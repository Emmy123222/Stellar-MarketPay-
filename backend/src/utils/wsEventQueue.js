// src/utils/wsEventQueue.js
"use strict";

const pool = require("../db/pool");

/** Insert a new event into the WS event queue */
async function enqueueEvent(event) {
  const { rows } = await pool.query(
    `INSERT INTO ws_event_queue (event) VALUES ($1::jsonb) RETURNING id, event, created_at`,
    [JSON.stringify(event)]
  );
  return rows[0];
}

/** Retrieve events after a given ID, limited to pageSize */
async function getEventsAfter(lastId, limit = 50) {
  const { rows } = await pool.query(
    `SELECT id, event FROM ws_event_queue WHERE id > $1 ORDER BY id ASC LIMIT $2`,
    [lastId, limit]
  );
  return rows;
}

/** Delete events older than 7 days */
async function cleanupOldEvents() {
  await pool.query(
    "DELETE FROM ws_event_queue WHERE created_at < NOW() - INTERVAL '7 days'"
  );
}

module.exports = {
  enqueueEvent,
  getEventsAfter,
  cleanupOldEvents,
};
