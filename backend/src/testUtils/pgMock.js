/* global jest */
"use strict";

function defaultJobRow(overrides = {}) {
  return {
    id: overrides.id || `job-${Date.now()}`,
    title: overrides.title || "Build a decentralized app",
    description:
      overrides.description ||
      "Looking for a full-stack developer to build a dApp on Stellar.",
    budget: overrides.budget || "500.0000000",
    currency: overrides.currency || "XLM",
    category: overrides.category || "Smart Contracts",
    category_id: overrides.category_id ?? null,
    skills: overrides.skills || [],
    status: overrides.status || "open",
    client_address: overrides.client_address,
    freelancer_address: overrides.freelancer_address || null,
    escrow_contract_id: overrides.escrow_contract_id || null,
    applicant_count: overrides.applicant_count ?? 0,
    share_count: overrides.share_count ?? 0,
    boosted: overrides.boosted ?? false,
    boosted_until: overrides.boosted_until || null,
    deadline: overrides.deadline || null,
    timezone: overrides.timezone || null,
    screening_questions: overrides.screening_questions || [],
    milestones: overrides.milestones || [],
    visibility: overrides.visibility || "public",
    dispute_reason: overrides.dispute_reason || null,
    dispute_description: overrides.dispute_description || null,
    disputed_by: overrides.disputed_by || null,
    disputed_at: overrides.disputed_at || null,
    expires_at: overrides.expires_at || null,
    extended_count: overrides.extended_count ?? null,
    extended_until: overrides.extended_until || null,
    bidding_closed_at: overrides.bidding_closed_at || null,
    view_count: overrides.view_count ?? 0,
    created_at: overrides.created_at || new Date().toISOString(),
    updated_at: overrides.updated_at || new Date().toISOString(),
    deleted_at: overrides.deleted_at || null,
  };
}

function defaultApplicationRow(overrides = {}) {
  return {
    id: overrides.id || `app-${Date.now()}`,
    job_id: overrides.job_id,
    freelancer_address: overrides.freelancer_address,
    proposal: overrides.proposal,
    bid_amount: overrides.bid_amount || "450.0000000",
    currency: overrides.currency || "XLM",
    status: overrides.status || "pending",
    screening_answers: overrides.screening_answers || {},
    bid_commitment: overrides.bid_commitment || null,
    bid_revealed: overrides.bid_revealed || false,
    revealed_bid_amount: overrides.revealed_bid_amount || null,
    created_at: overrides.created_at || new Date().toISOString(),
    accepted_at: overrides.accepted_at || null,
    withdrawn_at: overrides.withdrawn_at || null,
    completed_jobs: overrides.completed_jobs ?? 0,
    total_jobs: overrides.total_jobs ?? 0,
    total_earned_xlm: overrides.total_earned_xlm ?? 0,
    avg_rating: overrides.avg_rating ?? null,
    profile_created_at: overrides.profile_created_at || null,
  };
}

function defaultDaoProposalRow(overrides = {}) {
  return {
    id: overrides.id || `prop-${Date.now()}`,
    title: overrides.title || "Default Governance Proposal",
    description: overrides.description || "Proposal description for governance testing.",
    type: overrides.type || "treasury",
    proposer: overrides.proposer || "G" + "A".repeat(55),
    amount: overrides.amount != null ? String(overrides.amount) : "100.0000000",
    recipient: overrides.recipient || "G" + "B".repeat(55),
    status: overrides.status || "active",
    voting_ends_at: overrides.voting_ends_at || new Date(Date.now() + 7 * 86400000).toISOString(),
    created_at: overrides.created_at || new Date().toISOString(),
    executed_at: overrides.executed_at || null,
  };
}

function defaultDaoArbitratorRow(overrides = {}) {
  return {
    public_key: overrides.public_key || "G" + "C".repeat(55),
    display_name: overrides.display_name || "Test Arbitrator",
    bio: overrides.bio || "Experienced dispute arbitrator",
    votes_received: overrides.votes_received ?? 0,
    disputes_resolved: overrides.disputes_resolved ?? 0,
    elected_at: overrides.elected_at || null,
    active: overrides.active ?? true,
    created_at: overrides.created_at || new Date().toISOString(),
  };
}

function defaultApiKeyRow(overrides = {}) {
  return {
    id: overrides.id || `key-${Date.now()}`,
    owner_public_key: overrides.owner_public_key || "G" + "A".repeat(55),
    label: overrides.label || "Developer key",
    key_prefix: overrides.key_prefix || "sk_live_test",
    key_hash: overrides.key_hash || "hash123",
    previous_key_hash: overrides.previous_key_hash || null,
    created_at: overrides.created_at || new Date().toISOString(),
    last_used_at: overrides.last_used_at || null,
    revoked_at: overrides.revoked_at || null,
    rotating_at: overrides.rotating_at || null,
    rotating_key_hash: overrides.rotating_key_hash || null,
  };
}

function defaultEscrowRow(overrides = {}) {
  return {
    id: overrides.id || `escrow-${Date.now()}`,
    job_id: overrides.job_id || "job-1",
    client_address: overrides.client_address || "G" + "A".repeat(55),
    freelancer_address: overrides.freelancer_address || "G" + "B".repeat(55),
    amount_xlm: overrides.amount_xlm != null ? String(overrides.amount_xlm) : "100.0000000",
    status: overrides.status || "funded",
    created_at: overrides.created_at || new Date().toISOString(),
    updated_at: overrides.updated_at || new Date().toISOString(),
  };
}

function defaultEscrowExtensionRow(overrides = {}) {
  return {
    id: overrides.id || 1,
    job_id: overrides.job_id || "job-1",
    requested_by: overrides.requested_by || "G" + "A".repeat(55),
    new_timeout_ledger: overrides.new_timeout_ledger || 1000,
    status: overrides.status || "pending",
    approved_by: overrides.approved_by || null,
    approved_at: overrides.approved_at || null,
    created_at: overrides.created_at || new Date().toISOString(),
    updated_at: overrides.updated_at || new Date().toISOString(),
  };
}

function defaultOnboardingRow(overrides = {}) {
  return {
    public_key: overrides.public_key || "G" + "A".repeat(55),
    current_step: overrides.current_step ?? 0,
    completed_steps: overrides.completed_steps || [],
    dismissed: overrides.dismissed ?? false,
    completed: overrides.completed ?? false,
    updated_at: overrides.updated_at || new Date().toISOString(),
  };
}

// Helper: find the last occurrence of a numeric param placeholder like $1, $2, etc.
// and extract the first non-null param index to use as the id for lookups.
function findJobIdFromUpdate(text, params) {
  // Look for WHERE id = $N pattern and get the corresponding param
  const match = text.match(/WHERE\s+id\s*=\s*\$\d+/i);
  if (match) {
    const placeholder = match[0].match(/\$(\d+)/);
    if (placeholder) {
      const idx = parseInt(placeholder[1], 10) - 1;
      return params[idx];
    }
  }
  return null;
}

const DEFAULT_CATEGORIES = [
  { id: 1, name: "Smart Contracts", slug: "smart-contracts" },
  { id: 2, name: "Frontend Development", slug: "frontend-development" },
  { id: 3, name: "Backend Development", slug: "backend-development" },
  { id: 4, name: "UI/UX Design", slug: "ui-ux-design" },
  { id: 5, name: "Technical Writing", slug: "technical-writing" },
  { id: 6, name: "DevOps", slug: "devops" },
  { id: 7, name: "Security Audit", slug: "security-audit" },
  { id: 8, name: "Data Analysis", slug: "data-analysis" },
  { id: 9, name: "Mobile Development", slug: "mobile-development" },
  { id: 10, name: "Other", slug: "other" },
];

function createPgMock() {
  const jobs = new Map();
  const applications = new Map();
  const invitations = new Set();
  const skillsMap = new Map();
  const jobSkillsMap = new Map();
  const wsEvents = new Map();
  const daoProposals = new Map();
  const daoVotes = new Map();
  const daoArbitrators = new Map();
  const apiKeys = new Map();
  const escrows = new Map();
  const escrowExtensions = new Map();
  const onboardingProgress = new Map();
  const timelineEvents = [];

  function formatJobRow(row) {
    const skillIds = jobSkillsMap.get(row.id) || new Set();
    const skills = skillIds.size
      ? [...skillsMap.values()]
          .filter((s) => skillIds.has(s.id))
          .map((s) => s.display_name)
      : row.skills || [];
    const cat = DEFAULT_CATEGORIES.find(
      (c) => c.name === row.category || c.id === row.category_id,
    );
    return {
      ...row,
      skills,
      category_slug: row.category_slug || cat?.slug || null,
      category_name: row.category || cat?.name || null,
      category_id_resolved: row.category_id || cat?.id || 1,
    };
  }

  const query = jest.fn(async (sql, params = []) => {
    const text = sql.replace(/\s+/g, " ").trim();

    // ─── WebSocket Event Queue ───────────────────────────────────────────
    if (text.startsWith("INSERT INTO ws_event_queue")) {
      const id = wsEvents.size + 1;
      let createdAt = new Date().toISOString();
      if (text.includes("INTERVAL '8 days'")) {
        createdAt = new Date(
          Date.now() - 8 * 24 * 60 * 60 * 1000,
        ).toISOString();
      }
      const eventJson =
        typeof params[0] === "string" ? JSON.parse(params[0]) : params[0];
      const row = { id, event: eventJson, created_at: createdAt };
      wsEvents.set(id, row);
      return { rows: [row] };
    }

    if (text.startsWith("SELECT id, event FROM ws_event_queue")) {
      const lastId = params[0] || 0;
      const limit = params[1] || 50;
      const rows = [...wsEvents.values()]
        .filter((r) => r.id > lastId)
        .sort((a, b) => a.id - b.id)
        .slice(0, limit);
      return { rows };
    }

    if (text === "SELECT COUNT(*) FROM ws_event_queue") {
      return { rows: [{ count: wsEvents.size }] };
    }

    if (text === "SELECT event FROM ws_event_queue") {
      return { rows: [...wsEvents.values()] };
    }

    if (text.startsWith("DELETE FROM ws_event_queue")) {
      if (text.includes("created_at < NOW() - INTERVAL '7 days'")) {
        const threshold = Date.now() - 7 * 24 * 60 * 60 * 1000;
        for (const [id, r] of wsEvents.entries()) {
          if (new Date(r.created_at).getTime() < threshold) {
            wsEvents.delete(id);
          }
        }
      } else {
        wsEvents.clear();
      }
      return { rows: [], rowCount: 0 };
    }

    // ─── Categories ──────────────────────────────────────────────────────
    if (
      text.includes(
        "FROM categories WHERE slug = $1 OR LOWER(name) = LOWER($2)",
      )
    ) {
      const val = (params[0] || "").toLowerCase().trim();
      const cat = DEFAULT_CATEGORIES.find(
        (c) => c.slug === val || c.name.toLowerCase() === val,
      );
      return { rows: cat ? [cat] : [] };
    }

    if (text.includes("FROM categories") && !text.includes("FROM jobs")) {
      return { rows: DEFAULT_CATEGORIES };
    }

    // ─── Skills ──────────────────────────────────────────────────────────
    if (text.startsWith("INSERT INTO skills")) {
      const matches = text.match(/\$\$(.*?)\$\$/g);
      if (matches) {
        matches.forEach((m) => {
          const name = m.replace(/\$\$/g, "");
          const slug = name.toLowerCase().trim();
          if (!skillsMap.has(slug)) {
            skillsMap.set(slug, { id: skillsMap.size + 1, display_name: name });
          }
        });
      }
      return { rows: [] };
    }

    if (text.startsWith("SELECT id FROM skills WHERE slug = ANY")) {
      const slugs = params[0] || [];
      const rows = slugs
        .map((s) => {
          const found = skillsMap.get(s);
          return found ? { id: found.id } : null;
        })
        .filter(Boolean);
      return { rows };
    }

    if (text.startsWith("INSERT INTO job_skills")) {
      const matches = text.match(/\('([^']+)',\s*(\d+)\)/g);
      if (matches) {
        matches.forEach((m) => {
          const parts = m.match(/\('([^']+)',\s*(\d+)\)/);
          if (parts) {
            const jobId = parts[1];
            const skillId = parseInt(parts[2], 10);
            if (!jobSkillsMap.has(jobId)) {
              jobSkillsMap.set(jobId, new Set());
            }
            jobSkillsMap.get(jobId).add(skillId);
          }
        });
      }
      return { rows: [] };
    }

    if (
      text.startsWith("SELECT s.display_name FROM skills s JOIN job_skills js")
    ) {
      const jobId = params[0];
      const skillIds = jobSkillsMap.get(jobId) || new Set();
      const rows = [...skillsMap.values()]
        .filter((s) => skillIds.has(s.id))
        .map((s) => ({ display_name: s.display_name }));
      return { rows };
    }

    // ─── Job Timeline ────────────────────────────────────────────────────
    if (
      text.includes("FROM job_timeline WHERE job_id = $1 AND event_type = $2")
    ) {
      const found = timelineEvents.find(
        (e) => e.job_id === params[0] && e.event_type === params[1],
      );
      return { rows: found ? [found] : [] };
    }

    if (text.startsWith("INSERT INTO job_timeline")) {
      const evt = {
        id: `evt-${timelineEvents.length + 1}`,
        job_id: params[0],
        event_type: params[1],
        tx_hash: params[2] || null,
        created_at: new Date().toISOString(),
      };
      timelineEvents.push(evt);
      return { rows: [evt] };
    }

    if (text.includes("FROM job_timeline WHERE job_id = $1")) {
      const rows = timelineEvents.filter((e) => e.job_id === params[0]);
      return { rows };
    }

    // ─── INSERT INTO jobs ────────────────────────────────────────────────
    if (text.startsWith("INSERT INTO jobs")) {
      const row = defaultJobRow({
        id: `job-${jobs.size + 1}`,
        title: params[0],
        description: params[1],
        budget: params[2],
        currency: params[3],
        category: params[4],
        category_id: params[5],
        status: "open",
        client_address: params[6],
        deadline: params[7],
        timezone: params[8],
        screening_questions: params[9],
        milestones:
          typeof params[10] === "string" ? JSON.parse(params[10]) : params[10],
        visibility: params[11] || "public",
      });
      jobs.set(row.id, row);
      return { rows: [formatJobRow(row)] };
    }

    // ─── Single Job SELECT (by ID) ───────────────────────────────────────
    if (
      !text.includes("FROM applications") &&
      text.includes("FROM jobs") &&
      (text.includes("WHERE id = $1") ||
        text.includes("WHERE jobs.id = $1") ||
        text.includes("WHERE j.id = $1"))
    ) {
      const row = jobs.get(params[0]);
      if (!row) return { rows: [] };
      if (text.includes("deleted_at IS NULL") && row.deleted_at)
        return { rows: [] };
      return { rows: [formatJobRow(row)] };
    }

    // ─── Jobs by client SELECT ───────────────────────────────────────────
    if (text.includes("FROM jobs") && text.includes("client_address = $1")) {
      let rows = [...jobs.values()].filter(
        (job) => job.client_address === params[0],
      );
      if (text.includes("deleted_at IS NULL")) {
        rows = rows.filter((job) => !job.deleted_at);
      }
      return { rows: rows.map(formatJobRow) };
    }

    // ─── INSERT INTO escrows / UPDATE escrows ─────────────────────────────
    if (text.startsWith("INSERT INTO escrows")) {
      const row = defaultEscrowRow({
        id: `escrow-${escrows.size + 1}`,
        job_id: params[0],
        client_address: params[1],
        freelancer_address: params[2],
        amount_xlm: params[3],
      });
      escrows.set(row.id, row);
      return { rows: [row], rowCount: 1 };
    }

    if (text.startsWith("UPDATE escrows")) {
      return { rows: [], rowCount: 1 };
    }

    if (text.includes("FROM escrows") && text.includes("job_id = $1")) {
      const escrow =
        [...escrows.values()].find((e) => e.job_id === params[0]) ||
        escrows.get(params[0]);
      return { rows: escrow ? [escrow] : [] };
    }

    // ─── Escrow Extensions Queries ─────────────────────────────────────────
    if (text.startsWith("INSERT INTO escrow_extensions")) {
      const id = escrowExtensions.size + 1;
      const row = defaultEscrowExtensionRow({
        id,
        job_id: params[0],
        requested_by: params[1],
        new_timeout_ledger: params[2],
        status: "pending",
      });
      escrowExtensions.set(id, row);
      return { rows: [row], rowCount: 1 };
    }

    if (text.includes("FROM escrow_extensions")) {
      let list = [...escrowExtensions.values()];
      if (text.includes("job_id = $1")) {
        list = list.filter((e) => e.job_id === params[0]);
      }
      if (text.includes("status = 'pending'")) {
        list = list.filter((e) => e.status === "pending");
      }
      return { rows: list };
    }

    if (text.startsWith("UPDATE escrow_extensions")) {
      const ext = escrowExtensions.get(params[0]) || [...escrowExtensions.values()].find((e) => e.id === params[0]);
      if (ext) {
        ext.status = "approved";
        ext.approved_by = params[1];
        ext.approved_at = new Date().toISOString();
        ext.updated_at = new Date().toISOString();
        return { rows: [ext], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    // ─── Specific UPDATE jobs ────────────────────────────────────────────

    // UPDATE jobs SET applicant_count
    if (text.includes("UPDATE jobs") && text.includes("applicant_count")) {
      const row = jobs.get(params[0]);
      if (row) {
        row.applicant_count = (row.applicant_count || 0) + 1;
        jobs.set(row.id, row);
      }
      return { rows: [], rowCount: row ? 1 : 0 };
    }

    // UPDATE jobs SET deleted_at
    if (text.includes("UPDATE jobs") && text.includes("SET deleted_at")) {
      const row = jobs.get(params[0]);
      if (!row || row.deleted_at) return { rows: [], rowCount: 0 };
      row.deleted_at = new Date().toISOString();
      row.updated_at = new Date().toISOString();
      jobs.set(row.id, row);
      return { rows: [formatJobRow(row)], rowCount: 1 };
    }

    // UPDATE jobs SET status = 'cancelled' (bulkCancelJobs)
    if (
      text.includes("UPDATE jobs") &&
      text.includes("status = 'cancelled'") &&
      text.includes("client_address = $2")
    ) {
      const row = jobs.get(params[0]);
      if (
        !row ||
        row.deleted_at ||
        row.client_address !== params[1] ||
        row.status !== "open"
      ) {
        return { rows: [], rowCount: 0 };
      }
      row.status = "cancelled";
      row.updated_at = new Date().toISOString();
      jobs.set(row.id, row);
      return { rows: [{ id: row.id }], rowCount: 1 };
    }

    // UPDATE jobs SET status = $1 (updateJobStatus)
    if (
      text.includes("UPDATE jobs") &&
      text.includes("SET status = $1") &&
      text.includes("WHERE id = $2")
    ) {
      const row = jobs.get(params[1]);
      if (!row) return { rows: [] };
      row.status = params[0];
      row.updated_at = new Date().toISOString();
      jobs.set(row.id, row);
      return { rows: [formatJobRow(row)] };
    }

    // UPDATE jobs SET freelancer_address (assignFreelancer)
    if (
      text.includes("UPDATE jobs") &&
      text.includes("SET freelancer_address = $1")
    ) {
      const row = jobs.get(params[1]);
      if (!row) return { rows: [] };
      row.freelancer_address = params[0];
      row.status = "in_progress";
      row.updated_at = new Date().toISOString();
      jobs.set(row.id, row);
      return { rows: [formatJobRow(row)] };
    }

    // UPDATE jobs SET escrow_contract_id (updateJobEscrowId)
    if (
      text.includes("UPDATE jobs") &&
      text.includes("SET escrow_contract_id = $1")
    ) {
      const row = jobs.get(params[1]);
      if (!row) return { rows: [] };
      row.escrow_contract_id = params[0];
      row.updated_at = new Date().toISOString();
      jobs.set(row.id, row);
      return { rows: [formatJobRow(row)] };
    }

    // UPDATE jobs SET boosted (boostJob)
    if (text.includes("UPDATE jobs") && text.includes("SET boosted = true")) {
      const row = jobs.get(params[1]);
      if (!row) return { rows: [] };
      row.boosted = true;
      row.boosted_until = params[0];
      row.updated_at = new Date().toISOString();
      jobs.set(row.id, row);
      return { rows: [formatJobRow(row)] };
    }

    // UPDATE jobs SET share_count (incrementShareCount)
    if (
      text.includes("UPDATE jobs") &&
      text.includes("share_count = COALESCE(share_count, 0) + 1")
    ) {
      const row = jobs.get(params[0]);
      if (!row || row.deleted_at) return { rows: [], rowCount: 0 };
      row.share_count = (row.share_count || 0) + 1;
      row.updated_at = new Date().toISOString();
      jobs.set(row.id, row);
      return { rows: [formatJobRow(row)], rowCount: 1 };
    }

    // UPDATE jobs SET status = 'disputed' (raiseDispute)
    if (text.includes("UPDATE jobs") && text.includes("dispute_reason = $1")) {
      const row = jobs.get(params[3]);
      if (!row || row.deleted_at || row.status !== "in_progress") {
        return { rows: [] };
      }
      row.status = "disputed";
      row.dispute_reason = params[0];
      row.dispute_description = params[1];
      row.disputed_by = params[2];
      row.disputed_at = new Date().toISOString();
      row.updated_at = new Date().toISOString();
      jobs.set(row.id, row);
      return { rows: [formatJobRow(row)] };
    }

    // UPDATE jobs SET status = 'in_progress' (resolveDispute)
    if (
      text.includes("UPDATE jobs") &&
      text.includes("dispute_reason = NULL")
    ) {
      const row = jobs.get(params[0]);
      if (!row || row.deleted_at || row.status !== "disputed") {
        return { rows: [] };
      }
      row.status = "in_progress";
      row.dispute_reason = null;
      row.dispute_description = null;
      row.disputed_by = null;
      row.disputed_at = null;
      row.updated_at = new Date().toISOString();
      jobs.set(row.id, row);
      return { rows: [formatJobRow(row)] };
    }

    // UPDATE jobs SET expires_at (extendJobExpiry)
    if (
      text.includes("UPDATE jobs") &&
      text.includes("extended_count = COALESCE(extended_count, 0) + 1")
    ) {
      const row = jobs.get(params[1]);
      if (!row) return { rows: [] };
      row.expires_at = params[0];
      row.extended_until = params[0];
      row.extended_count = (row.extended_count || 0) + 1;
      row.updated_at = new Date().toISOString();
      jobs.set(row.id, row);
      return { rows: [formatJobRow(row)] };
    }

    // UPDATE jobs SET view_count (incrementViewCount)
    if (
      text.includes("UPDATE jobs") &&
      text.includes("view_count = COALESCE(view_count, 0) + 1")
    ) {
      const row = jobs.get(params[0]);
      if (!row || row.deleted_at) return { rows: [] };
      row.view_count = (row.view_count || 0) + 1;
      row.updated_at = new Date().toISOString();
      jobs.set(row.id, row);
      return { rows: [{ view_count: row.view_count }] };
    }

    // UPDATE jobs SET bidding_closed_at (closeBiddingForJob)
    if (
      text.includes("UPDATE jobs") &&
      text.includes("bidding_closed_at = NOW()")
    ) {
      const row = jobs.get(params[0]);
      if (!row) return { rows: [] };
      row.bidding_closed_at = new Date().toISOString();
      row.updated_at = new Date().toISOString();
      jobs.set(row.id, row);
      return { rows: [{ bidding_closed_at: row.bidding_closed_at }] };
    }

    // UPDATE jobs SET status = 'expired' (expireOldJobs)
    if (text.startsWith("UPDATE") && text.includes("status = 'expired'")) {
      return { rowCount: 0 };
    }

    // DELETE FROM jobs for purgeDeletedJobs
    if (text.startsWith("DELETE FROM jobs")) {
      let count = 0;
      for (const [id, j] of jobs.entries()) {
        if (j.deleted_at) {
          jobs.delete(id);
          count++;
        }
      }
      return { rowCount: count, rows: [] };
    }

    // ─── Applications Queries ────────────────────────────────────────────

    // UPDATE applications SET accepted
    if (
      text.includes("UPDATE applications") &&
      text.includes("status = 'accepted'")
    ) {
      const row = applications.get(params[0]);
      if (!row) return { rows: [] };
      row.status = "accepted";
      row.accepted_at = new Date().toISOString();
      applications.set(row.id, row);
      return { rows: [row] };
    }

    // UPDATE applications SET rejected
    if (
      text.includes("UPDATE applications") &&
      text.includes("status = 'rejected'")
    ) {
      const jobApps = [...applications.values()].filter(
        (app) =>
          app.job_id === params[0] &&
          app.id !== params[1] &&
          app.status === "pending",
      );
      jobApps.forEach((app) => {
        app.status = "rejected";
        applications.set(app.id, app);
      });
      return { rows: [] };
    }

    // UPDATE applications SET bid_revealed
    if (text.includes("UPDATE applications") && text.includes("bid_revealed")) {
      const row = applications.get(params[0]);
      if (!row) return { rows: [] };
      row.bid_revealed = true;
      row.revealed_bid_amount = params[1];
      row.revealed_at = new Date().toISOString();
      applications.set(row.id, row);
      return { rows: [row] };
    }

    // UPDATE applications SET withdrawn_at
    if (text.includes("UPDATE applications") && text.includes("withdrawn_at")) {
      const row = applications.get(params[0]);
      if (!row) return { rows: [] };
      row.withdrawn_at = new Date().toISOString();
      applications.set(row.id, row);
      return { rows: [row] };
    }

    // SELECT applications for job (findApplicationsByJob)
    if (
      text.includes("FROM applications") &&
      (text.includes("WHERE a.job_id = $1") ||
        text.includes("WHERE job_id = $1"))
    ) {
      const rows = [...applications.values()]
        .filter((app) => app.job_id === params[0])
        .map((app) => ({ ...defaultApplicationRow(app), ...app }));
      return { rows };
    }

    // SELECT applications for freelancer (getApplicationsForFreelancer)
    if (
      text.includes("FROM applications") &&
      (text.includes("WHERE a.freelancer_address = $1") ||
        text.includes("WHERE freelancer_address = $1"))
    ) {
      const rows = [...applications.values()]
        .filter((app) => app.freelancer_address === params[0])
        .map((app) => ({ ...defaultApplicationRow(app), ...app }));
      return { rows };
    }

    // SELECT * FROM applications WHERE id
    if (
      text.includes("FROM applications WHERE id = $1") ||
      text.includes("FROM applications a WHERE a.id = $1")
    ) {
      const row = applications.get(params[0]);
      return { rows: row ? [{ ...defaultApplicationRow(row), ...row }] : [] };
    }

    // SELECT 1 FROM applications WHERE job_id AND freelancer_address
    if (
      text.includes("SELECT 1 FROM applications WHERE") &&
      text.includes("job_id") &&
      text.includes("freelancer_address")
    ) {
      const exists = [...applications.values()].some(
        (app) =>
          app.job_id === params[0] && app.freelancer_address === params[1],
      );
      return { rows: exists ? [{ "?column?": 1 }] : [] };
    }

    // INSERT INTO applications
    if (text.includes("INSERT INTO applications")) {
      const duplicate = [...applications.values()].some(
        (app) =>
          app.job_id === params[0] && app.freelancer_address === params[1],
      );
      if (duplicate) {
        const err = new Error("duplicate");
        err.code = "23505";
        throw err;
      }

      const row = defaultApplicationRow({
        id: `app-${applications.size + 1}`,
        job_id: params[0],
        freelancer_address: params[1],
        proposal: params[2],
        bid_amount: params[3],
        screening_answers: params[4] || {},
        bid_commitment: params[6] || null,
      });
      applications.set(row.id, row);
      return { rows: [row] };
    }

    // ─── listJobs-style query: FROM jobs ... ORDER BY ... (paginated) ────
    if (
      !text.includes("FROM applications") &&
      text.includes("FROM jobs") &&
      text.includes("ORDER BY") &&
      !text.includes("WHERE id = $") &&
      !text.includes("WHERE client_address = $1") &&
      !text.includes("FROM job_timeline") &&
      !text.includes("COUNT(*)") &&
      !text.includes("GROUP BY")
    ) {
      let rows = [...jobs.values()].filter(
        (job) => job.visibility === "public",
      );
      if (text.includes("deleted_at IS NULL")) {
        rows = rows.filter((job) => !job.deleted_at);
      }
      if (text.includes("status = $1")) {
        rows = rows.filter((job) => job.status === params[0]);
      }
      if (
        text.includes("category = $") ||
        text.includes("c.slug = $") ||
        text.includes("jobs.category = $")
      ) {
        const catParam = params.find(
          (p) =>
            typeof p === "string" &&
            (DEFAULT_CATEGORIES.some(
              (c) =>
                c.name.toLowerCase() === p.toLowerCase() ||
                c.slug.toLowerCase() === p.toLowerCase(),
            ) ||
              [...jobs.values()].some((j) => j.category === p)),
        );
        if (catParam) {
          rows = rows.filter(
            (job) =>
              (job.category &&
                job.category.toLowerCase() === catParam.toLowerCase()) ||
              (job.category_slug &&
                job.category_slug.toLowerCase() === catParam.toLowerCase()) ||
              DEFAULT_CATEGORIES.some(
                (c) =>
                  (c.slug === catParam.toLowerCase() ||
                    c.name.toLowerCase() === catParam.toLowerCase()) &&
                  job.category &&
                  job.category.toLowerCase() === c.name.toLowerCase(),
              ),
          );
        }
      }
      const limit = params[params.length - 1] ?? 50;
      return {
        rows: rows
          .slice(0, typeof limit === "number" ? limit : 50)
          .map(formatJobRow),
      };
    }

    // Job invitations check
    if (text.includes("SELECT 1 FROM job_invitations")) {
      const key = `${params[0]}:${params[1]}`;
      return { rows: invitations.has(key) ? [{ ok: 1 }] : [] };
    }

    // INSERT INTO notifications
    if (text.startsWith("INSERT INTO notifications")) {
      const row = {
        id: Math.floor(Math.random() * 100000),
        user_address: params[0],
        type: params[1],
        title: params[2],
        body: params[3],
        read: false,
        job_id: params[4],
        link_path: params[5],
        created_at: new Date().toISOString(),
      };
      return { rows: [row] };
    }

    // INSERT INTO notification_queue
    if (text.startsWith("INSERT INTO notification_queue")) {
      return { rows: [{ id: Math.floor(Math.random() * 100000) }] };
    }

    // UPDATE notification_queue
    if (text.startsWith("UPDATE notification_queue")) {
      return { rows: [], rowCount: 1 };
    }

    // SELECT with COUNT(*) for analytics overview — return mock data
    if (
      text.includes("COUNT(*)") &&
      text.includes("FROM jobs") &&
      !text.includes("GROUP BY")
    ) {
      return {
        rows: [
          {
            total_jobs: jobs.size,
            open_jobs: [...jobs.values()].filter((j) => j.status === "open")
              .length,
            in_progress_jobs: [...jobs.values()].filter(
              (j) => j.status === "in_progress",
            ).length,
            completed_jobs: [...jobs.values()].filter(
              (j) => j.status === "completed",
            ).length,
            avg_budget_xlm: "250.00",
            total_filled: [...jobs.values()].filter((j) => j.freelancer_address)
              .length,
            avg_days_to_fill: null,
          },
        ],
      };
    }

    // SELECT with GROUP BY category for analytics
    if (text.includes("GROUP BY category") && text.includes("FROM jobs")) {
      const cats = {};
      for (const job of jobs.values()) {
        if (!cats[job.category]) {
          cats[job.category] = { count: 0, budgetSum: 0, filledCount: 0 };
        }
        cats[job.category].count++;
        cats[job.category].budgetSum += parseFloat(job.budget || 0);
        if (job.freelancer_address) cats[job.category].filledCount++;
      }
      return {
        rows: Object.entries(cats).map(([category, data]) => ({
          category,
          job_count: data.count,
          avg_budget_xlm: data.budgetSum / data.count,
          filled_count: data.filledCount,
          avg_days_to_fill: null,
        })),
      };
    }

    // SELECT from job_views
    if (text.includes("FROM job_views")) {
      return { rows: [{ total_views: 0, unique_views: 0 }] };
    }

    // SELECT from applications with count for job analytics
    if (
      text.includes("FROM applications WHERE job_id = $1") &&
      text.includes("COUNT(*)") &&
      !text.includes("a.job_id")
    ) {
      return {
        rows: [
          {
            total_applications: 0,
            accepted_applications: 0,
            avg_bid: "0",
            min_bid: "0",
            max_bid: "0",
          },
        ],
      };
    }

    // UPDATE profiles (for settings)
    if (text.startsWith("UPDATE profiles")) {
      return { rows: [], rowCount: 1 };
    }

    // SELECT from profiles
    if (text.includes("FROM profiles") && text.includes("public_key = $1")) {
      return { rows: [] };
    }

    // SELECT for suggestions
    if (text.includes("FROM jobs") && text.includes("search_vector")) {
      return { rows: [] };
    }

    // SELECT with ILIKE for job skills
    if (text.includes("SELECT DISTINCT skill FROM")) {
      return { rows: [] };
    }

    // Developer API Keys Queries
    if (text.startsWith("INSERT INTO api_keys")) {
      const row = defaultApiKeyRow({
        id: `key-${apiKeys.size + 1}`,
        owner_public_key: params[0],
        label: params[1],
        key_prefix: params[2],
        key_hash: params[3],
      });
      apiKeys.set(row.id, row);
      return { rows: [row] };
    }

    if (
      text.includes("FROM api_keys k") &&
      text.includes("k.owner_public_key = $1")
    ) {
      const rows = [...apiKeys.values()]
        .filter((k) => k.owner_public_key === params[0])
        .map((k) => ({
          id: k.id,
          label: k.label,
          key_prefix: k.key_prefix,
          created_at: k.created_at,
          last_used_at: k.last_used_at,
          revoked_at: k.revoked_at,
          rotating_at: k.rotating_at,
          rotating_key_hash: k.rotating_key_hash,
          requests_today: 0,
        }));
      return { rows };
    }

    if (
      text.startsWith("UPDATE api_keys") &&
      text.includes("SET revoked_at = NOW()")
    ) {
      const key = apiKeys.get(params[0]);
      if (key && key.owner_public_key === params[1] && !key.revoked_at) {
        key.revoked_at = new Date().toISOString();
        key.rotating_key_hash = null;
        key.rotating_at = null;
        apiKeys.set(key.id, key);
        return { rows: [key], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    if (
      text.startsWith("UPDATE api_keys") &&
      text.includes("SET rotating_key_hash")
    ) {
      const key = apiKeys.get(params[0]);
      if (
        key &&
        key.owner_public_key === params[1] &&
        !key.revoked_at &&
        !key.rotating_at
      ) {
        key.previous_key_hash = key.key_hash;
        key.rotating_key_hash = params[2];
        key.key_prefix = params[3];
        key.rotating_at = new Date().toISOString();
        apiKeys.set(key.id, key);
        return {
          rows: [
            {
              id: key.id,
              label: key.label,
              created_at: key.created_at,
              rotating_at: key.rotating_at,
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    }

    if (text.startsWith("INSERT INTO audit_logs")) {
      return { rows: [{ id: 1 }] };
    }

    // Onboarding progress upsert
    if (text.startsWith("INSERT INTO onboarding_progress")) {
      const row = defaultOnboardingRow({
        public_key: params[0],
        current_step: params[1],
        completed_steps:
          typeof params[2] === "string" ? JSON.parse(params[2]) : params[2],
        dismissed: params[3],
        completed: params[4],
      });
      onboardingProgress.set(row.public_key, row);
      return { rows: [row] };
    }

    if (
      text.includes("FROM onboarding_progress") &&
      text.includes("public_key = $1")
    ) {
      const row = onboardingProgress.get(params[0]);
      return { rows: row ? [row] : [] };
    }

    // Generic SELECT from categories
    if (text.includes("FROM categories")) {
      return { rows: [] };
    }
    // Generic UPDATE ... RETURNING
    if (text.startsWith("UPDATE") && text.includes("RETURNING")) {
      return { rows: [] };
    }

    // Generic SELECT from notification_queue
    if (text.includes("FROM notification_queue")) {
      return { rows: [] };
    }

    // Generic SELECT from notifications
    if (text.includes("FROM notifications")) {
      return { rows: [], rowCount: 0 };
    }

    // Generic SELECT COUNT(*) queries
    if (text.startsWith("SELECT COUNT(*)") || text.includes("COUNT(*)::int")) {
      return { rows: [{ count: 0 }] };
    }

    // DAO Queries
    if (text.startsWith("INSERT INTO dao_proposals")) {
      const days = parseInt(params[6], 10) || 7;
      const row = defaultDaoProposalRow({
        id: `prop-${daoProposals.size + 1}`,
        title: params[0],
        description: params[1],
        type: params[2],
        proposer: params[3],
        amount: params[4],
        recipient: params[5],
        voting_ends_at: new Date(Date.now() + days * 86400000).toISOString(),
      });
      daoProposals.set(row.id, row);
      return { rows: [row] };
    }

    if (text.includes("FROM dao_proposals p") && text.includes("dao_votes v")) {
      let list = [...daoProposals.values()];
      if (text.includes("WHERE p.id = $1") || text.includes("WHERE id = $1")) {
        list = list.filter((p) => p.id === params[0]);
      } else if (text.includes("p.status = $1") || text.includes("status = $1")) {
        list = list.filter((p) => p.status === params[0]);
      }
      const rows = list.map((p) => {
        const votes = [...daoVotes.values()].filter((v) => v.proposal_id === p.id);
        const votesFor = votes.filter((v) => v.support).reduce((acc, v) => acc + Number(v.weight), 0);
        const votesAgainst = votes.filter((v) => !v.support).reduce((acc, v) => acc + Number(v.weight), 0);
        const totalWeight = votesFor + votesAgainst;
        return {
          ...p,
          votes_for: votesFor,
          votes_against: votesAgainst,
          quorum_reached: totalWeight >= 100,
        };
      });
      return { rows };
    }

    if (text.startsWith("INSERT INTO dao_votes")) {
      const voteKey = `${params[0]}:${params[1]}`;
      const row = {
        proposal_id: params[0],
        voter: params[1],
        support: Boolean(params[2]),
        weight: params[3],
        tx_hash: params[4] || null,
      };
      daoVotes.set(voteKey, row);
      return { rows: [row] };
    }

    if (text.startsWith("UPDATE dao_proposals") && text.includes("status = CASE")) {
      const updated = [];
      for (const [id, prop] of daoProposals.entries()) {
        if (prop.status === "active" && new Date(prop.voting_ends_at) < new Date()) {
          const votes = [...daoVotes.values()].filter((v) => v.proposal_id === id);
          const votesFor = votes.filter((v) => v.support).reduce((acc, v) => acc + Number(v.weight), 0);
          const votesAgainst = votes.filter((v) => !v.support).reduce((acc, v) => acc + Number(v.weight), 0);
          prop.status = votesFor > votesAgainst ? "passed" : "rejected";
          daoProposals.set(id, prop);
          updated.push({ id: prop.id, status: prop.status, type: prop.type });
        }
      }
      return { rows: updated };
    }

    if (text.startsWith("UPDATE dao_proposals SET status = 'executed'")) {
      const prop = daoProposals.get(params[0]);
      if (prop) {
        prop.status = "executed";
        prop.executed_at = new Date().toISOString();
        daoProposals.set(prop.id, prop);
        return { rows: [prop], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }

    if (text.includes("FROM dao_proposals") && text.includes("SUM(amount)")) {
      const activeProposals = [...daoProposals.values()].filter((p) => p.status === "active").length;
      const allocated = [...daoProposals.values()]
        .filter((p) => ["passed", "executed"].includes(p.status) && p.type === "treasury")
        .reduce((acc, p) => acc + parseFloat(p.amount || 0), 0);
      return {
        rows: [{
          allocated: String(allocated),
          active_proposals: activeProposals,
        }],
      };
    }

    if (text.startsWith("INSERT INTO dao_arbitrators")) {
      const existing = daoArbitrators.get(params[0]) || defaultDaoArbitratorRow({ public_key: params[0] });
      existing.display_name = params[1] !== undefined ? params[1] : existing.display_name;
      existing.bio = params[2] !== undefined ? params[2] : existing.bio;
      daoArbitrators.set(params[0], existing);
      return { rows: [existing] };
    }

    if (text.startsWith("UPDATE dao_arbitrators SET votes_received")) {
      const key = params[0];
      const weight = Number(params[1]) || 1;
      const arb = daoArbitrators.get(key) || defaultDaoArbitratorRow({ public_key: key });
      arb.votes_received = (arb.votes_received || 0) + weight;
      daoArbitrators.set(key, arb);
      return { rows: [arb], rowCount: 1 };
    }

    if (text.includes("FROM dao_arbitrators")) {
      if (text.includes("WHERE public_key = ANY")) {
        const keys = params[0] || [];
        const rows = keys.map((k) => daoArbitrators.get(k)).filter(Boolean);
        return { rows };
      }
      const rows = [...daoArbitrators.values()]
        .filter((a) => a.active !== false)
        .sort((a, b) => (b.votes_received || 0) - (a.votes_received || 0));
      return { rows };
    }

    return { rows: [] };
  });

  const connect = jest.fn(async () => ({
    query: async (sql, params) => {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
        return { rows: [] };
      }
      return query(sql, params);
    },
    release: jest.fn(),
  }));

  function reset() {
    jobs.clear();
    applications.clear();
    invitations.clear();
    skillsMap.clear();
    jobSkillsMap.clear();
    wsEvents.clear();
    daoProposals.clear();
    daoVotes.clear();
    daoArbitrators.clear();
    apiKeys.clear();
    escrows.clear();
    escrowExtensions.clear();
    onboardingProgress.clear();
    timelineEvents.length = 0;
    query.mockClear();
    connect.mockClear();
  }

  const mock = {
    query,
    connect,
    jobs,
    applications,
    invitations,
    daoProposals,
    daoVotes,
    daoArbitrators,
    apiKeys,
    escrows,
    escrowExtensions,
    onboardingProgress,
    reset,
    end: jest.fn(),
  };
  // jobService/applicationService destructure { readPool, writePool } from pool
  mock.readPool = { query };
  mock.writePool = mock;
  return mock;
}

module.exports = {
  createPgMock,
  defaultJobRow,
  defaultApplicationRow,
  defaultDaoProposalRow,
  defaultDaoArbitratorRow,
  defaultApiKeyRow,
  defaultEscrowRow,
  defaultEscrowExtensionRow,
  defaultOnboardingRow,
};
