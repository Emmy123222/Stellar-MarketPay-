/**
 * TF-IDF job recommendation engine
 * Scores jobs by cosine similarity between freelancer skill vector and job description vectors.
 * Results cached in Redis for 5 minutes per user.
 */
"use strict";
const pool = require("../db/pool");
const cache = require("../services/cacheService");

const STOP_WORDS = new Set([
  "the","and","or","for","to","in","a","an","of","is","are","was","were","be","been",
  "being","have","has","had","do","does","did","but","if","or","because","as","until",
  "while","of","at","by","for","with","about","against","between","into","through",
  "during","before","after","above","below","to","from","up","down","out","on","off",
  "over","under","again","further","then","once","here","there","when","where","why",
  "how","all","both","each","few","more","most","other","some","such","no","nor","not",
  "only","own","same","so","than","too","very","s","t","can","will","just","should",
  "now","needs","need","looking","able","use","using","used","well","also","like","get",
  "got","make","made","take","took","come","came","know","knew","think","thought","see",
  "saw","want","wanted","give","gave","find","found","tell","told","ask","asked","work",
  "worked","seem","seemed","feel","felt","try","tried","leave","left","call","called",
  "job","jobs","project","projects","work","working","worker","help","helping","helpful",
  "looking","look","need","needed","required","require","requires","someone","something",
  "anything","everything","nothing","thing","things","new","old","good","great","best",
  "better","much","many","lot","lots","way","ways","part","parts","year","years","day",
  "days","time","times","man","woman","men","women","child","children","person","people",
  "world","life","company","companies","user","users","client","clients","freelancer",
  "freelancers","service","services"
]);

function tokenize(text) {
  if (!text) return [];
  return text
    .toLowerCase()
    .replace(/[^a-z0-9+#./-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}

async function getVocabulary() {
  const { rows } = await pool.query(
    "SELECT term, inverse_document_frequency FROM tfidf_vocabulary"
  );
  const map = {};
  for (const r of rows) {
    map[r.term] = parseFloat(r.inverse_document_frequency);
  }
  return map;
}

async function computeJobVector(title, description, skills) {
  const text = `${title} ${description} ${(skills || []).join(" ")}`;
  const tokens = tokenize(text);
  const skillTokens = (skills || [])
    .map((s) => s.toLowerCase().trim())
    .filter(Boolean);
  const allTerms = [...tokens, ...skillTokens];

  if (allTerms.length === 0) return {};

  const tf = {};
  for (const term of allTerms) {
    tf[term] = (tf[term] || 0) + 1;
  }

  const idfMap = await getVocabulary();
  const totalTerms = allTerms.length;
  const vector = {};

  for (const [term, count] of Object.entries(tf)) {
    const idf = idfMap[term];
    if (idf && idf > 0) {
      vector[term] = parseFloat(((count / totalTerms) * idf).toFixed(6));
    }
  }

  return vector;
}

async function computeFreelancerVector(skills) {
  if (!skills || skills.length === 0) return {};

  const skillTokens = skills
    .map((s) => s.toLowerCase().trim())
    .filter(Boolean);
  if (skillTokens.length === 0) return {};

  const idfMap = await getVocabulary();
  const tf = {};
  for (const term of skillTokens) {
    tf[term] = (tf[term] || 0) + 1;
  }

  const vector = {};
  for (const [term, count] of Object.entries(tf)) {
    const idf = idfMap[term];
    if (idf && idf > 0) {
      vector[term] = parseFloat(((count / skillTokens.length) * idf).toFixed(6));
    }
  }

  return vector;
}

function cosineSimilarity(vecA, vecB) {
  const keysA = Object.keys(vecA);
  const keysB = new Set(Object.keys(vecB));

  let dotProduct = 0;
  let magA = 0;
  let magB = 0;

  for (const key of keysA) {
    magA += vecA[key] * vecA[key];
    if (keysB.has(key)) {
      dotProduct += vecA[key] * vecB[key];
    }
  }

  for (const key of keysB) {
    magB += vecB[key] * vecB[key];
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dotProduct / denom;
}

function mapRowToSummary(row) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    budget: row.budget,
    currency: row.currency || "XLM",
    category: row.category,
    skills: row.skills || [],
    clientName: row.client_name,
    clientRating: row.client_rating,
    matchScore: row.match_score,
    createdAt: row.created_at,
    status: row.status,
  };
}

async function fetchRecentJobs(excludeAddress, limit) {
  const { rows } = await pool.query(
    `SELECT j.id, j.title, j.description, j.budget, j.currency, j.category,
       j.client_address, j.created_at, j.status,
       COALESCE((SELECT array_agg(s.display_name)
         FROM job_skills js
         JOIN skills s ON s.id = js.skill_id
         WHERE js.job_id = j.id), '{}') AS skills,
       p.display_name AS client_name,
       p.rating AS client_rating
     FROM jobs j
     LEFT JOIN profiles p ON j.client_address = p.public_key
     WHERE j.status = 'open'
       AND j.visibility = 'public'
       AND j.deleted_at IS NULL
       AND j.client_address != $1
       AND NOT EXISTS (
         SELECT 1 FROM applications a
         WHERE a.job_id = j.id AND a.freelancer_address = $1
       )
     ORDER BY j.created_at DESC
     LIMIT $2`,
    [excludeAddress, limit]
  );
  return rows;
}

async function fetchVectorJobs(excludeAddress, maxCandidates) {
  const { rows } = await pool.query(
    `SELECT j.id, j.title, j.description, j.budget, j.currency, j.category,
       j.tfidf_vector, j.created_at, j.status,
       COALESCE((SELECT array_agg(s.display_name)
         FROM job_skills js
         JOIN skills s ON s.id = js.skill_id
         WHERE js.job_id = j.id), '{}') AS skills,
       p.display_name AS client_name,
       p.rating AS client_rating
     FROM jobs j
     LEFT JOIN profiles p ON j.client_address = p.public_key
     WHERE j.status = 'open'
       AND j.visibility = 'public'
       AND j.deleted_at IS NULL
       AND j.tfidf_vector IS NOT NULL
       AND j.client_address != $1
       AND NOT EXISTS (
         SELECT 1 FROM applications a
         WHERE a.job_id = j.id AND a.freelancer_address = $1
       )
     ORDER BY j.created_at DESC
     LIMIT $2`,
    [excludeAddress, maxCandidates]
  );
  return rows;
}

async function getRecommendations(freelancerAddress, limit = 10) {
  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 50);
  const cacheKey = `recs:${freelancerAddress}:${safeLimit}`;

  const cached = await cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const { rows: profileRows } = await pool.query(
    `SELECT skills FROM profiles WHERE public_key = $1 AND deleted_at IS NULL`,
    [freelancerAddress]
  );

  const skills = profileRows.length ? profileRows[0].skills || [] : [];
  const freelancerVector = await computeFreelancerVector(skills);

  let result;

  if (Object.keys(freelancerVector).length === 0) {
    const rows = await fetchRecentJobs(freelancerAddress, safeLimit);
    result = rows.map((row) => ({
      ...mapRowToSummary(row),
      matchScore: 0,
    }));
  } else {
    const rows = await fetchVectorJobs(freelancerAddress, safeLimit * 20);
    const scored = rows.map((job) => {
      const jobVector = job.tfidf_vector || {};
      const score = cosineSimilarity(freelancerVector, jobVector);
      return {
        ...mapRowToSummary(job),
        matchScore: parseFloat((score * 100).toFixed(1)),
      };
    });

    scored.sort((a, b) => b.matchScore - a.matchScore);
    result = scored.slice(0, safeLimit);
  }

  await cache.set(cacheKey, result, 300);
  return result;
}

async function updateVocabularyAndIdf(newTerms) {
  if (!newTerms || newTerms.length === 0) return;

  const uniqueTerms = [...new Set(newTerms)];
  const { rows } = await pool.query(
    "SELECT COUNT(*) as total FROM jobs WHERE status = 'open'"
  );
  const totalJobs = Math.max(parseInt(rows[0].total) || 1, 1);

  await pool.query("BEGIN");
  try {
    for (const term of uniqueTerms) {
      await pool.query(
        `INSERT INTO tfidf_vocabulary (term, document_frequency)
         VALUES ($1, 1)
         ON CONFLICT (term) DO UPDATE SET
           document_frequency = tfidf_vocabulary.document_frequency + 1`,
        [term]
      );
    }

    if (uniqueTerms.length > 0) {
      await pool.query(
        `UPDATE tfidf_vocabulary
         SET inverse_document_frequency = LN(($1::numeric + 1) / (document_frequency + 1))
         WHERE term = ANY($2::text[])`,
        [totalJobs, uniqueTerms]
      );
    }

    await pool.query("COMMIT");
  } catch (err) {
    await pool.query("ROLLBACK");
    throw err;
  }
}

async function buildJobTfIdfVector(title, description, skills) {
  return computeJobVector(title, description, skills);
}

module.exports = {
  getRecommendations,
  computeJobVector,
  computeFreelancerVector,
  cosineSimilarity,
  updateVocabularyAndIdf,
  buildJobTfIdfVector,
};
