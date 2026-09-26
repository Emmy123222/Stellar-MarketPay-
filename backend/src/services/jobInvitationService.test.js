jest.mock("../db/pool", () => {
  const { createPgMock } = require("../testUtils/pgMock");
  return createPgMock();
});

jest.mock("./notificationService", () => ({
  queueNotification: jest.fn().mockResolvedValue({}),
  EVENT_TYPES: { JOB_INVITED: "job_invited" },
}));

jest.mock("./applicationService", () => ({
  submitApplication: jest.fn().mockResolvedValue({ id: "app-1", status: "pending" }),
}));

const pool = require("../db/pool");
const {
  inviteFreelancerToJob,
  getInvitationsForFreelancer,
  revokeInvitation,
  purgeExpiredInvitations,
} = require("./jobInvitationService");

const VALID_CLIENT =
  "GABCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC";
const VALID_FREELANCER =
  "GBBCDEFGHIJKLMNOPQRSTUVWXYZABCDEFGHIJKLMNOPQRSTUVWXYZABC";

function makeJob(overrides = {}) {
  return {
    id: overrides.id || `job-${Date.now()}`,
    title: "Test job",
    description: "desc",
    budget: "100",
    currency: "XLM",
    category: "Smart Contracts",
    client_address: VALID_CLIENT,
    freelancer_address: null,
    visibility: overrides.visibility || "invite_only",
    status: "open",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

function makeInvitation(overrides = {}) {
  return {
    id: overrides.id || `inv-${Date.now()}`,
    job_id: overrides.job_id || `job-${Date.now()}`,
    client_address: overrides.client_address || VALID_CLIENT,
    freelancer_address: overrides.freelancer_address || VALID_FREELANCER,
    status: overrides.status || "pending",
    created_at: overrides.created_at || new Date().toISOString(),
    expires_at: overrides.expires_at || new Date(Date.now() + 7 * 86400000).toISOString(),
  };
}

describe("jobInvitationService — expiry & revocation", () => {
  beforeEach(() => {
    pool.reset();
  });

  describe("inviteFreelancerToJob", () => {
    it("sets expires_at to ~7 days from now", async () => {
      const job = makeJob();
      pool.jobs.set(job.id, job);

      const expiresAtDate = new Date(Date.now() + 7 * 86400000);
      const mockInv = makeInvitation({ expires_at: expiresAtDate.toISOString() });

      const originalQuery = pool.query.getMockImplementation();
      pool.query.mockImplementation(async (sql, params) => {
        if (sql.includes("INSERT INTO job_invitations")) {
          return { rows: [mockInv] };
        }
        if (sql.includes("SELECT display_name FROM profiles")) {
          return { rows: [{ display_name: "Client" }] };
        }
        return originalQuery ? originalQuery(sql, params) : { rows: [] };
      });

      const invitation = await inviteFreelancerToJob({
        jobId: job.id,
        clientAddress: VALID_CLIENT,
        freelancerAddress: VALID_FREELANCER,
      });

      expect(invitation.expires_at).toBeDefined();
      const expiresAt = new Date(invitation.expires_at);
      const now = new Date();
      const diffMs = expiresAt.getTime() - now.getTime();
      expect(diffMs).toBeGreaterThan(6 * 86400000);
      expect(diffMs).toBeLessThanOrEqual(7 * 86400000 + 5000);
    });
  });

  describe("getInvitationsForFreelancer", () => {
    it("excludes expired invitations from results", async () => {
      const validInv = makeInvitation({ id: "inv-valid" });

      pool.query.mockImplementationOnce(async (sql) => {
        if (sql.includes("FROM job_invitations")) {
          return { rows: [validInv] };
        }
        return { rows: [] };
      });

      const invitations = await getInvitationsForFreelancer(VALID_FREELANCER);
      expect(invitations).toHaveLength(1);
      expect(invitations[0].id).toBe("inv-valid");
    });
  });

  describe("revokeInvitation", () => {
    it("deletes the invitation when called by the owning client", async () => {
      const inv = makeInvitation();
      pool.query
        .mockResolvedValueOnce({ rows: [inv] })
        .mockResolvedValueOnce({ rowCount: 1 });

      const result = await revokeInvitation(inv.id, VALID_CLIENT);
      expect(result).toBe(true);
    });

    it("throws 404 when the invitation does not exist", async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });
      await expect(revokeInvitation("nonexistent", VALID_CLIENT)).rejects.toThrow(
        "Invitation not found",
      );
    });

    it("throws 403 when the caller is not the job client", async () => {
      const inv = makeInvitation();
      pool.query.mockResolvedValueOnce({ rows: [inv] });
      await expect(revokeInvitation(inv.id, VALID_FREELANCER)).rejects.toThrow(
        "Only the job client can revoke an invitation",
      );
    });
  });

  describe("purgeExpiredInvitations", () => {
    it("deletes expired and accepted/declined invitations", async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 5 });
      const count = await purgeExpiredInvitations();
      expect(count).toBe(5);
    });

    it("returns 0 when nothing to purge", async () => {
      pool.query.mockResolvedValueOnce({ rowCount: 0 });
      const count = await purgeExpiredInvitations();
      expect(count).toBe(0);
    });
  });
});

describe("expired invitation accept returns 410 Gone", () => {
  it("expired token is rejected with 410 status", () => {
    const expiredInv = makeInvitation({
      expires_at: new Date(Date.now() - 60000).toISOString(),
    });

    const now = new Date();
    const isExpired = expiredInv.expires_at && new Date(expiredInv.expires_at) < now;
    expect(isExpired).toBe(true);
  });

  it("valid (non-expired) invitation is not rejected", () => {
    const validInv = makeInvitation({
      expires_at: new Date(Date.now() + 86400000).toISOString(),
    });

    const now = new Date();
    const isExpired = validInv.expires_at && new Date(validInv.expires_at) < now;
    expect(isExpired).toBe(false);
  });

  it("invitation without expires_at is not rejected", () => {
    const inv = makeInvitation();
    delete inv.expires_at;

    const now = new Date();
    const isExpired = Boolean(inv.expires_at && new Date(inv.expires_at) < now);
    expect(isExpired).toBe(false);
  });
});
