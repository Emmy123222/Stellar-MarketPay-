const request = require('supertest');
const express = require('express');
const { createRateLimiter } = require('./rateLimiter');

describe('Rate Limiter Middleware', () => {
  let app;

  beforeEach(() => {
    app = express();
    // Use a small limit for testing (e.g., 2 requests per 15 minutes)
    const limiter = createRateLimiter(2, 15);
    
    app.use('/api/test', limiter);
    app.get('/api/test', (req, res) => {
      res.status(200).json({ message: 'Success' });
    });
  });

  it('should return X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset headers', async () => {
    const response = await request(app).get('/api/test');
    
    expect(response.status).toBe(200);
    expect(response.headers).toHaveProperty('x-ratelimit-limit');
    expect(response.headers).toHaveProperty('x-ratelimit-remaining');
    expect(response.headers).toHaveProperty('x-ratelimit-reset');
    
    // Check if limit is correct
    expect(response.headers['x-ratelimit-limit']).toBe('2');
    expect(response.headers['x-ratelimit-remaining']).toBe('1');
  });

  it('should decrease X-RateLimit-Remaining on subsequent requests', async () => {
    await request(app).get('/api/test'); // 1st request (remaining: 1)
    const response = await request(app).get('/api/test'); // 2nd request (remaining: 0)
    
    expect(response.status).toBe(200);
    expect(response.headers['x-ratelimit-remaining']).toBe('0');
  });

  it('should return 429 when rate limit is exceeded', async () => {
    await request(app).get('/api/test'); // 1st request (remaining: 1)
    await request(app).get('/api/test'); // 2nd request (remaining: 0)
    const response = await request(app).get('/api/test'); // 3rd request (exceeds limit)
    
    expect(response.status).toBe(429);
    expect(response.body.message).toBe('Too many requests — please wait before trying again');
    expect(response.headers).toHaveProperty('retry-after');
    expect(response.headers).toHaveProperty('x-ratelimit-limit');
    expect(response.headers).toHaveProperty('x-ratelimit-remaining');
    expect(response.headers).toHaveProperty('x-ratelimit-reset');
  });

  describe('Proxy Handling & IP Spoofing Prevention', () => {
    let proxyApp;

    beforeEach(() => {
      proxyApp = express();
      proxyApp.set('trust proxy', 1);
      const limiter = createRateLimiter(2, 15);

      proxyApp.use('/api/proxy-test', limiter);
      proxyApp.get('/api/proxy-test', (req, res) => {
        res.status(200).json({ clientIp: req.ip });
      });
    });

    it('should correctly identify client IP behind a reverse proxy', async () => {
      const res = await request(proxyApp)
        .get('/api/proxy-test')
        .set('X-Forwarded-For', '203.0.113.195');

      expect(res.status).toBe(200);
      expect(res.body.clientIp).toBe('203.0.113.195');
    });

    it('should prevent rate limiter bypass via spoofed X-Forwarded-For headers', async () => {
      const res1 = await request(proxyApp)
        .get('/api/proxy-test')
        .set('X-Forwarded-For', '10.0.0.1, 203.0.113.195');
      expect(res1.status).toBe(200);

      const res2 = await request(proxyApp)
        .get('/api/proxy-test')
        .set('X-Forwarded-For', '10.0.0.2, 203.0.113.195');
      expect(res2.status).toBe(200);

      // 3rd request from the same client IP should be 429 even if prepended spoofed IP differs
      const res3 = await request(proxyApp)
        .get('/api/proxy-test')
        .set('X-Forwarded-For', '10.0.0.3, 203.0.113.195');
      expect(res3.status).toBe(429);
      expect(res3.body.message).toBe('Too many requests — please wait before trying again');
    });
  });
});
