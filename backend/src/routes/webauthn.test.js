"use strict";

/**
 * src/routes/webauthn.test.js
 *
 * Integration test suite for WebAuthn / Passkey registration and authentication flow.
 * Covers (Issue #1486):
 *   - Mock @simplewebauthn/server (not real WebAuthn cryptography)
 *   - Registration challenge -> verify registration -> store credential
 *   - Authentication challenge -> verify assertion -> return JWT
 *   - Replayed assertion rejected
 *   - Credential management routes (list / delete)
 */

jest.mock("../middleware/rateLimiter", () => ({
  createRateLimiter: () => (req, res, next) => next(),
}));

jest.mock("@simplewebauthn/server", () => ({
  generateRegistrationOptions: jest.fn(),
  verifyRegistrationResponse: jest.fn(),
  generateAuthenticationOptions: jest.fn(),
  verifyAuthenticationResponse: jest.fn(),
}));

jest.mock("../db/pool", () => {
  const mockQuery = jest.fn();
  return {
    query: mockQuery,
    connect: jest.fn().mockResolvedValue({ query: mockQuery, release: jest.fn() }),
    readPool: { query: mockQuery },
    writePool: { query: mockQuery },
  };
});

const express = require("express");
const request = require("supertest");
const jwt = require("jsonwebtoken");
const pool = require("../db/pool");
const { JWT_SECRET } = require("../middleware/auth");
const { _resetRegistrationAttemptsForTest } = require("../services/webauthnService");
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require("@simplewebauthn/server");
const webauthnRoutes = require("./webauthn");

// ── Minimal Express test app ─────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use("/api/webauthn", webauthnRoutes);

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.statusCode || err.status || 500;
  res.status(status).json({ error: err.message, code: err.code || "INTERNAL_ERROR" });
});

// ── Test fixtures & helpers ───────────────────────────────────────────────────

const TEST_PUBLIC_KEY = "G" + "A".repeat(55);
const OTHER_PUBLIC_KEY = "G" + "B".repeat(55);
const ADMIN_PUBLIC_KEY = "G" + "C".repeat(55);

function makeToken(publicKey = TEST_PUBLIC_KEY, role = "user") {
  return jwt.sign({ publicKey, role }, JWT_SECRET, { expiresIn: "1h" });
}

function parseCookies(res) {
  const setCookie = res.headers["set-cookie"] || [];
  return setCookie.reduce((acc, cookieStr) => {
    const [pair] = cookieStr.split(";");
    const [key, val] = pair.split("=");
    acc[key.trim()] = val ? decodeURIComponent(val.trim()) : "";
    return acc;
  }, {});
}

// ── Test Suite ────────────────────────────────────────────────────────────────

describe("WebAuthn / Passkey Route Suite (/api/webauthn)", () => {
  let credentialsStore;

  beforeEach(() => {
    jest.clearAllMocks();
    _resetRegistrationAttemptsForTest();
    credentialsStore = new Map();

    // Default pool query implementation simulating database interactions
    pool.query.mockImplementation(async (sql, params = []) => {
      const text = sql.replace(/\s+/g, " ").trim();

      // SELECT count for credential limit check
      if (text.includes("SELECT COUNT(*)::int AS count FROM webauthn_credentials")) {
        const pk = params[0];
        const userCreds = [...credentialsStore.values()].filter((c) => c.public_key === pk);
        return { rows: [{ count: userCreds.length }] };
      }

      // SELECT existing credentials for user (registration/login options)
      if (text.includes("SELECT credential_id, transports FROM webauthn_credentials WHERE public_key = $1")) {
        const pk = params[0];
        const rows = [...credentialsStore.values()]
          .filter((c) => c.public_key === pk)
          .map((c) => ({ credential_id: c.credential_id, transports: c.transports || [] }));
        return { rows };
      }

      // INSERT INTO webauthn_credentials
      if (text.startsWith("INSERT INTO webauthn_credentials")) {
        const [public_key, credential_id, credential_name, public_key_cose, counter, transports] = params;
        const id = `cred-${credentialsStore.size + 1}`;
        const row = {
          id,
          public_key,
          credential_id,
          credential_name,
          public_key_cose,
          counter,
          transports,
          created_at: new Date().toISOString(),
        };
        credentialsStore.set(credential_id, row);
        return { rows: [row], rowCount: 1 };
      }

      // SELECT single credential for login verify
      if (text.includes("SELECT * FROM webauthn_credentials WHERE credential_id = $1 AND public_key = $2")) {
        const [credId, pk] = params;
        const cred = credentialsStore.get(credId);
        if (cred && cred.public_key === pk) {
          return { rows: [cred] };
        }
        return { rows: [] };
      }

      // UPDATE webauthn_credentials SET counter
      if (text.startsWith("UPDATE webauthn_credentials SET counter = $1 WHERE credential_id = $2")) {
        const [counter, credId] = params;
        const cred = credentialsStore.get(credId);
        if (cred) {
          cred.counter = counter;
          credentialsStore.set(credId, cred);
          return { rows: [cred], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }

      // SELECT credentials for listCredentials
      if (text.includes("SELECT id, credential_name, created_at FROM webauthn_credentials WHERE public_key = $1")) {
        const pk = params[0];
        const rows = [...credentialsStore.values()]
          .filter((c) => c.public_key === pk)
          .map((c) => ({ id: c.id, credential_name: c.credential_name, created_at: c.created_at }));
        return { rows };
      }

      // DELETE credential for removeCredential
      if (text.startsWith("DELETE FROM webauthn_credentials WHERE id = $1 AND public_key = $2")) {
        const [id, pk] = params;
        let deleted = false;
        for (const [key, c] of credentialsStore.entries()) {
          if (c.id === id && c.public_key === pk) {
            credentialsStore.delete(key);
            deleted = true;
            break;
          }
        }
        return { rows: [], rowCount: deleted ? 1 : 0 };
      }

      // Admin list credentials
      if (text.includes("FROM webauthn_credentials wc") && text.includes("LEFT JOIN profiles p")) {
        const rows = [...credentialsStore.values()].map((c) => ({
          id: c.id,
          public_key: c.public_key,
          credential_id: c.credential_id,
          credential_name: c.credential_name,
          created_at: c.created_at,
          display_name: "Test User",
        }));
        return { rows };
      }

      // Admin revoke credential
      if (text.startsWith("DELETE FROM webauthn_credentials WHERE id = $1 RETURNING")) {
        const [id] = params;
        for (const [key, c] of credentialsStore.entries()) {
          if (c.id === id) {
            credentialsStore.delete(key);
            return { rows: [c], rowCount: 1 };
          }
        }
        return { rows: [], rowCount: 0 };
      }

      // Admin 2FA profile check
      if (text.includes("FROM admin_profiles WHERE id = $1")) {
        return { rows: [{ totp_enabled: false }] };
      }

      return { rows: [], rowCount: 0 };
    });
  });

  // ===========================================================================
  // 1. Registration Flow
  // ===========================================================================
  describe("Registration Flow (/api/webauthn/register/*)", () => {
    const mockRegistrationOptions = {
      challenge: "mock-reg-challenge-abc123",
      rp: { name: "Stellar MarketPay", id: "localhost" },
      user: { id: "mock-user-id", name: "GA...AAAA" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    };

    it("POST /register/begin (200) — generates registration challenge options for authenticated user", async () => {
      generateRegistrationOptions.mockResolvedValueOnce(mockRegistrationOptions);

      const res = await request(app)
        .post("/api/webauthn/register/begin")
        .set("Authorization", `Bearer ${makeToken(TEST_PUBLIC_KEY)}`)
        .set("X-CSRF-Token", "dummy-token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(mockRegistrationOptions);
      expect(generateRegistrationOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          rpName: "Stellar MarketPay",
          rpID: "localhost",
          attestationType: "none",
        })
      );
    });

    it("POST /register/begin (401) — rejects unauthenticated requests", async () => {
      const res = await request(app)
        .post("/api/webauthn/register/begin")
        .set("X-CSRF-Token", "dummy-token");

      expect(res.status).toBe(401);
      expect(generateRegistrationOptions).not.toHaveBeenCalled();
    });

    it("POST /register/finish (200) — verifies registration response and stores new credential", async () => {
      // 1. Begin registration to populate challenge in challengeStore
      generateRegistrationOptions.mockResolvedValueOnce(mockRegistrationOptions);
      await request(app)
        .post("/api/webauthn/register/begin")
        .set("Authorization", `Bearer ${makeToken(TEST_PUBLIC_KEY)}`)
        .set("X-CSRF-Token", "dummy-token");

      // 2. Mock successful verification response
      const rawCredId = Buffer.from("mock-credential-id-bytes-1");
      const rawPublicKey = Buffer.from("mock-public-key-cose-bytes-1");
      const expectedCredIdBase64Url = rawCredId.toString("base64url");
      const expectedPublicKeyBase64 = rawPublicKey.toString("base64");

      verifyRegistrationResponse.mockResolvedValueOnce({
        verified: true,
        registrationInfo: {
          credential: {
            id: rawCredId,
            publicKey: rawPublicKey,
            counter: 0,
          },
        },
      });

      const finishPayload = {
        credential: {
          id: expectedCredIdBase64Url,
          rawId: expectedCredIdBase64Url,
          response: {
            clientDataJSON: "mock-client-data-json",
            attestationObject: "mock-attestation-obj",
            transports: ["internal"],
          },
          type: "public-key",
        },
        name: "My YubiKey",
      };

      const res = await request(app)
        .post("/api/webauthn/register/finish")
        .set("Authorization", `Bearer ${makeToken(TEST_PUBLIC_KEY)}`)
        .set("X-CSRF-Token", "dummy-token")
        .send(finishPayload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe("Passkey registered successfully");

      expect(verifyRegistrationResponse).toHaveBeenCalledWith({
        response: finishPayload.credential,
        expectedChallenge: mockRegistrationOptions.challenge,
        expectedOrigin: "http://localhost:3000",
        expectedRPID: "localhost",
      });

      // Verify the credential was saved in the store
      const savedCred = credentialsStore.get(expectedCredIdBase64Url);
      expect(savedCred).toBeDefined();
      expect(savedCred.public_key).toBe(TEST_PUBLIC_KEY);
      expect(savedCred.credential_name).toBe("My YubiKey");
      expect(savedCred.public_key_cose).toBe(expectedPublicKeyBase64);
      expect(savedCred.counter).toBe(0);
    });

    it("POST /register/finish (400) — rejects when no pending challenge exists", async () => {
      const res = await request(app)
        .post("/api/webauthn/register/finish")
        .set("Authorization", `Bearer ${makeToken(TEST_PUBLIC_KEY)}`)
        .set("X-CSRF-Token", "dummy-token")
        .send({
          credential: { id: "some-cred-id", response: {} },
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("No pending registration challenge. Please try again.");
      expect(verifyRegistrationResponse).not.toHaveBeenCalled();
    });

    it("POST /register/finish (400) — rejects when registration verification fails", async () => {
      // Begin registration to put challenge in store
      generateRegistrationOptions.mockResolvedValueOnce(mockRegistrationOptions);
      await request(app)
        .post("/api/webauthn/register/begin")
        .set("Authorization", `Bearer ${makeToken(TEST_PUBLIC_KEY)}`)
        .set("X-CSRF-Token", "dummy-token");

      verifyRegistrationResponse.mockResolvedValueOnce({
        verified: false,
      });

      const res = await request(app)
        .post("/api/webauthn/register/finish")
        .set("Authorization", `Bearer ${makeToken(TEST_PUBLIC_KEY)}`)
        .set("X-CSRF-Token", "dummy-token")
        .send({
          credential: { id: "failed-cred-id", response: {} },
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Passkey registration verification failed");
    });
  });

  // ===========================================================================
  // 2. Authentication Flow & JWT Issuance
  // ===========================================================================
  describe("Authentication Flow & JWT Issuance (/api/webauthn/login/*)", () => {
    const mockAuthOptions = {
      challenge: "mock-auth-challenge-xyz789",
      rpID: "localhost",
      allowCredentials: [{ id: "mock-cred-id-1", type: "public-key" }],
      userVerification: "preferred",
    };

    beforeEach(() => {
      // Pre-seed a registered credential for TEST_PUBLIC_KEY
      credentialsStore.set("mock-cred-id-1", {
        id: "cred-1",
        public_key: TEST_PUBLIC_KEY,
        credential_id: "mock-cred-id-1",
        credential_name: "My Key",
        public_key_cose: Buffer.from("test-cose-key").toString("base64"),
        counter: 0,
        transports: ["internal"],
        created_at: new Date().toISOString(),
      });
    });

    it("POST /login/begin (200) — returns authentication challenge for valid Stellar public key", async () => {
      generateAuthenticationOptions.mockResolvedValueOnce(mockAuthOptions);

      const res = await request(app)
        .post("/api/webauthn/login/begin")
        .set("X-CSRF-Token", "dummy-token")
        .send({ publicKey: TEST_PUBLIC_KEY });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual(mockAuthOptions);
      expect(generateAuthenticationOptions).toHaveBeenCalledWith(
        expect.objectContaining({
          rpID: "localhost",
          allowCredentials: [{ id: "mock-cred-id-1", type: "public-key", transports: ["internal"] }],
          userVerification: "preferred",
        })
      );
    });

    it("POST /login/begin (400) — rejects invalid or missing Stellar public key", async () => {
      const res = await request(app)
        .post("/api/webauthn/login/begin")
        .set("X-CSRF-Token", "dummy-token")
        .send({ publicKey: "invalid-key" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid Stellar public key");
      expect(generateAuthenticationOptions).not.toHaveBeenCalled();
    });

    it("POST /login/finish (200) — verifies assertion, updates counter, and returns valid JWT + auth cookies", async () => {
      // 1. Begin login to store authentication challenge
      generateAuthenticationOptions.mockResolvedValueOnce(mockAuthOptions);
      await request(app)
        .post("/api/webauthn/login/begin")
        .set("X-CSRF-Token", "dummy-token")
        .send({ publicKey: TEST_PUBLIC_KEY });

      // 2. Mock successful authentication response
      verifyAuthenticationResponse.mockResolvedValueOnce({
        verified: true,
        authenticationInfo: {
          newCounter: 5,
        },
      });

      const loginPayload = {
        publicKey: TEST_PUBLIC_KEY,
        credential: {
          id: "mock-cred-id-1",
          rawId: "mock-cred-id-1",
          response: {
            authenticatorData: "mock-auth-data",
            clientDataJSON: "mock-client-data",
            signature: "mock-signature",
          },
          type: "public-key",
        },
      };

      const res = await request(app)
        .post("/api/webauthn/login/finish")
        .set("X-CSRF-Token", "dummy-token")
        .send(loginPayload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(typeof res.body.token).toBe("string");

      // Verify JWT token payload
      const decoded = jwt.verify(res.body.token, JWT_SECRET);
      expect(decoded.publicKey).toBe(TEST_PUBLIC_KEY);

      // Verify auth cookies are set
      const cookies = parseCookies(res);
      expect(cookies.token).toBe(res.body.token);
      expect(cookies.refreshToken).toBeDefined();

      // Verify counter in DB store was updated
      expect(credentialsStore.get("mock-cred-id-1").counter).toBe(5);

      // Verify verifyAuthenticationResponse parameters
      expect(verifyAuthenticationResponse).toHaveBeenCalledWith({
        response: loginPayload.credential,
        expectedChallenge: mockAuthOptions.challenge,
        expectedOrigin: "http://localhost:3000",
        expectedRPID: "localhost",
        credential: {
          id: "mock-cred-id-1",
          publicKey: Buffer.from("test-cose-key"),
          counter: 0,
          transports: ["internal"],
        },
      });
    });

    it("POST /login/finish (404) — rejects when passkey is not found for the account", async () => {
      generateAuthenticationOptions.mockResolvedValueOnce(mockAuthOptions);
      await request(app)
        .post("/api/webauthn/login/begin")
        .set("X-CSRF-Token", "dummy-token")
        .send({ publicKey: TEST_PUBLIC_KEY });

      const res = await request(app)
        .post("/api/webauthn/login/finish")
        .set("X-CSRF-Token", "dummy-token")
        .send({
          publicKey: TEST_PUBLIC_KEY,
          credential: { id: "non-existent-cred-id" },
        });

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Passkey not found for this account");
      expect(verifyAuthenticationResponse).not.toHaveBeenCalled();
    });

    it("POST /login/finish (401) — rejects when passkey verification fails", async () => {
      generateAuthenticationOptions.mockResolvedValueOnce(mockAuthOptions);
      await request(app)
        .post("/api/webauthn/login/begin")
        .set("X-CSRF-Token", "dummy-token")
        .send({ publicKey: TEST_PUBLIC_KEY });

      verifyAuthenticationResponse.mockResolvedValueOnce({
        verified: false,
      });

      const res = await request(app)
        .post("/api/webauthn/login/finish")
        .set("X-CSRF-Token", "dummy-token")
        .send({
          publicKey: TEST_PUBLIC_KEY,
          credential: { id: "mock-cred-id-1" },
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Passkey authentication failed");
    });
  });

  // ===========================================================================
  // 3. Replay Protection
  // ===========================================================================
  describe("Replay Protection", () => {
    const mockAuthOptions = {
      challenge: "replay-test-challenge-123",
      rpID: "localhost",
      allowCredentials: [{ id: "mock-cred-replay", type: "public-key" }],
      userVerification: "preferred",
    };

    const loginPayload = {
      publicKey: TEST_PUBLIC_KEY,
      credential: {
        id: "mock-cred-replay",
        rawId: "mock-cred-replay",
        response: {
          authenticatorData: "auth-data",
          clientDataJSON: "client-json",
          signature: "valid-sig",
        },
        type: "public-key",
      },
    };

    beforeEach(() => {
      credentialsStore.set("mock-cred-replay", {
        id: "cred-replay",
        public_key: TEST_PUBLIC_KEY,
        credential_id: "mock-cred-replay",
        credential_name: "Replay Test Key",
        public_key_cose: Buffer.from("cose-key").toString("base64"),
        counter: 0,
        transports: [],
        created_at: new Date().toISOString(),
      });
    });

    it("rejects replayed assertion when challenge has been consumed (returns 400)", async () => {
      // 1. Begin login
      generateAuthenticationOptions.mockResolvedValueOnce(mockAuthOptions);
      await request(app)
        .post("/api/webauthn/login/begin")
        .set("X-CSRF-Token", "dummy-token")
        .send({ publicKey: TEST_PUBLIC_KEY });

      // 2. First assertion succeeds and consumes the challenge from challengeStore
      verifyAuthenticationResponse.mockResolvedValueOnce({
        verified: true,
        authenticationInfo: { newCounter: 1 },
      });

      const firstRes = await request(app)
        .post("/api/webauthn/login/finish")
        .set("X-CSRF-Token", "dummy-token")
        .send(loginPayload);

      expect(firstRes.status).toBe(200);
      expect(firstRes.body.success).toBe(true);

      // 3. Second attempt with the exact same payload (replayed assertion)
      const secondRes = await request(app)
        .post("/api/webauthn/login/finish")
        .set("X-CSRF-Token", "dummy-token")
        .send(loginPayload);

      expect(secondRes.status).toBe(400);
      expect(secondRes.body.error).toBe("No pending authentication challenge. Please try again.");
    });

    it("rejects assertion replay against a new challenge (returns 401 when verification fails)", async () => {
      // 1. First login cycle completes
      generateAuthenticationOptions.mockResolvedValueOnce(mockAuthOptions);
      await request(app)
        .post("/api/webauthn/login/begin")
        .set("X-CSRF-Token", "dummy-token")
        .send({ publicKey: TEST_PUBLIC_KEY });

      verifyAuthenticationResponse.mockResolvedValueOnce({
        verified: true,
        authenticationInfo: { newCounter: 1 },
      });

      await request(app)
        .post("/api/webauthn/login/finish")
        .set("X-CSRF-Token", "dummy-token")
        .send(loginPayload);

      // 2. Attacker initiates a fresh challenge, but replays the old assertion signature
      generateAuthenticationOptions.mockResolvedValueOnce({
        ...mockAuthOptions,
        challenge: "different-fresh-challenge-999",
      });

      await request(app)
        .post("/api/webauthn/login/begin")
        .set("X-CSRF-Token", "dummy-token")
        .send({ publicKey: TEST_PUBLIC_KEY });

      // Verification library rejects the assertion because expectedChallenge does not match
      verifyAuthenticationResponse.mockResolvedValueOnce({
        verified: false,
      });

      const replayedRes = await request(app)
        .post("/api/webauthn/login/finish")
        .set("X-CSRF-Token", "dummy-token")
        .send(loginPayload);

      expect(replayedRes.status).toBe(401);
      expect(replayedRes.body.error).toBe("Passkey authentication failed");
    });
  });

  // ===========================================================================
  // 4. Credential Management Routes
  // ===========================================================================
  describe("Credential Management (/api/webauthn/credentials)", () => {
    beforeEach(() => {
      credentialsStore.set("cred-user-1", {
        id: "id-1",
        public_key: TEST_PUBLIC_KEY,
        credential_id: "cred-user-1",
        credential_name: "Laptop Passkey",
        created_at: new Date().toISOString(),
      });
      credentialsStore.set("cred-user-2", {
        id: "id-2",
        public_key: OTHER_PUBLIC_KEY,
        credential_id: "cred-user-2",
        credential_name: "Phone Passkey",
        created_at: new Date().toISOString(),
      });
    });

    it("GET /credentials (200) — lists registered passkeys for current authenticated user", async () => {
      const res = await request(app)
        .get("/api/webauthn/credentials")
        .set("Authorization", `Bearer ${makeToken(TEST_PUBLIC_KEY)}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].credential_name).toBe("Laptop Passkey");
    });

    it("DELETE /credentials/:id (200) — removes passkey for current authenticated user", async () => {
      const res = await request(app)
        .delete("/api/webauthn/credentials/id-1")
        .set("Authorization", `Bearer ${makeToken(TEST_PUBLIC_KEY)}`)
        .set("X-CSRF-Token", "dummy-token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe("Passkey removed");
    });

    it("DELETE /credentials/:id (404) — rejects when passkey does not belong to user", async () => {
      const res = await request(app)
        .delete("/api/webauthn/credentials/id-2")
        .set("Authorization", `Bearer ${makeToken(TEST_PUBLIC_KEY)}`)
        .set("X-CSRF-Token", "dummy-token");

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Passkey not found");
    });

    it("GET /admin/credentials (200) — allows admin to list credentials", async () => {
      const res = await request(app)
        .get("/api/webauthn/admin/credentials")
        .set("Authorization", `Bearer ${makeToken(ADMIN_PUBLIC_KEY, "admin")}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveLength(2);
    });

    it("DELETE /admin/credentials/:id (200) — allows admin to revoke any credential", async () => {
      const res = await request(app)
        .delete("/api/webauthn/admin/credentials/id-2")
        .set("Authorization", `Bearer ${makeToken(ADMIN_PUBLIC_KEY, "admin")}`)
        .set("X-CSRF-Token", "dummy-token");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe("Passkey revoked");
    });
  });
});
