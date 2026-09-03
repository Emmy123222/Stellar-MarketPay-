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
});
