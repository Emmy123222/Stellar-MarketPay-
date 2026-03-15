/**
 * src/services/profileService.js
 */
"use strict";

const { profiles } = require("./store");

function validatePublicKey(key) {
  if (!key || !/^G[A-Z0-9]{55}$/.test(key)) {
    const e = new Error("Invalid Stellar public key"); e.status = 400; throw e;
  }
}

function getProfile(publicKey) {
  validatePublicKey(publicKey);
  const profile = profiles.get(publicKey);
  if (!profile) { const e = new Error("Profile not found"); e.status = 404; throw e; }
  return profile;
}

function upsertProfile({ publicKey, displayName, bio, skills, role }) {
  validatePublicKey(publicKey);
  const existing = profiles.get(publicKey) || {
    publicKey,
    completedJobs:   0,
    totalEarnedXLM:  "0",
    rating:          null,
    createdAt:       new Date().toISOString(),
  };

  const updated = {
    ...existing,
    displayName: displayName?.trim() || existing.displayName || null,
    bio:         bio?.trim()         || existing.bio         || null,
    skills:      Array.isArray(skills) ? skills.slice(0, 15) : existing.skills || [],
    role:        role || existing.role || "both",
    updatedAt:   new Date().toISOString(),
  };

  profiles.set(publicKey, updated);
  return updated;
}

module.exports = { getProfile, upsertProfile };
