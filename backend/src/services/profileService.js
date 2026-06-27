/**
 * src/services/profileService.js
 * Service responsibility: Manages user profiles for clients and freelancers, including retrieval, creation, and updating.
 * All data persisted in the `profiles` PostgreSQL table.
 */
"use strict";

const pool = require("../db/pool");
const { validatePortfolioFiles } = require("./ipfsService");
const encryptionService = require("./encryptionService");

const VALID_PROFILE_ROLES = ["client", "freelancer", "both"];
const VALID_PORTFOLIO_TYPES = ["github", "live", "stellar_tx", "file"];
const VALID_AVAILABILITY_STATUSES = ["available", "busy", "unavailable"];
const MAX_PORTFOLIO_ITEMS = 10;
const FREELANCER_TIERS = {
  NEWCOMER: "Newcomer",
  RISING_TALENT: "Rising Talent",
  TOP_RATED: "Top Rated",
  EXPERT: "Expert",
};

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
 * @property {string|null} email            Email address for notifications.
 * @property {boolean}    emailNotificationsEnabled  Whether email notifications are enabled.
 * @property {string|null} webhookUrl       Webhook URL for programmatic notifications.
 * @property {string|null} webhookSecret    Secret for webhook HMAC signatures.
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
 * @property {string}            [email] - Email address for notifications
 * @property {boolean}           [emailNotificationsEnabled] - Enable email notifications
 * @property {string}            [webhookUrl] - Webhook URL for notifications
 * @property {string}            [webhookSecret] - Secret for webhook HMAC
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
  const decryptedEmail = row.email || null;
  const decryptedWebhookSecret = row.webhook_secret || null;

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
    referralCount: Number(row.referral_count || 0),
    reputationPoints: Number(row.reputation_points || 0),
    blockedAddresses: Array.isArray(row.blocked_addresses) ? row.blocked_addresses : [],
    email: decryptedEmail,
    emailNotificationsEnabled: row.email_notifications_enabled !== null ? row.email_notifications_enabled : null,
    webhookUrl: row.webhook_url || null,
    webhookSecret: decryptedWebhookSecret,
    isKycVerified: row.is_kyc_verified !== null ? row.is_kyc_verified : null,
    didHash: row.did_hash || null,
    encryptionPublicKey: row.encryption_public_key || null,
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

  const encKey = encryptionService.getEncryptionKey();
  const { rows } = await pool.query(
    `SELECT p.public_key, p.display_name, p.bio, p.skills, p.portfolio_items,
            p.portfolio_files, p.availability, p.role, p.completed_jobs,
            p.total_earned_xlm, p.rating, p.referral_count, p.reputation_points,
            p.blocked_addresses,
            p.email_notifications_enabled, p.webhook_url,
            p.is_kyc_verified, p.did_hash, p.encryption_public_key,
            p.created_at, p.updated_at,
            COALESCE(
              CASE WHEN p.encrypted_email IS NOT NULL
                THEN pgp_sym_decrypt(p.encrypted_email, $2)
              END,
              p.email
            ) AS email,
            COALESCE(
              CASE WHEN p.encrypted_webhook_secret IS NOT NULL
                THEN pgp_sym_decrypt(p.encrypted_webhook_secret, $3)
              END,
              p.webhook_secret
            ) AS webhook_secret,
       ROUND(AVG(r.stars)::numeric, 2) AS avg_rating,
       COUNT(r.id)::int                AS rating_count,
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
     WHERE p.public_key = $1 AND (p.deletion_status IS NULL OR p.deletion_status = 'active')
     GROUP BY p.public_key`,
    [publicKey, encKey, encKey]
  );

  if (!rows.length) {
    const e = new Error("Profile not found");
    e.status = 404;
    throw e;
  }

  const profile = rowToProfile(rows[0]);
  profile.rating = rows[0].avg_rating !== null ? parseFloat(rows[0].avg_rating) : null;
  profile.ratingCount = rows[0].rating_count;
  profile.tier = await calculateTier(publicKey);

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
async function upsertProfile({ publicKey, displayName, bio, skills, portfolioItems, portfolioFiles, availability, role, email, emailNotificationsEnabled, webhookUrl, webhookSecret, encryptionPublicKey }) {
  validatePublicKey(publicKey);

  const safeSkills = Array.isArray(skills) ? skills.slice(0, 15) : null;
  const safePortfolioItems = validatePortfolioItems(portfolioItems);
  const safePortfolioFiles = validatePortfolioFiles(portfolioFiles);
  const safeAvailability = availability === undefined ? null : validateAvailability(availability);
  const safeRole = validateProfileRole(role);
  const encKey = encryptionService.getEncryptionKey();

  const { rows } = await pool.query(
    `
    INSERT INTO profiles (public_key, display_name, bio, skills, portfolio_items, portfolio_files, availability, role, email, email_notifications_enabled, webhook_url, webhook_secret, encrypted_email, encrypted_webhook_secret, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9, $10, $11, $12,
            CASE WHEN $9 IS NOT NULL AND $9 != '' THEN pgp_sym_encrypt($9, $13) END,
            CASE WHEN $12 IS NOT NULL AND $12 != '' THEN pgp_sym_encrypt($12, $13) END,
            NOW(), NOW())
    ON CONFLICT (public_key) DO UPDATE
      SET display_name = COALESCE(NULLIF(EXCLUDED.display_name, ''), profiles.display_name),
          bio = COALESCE(NULLIF(EXCLUDED.bio, ''), profiles.bio),
          skills = COALESCE(EXCLUDED.skills, profiles.skills),
          portfolio_items = COALESCE(EXCLUDED.portfolio_items, profiles.portfolio_items),
          portfolio_files = COALESCE(EXCLUDED.portfolio_files, profiles.portfolio_files),
          availability = COALESCE(EXCLUDED.availability, profiles.availability),
          role = COALESCE(NULLIF(EXCLUDED.role, ''), profiles.role),
          email = COALESCE(NULLIF(EXCLUDED.email, ''), profiles.email),
          email_notifications_enabled = COALESCE(EXCLUDED.email_notifications_enabled, profiles.email_notifications_enabled),
          webhook_url = COALESCE(NULLIF(EXCLUDED.webhook_url, ''), profiles.webhook_url),
          webhook_secret = COALESCE(NULLIF(EXCLUDED.webhook_secret, ''), profiles.webhook_secret),
          encrypted_email = CASE WHEN EXCLUDED.email IS NOT NULL AND EXCLUDED.email != '' THEN pgp_sym_encrypt(EXCLUDED.email, $13) ELSE profiles.encrypted_email END,
          encrypted_webhook_secret = CASE WHEN EXCLUDED.webhook_secret IS NOT NULL AND EXCLUDED.webhook_secret != '' THEN pgp_sym_encrypt(EXCLUDED.webhook_secret, $13) ELSE profiles.encrypted_webhook_secret END,
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
      email?.trim() || null,
      emailNotificationsEnabled !== undefined ? emailNotificationsEnabled : null,
      webhookUrl?.trim() || null,
      webhookSecret?.trim() || null,
      encKey,
    ]
  );

  const profile = rowToProfile(rows[0]);

  if (encryptionPublicKey && typeof encryptionPublicKey === "string") {
    await pool.query(
      `UPDATE profiles SET encryption_public_key = $2 WHERE public_key = $1`,
      [publicKey, encryptionPublicKey.trim()],
    );
    profile.encryptionPublicKey = encryptionPublicKey.trim();
  }

  return profile;
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

async function listProfiles({ role, availability, search, limit = 50 } = {}) {
  const conditions = ["(deletion_status IS NULL OR deletion_status = 'active')"];
  const values = [];
  let idx = 1;

  if (role) {
    if (role === "freelancer") {
      conditions.push(`role IN ($${idx}, $${idx + 1})`);
      values.push("freelancer", "both");
      idx += 2;
    } else if (role === "client") {
      conditions.push(`role IN ($${idx}, $${idx + 1})`);
      values.push("client", "both");
      idx += 2;
    } else if (VALID_PROFILE_ROLES.includes(role)) {
      conditions.push(`role = $${idx}`);
      values.push(role);
      idx += 1;
    } else {
      throw createValidationError("Role must be one of: client, freelancer, both");
    }
  }

  if (availability != null) {
    if (!VALID_AVAILABILITY_STATUSES.includes(availability)) {
      throw createValidationError("Availability status must be one of: available, busy, unavailable");
    }
    conditions.push(`availability->>'status' = $${idx}`);
    values.push(availability);
    idx += 1;
  }

  if (search && typeof search === "string" && search.trim()) {
    const searchValue = `%${search.trim()}%`;
    conditions.push(`(display_name ILIKE $${idx} OR bio ILIKE $${idx} OR public_key ILIKE $${idx} OR skills::text ILIKE $${idx})`);
    values.push(searchValue);
    idx += 1;
  }

  const safeLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 50;
  values.push(safeLimit);
  const encKey = encryptionService.getEncryptionKey();
  values.push(encKey, encKey);

  const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await pool.query(
    `SELECT p.public_key, p.display_name, p.bio, p.skills, p.portfolio_items,
            p.portfolio_files, p.availability, p.role, p.completed_jobs,
            p.total_earned_xlm, p.rating, p.referral_count, p.reputation_points,
            p.blocked_addresses,
            p.email_notifications_enabled, p.webhook_url,
            p.is_kyc_verified, p.did_hash, p.created_at, p.updated_at,
            COALESCE(
              CASE WHEN p.encrypted_email IS NOT NULL
                THEN pgp_sym_decrypt(p.encrypted_email, $${idx + 1})
              END,
              p.email
            ) AS email,
            COALESCE(
              CASE WHEN p.encrypted_webhook_secret IS NOT NULL
                THEN pgp_sym_decrypt(p.encrypted_webhook_secret, $${idx + 2})
              END,
              p.webhook_secret
            ) AS webhook_secret
     FROM profiles p ${whereClause} ORDER BY p.updated_at DESC LIMIT $${idx}`,
    values,
  );

  return rows.map(rowToProfile);
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

/**
 * Fetch skill endorsements for a user, grouped by skill with counts and endorsers.
 *
 * @param {string} publicKey  Recipient Stellar G-address.
 * @returns {Promise<{ skill: string; count: number; endorsers: string[] }[]>}
 */
async function getSkillEndorsements(publicKey) {
  validatePublicKey(publicKey);

  const { rows } = await pool.query(
    `SELECT
       skill,
       COUNT(*)::int AS count,
       array_agg(endorser_address ORDER BY created_at DESC) AS endorsers
     FROM skill_endorsements
     WHERE recipient_address = $1
     GROUP BY skill
     ORDER BY count DESC, skill ASC`,
    [publicKey]
  );

  return rows;
}

/**
 * Create a skill endorsement.
 *
 * @param {Object} params
 * @param {string} params.skill            Skill name.
 * @param {string} params.endorserAddress  Endorser Stellar G-address.
 * @param {string} params.recipientAddress Recipient Stellar G-address.
 * @returns {Promise<void>}
 * @throws {Error} 400 — invalid public key, self-endorsement, or missing skill.
 */
async function endorseSkill({ skill, endorserAddress, recipientAddress }) {
  validatePublicKey(endorserAddress);
  validatePublicKey(recipientAddress);

  if (!skill || typeof skill !== "string" || !skill.trim()) {
    throw createValidationError("skill is required");
  }

  if (endorserAddress === recipientAddress) {
    const e = new Error("Cannot endorse your own skill");
    e.status = 400;
    throw e;
  }

  await pool.query(
    `INSERT INTO skill_endorsements (skill, endorser_address, recipient_address)
     VALUES ($1, $2, $3)
     ON CONFLICT (skill, endorser_address, recipient_address) DO NOTHING`,
    [skill.trim(), endorserAddress, recipientAddress]
  );
}

/**
 * Calculate freelancer tier from profile and job-history metrics.
 * @param {Object|number} metrics
 * @param {number|null} rating
 * @returns {string}
 */
function calculateFreelancerTier(metrics, rating = null) {
  const source = typeof metrics === "object" && metrics !== null
    ? metrics
    : { completedJobs: Number(metrics) || 0, rating };

  const completedJobs = Number(source.completedJobs) || 0;
  const totalJobs = Math.max(Number(source.totalJobs) || 0, completedJobs);
  const averageRating = Number(source.rating) || 0;
  const totalEarnedXlm = Number(source.totalEarnedXlm) || 0;
  const createdAt = source.createdAt ? new Date(source.createdAt) : null;
  const accountAgeMs = createdAt && !Number.isNaN(createdAt.getTime())
    ? Date.now() - createdAt.getTime()
    : null;
  const accountAgeDays = accountAgeMs == null ? null : accountAgeMs / (24 * 60 * 60 * 1000);
  const completionRate = totalJobs > 0 ? completedJobs / totalJobs : 0;

  if (completedJobs >= 20 && averageRating >= 4.8 && totalEarnedXlm >= 500) {
    return FREELANCER_TIERS.EXPERT;
  }
  if (completedJobs >= 5 && averageRating >= 4.5 && completionRate >= 0.9) {
    return FREELANCER_TIERS.TOP_RATED;
  }
  if (completedJobs >= 1 && accountAgeDays !== null && accountAgeDays < 90) {
    return FREELANCER_TIERS.RISING_TALENT;
  }
  return FREELANCER_TIERS.NEWCOMER;
}

async function calculateTier(publicKey, queryRunner = pool) {
  validatePublicKey(publicKey);

  const { rows } = await queryRunner.query(
    `
    SELECT
      p.created_at,
      GREATEST(
        COALESCE(p.completed_jobs, 0),
        COALESCE((SELECT COUNT(*) FROM jobs j WHERE j.freelancer_address = p.public_key AND j.status = 'completed'), 0)
      )::int AS completed_jobs,
      GREATEST(
        COALESCE(p.total_earned_xlm::numeric, 0),
        COALESCE((SELECT SUM(j.budget::numeric) FROM jobs j WHERE j.freelancer_address = p.public_key AND j.status = 'completed'), 0)
      ) AS total_earned_xlm,
      COALESCE((SELECT ROUND(AVG(r.stars)::numeric, 2) FROM ratings r WHERE r.rated_address = p.public_key), p.rating) AS avg_rating,
      COALESCE((SELECT COUNT(*) FROM jobs j WHERE j.freelancer_address = p.public_key), 0)::int AS total_jobs
    FROM profiles p
    WHERE p.public_key = $1
    `,
    [publicKey],
  );

  if (!rows.length) return FREELANCER_TIERS.NEWCOMER;

  const row = rows[0];
  return calculateFreelancerTier({
    completedJobs: row.completed_jobs,
    totalJobs: row.total_jobs,
    rating: row.avg_rating,
    totalEarnedXlm: row.total_earned_xlm,
    createdAt: row.created_at,
  });
}

async function refreshFreelancerTier(publicKey, queryRunner = pool) {
  validatePublicKey(publicKey);

  await queryRunner.query(
    `
    UPDATE profiles
    SET completed_jobs = stats.completed_jobs,
        total_earned_xlm = stats.total_earned_xlm,
        rating = stats.avg_rating,
        updated_at = NOW()
    FROM (
      SELECT
        COALESCE((SELECT COUNT(*) FROM jobs j WHERE j.freelancer_address = $1 AND j.status = 'completed'), 0)::int AS completed_jobs,
        COALESCE((SELECT SUM(j.budget::numeric) FROM jobs j WHERE j.freelancer_address = $1 AND j.status = 'completed'), 0)::numeric(20,7) AS total_earned_xlm,
        (SELECT ROUND(AVG(r.stars)::numeric, 2) FROM ratings r WHERE r.rated_address = $1) AS avg_rating
    ) stats
    WHERE profiles.public_key = $1
    `,
    [publicKey],
  );

  return calculateTier(publicKey, queryRunner);
}

async function getClientSpendingAnalytics(publicKey) {
  validatePublicKey(publicKey);

  const { rows } = await pool.query(
    `
    WITH client_jobs AS (
      SELECT id, budget::numeric AS budget, status, freelancer_address
      FROM jobs
      WHERE client_address = $1
    ),
    released_escrows AS (
      SELECT e.job_id, e.amount_xlm::numeric AS amount_xlm
      FROM escrows e
      JOIN client_jobs j ON j.id = e.job_id
      WHERE e.status = 'released'
    )
    SELECT
      COALESCE((SELECT SUM(amount_xlm) FROM released_escrows), 0)::numeric(20,7) AS total_spent_xlm,
      COALESCE((SELECT COUNT(*) FROM client_jobs), 0)::int AS jobs_posted,
      COALESCE((SELECT COUNT(*) FROM client_jobs WHERE status = 'completed'), 0)::int AS jobs_completed,
      COALESCE((SELECT COUNT(*) FROM client_jobs WHERE status = 'cancelled'), 0)::int AS jobs_cancelled,
      COALESCE((SELECT COUNT(*) FROM client_jobs WHERE status = 'in_progress'), 0)::int AS jobs_in_progress,
      COALESCE((SELECT AVG(budget) FROM client_jobs), 0)::numeric(20,7) AS average_budget_xlm,
      COALESCE((SELECT AVG(amount_xlm) FROM released_escrows), 0)::numeric(20,7) AS average_paid_xlm
    `,
    [publicKey]
  );
  const summary = rows[0];
  const { rows: topRows } = await pool.query(
    `
    SELECT
      j.freelancer_address,
      COUNT(*)::int AS jobs_count,
      COALESCE(SUM(e.amount_xlm::numeric), 0)::numeric(20,7) AS total_paid_xlm
    FROM jobs j
    JOIN escrows e ON e.job_id = j.id
    WHERE j.client_address = $1
      AND e.status = 'released'
      AND j.freelancer_address IS NOT NULL
    GROUP BY j.freelancer_address
    ORDER BY jobs_count DESC, total_paid_xlm DESC
    LIMIT 5
    `,
    [publicKey]
  );

  return {
    totalSpentXlm: String(summary.total_spent_xlm),
    jobsBreakdown: {
      posted: Number(summary.jobs_posted) || 0,
      completed: Number(summary.jobs_completed) || 0,
      cancelled: Number(summary.jobs_cancelled) || 0,
      inProgress: Number(summary.jobs_in_progress) || 0,
    },
    averageBudgetXlm: String(summary.average_budget_xlm),
    averagePaidXlm: String(summary.average_paid_xlm),
    topFreelancers: topRows.map((row) => ({
      freelancerAddress: row.freelancer_address,
      jobsCount: Number(row.jobs_count) || 0,
      totalPaidXlm: String(row.total_paid_xlm),
    })),
    hasCompletedJobs: (Number(summary.jobs_completed) || 0) > 0,
  };
}

async function getClientReputation(publicKey) {
  validatePublicKey(publicKey);

  const { rows } = await pool.query(
    `
    WITH client_jobs AS (
      SELECT id, status, created_at, updated_at
      FROM jobs
      WHERE client_address = $1
    ),
    completed_jobs AS (
      SELECT id, created_at, updated_at
      FROM client_jobs
      WHERE status = 'completed'
    ),
    dispute_jobs AS (
      SELECT id FROM client_jobs WHERE status = 'disputed'
    ),
    release_metrics AS (
      SELECT
        COUNT(*)::int AS total_released,
        COUNT(*) FILTER (WHERE e.released_at <= e.created_at + INTERVAL '7 days')::int AS released_on_time,
        AVG(EXTRACT(EPOCH FROM (e.released_at - e.created_at)) / 3600.0) AS avg_release_hours
      FROM escrows e
      JOIN completed_jobs cj ON cj.id = e.job_id
      WHERE e.status = 'released' AND e.released_at IS NOT NULL
    ),
    response_metrics AS (
      SELECT AVG(EXTRACT(EPOCH FROM (a.accepted_at - j.created_at)) / 3600.0) AS avg_response_hours
      FROM jobs j
      JOIN applications a ON a.job_id = j.id
      WHERE j.client_address = $1
        AND a.status = 'accepted'
        AND a.accepted_at IS NOT NULL
    )
    SELECT
      (SELECT COUNT(*)::int FROM client_jobs) AS total_jobs,
      (SELECT COUNT(*)::int FROM completed_jobs) AS completed_jobs,
      (SELECT COUNT(*)::int FROM dispute_jobs) AS disputed_jobs,
      COALESCE((SELECT total_released FROM release_metrics), 0) AS total_released,
      COALESCE((SELECT released_on_time FROM release_metrics), 0) AS released_on_time,
      COALESCE((SELECT avg_release_hours FROM release_metrics), 0) AS avg_release_hours,
      COALESCE((SELECT avg_response_hours FROM response_metrics), 0) AS avg_response_hours
    `,
    [publicKey]
  );

  const row = rows[0];
  const totalJobs = Number(row.total_jobs) || 0;
  const completedJobs = Number(row.completed_jobs) || 0;
  const disputedJobs = Number(row.disputed_jobs) || 0;
  const totalReleased = Number(row.total_released) || 0;
  const releasedOnTime = Number(row.released_on_time) || 0;
  const avgReleaseHours = Number(row.avg_release_hours) || 0;
  const avgResponseHours = Number(row.avg_response_hours) || 0;

  const paymentReleaseRate = totalReleased > 0 ? releasedOnTime / totalReleased : 0;
  const disputeRate = totalJobs > 0 ? disputedJobs / totalJobs : 0;
  const completionRate = totalJobs > 0 ? completedJobs / totalJobs : 0;
  const responseTimeScore = avgResponseHours <= 0 ? 0 : Math.max(0, 1 - avgResponseHours / 168);
  const releaseSpeedScore = avgReleaseHours <= 0 ? 0 : Math.max(0, 1 - avgReleaseHours / 336);

  const score100 =
    paymentReleaseRate * 35 +
    (1 - disputeRate) * 25 +
    completionRate * 25 +
    responseTimeScore * 10 +
    releaseSpeedScore * 5;

  const score = Math.max(0, Math.min(5, Number(((score100 / 100) * 5).toFixed(2))));

  return {
    publicKey,
    score,
    paymentReleaseRate: Number((paymentReleaseRate * 100).toFixed(1)),
    disputeRate: Number((disputeRate * 100).toFixed(1)),
    completionRate: Number((completionRate * 100).toFixed(1)),
    avgTimeToReleaseHours: Number(avgReleaseHours.toFixed(1)),
    responseTimeToApplicationsHours: Number(avgResponseHours.toFixed(1)),
    totals: { totalJobs, completedJobs, disputedJobs, totalReleased, releasedOnTime },
  };
}

async function getProfileStats(publicKey) {
  validatePublicKey(publicKey);

  const { rows } = await pool.query(
    `
    SELECT
      COUNT(*)::int AS total_applications,
      COUNT(*) FILTER (WHERE a.status = 'accepted')::int AS accepted_applications
    FROM applications a
    JOIN jobs j ON j.id = a.job_id
    WHERE a.freelancer_address = $1
    `,
    [publicKey],
  );

  const totalApplications = Number(rows[0]?.total_applications || 0);
  const acceptedApplications = Number(rows[0]?.accepted_applications || 0);
  const successRate =
    totalApplications > 0
      ? Math.round((acceptedApplications / totalApplications) * 100)
      : 0;

  return { totalApplications, acceptedApplications, successRate };
}

async function getResponseTime(publicKey) {
  validatePublicKey(publicKey);

  const { rows } = await pool.query(
    `
    SELECT
      AVG(EXTRACT(EPOCH FROM (e.released_at - e.created_at)) / 86400.0) AS average_days
    FROM escrows e
    JOIN jobs j ON j.id = e.job_id
    WHERE j.freelancer_address = $1
      AND e.status = 'released'
      AND e.released_at IS NOT NULL
    `,
    [publicKey],
  );

  const value = rows[0]?.average_days;
  return { averageDays: value == null ? null : Number(value) };
}

/**
 * Mark a profile for deletion (GDPR compliance).
 * Starts the 30-day grace period.
 * 
 * @param {string} publicKey 
 * @returns {Promise<Object>}
 */
async function markProfileForDeletion(publicKey) {
  validatePublicKey(publicKey);
  
  const { rows } = await pool.query(
    `UPDATE profiles 
     SET deletion_status = 'pending_deletion', deleted_at = NOW(), updated_at = NOW()
     WHERE public_key = $1 AND (deletion_status IS NULL OR deletion_status = 'active')
     RETURNING *`,
    [publicKey]
  );
  
  if (!rows.length) {
    const e = new Error("Profile not found or already marked for deletion");
    e.status = 404;
    throw e;
  }
  
  return rowToProfile(rows[0]);
}

/**
 * Permanently delete profiles whose grace period has expired.
 * 
 * @returns {Promise<string[]>} Array of deleted public keys
 */
async function permanentlyDeleteExpiredProfiles() {
  const { rows } = await pool.query(
    `DELETE FROM profiles
     WHERE deletion_status = 'pending_deletion' AND deleted_at < NOW() - INTERVAL '30 days'
     RETURNING public_key`
  );
  return rows.map(r => r.public_key);
}

module.exports = {
  getProfile,
  upsertProfile,
  updateAvailability,
  listProfiles,
  getSkillEndorsements,
  endorseSkill,
  getClientSpendingAnalytics,
  getClientReputation,
  calculateTier,
  calculateFreelancerTier,
  refreshFreelancerTier,
  FREELANCER_TIERS,
  getProfileStats,
  getResponseTime,
  isBlocked,
  blockFreelancer,
  unblockFreelancer,
  VALID_PORTFOLIO_TYPES,
  VALID_AVAILABILITY_STATUSES,
  MAX_PORTFOLIO_ITEMS,
  markProfileForDeletion,
  permanentlyDeleteExpiredProfiles
};
