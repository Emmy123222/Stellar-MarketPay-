import request from 'supertest';
import jwt from 'jsonwebtoken';
import { AppDataSource, initDataSource } from '../src/db/dataSource';
import { Booking } from '../src/db/entities/Booking';
import { Flight } from '../src/db/entities/Flight';
import { Passenger } from '../src/db/entities/Passenger';
import { config } from '../src/config';

const validToken = jwt.sign(
  { walletAddress: 'GAUSER', walletType: 'freighter' },
  config.jwtSecret,
  { expiresIn: '1h' }
);

const otherToken = jwt.sign(
  { walletAddress: 'GAOTHER', walletType: 'freighter' },
  config.jwtSecret,
  { expiresIn: '1h' }
);

jest.mock('../src/services/stripe', () => ({
  stripe: {
    paymentIntents: { create: jest.fn() },
    webhooks: { constructEvent: jest.fn() },
  },
  stripeWebhookSecret: 'whsec_test',
}));

jest.mock('../src/services/soroban', () => ({
  buildCreateBookingUnsignedXdr: jest.fn(),
  submitSignedSorobanXdr: jest.fn(),
  getTransactionStatus: jest.fn(),
}));

describe('Messages API (Issue #810)', () => {
  let app: any;
  let bookingId: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    await initDataSource();

    const { createApp } = await import('../src/app');
    app = await createApp({ globalRateLimit: false, tieredRateLimit: false, searchRateLimit: false });

    const flightRepo = AppDataSource.getRepository(Flight);
    const flight = await flightRepo.save(
      flightRepo.create({
        flightNumber: 'MSG001',
        fromAirport: 'JFK',
        toAirport: 'LAX',
        departureTime: new Date(Date.now() + 86400000),
        seatsAvailable: 5,
        priceCents: 20000,
        airlineSorobanAddress: 'GAIRLINE',
      })
    );

    const passengerRepo = AppDataSource.getRepository(Passenger);
    const passenger = await passengerRepo.save(
      passengerRepo.create({
        email: 'test@example.com',
        firstName: 'Test',
        lastName: 'User',
        sorobanAddress: 'GAPASSENGER',
      })
    );

    const bookingRepo = AppDataSource.getRepository(Booking);
    const booking = await bookingRepo.save(
      bookingRepo.create({
        flight,
        passenger,
        walletAddress: 'GAUSER',
        status: 'confirmed',
        amountCents: 20000,
      })
    );
    bookingId = booking.id;
  });

  afterAll(async () => {
    if (AppDataSource.isInitialized) await AppDataSource.destroy();
  });

  it('rejects fetching messages without auth', async () => {
    const res = await request(app)
      .get(`/api/v1/jobs/${bookingId}/messages`)
      .expect(401);
    expect(res.body.success).toBe(false);
  });

  it('returns empty messages list for a job', async () => {
    const res = await request(app)
      .get(`/api/v1/jobs/${bookingId}/messages`)
      .set('Authorization', `Bearer ${validToken}`)
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([]);
  });

  it('rejects sending message without auth', async () => {
    const res = await request(app)
      .post(`/api/v1/jobs/${bookingId}/messages`)
      .send({ content: 'Hello' })
      .expect(401);
    expect(res.body.success).toBe(false);
  });

  it('sends a message successfully', async () => {
    const res = await request(app)
      .post(`/api/v1/jobs/${bookingId}/messages`)
      .set('Authorization', `Bearer ${validToken}`)
      .send({ content: 'Hello, this is a test message' })
      .expect(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.content).toBe('Hello, this is a test message');
    expect(res.body.data.senderAddress).toBe('GAUSER');
    expect(res.body.data.jobId).toBe(bookingId);
  });

  it('retrieves sent messages', async () => {
    const res = await request(app)
      .get(`/api/v1/jobs/${bookingId}/messages`)
      .set('Authorization', `Bearer ${validToken}`)
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0].content).toBe('Hello, this is a test message');
  });

  it('rejects non-participants from sending messages', async () => {
    const res = await request(app)
      .post(`/api/v1/jobs/${bookingId}/messages`)
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ content: 'Unauthorized message' })
      .expect(403);
    expect(res.body.success).toBe(false);
  });

  it('rejects empty message content', async () => {
    const res = await request(app)
      .post(`/api/v1/jobs/${bookingId}/messages`)
      .set('Authorization', `Bearer ${validToken}`)
      .send({ content: '' })
      .expect(400);
    expect(res.body.success).toBe(false);
  });

  it('paginates messages', async () => {
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post(`/api/v1/jobs/${bookingId}/messages`)
        .set('Authorization', `Bearer ${validToken}`)
        .send({ content: `Message ${i + 1}` })
        .expect(201);
    }

    const res = await request(app)
      .get(`/api/v1/jobs/${bookingId}/messages?limit=3`)
      .set('Authorization', `Bearer ${validToken}`)
      .expect(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBeLessThanOrEqual(3);
    expect(res.body.pagination).toBeDefined();
    expect(res.body.pagination.hasMore).toBe(true);
  });
});
