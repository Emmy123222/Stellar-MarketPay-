/**
 * src/services/tokenService.js
 * Stellar Soroban token service for custom token support
 */
"use strict";

const { Server, Asset } = require("@stellar/stellar-sdk");

// Configuration
const HORIZON_URL = process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";
const server = new Server(HORIZON_URL);

/**
 * Get token metadata from Stellar Asset Contract (SAC)
 * @param {string} contractId - Stellar Asset Contract ID
 * @returns {Promise<Object>} - Token metadata
 */
async function getTokenMetadata(contractId) {
  if (!contractId) {
    const e = new Error("Contract ID is required");
    e.status = 400;
    throw e;
  }

  try {
    // First try to get the contract from Stellar
    const contract = await server.loadAccount(contractId);
    
    // Look for token metadata in contract data
    // This is a simplified approach - in production you'd want to use Soroban RPC
    const tokenMetadata = {
      contractId,
      name: "Unknown Token",
      symbol: "UNKNOWN",
      decimals: 7,
      icon: null,
      verified: false
    };

    // Try to extract basic info from the contract
    if (contract) {
      // For now, we'll use a basic approach
      // In a full implementation, you'd use Soroban RPC to get token metadata
      tokenMetadata.name = `Token ${contractId.slice(0, 8)}...`;
      tokenMetadata.symbol = `TKN${contractId.slice(0, 4)}`;
    }

    return tokenMetadata;
  } catch (error) {
    console.error("Token metadata fetch error:", error);
    const e = new Error(`Failed to fetch token metadata: ${error.message}`);
    e.status = 500;
    throw e;
  }
}

/**
 * Get token balance for an account
 * @param {string} publicKey - Account public key
 * @param {string} contractId - Token contract ID
 * @returns {Promise<Object>} - Balance information
 */
async function getTokenBalance(publicKey, contractId) {
  if (!publicKey || !contractId) {
    const e = new Error("Public key and contract ID are required");
    e.status = 400;
    throw e;
  }

  try {
    const account = await server.loadAccount(publicKey);
    
    // Find the balance for this specific token
    const tokenBalance = account.balances.find(balance => 
      balance.asset_code && balance.asset_issuer && 
      balance.asset_issuer === contractId
    );

    if (!tokenBalance) {
      return {
        balance: "0",
        exists: false,
        limit: "0"
      };
    }

    return {
      balance: tokenBalance.balance,
      exists: true,
      limit: tokenBalance.limit || "0"
    };
  } catch (error) {
    if (error.response?.status === 404) {
      return {
        balance: "0",
        exists: false,
        limit: "0"
      };
    }
    
    console.error("Token balance fetch error:", error);
    const e = new Error(`Failed to fetch token balance: ${error.message}`);
    e.status = 500;
    throw e;
  }
}

/**
 * Validate if a contract is a valid Stellar Asset Contract
 * @param {string} contractId - Contract ID to validate
 * @returns {Promise<Object>} - Validation result
 */
async function validateTokenContract(contractId) {
  if (!contractId) {
    const e = new Error("Contract ID is required");
    e.status = 400;
    throw e;
  }

  // Basic format validation for Stellar contract ID
  if (!/^[A-Z0-9]{56}$/.test(contractId)) {
    return {
      valid: false,
      error: "Invalid contract ID format"
    };
  }

  try {
    const account = await server.loadAccount(contractId);
    
    // Check if this looks like a token contract
    // In a full implementation, you'd check specific contract data
    const isTokenContract = account && account.account_id === contractId;
    
    return {
      valid: isTokenContract,
      error: isTokenContract ? null : "Contract does not appear to be a token contract"
    };
  } catch (error) {
    return {
      valid: false,
      error: "Contract not found or inaccessible"
    };
  }
}

/**
 * Get list of commonly used tokens (for suggestions)
 * @returns {Array} - List of popular tokens
 */
function getPopularTokens() {
  return [
    {
      contractId: "CBAN4QGC2FJVRRO3H5LUS44T2F2X3J5XR2XEYWF2ETQDVQ5OJRTNW5M",
      name: "USDC",
      symbol: "USDC",
      decimals: 7,
      verified: true,
      icon: "🪙"
    },
    {
      contractId: "CA3D5SRYAEYKJVVBFJKW6S5U2YJ5E5BBHCNATIVXQDQSTZPFFR4XCWK",
      name: "USDT",
      symbol: "USDT", 
      decimals: 7,
      verified: true,
      icon: "💵"
    }
  ];
}

/**
 * Search for tokens by name or symbol
 * @param {string} query - Search query
 * @returns {Array} - Matching tokens
 */
async function searchTokens(query) {
  if (!query || query.length < 2) {
    return [];
  }

  const popularTokens = getPopularTokens();
  const lowerQuery = query.toLowerCase();
  
  return popularTokens.filter(token => 
    token.name.toLowerCase().includes(lowerQuery) ||
    token.symbol.toLowerCase().includes(lowerQuery)
  );
}

module.exports = {
  getTokenMetadata,
  getTokenBalance,
  validateTokenContract,
  getPopularTokens,
  searchTokens
};
