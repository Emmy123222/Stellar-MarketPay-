/**
 * src/routes/profiles.js
 */
"use strict";
const express = require("express");
const router  = express.Router();
const { getProfile, upsertProfile } = require("../services/profileService");

router.get("/:publicKey", (req, res, next) => {
  try { res.json({ success: true, data: getProfile(req.params.publicKey) }); }
  catch (e) { next(e); }
});

router.post("/", (req, res, next) => {
  try { res.json({ success: true, data: upsertProfile(req.body) }); }
  catch (e) { next(e); }
});

module.exports = router;
