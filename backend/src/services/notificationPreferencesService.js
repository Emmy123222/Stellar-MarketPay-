const pool = require("../db/pool");

const NOTIFICATION_TYPES = [
  "new_application",
  "application_accepted",
  "application_rejected",
  "payment_released",
  "new_message",
  "job_expiring",
  "dispute_filed",
  "weekly_digest",
  "announcements",
];

async function getPreferences(userAddress) {
  try {
    const result = await pool.query(
      `SELECT notification_type, channel, enabled FROM notification_preferences
       WHERE user_address = $1 ORDER BY notification_type, channel`,
      [userAddress]
    );

    const preferences = {};
    NOTIFICATION_TYPES.forEach((type) => {
      preferences[type] = { email: true, inapp: true };
    });

    result.rows.forEach((row) => {
      if (!preferences[row.notification_type]) {
        preferences[row.notification_type] = { email: true, inapp: true };
      }
      preferences[row.notification_type][row.channel] = row.enabled;
    });

    return preferences;
  } catch (err) {
    console.error("Error getting notification preferences:", err);
    throw err;
  }
}

async function updatePreference(userAddress, notificationType, channel, enabled) {
  try {
    await pool.query(
      `INSERT INTO notification_preferences (user_address, notification_type, channel, enabled)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_address, notification_type, channel)
       DO UPDATE SET enabled = $4, updated_at = NOW()`,
      [userAddress, notificationType, channel, enabled]
    );
  } catch (err) {
    console.error("Error updating notification preference:", err);
    throw err;
  }
}

async function updatePreferences(userAddress, preferences) {
  try {
    for (const [notificationType, channels] of Object.entries(preferences)) {
      for (const [channel, enabled] of Object.entries(channels)) {
        await updatePreference(userAddress, notificationType, channel, enabled);
      }
    }
  } catch (err) {
    console.error("Error updating notification preferences:", err);
    throw err;
  }
}

async function isNotificationEnabled(userAddress, notificationType, channel) {
  try {
    const result = await pool.query(
      `SELECT enabled FROM notification_preferences
       WHERE user_address = $1 AND notification_type = $2 AND channel = $3`,
      [userAddress, notificationType, channel]
    );
    return result.rows.length === 0 || result.rows[0].enabled;
  } catch (err) {
    console.error("Error checking notification enabled:", err);
    return true;
  }
}

module.exports = {
  NOTIFICATION_TYPES,
  getPreferences,
  updatePreference,
  updatePreferences,
  isNotificationEnabled,
};
