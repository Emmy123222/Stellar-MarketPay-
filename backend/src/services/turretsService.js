/**
 * src/services/turretsService.js
 * Stellar Turrets integration for serverless contract execution
 */
"use strict";

const axios = require("axios");
const { Server, TransactionBuilder, Networks } = require("@stellar/stellar-sdk");

// Configuration
const HORIZON_URL = process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";
const TURRET_URL = process.env.TURRET_URL || "https://tss.stellar.org";
const TURRET_API_KEY = process.env.TURRET_API_KEY;

/**
 * Submit transaction through Stellar Turret
 * @param {string} transactionXDR - Signed transaction XDR
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} - Transaction result
 */
async function submitViaTurret(transactionXDR, options = {}) {
  if (!transactionXDR) {
    const e = new Error("Transaction XDR is required");
    e.status = 400;
    throw e;
  }

  if (!TURRET_URL) {
    const e = new Error("Turret URL not configured");
    e.status = 500;
    throw e;
  }

  try {
    const payload = {
      xdr: transactionXDR,
      network: HORIZON_URL.includes("testnet") ? "testnet" : "public",
      ...options
    };

    // Add API key if available
    const headers = {};
    if (TURRET_API_KEY) {
      headers["Authorization"] = `Bearer ${TURRET_API_KEY}`;
    }

    const response = await axios.post(`${TURRET_URL}/api/v1/submit`, payload, {
      headers,
      timeout: 30000,
      "maxContentLength": 1000000,
      "maxBodyLength": 1000000
    });

    if (!response.data) {
      throw new Error("Invalid response from Turret");
    }

    return {
      success: true,
      hash: response.data.hash,
      ledger: response.data.ledger,
      feeCharged: response.data.fee_charged || "0",
      turretUsed: true,
      message: "Transaction submitted via Stellar Turret"
    };
  } catch (error) {
    console.error("Turret submission error:", error.response?.data || error.message);
    
    if (error.response?.status === 400) {
      const message = error.response?.data?.error || "Invalid transaction";
      const e = new Error(`Turret error: ${message}`);
      e.status = 400;
      throw e;
    }
    
    if (error.response?.status === 429) {
      const e = new Error("Turret rate limit exceeded. Please try again later.");
      e.status = 429;
      throw e;
    }

    if (error.response?.status === 503) {
      const e = new Error("Turret service temporarily unavailable");
      e.status = 503;
      throw e;
    }

    const e = new Error(`Failed to submit via Turret: ${error.message}`);
    e.status = 500;
    throw e;
  }
}

/**
 * Submit transaction with fallback to direct submission
 * @param {string} transactionXDR - Signed transaction XDR
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} - Transaction result
 */
async function submitTransaction(transactionXDR, options = {}) {
  // First try Turret submission
  try {
    const turretResult = await submitViaTurret(transactionXDR, options);
    return turretResult;
  } catch (turretError) {
    console.warn("Turret submission failed, falling back to direct submission:", turretError.message);
    
    // Fallback to direct Horizon submission
    try {
      const server = new Server(HORIZON_URL);
      const result = await server.submitTransaction(transactionXDR);
      
      return {
        success: true,
        hash: result.hash,
        ledger: result.ledger,
        feeCharged: result.feeCharged || "0",
        turretUsed: false,
        message: "Transaction submitted directly (Turret unavailable)"
      };
    } catch (directError) {
      console.error("Direct submission also failed:", directError.message);
      const e = new Error(`Both Turret and direct submission failed: ${directError.message}`);
      e.status = 500;
      throw e;
    }
  }
}

/**
 * Get Turret status and capabilities
 * @returns {Promise<Object>} - Turret status
 */
async function getTurretStatus() {
  if (!TURRET_URL) {
    return {
      available: false,
      message: "Turret not configured"
    };
  }

  try {
    const response = await axios.get(`${TURRET_URL}/api/v1/status`, {
      timeout: 5000
    });

    return {
      available: true,
      url: TURRET_URL,
      network: response.data.network || "unknown",
      version: response.data.version || "unknown",
      feeSponsorship: response.data.fee_sponsorship || false,
      message: "Turret service available"
    };
  } catch (error) {
    return {
      available: false,
      url: TURRET_URL,
      message: "Turret service unavailable",
      error: error.message
    };
  }
}

/**
 * Estimate transaction fee via Turret
 * @param {string} transactionXDR - Unsigned transaction XDR
 * @returns {Promise<Object>} - Fee estimation
 */
async function estimateTurretFee(transactionXDR) {
  if (!transactionXDR) {
    const e = new Error("Transaction XDR is required");
    e.status = 400;
    throw e;
  }

  if (!TURRET_URL) {
    const e = new Error("Turret URL not configured");
    e.status = 500;
    throw e;
  }

  try {
    const payload = {
      xdr: transactionXDR,
      network: HORIZON_URL.includes("testnet") ? "testnet" : "public"
    };

    const headers = {};
    if (TURRET_API_KEY) {
      headers["Authorization"] = `Bearer ${TURRET_API_KEY}`;
    }

    const response = await axios.post(`${TURRET_URL}/api/v1/estimate`, payload, {
      headers,
      timeout: 10000
    });

    return {
      success: true,
      baseFee: response.data.base_fee || "100",
      turretFee: response.data.turret_fee || "0",
      totalFee: response.data.total_fee || "100",
      feeSponsored: response.data.fee_sponsored || false
    };
  } catch (error) {
    console.error("Turret fee estimation error:", error.response?.data || error.message);
    
    // Return default fee estimation
    return {
      success: false,
      baseFee: "100",
      turretFee: "0",
      totalFee: "100",
      feeSponsored: false,
      message: "Unable to estimate Turret fees, using default"
    };
  }
}

/**
 * Check if Turret integration should be used
 * @param {Object} options - Configuration options
 * @returns {boolean} - Whether to use Turret
 */
function shouldUseTurret(options = {}) {
  // Don't use Turret if explicitly disabled
  if (options.useTurret === false) {
    return false;
  }

  // Don't use Turret if not configured
  if (!TURRET_URL) {
    return false;
  }

  // Use Turret by default if available
  return true;
}

module.exports = {
  submitViaTurret,
  submitTransaction,
  getTurretStatus,
  estimateTurretFee,
  shouldUseTurret
};
