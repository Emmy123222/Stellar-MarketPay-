"use strict";

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");

const jobRoutes = require("./routes/jobs");
const applicationRoutes = require("./routes/applications");
const profileRoutes     = require("./routes/profiles");
const escrowRoutes      = require("./routes/escrow");
const healthRoutes      = require("./routes/health");
const authRoutes        = require("./routes/auth");
const ratingRoutes      = require("./routes/ratings");
const progressRoutes    = require("./routes/progress");
const eventRoutes       = require("./routes/events");
const statsRoutes       = require("./routes/stats");
const contributorRoutes = require("./routes/contributors");
const verificationRoutes = require("./routes/verification");
const nftRoutes         = require("./routes/nft");
const aiScorerRoutes    = require("./routes/aiScorer");

const gasEstimatorRoutes = require("./routes/gasEstimator");
const transactionRoutes  = require("./routes/transactions");
const daoRoutes          = require("./routes/dao");
const proposalTemplateRoutes = require("./routes/proposalTemplates");
const priceAlertRoutes     = require("./routes/priceAlerts");

const turretRoutes         = require("./routes/turrets");
const referralRoutes       = require("./routes/referrals");
const reputationRoutes     = require("./routes/reputation");
const autoConvertRoutes    = require("./routes/autoConvert");
const talentPoolRoutes     = require("./routes/talentPool");
const invitationRoutes     = require("./routes/invitations");

const anchorRoutes        = require("./routes/anchors");
const scopeRoutes         = require("./routes/scope");
const analyticsRoutes     = require("./routes/analytics");
const searchRoutes        = require("./routes/search");

function createApp(options = {}) {
  const app = express();

  const indexerService = options.indexerService || null;
  const broadcastRealtime = options.broadcastRealtime || (() => {});

  if (indexerService) {
    app.locals.indexerService = indexerService;
  }
  app.locals.broadcastRealtime = broadcastRealtime;

  // Middleware
  app.use(helmet());
  if (process.env.NODE_ENV !== "test") {
    app.use(morgan("dev"));
  }
  app.use(express.json({ limit: "20kb" }));

  const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:3000")
    .split(",")
    .map((o) => o.trim());
  app.use(
    cors({
      origin: (origin, cb) =>
        !origin || allowedOrigins.includes(origin)
          ? cb(null, true)
          : cb(new Error("CORS blocked")),
      methods: ["GET", "POST", "PATCH", "DELETE"],
      allowedHeaders: ["Content-Type", "Authorization"],
      credentials: true,
    })
  );

  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 150,
      standardHeaders: true,
      legacyHeaders: true,
    })
  );

  // ─── Routes ───────────────────────────────────────────────────────────────────
  app.use("/health",            healthRoutes);
  app.use("/api/auth",          authRoutes);
  app.use("/api/jobs",          jobRoutes);
  app.use("/api/applications",  applicationRoutes);
  app.use("/api/profiles",      profileRoutes);
  app.use("/api/escrow",        escrowRoutes);
  app.use("/api/ratings",       ratingRoutes);
  app.use("/api/progress",      progressRoutes);
  app.use("/api/events",        eventRoutes);
  app.use("/api/stats",         statsRoutes);
  app.use("/api/contributors",  contributorRoutes);
  app.use("/api/verification",  verificationRoutes);
  app.use("/api/nft",           nftRoutes);
  app.use("/api/ai-scorer",     aiScorerRoutes);
  app.use("/api/anchors",       anchorRoutes);

  app.get("/api/indexer/health", (req, res) => {
    const service = app.locals.indexerService;
    res.json({
      status: "ok",
      indexer: service && typeof service.getHealth === "function" ? service.getHealth() : null,
    });
  });
  app.use("/api/contributors",    contributorRoutes);
  app.use("/api/gas-estimate",    gasEstimatorRoutes);
  app.use("/api/transactions",   transactionRoutes);
  app.use("/api/dao",            daoRoutes);
  app.use("/api/proposal-templates", proposalTemplateRoutes);
  app.use("/api/price-alerts",      priceAlertRoutes);
  app.use("/api/ai",                aiScorerRoutes);
  app.use("/api/scope",             scopeRoutes);
  app.use("/api/turrets",           turretRoutes);
  app.use("/api/referrals",         referralRoutes);
  app.use("/api/reputation",        reputationRoutes);
  app.use("/api/auto-convert",      autoConvertRoutes);
  app.use("/api/talent-pools",      talentPoolRoutes);
  app.use("/api/invitations",       rateLimit({ windowMs: 60_000, max: 20 }), invitationRoutes);
  app.use("/api/analytics",         analyticsRoutes);
  app.use("/api/search",            searchRoutes);

  // 404 handler — must come after all routes
  app.use((req, res) => {
    res.status(404).json({ error: "Not found", code: "NOT_FOUND" });
  });

  // Error handler
  app.use((err, req, res, _next) => {
    if (process.env.NODE_ENV !== "test") {
      console.error("[Error]", err.message);
    }

    res.status(err.status || 500).json({
      error: err.message || "Internal server error",
    });
  });

  return app;
}

module.exports = {
  createApp,
};
