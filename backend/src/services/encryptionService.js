"use strict";

const pool = require("../db/pool");

function getEncryptionKey() {
  const key = process.env.DATABASE_ENCRYPTION_KEY;
  if (!key || key.length < 16) {
    throw new Error("DATABASE_ENCRYPTION_KEY must be at least 16 characters");
  }
  return key;
}

async function encrypt(plaintext) {
  if (plaintext == null || plaintext === "") return null;
  const { rows } = await pool.query(
    "SELECT pgp_sym_encrypt($1, $2) AS encrypted_text",
    [plaintext, getEncryptionKey()]
  );
  return rows[0].encrypted_text;
}

async function decrypt(encryptedText) {
  if (encryptedText == null) return null;
  try {
    const { rows } = await pool.query(
      "SELECT pgp_sym_decrypt($1, $2) AS decrypted_text",
      [encryptedText, getEncryptionKey()]
    );
    return rows[0].decrypted_text;
  } catch {
    return null;
  }
}

async function encryptMany(values) {
  if (!values || values.length === 0) return [];
  const key = getEncryptionKey();
  const placeholders = values.map((_, i) => `pgp_sym_encrypt($${i + 1}, $${values.length + 1})`).join(", ");
  const { rows } = await pool.query(
    `SELECT ${placeholders}`,
    [...values, key]
  );
  return Object.values(rows[0]);
}

module.exports = { encrypt, decrypt, encryptMany, getEncryptionKey };
