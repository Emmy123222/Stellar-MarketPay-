const { runDailyDigest } = require('./jobDigestService');
const pool = require('../db/pool');
const { sendEmail } = require('../utils/email');

jest.mock('../db/pool');
jest.mock('../utils/email');

describe('jobDigestService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('job matching two categories appears once in digest output', async () => {
    // 1. Mock users query
    pool.query.mockResolvedValueOnce({
      rows: [
        { id: 1, email: 'user1@example.com', name: 'User One', email_digest_enabled: true }
      ]
    });

    // 2. Mock saved searches query (2 searches for same user)
    pool.query.mockResolvedValueOnce({
      rows: [
        { keyword: 'React', skills: [] },
        { keyword: 'Frontend', skills: [] }
      ]
    });

    // 3. Mock findMatchingJobs for first search
    pool.query.mockResolvedValueOnce({
      rows: [
        { id: 100, title: 'React Frontend Developer', category: 'Frontend', budget: 1000, currency: 'USD', skills: ['React'] }
      ]
    });

    // 4. Mock findMatchingJobs for second search (same job!)
    pool.query.mockResolvedValueOnce({
      rows: [
        { id: 100, title: 'React Frontend Developer', category: 'Frontend', budget: 1000, currency: 'USD', skills: ['React'] }
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
});
