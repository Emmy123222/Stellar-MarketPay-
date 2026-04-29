/**
 * src/services/profileService.js
 * Service responsibility: Manages user profiles for clients and freelancers, including retrieval, creation, and updating.
 * All data persisted in the `profiles` PostgreSQL table.
 */
"use strict";

const pool = require("../db/pool");
const { validatePortfolioFiles } = require("./ipfsService");

const VALID_PROFILE_ROLES = ["client", "freelancer", "both"];
const VALID_PORTFOLIO_TYPES = ["github", "live", "stellar_tx", "file"];
const VALID_AVAILABILITY_STATUSES = ["available", "busy", "unavailable"];
const MAX_PORTFOLIO_ITEMS = 10;

/**
 * Camel-cased profile record returned by this service.
 *
 * @typedef {Object} UserProfile
 * @property {string}     publicKey         Stellar G-address (primary key).
 * @property {string|null} displayName
 * @property {string|null} bio
 * @property {string[]}   skills
 * @property {PortfolioItem[]} portfolioItems
 * @property {Object[]}   portfolioFiles     - IPFS uploaded files
 * @property {Availability|null} availability
 * @property {("client"|"freelancer"|"both")} role
 * @property {number}     completedJobs
 * @property {string}     totalEarnedXLM    Fixed-point string.
 * @property {number|null} rating           Average rating (1..5), null until rated.
 * @property {string|null} didHash          Optional DID hash from identity verification.
 * @property {boolean|null} isKycVerified   True after a successful `verifyIdentity` call.
 * @property {number}     [ratingCount]     Number of ratings (only on getProfile result).
 * @property {number}     [reputationScore] Derived score 0..100 (only on getProfile result).
 * @property {{ avgAcceptHours: number, avgReleaseHours: number }} [reputationMetrics]
 * @property {string}     createdAt
 * @property {string}     updatedAt
 */

/**
 * @typedef {Object} PortfolioItem
 * @property {string} title
 * @property {("github"|"live"|"stellar_tx")} type
 * @property {string} url
 */

/**
 * @typedef {Object} Availability
 * @property {("available"|"busy"|"unavailable")} status
 * @property {string} [availableFrom]   ISO timestamp.
 * @property {string} [availableUntil]  ISO timestamp.
 */

/**
 * Input shape accepted by {@link upsertProfile}.
 *
 * @typedef {Object} UpsertProfileInput
 * @property {string}            publicKey
 * @property {string}            [displayName]
 * @property {string}            [bio]
 * @property {string[]}          [skills]
 * @property {PortfolioItem[]}   [portfolioItems]
 * @property {Object[]}          [portfolioFiles] - IPFS uploaded files
 * @property {Availability}      [availability]
 * @property {("client"|"freelancer"|"both")} [role]
 */

/**
 * Throws a 400 Error when `key` is not a valid Stellar G-address.
 *
 * @param {string} key
 * @returns {void}
 * @throws {Error} `status === 400` if the key fails the G-address regex.
 */
function validatePublicKey(key) {
  if (!key || !/^G[A-Z0-9]{55}$/.test(key)) {
    const e = new Error("Invalid Stellar public key");
    e.status = 400;
    throw e;
  }
}

function createValidationError(message) {
  const e = new Error(message);
  e.status = 400;
  return e;
}

function validateProfileRole(role) {
  if (role == null || role === "") return "both";
  if (!VALID_PROFILE_ROLES.includes(role)) {
    throw createValidationError("Role must be one of: client, freelancer, both");
  }
  return role;
}

function validatePortfolioUrl(url, type) {
  if (typeof url !== "string" || !url.trim()) {
    throw createValidationError("Each portfolio item must include a url");
  }

  const trimmedUrl = url.trim();
  if (type === "stellar_tx") return trimmedUrl;

  try {
    const parsed = new URL(trimmedUrl);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error("Invalid protocol");
    }
  } catch (_) {
    throw createValidationError("Portfolio item url must be a valid http or https URL");
  }

  return trimmedUrl;
}

function validatePortfolioItems(portfolioItems) {
  if (portfolioItems == null) return [];
  if (!Array.isArray(portfolioItems)) {
    throw createValidationError("portfolioItems must be an array");
  }
  if (portfolioItems.length > MAX_PORTFOLIO_ITEMS) {
    throw createValidationError(`portfolioItems cannot exceed ${MAX_PORTFOLIO_ITEMS} items`);
  }

  return portfolioItems.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw createValidationError("Each portfolio item must be an object");
    }

    const title = typeof item.title === "string" ? item.title.trim() : "";
    const type = typeof item.type === "string" ? item.type.trim() : "";

    if (!title) {
      throw createValidationError("Each portfolio item must include a title");
    }
    if (!VALID_PORTFOLIO_TYPES.includes(type)) {
      throw createValidationError("Portfolio item type must be one of: github, live, stellar_tx");
    }

    return {
      title,
      type,
      url: validatePortfolioUrl(item.url, type),
    };
  });
}

function validateAvailabilityDate(value, fieldName) {
  if (value == null || value === "") return null;
  if (typeof value !== "string") {
    throw createValidationError(`${fieldName} must be a valid date string`);
  }

  const trimmedValue = value.trim();
  const date = new Date(trimmedValue);
  if (Number.isNaN(date.getTime())) {
    throw createValidationError(`${fieldName} must be a valid date string`);
  }

  return date.toISOString();
}

function validateAvailability(availability) {
  if (availability == null) return null;
  if (typeof availability !== "object" || Array.isArray(availability)) {
    throw createValidationError("availability must be an object");
  }

  const status = typeof availability.status === "string" ? availability.status.trim() : "";
  if (!VALID_AVAILABILITY_STATUSES.includes(status)) {
    throw createValidationError("Availability status must be one of: available, busy, unavailable");
  }

  const availableFrom = validateAvailabilityDate(availability.availableFrom, "availableFrom");
  const availableUntil = validateAvailabilityDate(availability.availableUntil, "availableUntil");

  if (availableFrom && availableUntil && new Date(availableFrom) > new Date(availableUntil)) {
    throw createValidationError("availableFrom must be before availableUntil");
  }

  return {
    status,
    ...(availableFrom ? { availableFrom } : {}),
    ...(availableUntil ? { availableUntil } : {}),
  };
}

/**
 * Convert a snake_case `profiles` row into the camelCase API object.
 *
 * @param {Object} row
 * @returns {UserProfile}
 */
function rowToProfile(row) {
  return {
    publicKey: row.public_key,
    displayName: row.display_name,
    bio: row.bio,
    skills: row.skills,
    portfolioItems: Array.isArray(row.portfolio_items) ? row.portfolio_items : [],
    portfolioFiles: Array.isArray(row.portfolio_files) ? row.portfolio_files : [],
    availability: row.availability && typeof row.availability === "object" ? row.availability : null,
    role: row.role,
    completedJobs: row.completed_jobs,
    totalEarnedXLM: row.total_earned_xlm,
    rating: row.rating !== null ? parseFloat(row.rating) : null,
    blockedAddresses: Array.isArray(row.blocked_addresses) ? row.blocked_addresses : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Retrieve a user profile by their Stellar public key. Includes average rating and rating count.
 *
 * @param {string} publicKey - The Stellar public key of the user.
 * @returns {Promise<Object>} The user profile object.
 * @throws {Error} If the public key is invalid or the profile is not found.
 */
async function getProfile(publicKey) {
  validatePublicKey(publicKey);

  const { rows } = await pool.query(
    `SELECT p.*,
       ROUND(AVG(r.stars)::numeric, 2) AS avg_rating,
       COUNT(r.id)::int                AS rating_count,
       -- Reputation metrics
       (SELECT ROUND(AVG(EXTRACT(EPOCH FROM (a.accepted_at - j.created_at)) / 3600)::numeric, 1)
        FROM jobs j
        JOIN applications a ON a.job_id = j.id
        WHERE j.client_address = p.public_key AND a.status = 'accepted' AND a.accepted_at IS NOT NULL
       ) AS avg_accept_hours,
       (SELECT ROUND(AVG(EXTRACT(EPOCH FROM (e.released_at - e.created_at)) / 3600)::numeric, 1)
        FROM escrows e
        JOIN jobs j ON j.id = e.job_id
        WHERE j.client_address = p.public_key AND e.status = 'released' AND e.released_at IS NOT NULL
       ) AS avg_release_hours
     FROM profiles p
     LEFT JOIN ratings r ON r.rated_address = p.public_key
     WHERE p.public_key = $1
     GROUP BY p.public_key`,
    [publicKey]
  );

  if (!rows.length) {
    const e = new Error("Profile not found");
    e.status = 404;
    throw e;
  }

  const profile = rowToProfile(rows[0]);
  profile.rating = rows[0].avg_rating !== null ? parseFloat(rows[0].avg_rating) : null;
  profile.ratingCount = rows[0].rating_count;

  // Calculate reputation score (simple formula: higher weight on ratings, lower on time)
  // Max score 100.
  let repScore = 0;
  if (profile.rating) repScore += profile.rating * 15; // up to 75

  // Bonus for fast acceptance (avg < 24h)
  const acceptHours = parseFloat(rows[0].avg_accept_hours || 0);
  if (acceptHours > 0 && acceptHours < 24) repScore += 15;
  else if (acceptHours > 0 && acceptHours < 72) repScore += 10;

  // Bonus for fast release (avg < 48h)
  const releaseHours = parseFloat(rows[0].avg_release_hours || 0);
  if (releaseHours > 0 && releaseHours < 48) repScore += 10;
  else if (releaseHours > 0 && releaseHours < 168) repScore += 5;

  // Bonus for referral activity (1 point per 2 referrals, max 10)
  repScore += Math.min(Math.floor((profile.referralCount || 0) / 2), 10);

  // Direct reputation points from referrals/completions
  repScore += (profile.reputationPoints || 0);

  profile.reputationScore = Math.min(repScore, 100);
  profile.reputationMetrics = {
    avgAcceptHours: acceptHours,
    avgReleaseHours: releaseHours
  };

  return profile;
}

/**
 * @typedef {Object} UpsertProfileInput
 * @property {string} publicKey - The Stellar public key of the user.
 * @property {string} [displayName] - The display name of the user.
 * @property {string} [bio] - The user's biography.
 * @property {string[]} [skills] - Array of skills (max 15).
 * @property {Object[]} [portfolioItems] - Array of portfolio items (max 10).
 * @property {Object} [availability] - Availability status and dates.
 * @property {string} [role] - The role of the user (e.g., 'freelancer', 'client', 'both').
 */

/**
 * Create or update a user profile. Only provided fields will be updated if the profile already exists.
 *
 * @param {UpsertProfileInput} params - The profile details to upsert.
 * @returns {Promise<Object>} The created or updated profile object.
 * @throws {Error} If the public key is invalid.
 *
 * @example
 * const profile = await profileService.upsertProfile({
 *   publicKey: 'GBX...',
 *   displayName: 'Alice Developer',
 *   bio: 'Full-stack developer specializing in Stellar network integrations.',
 *   skills: ['React', 'Node.js', 'Stellar SDK'],
 *   portfolioItems: [{
 *     title: 'My Awesome Project',
 *     type: 'live',
 *     url: 'https://example.com',
 *   }],
 *   availability: {
 *     status: 'available',
 *     availableFrom: '2023-01-01',
 *     availableUntil: '2023-12-31',
 *   },
 *   role: 'freelancer',
 * });
 */
async function upsertProfile({ publicKey, displayName, bio, skills, portfolioItems, availability, role }) {
  validatePublicKey(publicKey);

  const safeSkills = Array.isArray(skills) ? skills.slice(0, 15) : null;
  const safePortfolioItems = validatePortfolioItems(portfolioItems);
  const safePortfolioFiles = validatePortfolioFiles(portfolioFiles);
  const safeAvailability = validateAvailability(availability);
  const safeRole = validateProfileRole(role);

  const { rows } = await pool.query(
    `
    INSERT INTO profiles (public_key, display_name, bio, skills, portfolio_items, portfolio_files, availability, role, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9, NOW(), NOW())
    ON CONFLICT (public_key) DO UPDATE
      SET display_name = COALESCE(NULLIF(EXCLUDED.display_name, ''), profiles.display_name),
          bio = COALESCE(NULLIF(EXCLUDED.bio, ''), profiles.bio),
          skills = COALESCE(EXCLUDED.skills, profiles.skills),
          portfolio_items = COALESCE(EXCLUDED.portfolio_items, profiles.portfolio_items),
          portfolio_files = COALESCE(EXCLUDED.portfolio_files, profiles.portfolio_files),
          availability = COALESCE(EXCLUDED.availability, profiles.availability),
          role = COALESCE(NULLIF(EXCLUDED.role, ''), profiles.role),
          updated_at = NOW()
    RETURNING *
    `,
    [
      publicKey,
      displayName?.trim() || null,
      bio?.trim() || null,
      safeSkills,
      JSON.stringify(safePortfolioItems),
      JSON.stringify(safePortfolioFiles),
      safeAvailability ? JSON.stringify(safeAvailability) : null,
      safeRole,
    ]
  );

  return rowToProfile(rows[0]);
}

/**
 * Update only the availability block on a profile, creating the profile row
 * if it does not yet exist.
 *
 * @param {string}              publicKey     Stellar G-address.
 * @param {Availability|null}   availability  New availability block, or null to clear.
 * @returns {Promise<UserProfile>}
 * @throws {Error} 400 — invalid public key or availability shape.
 */
async function updateAvailability(publicKey, availability) {
  validatePublicKey(publicKey);
  const safeAvailability = validateAvailability(availability);

  const { rows } = await pool.query(
    `
    INSERT INTO profiles (public_key, availability, created_at, updated_at)
    VALUES ($1, $2::jsonb, NOW(), NOW())
    ON CONFLICT (public_key) DO UPDATE
      SET availability = EXCLUDED.availability,
          updated_at = NOW()
    RETURNING *
    `,
    [publicKey, safeAvailability ? JSON.stringify(safeAvailability) : null]
  );

  return rowToProfile(rows[0]);
}

async function isBlocked(clientPublicKey, freelancerAddress) {
  validatePublicKey(clientPublicKey);
  validatePublicKey(freelancerAddress);

  const { rows } = await pool.query(
    `SELECT 1 FROM profiles WHERE public_key = $1 AND $2 = ANY(blocked_addresses)`,
    [clientPublicKey, freelancerAddress]
  );
  return rows.length > 0;
}

async function blockFreelancer(clientPublicKey, freelancerAddress) {
  validatePublicKey(clientPublicKey);
  validatePublicKey(freelancerAddress);

  if (clientPublicKey === freelancerAddress) {
    const e = new Error("You cannot block yourself");
    e.status = 400;
    throw e;
  }

  const { rows } = await pool.query(
    `UPDATE profiles
     SET blocked_addresses = array_append(blocked_addresses, $2),
         updated_at = NOW()
     WHERE public_key = $1
       AND NOT ($2 = ANY(blocked_addresses))
     RETURNING *`,
    [clientPublicKey, freelancerAddress]
  );

  if (!rows.length) {
    // Already blocked or profile not found; check which
    const profile = await getProfile(clientPublicKey);
    if (profile.blockedAddresses.includes(freelancerAddress)) {
      const e = new Error("Freelancer is already blocked");
      e.status = 409;
      throw e;
    }
  }

  return rowToProfile(rows[0]);
}

async function unblockFreelancer(clientPublicKey, freelancerAddress) {
  validatePublicKey(clientPublicKey);
  validatePublicKey(freelancerAddress);

  const { rows } = await pool.query(
    `UPDATE profiles
     SET blocked_addresses = array_remove(blocked_addresses, $2),
         updated_at = NOW()
     WHERE public_key = $1
     RETURNING *`,
    [clientPublicKey, freelancerAddress]
  );

  if (!rows.length) {
    const e = new Error("Profile not found");
    e.status = 404;
    throw e;
  }

  return rowToProfile(rows[0]);
}

module.exports = {
  getProfile,
  upsertProfile,
  updateAvailability,
  isBlocked,
  blockFreelancer,
  unblockFreelancer,
  VALID_PORTFOLIO_TYPES,
  VALID_AVAILABILITY_STATUSES,
  MAX_PORTFOLIO_ITEMS,
};
