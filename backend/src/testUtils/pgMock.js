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

function createPgMock() {
  const jobs = new Map();
  const applications = new Map();
  const invitations = new Set();
  const skillsMap = new Map();
  const jobSkillsMap = new Map();
  const wsEvents = new Map();

  const query = jest.fn(async (sql, params = []) => {
    const text = sql.replace(/\s+/g, " ").trim();

    if (text.startsWith("INSERT INTO ws_event_queue")) {
      const id = wsEvents.size + 1;
      let createdAt = new Date().toISOString();
      if (text.includes("INTERVAL '8 days'")) {
        createdAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      }
      const eventJson = typeof params[0] === "string" ? JSON.parse(params[0]) : params[0];
      const row = { id, event: eventJson, created_at: createdAt };
      wsEvents.set(id, row);
      return { rows: [row] };
    }

    if (text.startsWith("SELECT id, event FROM ws_event_queue")) {
      const lastId = params[0] || 0;
      const limit = params[1] || 50;
      const rows = [...wsEvents.values()]
        .filter(r => r.id > lastId)
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

    if (text.startsWith("INSERT INTO skills")) {
      const matches = text.match(/\$\$(.*?)\$\$/g);
      if (matches) {
        matches.forEach(m => {
          const name = m.replace(/\$\$/g, '');
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
      const rows = slugs.map(s => {
        const found = skillsMap.get(s);
        return found ? { id: found.id } : null;
      }).filter(Boolean);
      return { rows };
    }

    if (text.startsWith("INSERT INTO job_skills")) {
      const matches = text.match(/\('([^']+)',\s*(\d+)\)/g);
      if (matches) {
        matches.forEach(m => {
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

    if (text.startsWith("SELECT s.display_name FROM skills s JOIN job_skills js")) {
      const jobId = params[0];
      const skillIds = jobSkillsMap.get(jobId) || new Set();
      const rows = [...skillsMap.values()]
        .filter(s => skillIds.has(s.id))
        .map(s => ({ display_name: s.display_name }));
      return { rows };
    }

    // INSERT INTO jobs
    if (text.startsWith("INSERT INTO jobs")) {
      const row = defaultJobRow({
        id: `job-${jobs.size + 1}`,
        title: params[0],
        description: params[1],
        budget: params[2],
        currency: params[3],
        category: params[4],
        client_address: params[6],
        deadline: params[7],
        timezone: params[8],
        screening_questions: params[9],
        milestones: typeof params[10] === "string" ? JSON.parse(params[10]) : params[10],
        visibility: params[11],
      });
      jobs.set(row.id, row);
      return { rows: [row] };
    }

    // Generic job lookup by id (handles JOB_SELECT_CLAUSE too)
    const jobId = findJobIdFromUpdate(text, params);
    const hasWhereId = text.includes("WHERE id = $") || text.includes("WHERE  id = $");

    // Handle jobs queries — but NOT applications/notifications (which also use WHERE id = $N)
    if (hasWhereId && jobId && !text.includes("applications") && !text.includes("notifications") && !text.includes("notification_queue")) {
      const row = jobs.get(jobId);

      // If job doesn't exist for UPDATE, return empty (so caller can throw 404)
      if (!row && text.startsWith("UPDATE")) {
        return { rows: [] };
      }

      if (!row) {
        // Job not found for SELECT
        return { rows: [] };
      }

      // Order matters: check most specific patterns first!

      // UPDATE ... resolveDispute: SET status = 'in_progress', dispute_reason = NULL ... (must come before dispute handler)
      if (text.startsWith("UPDATE") && text.includes("dispute_reason = NULL")) {
        row.status = "in_progress";
        row.dispute_reason = null;
        row.dispute_description = null;
        row.disputed_by = null;
        row.disputed_at = null;
        row.updated_at = new Date().toISOString();
        jobs.set(row.id, row);
        return { rows: [row], rowCount: 1 };
      }

      // UPDATE jobs SET status = 'disputed', dispute_reason = $N ... (raiseDispute)
      if (text.startsWith("UPDATE") && text.includes("dispute_reason =") && text.includes("$1")) {
        row.dispute_reason = params[0];
        row.dispute_description = params[1];
        row.status = "disputed";
        row.disputed_at = new Date().toISOString();
        row.updated_at = new Date().toISOString();
        row.disputed_by = params[2];
        jobs.set(row.id, row);
        return { rows: [row], rowCount: 1 };
      }

      // UPDATE ... SET status = 'cancelled' WHERE ... AND client_address = $2 AND status = 'open'
      if (text.startsWith("UPDATE") && text.includes("client_address") && text.includes("status = 'open'")) {
        const clientAddress = params[params.length === 2 ? 1 : 1];
        if (row.client_address === clientAddress && row.status === "open") {
          row.status = "cancelled";
          row.updated_at = new Date().toISOString();
          jobs.set(row.id, row);
          return { rows: [row] };
        }
        return { rows: [] };
      }

      // UPDATE jobs SET status = ... WHERE id = $N  (generic status update — uses $1 placeholder)
      if (text.startsWith("UPDATE") && text.includes("SET status")) {
        // Try literal string first (e.g., status = 'cancelled')
        const literalMatch = text.match(/SET\s+status\s*=\s*'([^']+)'/i);
        if (literalMatch) {
          row.status = literalMatch[1];
        } else {
          // Otherwise use first param (e.g., status = $1)
          row.status = params[0];
        }
        row.updated_at = new Date().toISOString();
        jobs.set(row.id, row);
        return { rows: [row] };
      }

      // UPDATE jobs SET deleted_at = ...
      if (text.startsWith("UPDATE") && text.includes("deleted_at")) {
        row.deleted_at = new Date().toISOString();
        row.updated_at = new Date().toISOString();
        jobs.set(row.id, row);
        return { rows: [row], rowCount: 1 };
      }

      // UPDATE jobs SET share_count = ...
      if (text.startsWith("UPDATE") && text.includes("share_count")) {
        row.share_count = (row.share_count || 0) + 1;
        row.updated_at = new Date().toISOString();
        jobs.set(row.id, row);
        return { rows: [row], rowCount: 1 };
      }

      // UPDATE jobs SET escrow_contract_id = ...
      if (text.startsWith("UPDATE") && text.includes("escrow_contract_id")) {
        row.escrow_contract_id = params[0];
        row.updated_at = new Date().toISOString();
        jobs.set(row.id, row);
        return { rows: [row] };
      }

      // UPDATE jobs SET freelancer_address = ...
      if (text.startsWith("UPDATE") && text.includes("freelancer_address")) {
        row.freelancer_address = params[0];
        row.status = "in_progress";
        row.updated_at = new Date().toISOString();
        jobs.set(row.id, row);
        return { rows: [row] };
      }

      // UPDATE jobs SET boosted = ...
      if (text.startsWith("UPDATE") && text.includes("boosted")) {
        row.boosted = true;
        row.boosted_until = params[0];
        row.updated_at = new Date().toISOString();
        jobs.set(row.id, row);
        return { rows: [row] };
      }

      // UPDATE jobs SET expires_at = ...
      if (text.startsWith("UPDATE") && text.includes("expires_at")) {
        row.expires_at = params[0];
        row.extended_count = (row.extended_count || 0) + 1;
        row.extended_until = params[0];
        row.updated_at = new Date().toISOString();
        jobs.set(row.id, row);
        return { rows: [row] };
      }

      // UPDATE jobs SET bidding_closed_at = ...
      if (text.startsWith("UPDATE") && text.includes("bidding_closed_at")) {
        row.bidding_closed_at = new Date().toISOString();
        row.updated_at = new Date().toISOString();
        jobs.set(row.id, row);
        return { rows: [row] };
      }

      // UPDATE jobs SET view_count = ...
      if (text.startsWith("UPDATE") && text.includes("view_count")) {
        row.view_count = (row.view_count || 0) + 1;
        row.updated_at = new Date().toISOString();
        jobs.set(row.id, row);
        return { rows: [row] };
      }

      // UPDATE ... RETURNING * — fallback (only if job exists)
      if (text.startsWith("UPDATE") && text.includes("RETURNING")) {
        row.updated_at = new Date().toISOString();
        jobs.set(row.id, row);
        return { rows: [row] };
      }

      // SELECT ... WHERE id = $1 — return the job
      if (text.startsWith("SELECT")) {
        return { rows: [row] };
      }
    }

    // SELECT ... FROM applications WHERE a.job_id = $1 (with JOINs)
    if (text.includes("FROM applications a") && text.includes("WHERE a.job_id = $1")) {
      const rows = [...applications.values()]
        .filter(app => app.job_id === params[0])
        .map(app => ({ ...defaultApplicationRow(), ...app }));
      return { rows };
    }

    // SELECT ... FROM applications ... WHERE a.freelancer_address = $1
    if (text.includes("FROM applications") && text.includes("freelancer_address = $1") && !text.includes("job_id")) {
      const rows = [...applications.values()]
        .filter(app => app.freelancer_address === params[0])
        .map(app => ({ ...defaultApplicationRow(), ...app }));
      return { rows };
    }

    // FROM jobs WHERE client_address = $1
    if (text.includes("FROM jobs") && text.includes("WHERE client_address = $1")) {
      const rows = [...jobs.values()].filter(
        (job) => job.client_address === params[0],
      );
      return { rows };
    }

    // INSERT INTO escrows
    if (text.startsWith("INSERT INTO escrows")) {
      return { rows: [] };
    }

    // UPDATE jobs SET applicant_count
    if (text.includes("UPDATE jobs") && text.includes("applicant_count")) {
      const idParam = params[0];
      const job = [...jobs.values()].find(j => j.id === idParam);
      if (job) {
        job.applicant_count += 1;
        jobs.set(job.id, job);
      }
      return { rows: [] };
    }

    // UPDATE applications SET status = 'accepted'
    if (text.startsWith("UPDATE applications SET status = 'accepted'")) {
      const row = applications.get(params[0]);
      if (!row) return { rows: [] };
      row.status = "accepted";
      row.accepted_at = new Date().toISOString();
      applications.set(row.id, row);
      return { rows: [row] };
    }

    // UPDATE applications SET status = 'rejected'
    if (text.includes("UPDATE applications") && text.includes("status = 'rejected'")) {
      const jobApps = [...applications.values()].filter(
        (app) => app.job_id === params[0] && app.id !== params[1] && app.status === "pending",
      );
      jobApps.forEach((app) => {
        app.status = "rejected";
        applications.set(app.id, app);
      });
      return { rows: [] };
    }

    // UPDATE applications SET bid_revealed = TRUE
    if (text.startsWith("UPDATE applications SET bid_revealed")) {
      const row = applications.get(params[0]);
      if (!row) return { rows: [] };
      row.bid_revealed = true;
      row.revealed_bid_amount = params[1];
      row.revealed_at = new Date().toISOString();
      applications.set(row.id, row);
      return { rows: [row] };
    }

    // UPDATE applications SET withdrawn_at
    if (text.startsWith("UPDATE applications SET withdrawn_at")) {
      const row = applications.get(params[0]);
      if (!row) return { rows: [] };
      row.withdrawn_at = new Date().toISOString();
      applications.set(row.id, row);
      return { rows: [row] };
    }

    // SELECT * FROM applications WHERE id
    if (text.startsWith("SELECT * FROM applications WHERE id")) {
      const row = applications.get(params[0]);
      return { rows: row ? [row] : [] };
    }

    // SELECT 1 FROM applications WHERE job_id AND freelancer_address
    if (text.includes("SELECT 1 FROM applications WHERE") && text.includes("job_id") && text.includes("freelancer_address")) {
      const exists = [...applications.values()].some(
        (app) => app.job_id === params[0] && app.freelancer_address === params[1],
      );
      return { rows: exists ? [{ "?column?": 1 }] : [] };
    }

    // INSERT INTO applications
    if (text.includes("INSERT INTO applications")) {
      const duplicate = [...applications.values()].some(
        (app) => app.job_id === params[0] && app.freelancer_address === params[1],
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

    // UPDATE ... SET freelancer_address for assignFreelancer
    if (text.includes("SET freelancer_address = $1, status = 'in_progress'") && text.includes("UPDATE jobs")) {
      const row = jobs.get(params[1]);
      if (!row) return { rows: [] };
      row.freelancer_address = params[0];
      row.status = "in_progress";
      jobs.set(row.id, row);
      return { rows: [row] };
    }

    // listJobs-style query: FROM jobs ... ORDER BY ... (paginated)
    if (text.includes("FROM jobs") && text.includes("ORDER BY") && !text.includes("WHERE id = $") && !text.includes("WHERE client_address = $1")) {
      let rows = [...jobs.values()].filter((job) => job.visibility === "public");
      if (text.includes("status = $")) {
        const statusIdx = text.indexOf("status = $2") >= 0 ? 1 : 0;
        const status = params[statusIdx];
        if (status) rows = rows.filter((job) => job.status === status);
      }
      const limit = params[params.length - 1] ?? 50;
      return { rows: rows.slice(0, limit) };
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
    if (text.includes("COUNT(*)") && text.includes("FROM jobs")) {
      return {
        rows: [{
          total_jobs: jobs.size,
          open_jobs: [...jobs.values()].filter(j => j.status === "open").length,
          in_progress_jobs: [...jobs.values()].filter(j => j.status === "in_progress").length,
          completed_jobs: [...jobs.values()].filter(j => j.status === "completed").length,
          avg_budget_xlm: "250.00",
          total_filled: [...jobs.values()].filter(j => j.freelancer_address).length,
          avg_days_to_fill: null,
        }]
      };
    }

    // SELECT with GROUP BY category for analytics
    if (text.includes("GROUP BY category") && text.includes("FROM jobs")) {
      const cats = {};
      for (const job of jobs.values()) {
        if (!cats[job.category]) cats[job.category] = { count: 0, budgetSum: 0, filledCount: 0 };
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
        }))
      };
    }

    // SELECT from job_views
    if (text.includes("FROM job_views")) {
      return { rows: [{ total_views: 0, unique_views: 0 }] };
    }

    // SELECT from applications with count for job analytics
    if (text.includes("FROM applications WHERE job_id = $1") && text.includes("COUNT(*)") && !text.includes("a.job_id")) {
      return { rows: [{ total_applications: 0, accepted_applications: 0, avg_bid: "0", min_bid: "0", max_bid: "0" }] };
    }

    // UPDATE jobs SET status = 'expired' (expireOldJobs)
    if (text.startsWith("UPDATE") && text.includes("status = 'expired'") && text.includes("expires_at < NOW()")) {
      return { rowCount: 0 };
    }

    // SELECT with INTERVAL for getExpiringJobs
    if (text.includes("expires_at > NOW()") && text.includes("expires_at <= NOW() + INTERVAL")) {
      return { rows: [] };
    }

    // DELETE FROM jobs for purgeDeletedJobs
    if (text.startsWith("DELETE FROM jobs")) {
      return { rowCount: 0, rows: [] };
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

    // Generic SELECT from categories
    if (text.includes("FROM categories")) {
      return { rows: [] };
    }

    // Generic UPDATE ... RETURNING
    if (text.startsWith("UPDATE") && text.includes("RETURNING")) {
      return { rows: [{}] };
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
    query.mockClear();
    connect.mockClear();
  }

  const mock = { query, connect, jobs, applications, invitations, reset, end: jest.fn() };
  // jobService/applicationService destructure { readPool, writePool } from pool
  mock.readPool = { query };
  mock.writePool = mock;
  return mock;
}

module.exports = { createPgMock, defaultJobRow, defaultApplicationRow };
