"use strict";

const pool = require("../db/pool");
const sorobanArbitratorRegistry = require("./sorobanArbitratorRegistry");

const VALID_TYPES = ["treasury", "platform", "parameter", "arbitration"];
const VALID_STATUSES = ["active", "passed", "rejected", "executed"];
const QUORUM_PERCENT = 10;

function validatePublicKey(key) {
  if (!key || !/^G[A-Z0-9]{55}$/.test(key)) {
    const err = new Error("Invalid Stellar public key");
    err.statusCode = 400;
    throw err;
  }
}

function rowToProposal(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    type: row.type,
    proposer: row.proposer,
    amount: row.amount != null ? String(row.amount) : undefined,
    recipient: row.recipient || undefined,
    status: row.status,
    votesFor: Number(row.votes_for || 0),
    votesAgainst: Number(row.votes_against || 0),
    votingEndsAt: row.voting_ends_at,
    createdAt: row.created_at,
    executedAt: row.executed_at || undefined,
    quorumPercent: QUORUM_PERCENT,
    quorumReached: Boolean(row.quorum_reached),
  };
}

async function listProposals({ status } = {}) {
  const conditions = [];
  const params = [];
  if (status) {
    params.push(status);
    conditions.push(`p.status = $${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const { rows } = await pool.query(
    `SELECT p.*,
       COALESCE(SUM(v.weight) FILTER (WHERE v.support = true), 0) AS votes_for,
       COALESCE(SUM(v.weight) FILTER (WHERE v.support = false), 0) AS votes_against,
       (COALESCE(SUM(v.weight), 0) >= 100) AS quorum_reached
     FROM dao_proposals p
     LEFT JOIN dao_votes v ON v.proposal_id = p.id
     ${where}
     GROUP BY p.id
     ORDER BY p.created_at DESC`,
    params,
  );
  return rows.map(rowToProposal);
}

async function getProposal(id) {
  const { rows } = await pool.query(
    `SELECT p.*,
       COALESCE(SUM(v.weight) FILTER (WHERE v.support = true), 0) AS votes_for,
       COALESCE(SUM(v.weight) FILTER (WHERE v.support = false), 0) AS votes_against,
       (COALESCE(SUM(v.weight), 0) >= 100) AS quorum_reached
     FROM dao_proposals p
     LEFT JOIN dao_votes v ON v.proposal_id = p.id
     WHERE p.id = $1
     GROUP BY p.id`,
    [id],
  );
  if (!rows.length) {
    const err = new Error("Proposal not found");
    err.statusCode = 404;
    throw err;
  }
  return rowToProposal(rows[0]);
}

async function createProposal({
  title,
  description,
  type,
  proposer,
  amount,
  recipient,
  votingDays = 7,
}) {
  validatePublicKey(proposer);
  if (!title?.trim() || !description?.trim()) {
    const err = new Error("Title and description are required");
    err.statusCode = 400;
    throw err;
  }
  if (!VALID_TYPES.includes(type)) {
    const err = new Error(`Type must be one of: ${VALID_TYPES.join(", ")}`);
    err.statusCode = 400;
    throw err;
  }

  const days = Math.min(Math.max(parseInt(votingDays, 10) || 7, 1), 30);
  const { rows } = await pool.query(
    `INSERT INTO dao_proposals
       (title, description, type, proposer, amount, recipient, voting_ends_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW() + ($7 || ' days')::interval)
     RETURNING *`,
    [
      title.trim(),
      description.trim(),
      type,
      proposer,
      amount != null ? amount : null,
      recipient || null,
      String(days),
    ],
  );
  return getProposal(rows[0].id);
}

async function castVote({ proposalId, voter, support, weight, txHash }) {
  validatePublicKey(voter);
  const proposal = await getProposal(proposalId);
  if (proposal.status !== "active") {
    const err = new Error("Voting is closed for this proposal");
    err.statusCode = 400;
    throw err;
  }
  if (new Date(proposal.votingEndsAt) < new Date()) {
    const err = new Error("Voting period has ended");
    err.statusCode = 400;
    throw err;
  }

  const voteWeight = Math.max(parseFloat(weight) || 1, 0.0000001);

  await pool.query(
    `INSERT INTO dao_votes (proposal_id, voter, support, weight, tx_hash)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (proposal_id, voter)
     DO UPDATE SET support = EXCLUDED.support, weight = EXCLUDED.weight, tx_hash = EXCLUDED.tx_hash`,
    [proposalId, voter, Boolean(support), voteWeight, txHash || null],
  );

  return getProposal(proposalId);
}

async function finalizeExpiredProposals() {
  const { rows } = await pool.query(
    `UPDATE dao_proposals
     SET status = CASE
       WHEN (SELECT COALESCE(SUM(weight) FILTER (WHERE support = true), 0)
             FROM dao_votes WHERE proposal_id = dao_proposals.id)
            >
            (SELECT COALESCE(SUM(weight) FILTER (WHERE support = false), 0)
             FROM dao_votes WHERE proposal_id = dao_proposals.id)
       THEN 'passed' ELSE 'rejected' END
     WHERE status = 'active' AND voting_ends_at < NOW()
     RETURNING id, status, type`,
  );

  for (const proposal of rows) {
    if (
      proposal.status === "passed" &&
      proposal.type === "arbitration"
    ) {
      // TODO: Submit on-chain transaction via admin key to call
      // dao_register_arbitrator or dao_remove_arbitrator on
      // the arbitrator-registry contract.
      // This requires a backend admin Stellar keypair and gas budget.
      console.log(
        `Arbitration proposal ${proposal.id} passed — on-chain execution pending`,
      );
    }
  }
}

async function executeProposal(id) {
  const proposal = await getProposal(id);
  if (proposal.status !== "passed") {
    const err = new Error("Only passed proposals can be executed");
    err.statusCode = 400;
    throw err;
  }

  if (proposal.type === "arbitration") {
    // TODO: Submit on-chain transaction to call dao_register_arbitrator
    // or dao_remove_arbitrator on the arbitrator-registry contract.
    console.log(
      `Arbitration proposal ${id} execution triggered — on-chain tx pending`,
    );
  }

  await pool.query(
    "UPDATE dao_proposals SET status = 'executed', executed_at = NOW() WHERE id = $1",
    [id],
  );

  return getProposal(id);
}

async function listArbitrators() {
  return sorobanArbitratorRegistry.listArbitrators();
}

async function upsertArbitrator({ publicKey, displayName, bio }) {
  validatePublicKey(publicKey);
  const { rows } = await pool.query(
    `INSERT INTO dao_arbitrators (public_key, display_name, bio)
     VALUES ($1, $2, $3)
     ON CONFLICT (public_key)
     DO UPDATE SET display_name = COALESCE(EXCLUDED.display_name, dao_arbitrators.display_name),
                   bio = COALESCE(EXCLUDED.bio, dao_arbitrators.bio)
     RETURNING *`,
    [publicKey, displayName || null, bio || null],
  );
  const r = rows[0];
  return {
    publicKey: r.public_key,
    displayName: r.display_name,
    bio: r.bio,
    votesReceived: r.votes_received,
    disputesResolved: r.disputes_resolved,
    electedAt: r.elected_at,
  };
}

async function voteForArbitrator({ voter, arbitratorKey, weight }) {
  validatePublicKey(voter);
  validatePublicKey(arbitratorKey);
  const voteWeight = Math.max(parseInt(weight, 10) || 1, 1);
  await upsertArbitrator({ publicKey: arbitratorKey });
  await pool.query(
    `UPDATE dao_arbitrators SET votes_received = votes_received + $2 WHERE public_key = $1`,
    [arbitratorKey, voteWeight],
  );
  return listArbitrators();
}

async function getTopArbitratorPanel(limit = 3) {
  const arbitrators = await listArbitrators();
  return arbitrators.slice(0, limit);
}

async function getTreasurySummary() {
  const { rows } = await pool.query(
    `SELECT
       COALESCE(SUM(amount) FILTER (WHERE status IN ('passed', 'executed') AND type = 'treasury'), 0) AS allocated,
       COUNT(*) FILTER (WHERE status = 'active')::int AS active_proposals
     FROM dao_proposals`,
  );
  return {
    allocatedXlm: String(rows[0]?.allocated || 0),
    activeProposals: rows[0]?.active_proposals || 0,
    quorumPercent: QUORUM_PERCENT,
  };
}

module.exports = {
  listProposals,
  getProposal,
  createProposal,
  castVote,
  finalizeExpiredProposals,
  executeProposal,
  listArbitrators,
  upsertArbitrator,
  voteForArbitrator,
  getTopArbitratorPanel,
  getTreasurySummary,
  VALID_TYPES,
  VALID_STATUSES,
};
