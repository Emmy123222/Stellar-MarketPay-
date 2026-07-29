/*
 * __tests__/wsEventQueue.test.js
 * Tests for the WebSocket event queue pagination and 7‑day retention cleanup.
 */

jest.mock('../src/db/pool', () => {
  const { createPgMock } = require('../src/testUtils/pgMock');
  return createPgMock();
});

const wsQueue = require('../src/utils/wsEventQueue');
const pool = require('../src/db/pool');

// Helper to clear the table before each test suite
async function clearQueue() {
  await pool.query('DELETE FROM ws_event_queue');
}

describe('wsEventQueue pagination', () => {
  beforeAll(async () => {
    await clearQueue();
  });

  afterAll(async () => {
    await clearQueue();
    await pool.end();
  });

  test('enqueue and retrieve events in pages of 50', async () => {
    // Enqueue 120 events with identifiable payloads
    const total = 120;
    for (let i = 0; i < total; i++) {
      await wsQueue.enqueueEvent({ index: i, type: 'test' });
    }

    // First page (after id 0)
    const firstPage = await wsQueue.getEventsAfter(0, 50);
    expect(firstPage).toHaveLength(50);
    expect(firstPage[0].event.index).toBe(0);
    expect(firstPage[49].event.index).toBe(49);

    const lastIdFirst = firstPage[49].id;
    // Second page
    const secondPage = await wsQueue.getEventsAfter(lastIdFirst, 50);
    expect(secondPage).toHaveLength(50);
    expect(secondPage[0].event.index).toBe(50);
    expect(secondPage[49].event.index).toBe(99);

    const lastIdSecond = secondPage[49].id;
    // Third (partial) page – should contain remaining 20 events
    const thirdPage = await wsQueue.getEventsAfter(lastIdSecond, 50);
    expect(thirdPage).toHaveLength(20);
    expect(thirdPage[0].event.index).toBe(100);
    expect(thirdPage[19].event.index).toBe(119);
  });
});

describe('wsEventQueue cleanup of old events', () => {
  beforeAll(async () => {
    await clearQueue();
    // Insert a fresh event
    await wsQueue.enqueueEvent({ type: 'fresh' });
    // Insert an old event by manually setting created_at 8 days ago
    const { rows } = await pool.query(
      `INSERT INTO ws_event_queue (event, created_at) VALUES ($1::jsonb, NOW() - INTERVAL '8 days') RETURNING id`,
      [JSON.stringify({ type: 'old' })]
    );
    // Save old id for verification (optional)
    global.__oldEventId = rows[0].id;
  });

  afterAll(async () => {
    await clearQueue();
    await pool.end();
  });

  test('cleanupOldEvents removes events older than 7 days', async () => {
    // Verify both events exist before cleanup
    const before = await pool.query('SELECT COUNT(*) FROM ws_event_queue');
    expect(parseInt(before.rows[0].count, 10)).toBe(2);

    // Run cleanup
    await wsQueue.cleanupOldEvents();

    // Verify only the fresh event remains
    const after = await pool.query('SELECT COUNT(*) FROM ws_event_queue');
    expect(parseInt(after.rows[0].count, 10)).toBe(1);

    const remaining = await pool.query('SELECT event FROM ws_event_queue');
    expect(remaining.rows[0].event.type).toBe('fresh');
  });
});
