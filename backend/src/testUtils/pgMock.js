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
    visibility: overrides.visibility || "public",
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
    created_at: overrides.created_at || new Date().toISOString(),
    accepted_at: overrides.accepted_at || null,
  };
}

function createPgMock() {
  const jobs = new Map();
  const applications = new Map();
  const invitations = new Set();

  const query = jest.fn(async (sql, params = []) => {
    const text = sql.replace(/\s+/g, " ").trim();

    if (text.startsWith("INSERT INTO jobs")) {
      const row = defaultJobRow({
        id: `job-${jobs.size + 1}`,
        title: params[0],
        description: params[1],
        budget: params[2],
        currency: params[3],
        category: params[4],
        skills: params[5],
        client_address: params[6],
        deadline: params[7],
        timezone: params[8],
        screening_questions: params[9],
        visibility: params[10],
      });
      jobs.set(row.id, row);
      return { rows: [row] };
    }

    if (text === "SELECT * FROM jobs WHERE id = $1") {
      const row = jobs.get(params[0]);
      return { rows: row ? [row] : [] };
    }

    if (text.startsWith("SELECT * FROM jobs WHERE client_address")) {
      const rows = [...jobs.values()].filter(
        (job) => job.client_address === params[0],
      );
      return { rows };
    }

    if (text.startsWith("UPDATE jobs SET status")) {
      const row = jobs.get(params[1]);
      if (!row) return { rows: [] };
      row.status = params[0];
      row.updated_at = new Date().toISOString();
      jobs.set(row.id, row);
      return { rows: [row] };
    }

    if (text.includes("UPDATE jobs") && text.includes("freelancer_address")) {
      const row = jobs.get(params[1] || params[2]);
      if (!row) return { rows: [] };
      row.freelancer_address = params[0];
      row.status = "in_progress";
      jobs.set(row.id, row);
      return { rows: [row] };
    }

    if (text.startsWith("SELECT * FROM applications WHERE id")) {
      const row = applications.get(params[0]);
      return { rows: row ? [row] : [] };
    }

    if (
      text.includes("SELECT 1 FROM applications WHERE job_id") &&
      text.includes("freelancer_address")
    ) {
      const exists = [...applications.values()].some(
        (app) =>
          app.job_id === params[0] && app.freelancer_address === params[1],
      );
      return { rows: exists ? [{ "?column?": 1 }] : [] };
    }

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
        screening_answers: params[5] || {},
      });
      applications.set(row.id, row);
      return { rows: [row] };
    }

    if (text.includes("UPDATE jobs SET applicant_count")) {
      const job = jobs.get(params[0]);
      if (job) {
        job.applicant_count += 1;
        jobs.set(job.id, job);
      }
      return { rows: [] };
    }

    if (text.startsWith("UPDATE applications SET status = 'accepted'")) {
      const row = applications.get(params[0]);
      if (!row) return { rows: [] };
      row.status = "accepted";
      applications.set(row.id, row);
      return { rows: [row] };
    }

    if (text.includes("UPDATE applications") && text.includes("status = 'rejected'")) {
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

    if (text.includes("SET freelancer_address = $1, status = 'in_progress'")) {
      const row = jobs.get(params[1]);
      if (!row) return { rows: [] };
      row.freelancer_address = params[0];
      row.status = "in_progress";
      jobs.set(row.id, row);
      return { rows: [row] };
    }

    if (text.startsWith("SELECT * FROM jobs") && text.includes("ORDER BY")) {
      let rows = [...jobs.values()].filter((job) => job.visibility === "public");
      if (text.includes("status = $1")) {
        rows = rows.filter((job) => job.status === params[0]);
      }
      if (text.includes("category = $")) {
        const categoryIndex = text.indexOf("category = $2") >= 0 ? 1 : 0;
        const category = params[categoryIndex];
        if (category) rows = rows.filter((job) => job.category === category);
      }
      const limit = params[params.length - 1] ?? 50;
      return { rows: rows.slice(0, limit) };
    }

    if (text === "SELECT 1 FROM job_invitations WHERE job_id = $1 AND freelancer_address = $2") {
      const key = `${params[0]}:${params[1]}`;
      return { rows: invitations.has(key) ? [{ ok: 1 }] : [] };
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
    query.mockClear();
    connect.mockClear();
  }

  return { query, connect, jobs, applications, invitations, reset };
}

module.exports = { createPgMock, defaultJobRow, defaultApplicationRow };
