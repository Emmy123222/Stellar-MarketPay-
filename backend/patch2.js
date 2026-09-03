const fs = require('fs');
let code = fs.readFileSync('src/services/jobService.js', 'utf8');

const appendCode = `
const _pool = require("../db/pool");

const TIMELINE_EVENT_TYPES = ["job_posted", "bid_accepted", "escrow_funded", "work_completed", "escrow_released"];

async function recordTimelineEvent(jobId, eventType, txHash = null) {
  if (!TIMELINE_EVENT_TYPES.includes(eventType)) {
    throw new Error(\`Invalid timeline event type: \${eventType}\`);
  }

  const { rows: existing } = await _pool.query(
    "SELECT * FROM job_timeline WHERE job_id = $1 AND event_type = $2",
    [jobId, eventType]
  );
  if (existing.length > 0) {
    return existing[0];
  }

  const { rows } = await _pool.query(
    "INSERT INTO job_timeline (job_id, event_type, tx_hash, created_at) VALUES ($1, $2, $3, NOW()) RETURNING *",
    [jobId, eventType, txHash]
  );
  return rows[0];
}

async function getJobTimeline(jobId) {
  const { rows } = await _pool.query(
    "SELECT * FROM job_timeline WHERE job_id = $1 ORDER BY created_at ASC",
    [jobId]
  );
  return rows.map(r => ({
    id: r.id,
    jobId: r.job_id,
    eventType: r.event_type,
    txHash: r.tx_hash,
    createdAt: r.created_at
  }));
}

Object.assign(module.exports, { TIMELINE_EVENT_TYPES, recordTimelineEvent, getJobTimeline });
`;

fs.writeFileSync('src/services/jobService.js', code + appendCode);
