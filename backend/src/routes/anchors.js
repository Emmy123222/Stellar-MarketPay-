"use strict";

const express = require("express");
const router = express.Router();

function configuredAnchors() {
  try {
    const parsed = JSON.parse(process.env.SEP24_ANCHORS_JSON || "[]");
    if (Array.isArray(parsed)) return parsed.filter((anchor) => anchor && anchor.homeDomain);
  } catch {
    // Fall through to the simple comma-separated configuration.
  }
  return (process.env.SEP24_ANCHOR_DOMAINS || "")
    .split(",")
    .map((homeDomain) => homeDomain.trim())
    .filter(Boolean)
    .map((homeDomain) => ({ homeDomain }));
}

router.get("/", (_req, res) => {
  res.json({ success: true, data: configuredAnchors() });
});

module.exports = router;
