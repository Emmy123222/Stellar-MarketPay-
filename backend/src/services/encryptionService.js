"use strict";

const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;

function getEncryptionKey() {
  const key = process.env.DATABASE_ENCRYPTION_KEY;
  if (!key || key.length < 16) {
    throw new Error("DATABASE_ENCRYPTION_KEY must be at least 16 characters");
  }
  
  // Ensure the key is exactly 32 bytes for aes-256-gcm
  // If the user provided key is exactly 32 chars, use it.
  // Otherwise, hash it to 32 bytes.
  if (Buffer.from(key).length === 32) {
    return Buffer.from(key);
  }
  return crypto.createHash("sha256").update(String(key)).digest();
}

function encrypt(plaintext) {
  if (plaintext == null || plaintext === "") return null;
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

function decrypt(encryptedText) {
  if (encryptedText == null || encryptedText === "") return null;
  try {
    const parts = encryptedText.split(":");
    if (parts.length !== 3) {
      return null; // Not in expected format, possibly old data or invalid
    }
    const [ivHex, authTagHex, encryptedDataHex] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const key = getEncryptionKey();
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedDataHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch (error) {
    return null;
  }
}

function hashEmail(email) {
  if (!email) return null;
  const emailStr = email.trim().toLowerCase();
  const key = getEncryptionKey();
  const hmac = crypto.createHmac("sha256", key);
  hmac.update(emailStr);
  return hmac.digest("hex");
}

module.exports = { encrypt, decrypt, hashEmail, getEncryptionKey };
