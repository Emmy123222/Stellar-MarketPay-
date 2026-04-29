/**
 * src/services/faucetService.js
 * Stellar testnet faucet service using Friendbot API
 */
"use strict";

const axios = require("axios");
const { Server } = require("@stellar/stellar-sdk");

// Configuration
const HORIZON_TESTNET_URL = process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";
const FRIENDBOT_URL = "https://friendbot.stellar.org";

/**
 * Fund a testnet wallet using Friendbot API
 * @param {string} publicKey - Stellar public key to fund
 * @returns {Promise<Object>} - Funding result with balance and transaction details
 */
async function fundTestnetWallet(publicKey) {
  if (!publicKey || !/^G[A-Z0-9]{55}$/.test(publicKey)) {
    const e = new Error("Invalid Stellar public key");
    e.status = 400;
    throw e;
  }

  // Check if we're on testnet
  if (!HORIZON_TESTNET_URL.includes("testnet")) {
    const e = new Error("Faucet only available on testnet");
    e.status = 403;
    throw e;
  }

  try {
    // Get current balance before funding
    const server = new Server(HORIZON_TESTNET_URL);
    const account = await server.loadAccount(publicKey);
    const currentBalance = account.balances.find(b => b.asset_type === "native")?.balance || "0";

    // If account already has balance, don't fund it
    if (parseFloat(currentBalance) > 0) {
      return {
        success: false,
        message: "Account already has testnet XLM balance",
        currentBalance,
        fundedAmount: "0"
      };
    }

    // Call Friendbot to fund the account
    const response = await axios.post(`${FRIENDBOT_URL}?addr=${publicKey}`);
    
    if (!response.data) {
      throw new Error("Invalid response from Friendbot");
    }

    // Get updated balance after funding
    const updatedAccount = await server.loadAccount(publicKey);
    const newBalance = updatedAccount.balances.find(b => b.asset_type === "native")?.balance || "0";
    const fundedAmount = (parseFloat(newBalance) - parseFloat(currentBalance)).toString();

    return {
      success: true,
      message: "Successfully funded testnet wallet",
      fundedAmount,
      newBalance,
      transactionHash: response.data.hash,
      ledger: response.data.ledger
    };
  } catch (error) {
    console.error("Faucet funding error:", error.response?.data || error.message);
    
    // Handle specific Friendbot errors
    if (error.response?.status === 400) {
      const message = error.response?.data?.detail || "Invalid request";
      const e = new Error(`Faucet error: ${message}`);
      e.status = 400;
      throw e;
    }
    
    if (error.response?.status === 429) {
      const e = new Error("Rate limit exceeded. Please try again later.");
      e.status = 429;
      throw e;
    }

    // Handle network errors
    if (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND") {
      const e = new Error("Unable to connect to Stellar testnet");
      e.status = 503;
      throw e;
    }

    const e = new Error(`Failed to fund wallet: ${error.message}`);
    e.status = 500;
    throw e;
  }
}

/**
 * Check if an account needs funding (has zero balance)
 * @param {string} publicKey - Stellar public key to check
 * @returns {Promise<Object>} - Account status and balance
 */
async function checkAccountNeedsFunding(publicKey) {
  if (!publicKey || !/^G[A-Z0-9]{55}$/.test(publicKey)) {
    const e = new Error("Invalid Stellar public key");
    e.status = 400;
    throw e;
  }

  try {
    const server = new Server(HORIZON_TESTNET_URL);
    const account = await server.loadAccount(publicKey);
    const balance = account.balances.find(b => b.asset_type === "native")?.balance || "0";
    
    return {
      needsFunding: parseFloat(balance) === 0,
      currentBalance: balance,
      exists: true
    };
  } catch (error) {
    // If account doesn't exist, it needs funding
    if (error.response?.status === 404) {
      return {
        needsFunding: true,
        currentBalance: "0",
        exists: false
      };
    }
    
    console.error("Account check error:", error.message);
    const e = new Error(`Failed to check account: ${error.message}`);
    e.status = 500;
    throw e;
  }
}

/**
 * Check if the current environment is testnet
 * @returns {boolean} - True if running on testnet
 */
function isTestnet() {
  return HORIZON_TESTNET_URL.includes("testnet");
}

module.exports = {
  fundTestnetWallet,
  checkAccountNeedsFunding,
  isTestnet
};
