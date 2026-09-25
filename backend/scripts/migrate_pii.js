"use strict";

require("dotenv").config();
const { Pool } = require("pg");
const encryptionService = require("../src/services/encryptionService");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function migrate() {
  const client = await pool.connect();
  try {
    const key = process.env.DATABASE_ENCRYPTION_KEY;
    if (!key) throw new Error("DATABASE_ENCRYPTION_KEY is required");

    console.log("Starting PII data encryption migration...");

    // Fetch all profiles. We attempt to decrypt existing PGP-encrypted fields using Postgres.
    // If the field contains ':', we assume it's already AES-256-GCM migrated and skip Postgres decryption.
    const { rows } = await client.query(`
      SELECT 
        public_key,
        email,
        webhook_secret,
        encrypted_email,
        encrypted_webhook_secret,
        CASE 
          WHEN encrypted_email IS NOT NULL AND encrypted_email NOT LIKE '%:%' THEN 
            (SELECT pgp_sym_decrypt(encrypted_email::bytea, $1))
          ELSE NULL
        END AS pgp_email,
        CASE 
          WHEN encrypted_webhook_secret IS NOT NULL AND encrypted_webhook_secret NOT LIKE '%:%' THEN 
            (SELECT pgp_sym_decrypt(encrypted_webhook_secret::bytea, $1))
          ELSE NULL
        END AS pgp_webhook_secret
      FROM profiles
    `, [key]);

    console.log(`Found ${rows.length} profiles to process.`);

    let migratedCount = 0;

    for (const row of rows) {
      // Determine the plaintext values
      let plaintextEmail = row.pgp_email || row.email || null;
      let plaintextWebhook = row.pgp_webhook_secret || row.webhook_secret || null;

      // If the row was already migrated, our Node.js decrypt will work on the encrypted column
      if (!plaintextEmail && row.encrypted_email && row.encrypted_email.includes(':')) {
        plaintextEmail = encryptionService.decrypt(row.encrypted_email);
      }
      if (!plaintextWebhook && row.encrypted_webhook_secret && row.encrypted_webhook_secret.includes(':')) {
        plaintextWebhook = encryptionService.decrypt(row.encrypted_webhook_secret);
      }

      const emailHash = encryptionService.hashEmail(plaintextEmail);
      const newEncryptedEmail = encryptionService.encrypt(plaintextEmail);
      const newEncryptedWebhook = encryptionService.encrypt(plaintextWebhook);

      await client.query(`
        UPDATE profiles
        SET 
          encrypted_email = $2,
          encrypted_webhook_secret = $3,
          email_hash = $4
        WHERE public_key = $1
      `, [
        row.public_key,
        newEncryptedEmail,
        newEncryptedWebhook,
        emailHash
      ]);

      migratedCount++;
    }

    console.log(`Migration complete. Successfully migrated ${migratedCount} profiles.`);
  } catch (error) {
    console.error("Migration failed:", error);
  } finally {
    client.release();
    pool.end();
  }
}

if (require.main === module) {
  migrate();
}

module.exports = { migrate };
