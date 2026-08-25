jest.mock("../db/pool", () => ({
  query: jest.fn(),
}));

const pool = require("../db/pool");
const {
  MAX_ACTIVE_CREDENTIALS,
  MAX_REGISTRATION_ATTEMPTS_PER_HOUR,
  REGISTRATION_ATTEMPT_WINDOW_MS,
  assertCanRegisterCredential,
  assertRegistrationAttemptAllowed,
  recordRegistrationAttempt,
  registerCredential,
  adminListCredentials,
  adminRevokeCredential,
  _resetRegistrationAttemptsForTest,
} = require("./webauthnService");

describe("webauthnService", () => {
  const publicKey = "GABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC";

  beforeEach(() => {
    jest.clearAllMocks();
    _resetRegistrationAttemptsForTest();
  });

  describe("registration attempts", () => {
    it("limits registration verification attempts to 3 per hour per public key", () => {
      const now = Date.now();

      for (let i = 0; i < MAX_REGISTRATION_ATTEMPTS_PER_HOUR; i += 1) {
        recordRegistrationAttempt(publicKey, now + i);
      }

      expect(() => assertRegistrationAttemptAllowed(publicKey, now + 1000)).toThrow(
        "Too many passkey registration attempts"
      );

      try {
        assertRegistrationAttemptAllowed(publicKey, now + 1000);
      } catch (e) {
        expect(e.status).toBe(429);
      }
    });

    it("allows a public key again after the hourly window expires", () => {
      const now = Date.now();

      for (let i = 0; i < MAX_REGISTRATION_ATTEMPTS_PER_HOUR; i += 1) {
        recordRegistrationAttempt(publicKey, now + i);
      }

      expect(() => assertRegistrationAttemptAllowed(publicKey, now + REGISTRATION_ATTEMPT_WINDOW_MS + 1))
        .not.toThrow();
    });
  });

  describe("credential limits", () => {
    it("rejects new registrations after 10 active credentials", async () => {
      pool.query.mockResolvedValueOnce({ rows: [{ count: MAX_ACTIVE_CREDENTIALS }] });

      await expect(assertCanRegisterCredential(publicKey)).rejects.toMatchObject({
        status: 409,
        message: "Maximum active passkeys reached for this account.",
      });
    });

    it("checks the active credential cap before inserting a credential", async () => {
      pool.query
        .mockResolvedValueOnce({ rows: [{ count: MAX_ACTIVE_CREDENTIALS - 1 }] })
        .mockResolvedValueOnce({
          rows: [
            {
              id: "credential-uuid",
              public_key: publicKey,
              credential_id: "credential-id",
              credential_name: "Laptop",
              created_at: "2026-06-24T00:00:00.000Z",
            },
          ],
        });

      const registered = await registerCredential({
        publicKey,
        credentialId: "credential-id",
        credentialName: "Laptop",
        publicKeyCose: "public-key-cose",
        counter: 0,
        transports: ["internal"],
      });

      expect(registered.id).toBe("credential-uuid");
      expect(pool.query).toHaveBeenCalledTimes(2);
      expect(pool.query.mock.calls[1][0]).toContain("INSERT INTO webauthn_credentials");
    });
  });

  describe("admin credential management", () => {
    it("lists credentials for a requested account", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ id: "credential-uuid", public_key: publicKey, credential_name: "Laptop" }],
      });

      const rows = await adminListCredentials(publicKey);

      expect(rows).toHaveLength(1);
      expect(pool.query.mock.calls[0][0]).toContain("WHERE wc.public_key = $1");
      expect(pool.query.mock.calls[0][1]).toEqual([publicKey]);
    });

    it("lets admins revoke any credential by id", async () => {
      pool.query.mockResolvedValueOnce({
        rows: [{ id: "credential-uuid", public_key: publicKey, credential_name: "Laptop" }],
      });

      const revoked = await adminRevokeCredential("credential-uuid");

      expect(revoked).toEqual({
        id: "credential-uuid",
        public_key: publicKey,
        credential_name: "Laptop",
      });
      expect(pool.query.mock.calls[0][0]).toContain("DELETE FROM webauthn_credentials");
      expect(pool.query.mock.calls[0][1]).toEqual(["credential-uuid"]);
    });

    it("returns 404 when an admin revokes a missing credential", async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      await expect(adminRevokeCredential("missing")).rejects.toMatchObject({
        status: 404,
        message: "Passkey not found",
      });
    });
  });
});
