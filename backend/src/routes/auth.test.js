"use strict";

beforeAll(() => {
  process.env.CONTRACT_ID = process.env.CONTRACT_ID || "CCONTRACTID123456789012345678901234567890123456789012";
  process.env.STELLAR_NETWORK = process.env.STELLAR_NETWORK || "testnet";
  process.env.HORIZON_URL = process.env.HORIZON_URL || "https://horizon-testnet.stellar.org";
  process.env.PLATFORM_WALLET_ADDRESS = process.env.PLATFORM_WALLET_ADDRESS || "GPLATFORMWALLET1234567890123456789012345678901234567890";
});

jest.mock("../db/pool", () => {
  const mockQuery = jest.fn().mockResolvedValue({ rows: [] });
  return {
    query: mockQuery,
    connect: jest.fn().mockResolvedValue({
      query: mockQuery,
      release: jest.fn(),
    }),
  };
});

jest.mock("../services/indexerService", () => {
  return jest.fn().mockImplementation(() => ({
    start: jest.fn(),
  }));
});

jest.mock("../services/priceAlertService", () => {
  return jest.fn().mockImplementation(() => ({
    start: jest.fn(),
  }));
});

jest.mock("../db/migrate", () => ({
  migrate: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../routes/notifications", () => {
  const { Router } = require("express");
  const router = Router();
  router.get("/", (req, res) => res.json({ success: true }));
  return router;
});

const { Utils, Keypair } = require("@stellar/stellar-sdk");

jest.mock("@stellar/stellar-sdk", () => {
  const actual = jest.requireActual("@stellar/stellar-sdk");
  return {
    ...actual,
    Utils: {
      buildChallengeTx: jest.fn(),
      verifyChallengeTx: jest.fn(),
    },
  };
});

const request = require("supertest");
const jwt = require("jsonwebtoken");

const app = require("../server");

const TEST_KEYPAIR = Keypair.random();
const WRONG_KEYPAIR = Keypair.random();
const CHALLENGE_XDR = "AAAAAFakeChallengeTransactionXDRBase64Encoded==";
const SIGNED_XDR = "AAAAAFakeSignedChallengeTransactionXDRBase64==";

function getCookie(res, name) {
  return (res.headers["set-cookie"] || [])
    .find((cookie) => cookie.startsWith(`${name}=`))
    ?.split(";")[0];
}

describe("SEP-10 Authentication Flow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.ADMIN_WALLET_ADDRESSES;
  });

  describe("GET /api/auth — generate challenge", () => {
    it("returns a challenge transaction for a valid account", async () => {
      Utils.buildChallengeTx.mockReturnValue(CHALLENGE_XDR);

      const res = await request(app)
        .get("/api/auth")
        .query({ account: TEST_KEYPAIR.publicKey() });

      expect(res.status).toBe(200);
      expect(res.body.transaction).toBe(CHALLENGE_XDR);
      expect(Utils.buildChallengeTx).toHaveBeenCalledWith(
        expect.anything(),
        TEST_KEYPAIR.publicKey(),
        expect.any(String),
        300,
        expect.any(String),
      );
    });

    it("returns 400 when account parameter is missing", async () => {
      const res = await request(app).get("/api/auth");

      expect(res.status).toBe(400);
      expect(res.body).toHaveProperty("error");
    });
  });

  describe("POST /api/auth — verify and receive JWT", () => {
    it("valid flow: returns JWT with correct public key", async () => {
      Utils.verifyChallengeTx.mockReturnValue(TEST_KEYPAIR.publicKey());

      const res = await request(app)
        .post("/api/auth")
        .send({ transaction: SIGNED_XDR });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body).toHaveProperty("token");

      const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
      expect(decoded.publicKey).toBe(TEST_KEYPAIR.publicKey());
      expect(decoded.exp - decoded.iat).toBe(15 * 60);
      expect(getCookie(res, "refreshToken")).toBeTruthy();
    });

    it("refreshes and rotates access tokens", async () => {
      Utils.verifyChallengeTx.mockReturnValue(TEST_KEYPAIR.publicKey());

      const loginRes = await request(app)
        .post("/api/auth")
        .send({ transaction: SIGNED_XDR });
      const refreshCookie = getCookie(loginRes, "refreshToken");

      const refreshRes = await request(app)
        .post("/api/auth/refresh")
        .set("Cookie", refreshCookie);

      expect(refreshRes.status).toBe(200);
      expect(refreshRes.body.success).toBe(true);
      expect(refreshRes.body).toHaveProperty("token");
      const decoded = jwt.verify(refreshRes.body.token, process.env.JWT_SECRET);
      expect(decoded.publicKey).toBe(TEST_KEYPAIR.publicKey());
      expect(decoded.exp - decoded.iat).toBe(15 * 60);
      expect(getCookie(refreshRes, "refreshToken")).not.toBe(refreshCookie);

      const reusedRes = await request(app)
        .post("/api/auth/refresh")
        .set("Cookie", refreshCookie);

      expect(reusedRes.status).toBe(401);
    });

    it("logout invalidates the refresh token", async () => {
      Utils.verifyChallengeTx.mockReturnValue(TEST_KEYPAIR.publicKey());

      const loginRes = await request(app)
        .post("/api/auth")
        .send({ transaction: SIGNED_XDR });
      const refreshCookie = getCookie(loginRes, "refreshToken");

      const logoutRes = await request(app)
        .post("/api/auth/logout")
        .set("Cookie", refreshCookie);

      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body.success).toBe(true);

      const refreshRes = await request(app)
        .post("/api/auth/refresh")
        .set("Cookie", refreshCookie);

      expect(refreshRes.status).toBe(401);
    });

    it("invalid signature: returns 401 for tampered transaction", async () => {
      Utils.verifyChallengeTx.mockImplementation(() => {
        throw new Error("Invalid challenge signature");
      });

      const res = await request(app)
        .post("/api/auth")
        .send({ transaction: "TAMPERED_TRANSACTION_XDR" });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain("Invalid challenge signature");
    });

    it("expired challenge: returns 401 for old challenge", async () => {
      Utils.verifyChallengeTx.mockImplementation(() => {
        throw new Error("Challenge has expired");
      });

      const res = await request(app)
        .post("/api/auth")
        .send({ transaction: "EXPIRED_CHALLENGE_XDR" });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain("Challenge has expired");
    });

    it("wrong account: returns 200 with different public key in JWT", async () => {
      Utils.verifyChallengeTx.mockReturnValue(WRONG_KEYPAIR.publicKey());

      const res = await request(app)
        .post("/api/auth")
        .send({ transaction: SIGNED_XDR });

      expect(res.status).toBe(200);
      const decoded = jwt.verify(res.body.token, process.env.JWT_SECRET);
      expect(decoded.publicKey).toBe(WRONG_KEYPAIR.publicKey());
    });

    it("rejects challenge signed by wrong key", async () => {
      Utils.verifyChallengeTx.mockImplementation(() => {
        throw new Error("Signatures do not match");
      });

      const res = await request(app)
        .post("/api/auth")
        .send({ transaction: SIGNED_XDR });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain("Signatures do not match");
    });

    it("rejects mainnet challenge used for testnet account", async () => {
      // Simulate a network/passphrase mismatch during verification
      Utils.verifyChallengeTx.mockImplementation(() => {
        throw new Error("Invalid network passphrase");
      });

      const res = await request(app)
        .post("/api/auth")
        .send({ transaction: SIGNED_XDR });

      expect(res.status).toBe(401);
      expect(res.body.error).toContain("Invalid network passphrase");
    });

    it("rejects replayed challenge (nonce reuse)", async () => {
      // First login succeeds
      Utils.verifyChallengeTx.mockReturnValue(TEST_KEYPAIR.publicKey());

      const first = await request(app)
        .post("/api/auth")
        .send({ transaction: SIGNED_XDR });
      expect(first.status).toBe(200);

      // Subsequent attempt with same transaction/nonce is rejected
      Utils.verifyChallengeTx.mockImplementation(() => {
        throw new Error("Nonce already used");
      });

      const second = await request(app)
        .post("/api/auth")
        .send({ transaction: SIGNED_XDR });

      expect(second.status).toBe(401);
      expect(second.body.error).toContain("Nonce already used");
    });
  });

  describe("Protected endpoint — missing/invalid JWT", () => {
    it("missing JWT: returns 401 for protected endpoint", async () => {
      const res = await request(app)
        .post("/api/disputes/job-123/evidence");

      expect(res.status).toBe(401);
      expect(res.body.error).toContain("Missing or invalid token");
    });

    it("invalid JWT: returns 401 when accessing protected route", async () => {
      const res = await request(app)
        .post("/api/disputes/job-123/evidence")
        .set("Authorization", "Bearer invalid.jwt.token");

      expect(res.status).toBe(401);
      expect(res.body.error).toContain("Invalid or expired token");
    });

    it("expired JWT: returns 401 on protected endpoint", async () => {
      // Create a short-lived token and let it expire
      const shortLived = jwt.sign({ publicKey: TEST_KEYPAIR.publicKey() }, process.env.JWT_SECRET, {
        expiresIn: "1s",
      });
      // Wait for expiration
      await new Promise((r) => setTimeout(r, 1100));

      const res = await request(app)
        .post("/api/disputes/job-123/evidence")
        .set("Authorization", `Bearer ${shortLived}`);

      expect(res.status).toBe(401);
      expect(res.body.error).toContain("Invalid or expired token");
    });
  });
});
