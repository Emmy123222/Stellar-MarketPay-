const request = require('supertest');
const express = require('express');
const rateLimit = require('express-rate-limit');

// Import route modules that use the rate limiter internally
const healthRoutes = require('../routes/health');
const verificationRoutes = require('../routes/verification');

describe('Rate limit headers - integration', () => {
    let app;

    beforeEach(() => {
        app = express();
        app.use(express.json());

        // Also apply a global rate limiter (matches server.js) so headers are present
        app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 150, standardHeaders: true, legacyHeaders: true }));

        app.use('/health', healthRoutes);
        app.use('/api/verification', verificationRoutes);
    });

    it('returns X-RateLimit headers for health endpoint', async () => {
        const res = await request(app).get('/health');

        expect(res.status).toBe(200);
        expect(res.headers).toHaveProperty('x-ratelimit-limit');
        expect(res.headers).toHaveProperty('x-ratelimit-remaining');
        expect(res.headers).toHaveProperty('x-ratelimit-reset');
    });

    it('returns X-RateLimit headers for verification POST endpoint', async () => {
        const res = await request(app)
            .post('/api/verification/email')
            .send({ email: 'test@example.com', publicKey: 'GTESTPUBLICKEY' });

        expect(res.status).toBe(200);
        expect(res.headers).toHaveProperty('x-ratelimit-limit');
        expect(res.headers).toHaveProperty('x-ratelimit-remaining');
        expect(res.headers).toHaveProperty('x-ratelimit-reset');
    });
});
