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

    if (text.startsWith("INSERT INTO jobs")) {
      const row = defaultJobRow({
        id: `job-${jobs.size + 1}`,
        title: params[0],
        description: params[1],
        budget: params[2],
        currency: params[3],
        category: params[4],
        client_address: params[5],
        deadline: params[6],
        timezone: params[7],
        screening_questions: params[8],
        milestones: typeof params[9] === "string" ? JSON.parse(params[9]) : params[9],
        visibility: params[10],
      });
      jobs.set(row.id, row);
      return { rows: [row] };
    }

    if (text.includes("FROM jobs WHERE id = $1")) {
      const row = jobs.get(params[0]);
      return { rows: row ? [row] : [] };
    }

    if (text.includes("FROM jobs WHERE client_address = $1")) {
      const rows = [...jobs.values()].filter(
        (job) => job.client_address === params[0],
      );
      return { rows };
    }


    if (text.startsWith("UPDATE jobs SET escrow_contract_id")) {
      const row = jobs.get(params[1]);
      if (!row) return { rows: [] };
      row.escrow_contract_id = params[0];
      row.updated_at = new Date().toISOString();
      jobs.set(row.id, row);
      return { rows: [row] };
    }

    if (text.startsWith("INSERT INTO escrows")) {
      return { rows: [] };
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

    if (text.includes("FROM jobs") && text.includes("ORDER BY") && !text.includes("WHERE id = $1") && !text.includes("WHERE client_address = $1")) {
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

  return { query, connect, jobs, applications, invitations, reset, end: jest.fn() };
}

module.exports = { createPgMock, defaultJobRow, defaultApplicationRow };
