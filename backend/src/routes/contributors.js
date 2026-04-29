const express = require("express");
const router = express.Router();
const axios = require("axios");

const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
let contributorCache = { data: null, timestamp: 0 };

// Fetch top contributors from GitHub API
async function fetchGitHubContributors() {
  if (Date.now() - contributorCache.timestamp < CACHE_TTL && contributorCache.data) {
    return contributorCache.data;
  }

  try {
    const response = await axios.get(
      "https://api.github.com/repos/Emmy123222/Stellar-MarketPay-/contributors",
      {
        params: { per_page: 20, sort: "contributions" },
        headers: process.env.GITHUB_TOKEN ? { Authorization: `token ${process.env.GITHUB_TOKEN}` } : {},
      }
    );

    const contributors = response.data.map(c => ({
      login: c.login,
      avatar_url: c.avatar_url,
      profile_url: c.html_url,
      contributions: c.contributions,
      id: c.id,
    }));

    contributorCache = { data: contributors, timestamp: Date.now() };
    return contributors;
  } catch (error) {
    console.error("Error fetching GitHub contributors:", error.message);
    return contributorCache.data || [];
  }
}

// GET /api/contributors
router.get("/", async (req, res, next) => {
  try {
    const contributors = await fetchGitHubContributors();
    res.json({ success: true, data: contributors });
  } catch (error) {
    next(error);
  }
});

// POST /api/contributors/refresh (admin only, refreshes cache)
router.post("/refresh", async (req, res, next) => {
  try {
    contributorCache = { data: null, timestamp: 0 };
    const contributors = await fetchGitHubContributors();
    res.json({ success: true, data: contributors, message: "Cache refreshed" });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
