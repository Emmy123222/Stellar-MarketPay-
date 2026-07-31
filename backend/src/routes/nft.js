/**
 * @swagger
 * tags:
 *   name: NFT
 *   description: NFT minting for job completion certificates
 */
const express = require("express");
const router = express.Router();
const { Keypair } = require("stellar-sdk");

/**
 * @swagger
 * /api/nft/mint-completion-certificate:
 *   post:
 *     summary: Mint a job completion NFT certificate
 *     tags: [NFT]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - jobId
 *               - jobTitle
 *               - clientAddress
 *               - freelancerAddress
 *               - paymentAmount
 *             properties:
 *               jobId:
 *                 type: string
 *               jobTitle:
 *                 type: string
 *               clientAddress:
 *                 type: string
 *               freelancerAddress:
 *                 type: string
 *               paymentAmount:
 *                 type: number
 *               currency:
 *                 type: string
 *               completionDate:
 *                 type: string
 *     responses:
 *       201:
 *         description: NFT minting queued
 */
router.post("/mint-completion-certificate", async (req, res, next) => {
  try {
    const { jobId, jobTitle, clientAddress, freelancerAddress, completionDate, paymentAmount, currency } = req.body;

    if (!jobId || !jobTitle || !clientAddress || !freelancerAddress || !paymentAmount) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Verify Stellar addresses
    if (!isValidStellarAddress(freelancerAddress) || !isValidStellarAddress(clientAddress)) {
      return res.status(400).json({ error: "Invalid Stellar address" });
    }

    // Create NFT metadata
    const nftMetadata = {
      jobId,
      jobTitle,
      clientAddress,
      completionDate: completionDate || new Date().toISOString(),
      paymentAmount,
      currency: currency || "USD",
      mintedAt: new Date().toISOString(),
      name: `Completion Certificate: ${jobTitle}`,
      description: `Certificate of completion for job: ${jobTitle}`,
    };

    // In production: Use actual Stellar SDK to mint NFT
    // For now, return mock response with metadata
    const nftId = generateNFTId();

    // Store NFT record (in production: save to database)
    const nftRecord = {
      id: nftId,
      jobId,
      freelancerAddress,
      metadata: nftMetadata,
      status: "minting",
      createdAt: new Date(),
    };

    console.log("NFT Minting:", nftRecord);

    // Queue for actual minting (in production: use background job queue)
    res.status(201).json({
      success: true,
      data: {
        nftId,
        status: "queued_for_minting",
        message: "NFT minting queued. Will be minted shortly.",
        metadata: nftMetadata,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/nft/job/{jobId}:
 *   get:
 *     summary: Get NFT certificate by job ID
 *     tags: [NFT]
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: NFT details
 */
router.get("/job/:jobId", async (req, res, next) => {
  try {
    const { jobId } = req.params;
    // In production: fetch from database
    res.json({ success: true, data: { jobId, status: "minted", nftId: "placeholder" } });
  } catch (error) {
    next(error);
  }
});

/**
 * @swagger
 * /api/nft/freelancer/{publicKey}:
 *   get:
 *     summary: Get NFTs owned by a freelancer
 *     tags: [NFT]
 *     parameters:
 *       - in: path
 *         name: publicKey
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: NFT list
 */
router.get("/freelancer/:publicKey", async (req, res, next) => {
  try {
    const { publicKey } = req.params;
    if (!isValidStellarAddress(publicKey)) {
      return res.status(400).json({ error: "Invalid Stellar address" });
    }
    // In production: fetch from database where freelancerAddress = publicKey
    res.json({ success: true, data: [] });
  } catch (error) {
    next(error);
  }
});

function isValidStellarAddress(address) {
  try {
    Keypair.fromPublicKey(address);
    return true;
  } catch {
    return false;
  }
}

function generateNFTId() {
  return `nft_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

module.exports = router;
