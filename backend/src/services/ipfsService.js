/**
 * src/services/ipfsService.js
 * IPFS file upload service using Pinata API
 */
"use strict";

const FormData = require("form-data");
const axios = require("axios");

// Configuration
const PINATA_API_URL = process.env.PINATA_API_URL || "https://api.pinata.cloud";
const PINATA_API_KEY = process.env.PINATA_API_KEY;
const PINATA_SECRET_KEY = process.env.PINATA_SECRET_KEY;

// File upload limits
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB in bytes
const MAX_FILES_PER_PROFILE = 5;
const ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png", 
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
];

/**
 * Upload a file to IPFS via Pinata
 * @param {Buffer} fileBuffer - File buffer
 * @param {string} fileName - Original filename
 * @param {string} mimeType - File MIME type
 * @returns {Promise<Object>} - IPFS upload result with CID
 */
async function uploadFile(fileBuffer, fileName, mimeType) {
  if (!PINATA_API_KEY || !PINATA_SECRET_KEY) {
    throw new Error("Pinata credentials not configured");
  }

  // Validate file size
  if (fileBuffer.length > MAX_FILE_SIZE) {
    throw new Error(`File size exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`);
  }

  // Validate MIME type
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    throw new Error(`File type ${mimeType} not allowed`);
  }

  try {
    const formData = new FormData();
    formData.append("file", fileBuffer, {
      filename: fileName,
      contentType: mimeType
    });

    // Add Pinata metadata
    const metadata = {
      name: fileName,
      keyvalues: {
        app: "stellar-marketpay",
        uploadedAt: new Date().toISOString()
      }
    };

    formData.append("pinataMetadata", JSON.stringify(metadata));

    const response = await axios.post(
      `${PINATA_API_URL}/pinning/pinFileToIPFS`,
      formData,
      {
        headers: {
          "pinata_api_key": PINATA_API_KEY,
          "pinata_secret_api_key": PINATA_SECRET_KEY,
          ...formData.getHeaders()
        },
        maxContentLength: MAX_FILE_SIZE + 1024, // Add some buffer
        timeout: 30000 // 30 seconds timeout
      }
    );

    if (!response.data.IpfsHash) {
      throw new Error("Invalid response from Pinata");
    }

    return {
      cid: response.data.IpfsHash,
      size: fileBuffer.length,
      fileName: fileName,
      mimeType: mimeType,
      uploadedAt: new Date().toISOString()
    };
  } catch (error) {
    console.error("IPFS upload error:", error.response?.data || error.message);
    if (error.response?.status === 429) {
      throw new Error("Rate limit exceeded. Please try again later.");
    }
    throw new Error(`Failed to upload file to IPFS: ${error.message}`);
  }
}

/**
 * Validate portfolio files array
 * @param {Array} portfolioFiles - Array of portfolio file objects
 * @returns {Array} - Validated and sanitized portfolio files
 */
function validatePortfolioFiles(portfolioFiles) {
  if (!portfolioFiles) return [];
  
  if (!Array.isArray(portfolioFiles)) {
    const e = new Error("portfolio_files must be an array");
    e.status = 400;
    throw e;
  }

  if (portfolioFiles.length > MAX_FILES_PER_PROFILE) {
    const e = new Error(`Maximum ${MAX_FILES_PER_PROFILE} files allowed per profile`);
    e.status = 400;
    throw e;
  }

  return portfolioFiles.map((file, index) => {
    if (!file || typeof file !== "object") {
      const e = new Error(`Invalid file object at index ${index}`);
      e.status = 400;
      throw e;
    }

    if (!file.cid || typeof file.cid !== "string") {
      const e = new Error(`File at index ${index} missing valid CID`);
      e.status = 400;
      throw e;
    }

    if (!file.fileName || typeof file.fileName !== "string") {
      const e = new Error(`File at index ${index} missing fileName`);
      e.status = 400;
      throw e;
    }

    if (!file.mimeType || typeof file.mimeType !== "string") {
      const e = new Error(`File at index ${index} missing mimeType`);
      e.status = 400;
      throw e;
    }

    if (!file.uploadedAt || typeof file.uploadedAt !== "string") {
      const e = new Error(`File at index ${index} missing uploadedAt`);
      e.status = 400;
      throw e;
    }

    return {
      cid: file.cid.trim(),
      fileName: file.fileName.trim(),
      mimeType: file.mimeType.trim(),
      size: file.size || 0,
      uploadedAt: file.uploadedAt
    };
  });
}

/**
 * Get IPFS gateway URL for a CID
 * @param {string} cid - IPFS CID
 * @returns {string} - Gateway URL
 */
function getGatewayUrl(cid) {
  return `https://gateway.pinata.cloud/ipfs/${cid}`;
}

/**
 * Check if Pinata is properly configured
 * @returns {boolean} - True if configured
 */
function isConfigured() {
  return !!(PINATA_API_KEY && PINATA_SECRET_KEY);
}

module.exports = {
  uploadFile,
  validatePortfolioFiles,
  getGatewayUrl,
  isConfigured,
  MAX_FILE_SIZE,
  MAX_FILES_PER_PROFILE,
  ALLOWED_MIME_TYPES
};
