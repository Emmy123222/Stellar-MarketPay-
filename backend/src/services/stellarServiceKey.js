/**
 * src/services/stellarServiceKey.js
 * Issue #536: Service keypair management for backend-to-contract calls
 *
 * Manages the Stellar service keypair used for contract interactions
 * (e.g., timeout_refund, admin operations). Key is loaded from environment
 * and validated. Production deployments should use HSM or AWS Secrets Manager.
 */

"use strict";

const { Keypair } = require("@stellar/stellar-sdk");
const { createServiceLogger, logError } = require("../utils/logger");

const logger = createServiceLogger('stellarServiceKey');

// Environment variable for service secret key
const SERVICE_SECRET_ENV = "STELLAR_SERVICE_SECRET";

// Allowed IPs for service key usage (comma-separated)
const ALLOWED_IPS_ENV = "STELLAR_SERVICE_ALLOWED_IPS";

let serviceKeypair = null;
let servicePublicKey = null;

/**
 * Load and validate the service keypair from environment.
 * Throws if keypair is missing or invalid.
 *
 * @returns {Keypair} The Stellar service keypair
 * @throws {Error} If STELLAR_SERVICE_SECRET is not set or invalid
 */
function loadServiceKeypair() {
  if (serviceKeypair) {
    return serviceKeypair;
  }

  const secretKey = process.env[SERVICE_SECRET_ENV];

  if (!secretKey) {
    const error = new Error(
      `Service keypair not configured. Set ${SERVICE_SECRET_ENV} environment variable.`
    );
    error.status = 500;
    throw error;
  }

  try {
    serviceKeypair = Keypair.fromSecret(secretKey);
    servicePublicKey = serviceKeypair.publicKey();
    logger.info({ publicKey: servicePublicKey }, 'Service keypair loaded successfully');
    return serviceKeypair;
  } catch (err) {
    const error = new Error(`Invalid service secret key: ${err.message}`);
    error.status = 500;
    throw error;
  }
}

/**
 * Get the service public key.
 *
 * @returns {string} Stellar public key (G...)
 */
function getServicePublicKey() {
  if (!servicePublicKey) {
    loadServiceKeypair();
  }
  return servicePublicKey;
}

/**
 * Check if the current request IP is allowed to use the service key.
 * Logs a warning if used from unexpected IP.
 *
 * @param {string} clientIp - The client IP address
 * @returns {boolean} True if IP is allowed or no restrictions configured
 */
function isAllowedIp(clientIp) {
  const allowedIpsStr = process.env[ALLOWED_IPS_ENV];
  
  // No IP restrictions configured
  if (!allowedIpsStr) {
    return true;
  }

  const allowedIps = allowedIpsStr.split(',').map(ip => ip.trim());
  const isAllowed = allowedIps.includes(clientIp);

  if (!isAllowed) {
    logger.warn(
      { clientIp, allowedIps },
      'Service key used from unexpected IP address'
    );
  }

  return isAllowed;
}

/**
 * Sign a transaction using the service keypair.
 * Validates IP restrictions before signing.
 *
 * @param {string} clientIp - The client IP address making the request
 * @param {Function} signFn - Function to execute with signing (receives keypair)
 * @returns {Promise<any>} Result of the sign function
 * @throws {Error} If IP not allowed or signing fails
 */
async function signWithServiceKey(clientIp, signFn) {
  if (!isAllowedIp(clientIp)) {
    const error = new Error(
      'Service key usage not allowed from this IP address'
    );
    error.status = 403;
    throw error;
  }

  const keypair = loadServiceKeypair();

  try {
    const result = await signFn(keypair);
    logger.debug({ publicKey: servicePublicKey }, 'Transaction signed with service key');
    return result;
  } catch (err) {
    logError(logger, err, { operation: 'sign_with_service_key' });
    throw err;
  }
}

/**
 * Verify that a provided public key matches the service keypair.
 * Used for testing and validation.
 *
 * @param {string} publicKey - Public key to verify
 * @returns {boolean} True if matches service keypair
 */
function verifyServiceKey(publicKey) {
  const expected = getServicePublicKey();
  return expected === publicKey;
}

module.exports = {
  loadServiceKeypair,
  getServicePublicKey,
  isAllowedIp,
  signWithServiceKey,
  verifyServiceKey,
  SERVICE_SECRET_ENV,
  ALLOWED_IPS_ENV,
};
