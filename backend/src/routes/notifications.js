const express = require("express");
const router = express.Router();
const { verifyJWT } = require("../middleware/auth");
const notificationPreferencesService = require("../services/notificationPreferencesService");

router.get("/preferences", verifyJWT, async (req, res, next) => {
  try {
    const preferences = await notificationPreferencesService.getPreferences(
      req.user.publicKey
    );
    res.json({
      success: true,
      data: {
        notificationTypes: notificationPreferencesService.NOTIFICATION_TYPES,
        preferences,
      },
    });
  } catch (e) {
    next(e);
  }
});

router.patch("/preferences", verifyJWT, async (req, res, next) => {
  try {
    const { preferences } = req.body;
    if (!preferences || typeof preferences !== "object") {
      const err = new Error("Invalid preferences format");
      err.status = 400;
      throw err;
    }

    await notificationPreferencesService.updatePreferences(
      req.user.publicKey,
      preferences
    );

    const updated = await notificationPreferencesService.getPreferences(
      req.user.publicKey
    );
    res.json({ success: true, data: updated });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
