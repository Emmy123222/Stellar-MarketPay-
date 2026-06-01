/**
 * src/services/weeklyDigestService.test.js
 *
 * Unit tests for the weekly job-digest email service.
 * All DB calls and dependencies are mocked — no real DB or SMTP needed.
 */
"use strict";

// ── Mock dependencies before requiring the module under test ──────────────────

jest.mock("../db/pool", () => ({
  query: jest.fn(),
}));

jest.mock("./recommendationService", () => ({
  getRecommendations: jest.fn(),
}));

jest.mock("./notificationPreferencesService", () => ({
  isNotificationEnabled: jest.fn(),
}));

jest.mock("../utils/logger", () => ({
  createServiceLogger: () => ({
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
  }),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

const pool = require("../db/pool");
const { getRecommendations } = require("./recommendationService");
const { isNotificationEnabled } = require("./notificationPreferencesService");
const {
  sendWeeklyDigest,
  generateDigestEmail,
  getActiveFreelancers,
} = require("./weeklyDigestService");

// ── Fixtures ──────────────────────────────────────────────────────────────────

const MOCK_FREELANCERS = [
  {
    public_key: "GFREELANCER1",
    email: "freelancer1@example.com",
    digest_unsubscribe_token: "token-aaa-111",
  },
  {
    public_key: "GFREELANCER2",
    email: "freelancer2@example.com",
    digest_unsubscribe_token: "token-bbb-222",
  },
];

function makeJob(overrides = {}) {
  return {
    id: "job-uuid-001",
    title: "Rust Smart Contract Developer",
    description: "We need an experienced Rust developer to build Soroban contracts.",
    budget: 1500,
    currency: "XLM",
    category: "Blockchain",
    match_score: 87.5,
    created_at: new Date().toISOString(), // now = within 7 days
    ...overrides,
  };
}

// ── Tests: getActiveFreelancers ───────────────────────────────────────────────

describe("getActiveFreelancers()", () => {
  afterEach(() => jest.clearAllMocks());

  it("queries profiles with correct activity + role filters", async () => {
    pool.query.mockResolvedValueOnce({ rows: MOCK_FREELANCERS });

    const result = await getActiveFreelancers();

    expect(pool.query).toHaveBeenCalledTimes(1);
    const sql = pool.query.mock.calls[0][0];
    expect(sql).toMatch(/role IN \('freelancer', 'both'\)/);
    expect(sql).toMatch(/email IS NOT NULL/);
    expect(sql).toMatch(/last_login_at >= NOW\(\) - INTERVAL '30 days'/);
    expect(result).toEqual(MOCK_FREELANCERS);
  });

  it("returns empty array when no active freelancers", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });
    const result = await getActiveFreelancers();
    expect(result).toEqual([]);
  });
});

// ── Tests: generateDigestEmail ────────────────────────────────────────────────

describe("generateDigestEmail()", () => {
  const jobs = [makeJob(), makeJob({ id: "job-uuid-002", title: "Frontend Engineer" })];
  const token = "unsub-token-xyz";
  const baseUrl = "https://app.example.com";
  const apiBaseUrl = "https://api.example.com";

  it("returns correct subject line", () => {
    const { subject } = generateDigestEmail(jobs, token, baseUrl, apiBaseUrl);
    expect(subject).toBe("5 new jobs matching your skills this week");
  });

  it("HTML contains all job titles", () => {
    const { html } = generateDigestEmail(jobs, token, baseUrl, apiBaseUrl);
    expect(html).toContain("Rust Smart Contract Developer");
    expect(html).toContain("Frontend Engineer");
  });

  it("HTML contains correct Apply Now links", () => {
    const { html } = generateDigestEmail(jobs, token, baseUrl, apiBaseUrl);
    expect(html).toContain(`${baseUrl}/jobs/job-uuid-001`);
    expect(html).toContain(`${baseUrl}/jobs/job-uuid-002`);
  });

  it("HTML contains the unsubscribe link with the token", () => {
    const { html } = generateDigestEmail(jobs, token, baseUrl, apiBaseUrl);
    expect(html).toContain(`${apiBaseUrl}/api/notifications/unsubscribe?token=${token}`);
  });

  it("plain-text fallback contains all job titles", () => {
    const { text } = generateDigestEmail(jobs, token, baseUrl, apiBaseUrl);
    expect(text).toContain("Rust Smart Contract Developer");
    expect(text).toContain("Frontend Engineer");
    expect(text).toContain(token);
  });

  it("HTML contains budget in XLM", () => {
    const { html } = generateDigestEmail(jobs, token, baseUrl, apiBaseUrl);
    expect(html).toContain("1,500 XLM");
  });

  it("HTML contains category badge", () => {
    const { html } = generateDigestEmail(jobs, token, baseUrl, apiBaseUrl);
    expect(html).toContain("Blockchain");
  });
});

// ── Tests: sendWeeklyDigest ───────────────────────────────────────────────────

describe("sendWeeklyDigest()", () => {
  let sendEmailFn;

  beforeEach(() => {
    sendEmailFn = jest.fn().mockResolvedValue(undefined);
    jest.clearAllMocks();

    process.env.FRONTEND_URL = "https://app.example.com";
    process.env.API_BASE_URL = "https://api.example.com";
  });

  afterEach(() => {
    delete process.env.FRONTEND_URL;
    delete process.env.API_BASE_URL;
  });

  it("sends to all active freelancers with matching recent jobs", async () => {
    pool.query.mockResolvedValueOnce({ rows: MOCK_FREELANCERS });
    isNotificationEnabled.mockResolvedValue(true);
    getRecommendations.mockResolvedValue([makeJob()]);

    const stats = await sendWeeklyDigest(sendEmailFn);

    expect(sendEmailFn).toHaveBeenCalledTimes(2);
    expect(stats.sent).toBe(2);
    expect(stats.skipped).toBe(0);
    expect(stats.failed).toBe(0);
  });

  it("skips freelancers who have opted out", async () => {
    pool.query.mockResolvedValueOnce({ rows: [MOCK_FREELANCERS[0]] });
    isNotificationEnabled.mockResolvedValue(false); // opted out

    const stats = await sendWeeklyDigest(sendEmailFn);

    expect(sendEmailFn).not.toHaveBeenCalled();
    expect(stats.sent).toBe(0);
    expect(stats.skipped).toBe(1);
    expect(stats.failed).toBe(0);
  });

  it("skips freelancers with no matching jobs in the past 7 days", async () => {
    pool.query.mockResolvedValueOnce({ rows: [MOCK_FREELANCERS[0]] });
    isNotificationEnabled.mockResolvedValue(true);
    // Job is older than 7 days
    const oldJob = makeJob({
      created_at: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(),
    });
    getRecommendations.mockResolvedValue([oldJob]);

    const stats = await sendWeeklyDigest(sendEmailFn);

    expect(sendEmailFn).not.toHaveBeenCalled();
    expect(stats.skipped).toBe(1);
  });

  it("caps jobs per freelancer at 5 even if more are returned", async () => {
    pool.query.mockResolvedValueOnce({ rows: [MOCK_FREELANCERS[0]] });
    isNotificationEnabled.mockResolvedValue(true);

    // Return 10 recent jobs
    const tenJobs = Array.from({ length: 10 }, (_, i) =>
      makeJob({ id: `job-${i}`, title: `Job ${i}` })
    );
    getRecommendations.mockResolvedValue(tenJobs);

    await sendWeeklyDigest(sendEmailFn);

    // Extract the html argument to count job titles
    const htmlSent = sendEmailFn.mock.calls[0][0].html;
    // Only 5 "Apply Now →" buttons should appear
    const applyCount = (htmlSent.match(/Apply Now →/g) || []).length;
    expect(applyCount).toBe(5);
  });

  it("counts failed sends and continues for other freelancers", async () => {
    pool.query.mockResolvedValueOnce({ rows: MOCK_FREELANCERS });
    isNotificationEnabled.mockResolvedValue(true);
    getRecommendations.mockResolvedValue([makeJob()]);

    // First send fails, second succeeds
    sendEmailFn
      .mockRejectedValueOnce(new Error("SMTP timeout"))
      .mockResolvedValueOnce(undefined);

    const stats = await sendWeeklyDigest(sendEmailFn);

    expect(stats.sent).toBe(1);
    expect(stats.failed).toBe(1);
  });

  it("sends the correct subject line", async () => {
    pool.query.mockResolvedValueOnce({ rows: [MOCK_FREELANCERS[0]] });
    isNotificationEnabled.mockResolvedValue(true);
    getRecommendations.mockResolvedValue([makeJob()]);

    await sendWeeklyDigest(sendEmailFn);

    const call = sendEmailFn.mock.calls[0][0];
    expect(call.subject).toBe("5 new jobs matching your skills this week");
    expect(call.to).toBe("freelancer1@example.com");
  });

  it("sends nothing when there are no active freelancers", async () => {
    pool.query.mockResolvedValueOnce({ rows: [] });

    const stats = await sendWeeklyDigest(sendEmailFn);

    expect(sendEmailFn).not.toHaveBeenCalled();
    expect(stats.sent).toBe(0);
    expect(stats.skipped).toBe(0);
    expect(stats.failed).toBe(0);
  });
});
