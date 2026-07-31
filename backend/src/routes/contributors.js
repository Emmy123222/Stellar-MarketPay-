/**
 * Contributors leaderboard route — Issue #844
 * GET /api/contributors — returns top 50 contributors sorted by contribution score
 *
 * Score = (jobs_completed × 10) + (xlm_transacted / 100) + (github_prs × 5)
 *
 * Weekly-refresh semantics: we cache the merged result for 1 hour (3600s)
 * so that repeated calls are snappy while the data stays reasonably fresh.
 *
 * @swagger
 * tags:
 *   name: Contributors
 *   description: GitHub contributor fetching
 */
"use strict";
const express = require("express");
const router = express.Router();
const axios = require("axios");
const pool = require("../db/pool");
const { createRateLimiter } = require("../middleware/rateLimiter");

// 60 requests per minute — public endpoint backed by GitHub API + DB queries
const contributorRateLimiter = createRateLimiter(60, 1);

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const GITHUB_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

let contributorCache = {
  data: null,
  timestamp: 0,
  _githubData: null,
  _githubTs: 0,
};

/** Gold (1-3), Silver (4-10), Bronze (11-50) */
function assignBadge(rank) {
  if (rank <= 3) return "Gold";
  if (rank <= 10) return "Silver";
  return "Bronze";
}

/**
 * Fetch top 50 GitHub contributors for the repository.
 * Uses a 24‑hour in‑memory cache, returning stale data on error.
 */
async function fetchGitHubContributors() {
  if (
    Date.now() - contributorCache._githubTs < GITHUB_CACHE_TTL_MS &&
    contributorCache._githubData
  ) {
    return contributorCache._githubData;
  }

  try {
    const response = await axios.get(
      "https://api.github.com/repos/Emmy123222/Stellar-MarketPay-/contributors",
      {
        params: { per_page: 50, sort: "contributions" },
        headers: process.env.GITHUB_TOKEN
          ? { Authorization: `token ${process.env.GITHUB_TOKEN}` }
          : {},
      }
    );

    const contributors = response.data.map((c) => ({
      login: c.login,
      avatar_url: c.avatar_url,
      profile_url: c.html_url,
      contributions: c.contributions,
      id: c.id,
    }));

    contributorCache._githubData = contributors;
    contributorCache._githubTs = Date.now();
    return contributors;
  } catch (error) {
    console.error("Error fetching GitHub contributors:", error.message);
    return contributorCache._githubData || [];
  }
}

/**
 * Query profiles with meaningful on‑platform activity.
 * Returns rows with display_name, completed_jobs, total_earned_xlm.
 */
async function fetchPlatformContributors() {
  const { rows } = await pool.query(`
    SELECT
      public_key,
      display_name,
      github_username,
      completed_jobs,
      total_earned_xlm
    FROM profiles
    WHERE deleted_at IS NULL
      AND (completed_jobs > 0 OR total_earned_xlm > 0)
    ORDER BY completed_jobs DESC, total_earned_xlm DESC
    LIMIT 100
  `);
  return rows;
}

/**
 * Merge GitHub contributor data with platform profiles, compute scores,
 * sort descending, and assign badges. Returns top 50 contributors.
 */
function computeLeaderboard(githubContributors, platformProfiles) {
  // Build a case-insensitive GitHub login → record lookup
  const githubByLogin = new Map();
  for (const gc of githubContributors) {
    githubByLogin.set(gc.login.toLowerCase(), gc);
  }

  const merged = new Map(); // key → contributor entry

  // Merge platform profiles with matching GitHub data.
  // Prefer github_username over display_name for matching.
  for (const profile of platformProfiles) {
    const githubUsername = (profile.github_username || "").toLowerCase();
    const displayName = profile.display_name || "";

    // Try github_username first, fall back to display_name
    const matchedGitHub =
      (githubUsername && githubByLogin.get(githubUsername)) ||
      (displayName && githubByLogin.get(displayName.toLowerCase())) ||
      null;

    const jobsCompleted = Number(profile.completed_jobs) || 0;
    const xlmTransacted = Number(profile.total_earned_xlm) || 0;
    const githubPrs = matchedGitHub ? matchedGitHub.contributions : 0;

    const score =
      jobsCompleted * 10 +
      Math.floor(xlmTransacted / 100) +
      githubPrs * 5;

    if (score > 0) {
      merged.set(profile.public_key, {
        public_key: profile.public_key,
        name:
          displayName ||
          matchedGitHub?.login ||
          profile.public_key.slice(0, 8),
        avatar_url: matchedGitHub?.avatar_url || null,
        profile_url: matchedGitHub?.profile_url || null,
        score,
        jobs_completed: jobsCompleted,
        xlm_transacted: xlmTransacted,
        github_prs: githubPrs,
      });
    }
  }

  // Track which GitHub logins were already matched (by either github_username or display_name)
  const usedLogins = new Set();
  for (const profile of platformProfiles) {
    if (profile.github_username) usedLogins.add(profile.github_username.toLowerCase());
    if (profile.display_name) usedLogins.add(profile.display_name.toLowerCase());
  }

  // Include unmatched GitHub-only contributors (open-source visibility)
  for (const gc of githubContributors) {
    if (usedLogins.has(gc.login.toLowerCase())) continue;
    const score = gc.contributions * 5;
    if (score > 0) {
      merged.set(`gh-${gc.id}`, {
        public_key: null,
        name: gc.login,
        avatar_url: gc.avatar_url,
        profile_url: gc.profile_url,
        score,
        jobs_completed: 0,
        xlm_transacted: 0,
        github_prs: gc.contributions,
      });
    }
  }

  // Sort descending, slice to 50, assign badges + ranks
  return Array.from(merged.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, 50)
    .map((entry, index) => ({
      ...entry,
      badge: assignBadge(index + 1),
      rank: index + 1,
    }));
}

/**
 * @swagger
 * /api/contributors:
 *   get:
 *     summary: Get top GitHub contributors (cached 24h)
 *     tags: [Contributors]
 *     responses:
 *       200:
 *         description: Contributor list
 */
router.get("/", contributorRateLimiter, async (req, res, next) => {
  try {
    // 1. Check main cache (1 hour TTL)
    if (Date.now() - contributorCache.timestamp < CACHE_TTL_MS && contributorCache.data) {
      return res.json({ success: true, data: contributorCache.data });
    }

    // 2. Fetch source data in parallel
    const [githubContributors, platformProfiles] = await Promise.all([
      fetchGitHubContributors(),
      fetchPlatformContributors(),
    ]);

    // 3. Merge, sort, assign badges
    const sorted = computeLeaderboard(githubContributors, platformProfiles);

    // 4. Cache the result for 1 hour
    contributorCache.data = sorted;
    contributorCache.timestamp = Date.now();

    res.json({ success: true, data: sorted });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/contributors/refresh:
 *   post:
 *     summary: Refresh contributor cache
 *     tags: [Contributors]
 *     responses:
 *       200:
 *         description: Cache refreshed
 */
// POST /api/contributors/refresh — busts all caches (admin-triggered)
router.post("/refresh", async (req, res, next) => {
  try {
    // Bust both caches
    contributorCache.data = null;
    contributorCache.timestamp = 0;
    contributorCache._githubData = null;
    contributorCache._githubTs = 0;

    const [githubContributors, platformProfiles] = await Promise.all([
      fetchGitHubContributors(),
      fetchPlatformContributors(),
    ]);

    const sorted = computeLeaderboard(githubContributors, platformProfiles);

    contributorCache.data = sorted;
    contributorCache.timestamp = Date.now();

    res.json({ success: true, data: sorted, message: "Cache refreshed" });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
