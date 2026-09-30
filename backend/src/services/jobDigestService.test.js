const { runDailyDigest } = require('./jobDigestService');
const pool = require('../db/pool');
const { sendEmail } = require('../utils/email');

jest.mock('../db/pool');
jest.mock('../utils/email');

describe('jobDigestService', () => {
  const USER = {
    id: 1,
    email: 'user1@example.com',
    name: 'User One',
    email_digest_enabled: true,
  };
  const SEARCH = { keyword: 'Stellar', skills: [] };
  const DIGEST_WINDOW_MS = 24 * 60 * 60 * 1000;

  beforeEach(() => {
    jest.clearAllMocks();
    pool.query.mockReset();
  });

  it('job matching two categories appears once in digest output', async () => {
    // 1. Mock users query
    pool.query.mockResolvedValueOnce({ rows: [USER] });

    // 2. Mock saved searches query (2 searches for same user)
    pool.query.mockResolvedValueOnce({
      rows: [
        { keyword: 'React', skills: [] },
        { keyword: 'Frontend', skills: [] }
      ]
    });

    // 3. Mock findMatchingJobs for first search (same job matched)
    pool.query.mockResolvedValueOnce({
      rows: [
        { id: 100, title: 'React Frontend Developer', category: 'Frontend', budget: 1000, currency: 'USD', skills: ['React'], created_at: '2026-01-15T06:00:00.000Z' }
      ]
    });

    // 4. Mock findMatchingJobs for second search (same job matched again)
    pool.query.mockResolvedValueOnce({
      rows: [
        { id: 100, title: 'React Frontend Developer', category: 'Frontend', budget: 1000, currency: 'USD', skills: ['React'], created_at: '2026-01-15T06:00:00.000Z' }
      ]
    });

    const result = await runDailyDigest();

    expect(result.emailsSent).toBe(1);
    expect(sendEmail).toHaveBeenCalledTimes(1);

    // The email html should contain the job exactly once.
    const emailArgs = sendEmail.mock.calls[0][0];

    const htmlMatches = emailArgs.html.match(/React Frontend Developer/g);
    expect(htmlMatches.length).toBe(1);
  });

  it('includes all five matching jobs in newest-first order', async () => {
    const jobs = [
      { id: 5, title: 'Job 5', category: 'Blockchain', budget: 5000, currency: 'USD', skills: ['Soroban'], created_at: '2026-01-20T12:00:00.000Z' },
      { id: 4, title: 'Job 4', category: 'Blockchain', budget: 4000, currency: 'USD', skills: ['Soroban'], created_at: '2026-01-19T12:00:00.000Z' },
      { id: 3, title: 'Job 3', category: 'Backend', budget: 3000, currency: 'USD', skills: ['Rust'], created_at: '2026-01-18T12:00:00.000Z' },
      { id: 2, title: 'Job 2', category: 'Backend', budget: 2000, currency: 'USD', skills: ['Node'], created_at: '2026-01-17T12:00:00.000Z' },
      { id: 1, title: 'Job 1', category: 'Frontend', budget: 1000, currency: 'USD', skills: ['React'], created_at: '2026-01-16T12:00:00.000Z' }
    ];

    pool.query
      .mockResolvedValueOnce({ rows: [USER] })
      .mockResolvedValueOnce({ rows: [SEARCH] })
      .mockResolvedValueOnce({ rows: jobs });

    const result = await runDailyDigest();

    expect(result).toEqual({ usersProcessed: 1, emailsSent: 1 });
    expect(sendEmail).toHaveBeenCalledTimes(1);

    const { html, subject } = sendEmail.mock.calls[0][0];

    const titles = jobs.map((job) => job.title);
    const positions = titles.map((title) => html.indexOf(title));

    expect(positions.every((pos) => pos >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));

    titles.forEach((title) => {
      expect(html.split(title).length - 1).toBe(1);
    });

    expect(subject).toContain('5 new jobs');

    const jobSql = pool.query.mock.calls.find(([sql]) => sql.includes('FROM jobs'))[0];
    expect(jobSql).toMatch(/ORDER BY created_at DESC/i);
  });

  it('excludes a job older than 7 days while still digesting a recent job', async () => {
    // Deterministic reference date for "digest generation time".
    const referenceDate = new Date('2026-01-15T06:00:00.000Z');

    const recentJob = {
      id: 201,
      title: 'Fresh Stellar Job',
      category: 'Blockchain',
      budget: 800,
      currency: 'XLM',
      skills: ['Soroban'],
      created_at: '2026-01-15T02:00:00.000Z'
    };
    const oldJob = {
      id: 202,
      title: 'Ancient Stellar Job',
      category: 'Blockchain',
      budget: 100,
      currency: 'XLM',
      skills: ['Rust'],
      created_at: '2026-01-07T00:00:00.000Z'
    };

    // Simulate the database applying the digest date window against the fixed
    // reference date before return rows to findMatchingJobs.
    pool.query.mockImplementation(async (sql) => {
      if (sql.includes('FROM jobs')) {
        return {
          rows: [oldJob, recentJob]
            .filter((job) => new Date(job.created_at).getTime() >= referenceDate.getTime() - DIGEST_WINDOW_MS)
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
        };
      }
      if (sql.includes('FROM users')) return { rows: [USER] };
      if (sql.includes('FROM saved_searches')) return { rows: [SEARCH] };
      return { rows: [] };
    });

    const result = await runDailyDigest();

    expect(result).toEqual({ usersProcessed: 1, emailsSent: 1 });
    expect(sendEmail).toHaveBeenCalledTimes(1);

    const { html } = sendEmail.mock.calls[0][0];
    expect(html).toContain('Fresh Stellar Job');
    expect(html).not.toContain('Ancient Stellar Job');

    const jobSql = pool.query.mock.calls.find(([sql]) => sql.includes('FROM jobs'))[0];
    expect(jobSql).toMatch(/created_at\s*>=\s*NOW\(\)\s*-\s*INTERVAL\s*'24 hours'/i);
  });
});