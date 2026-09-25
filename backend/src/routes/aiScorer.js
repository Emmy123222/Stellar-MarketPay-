/**
 * @swagger
 * tags:
 *   name: AI Scorer
 *   description: AI-powered job description scoring
 */
const express = require("express");
const router = express.Router();
const { createRateLimiter } = require("../middleware/rateLimiter");

const CLAUDE_MODEL = "claude-3-haiku-20240307";
const scoringRateLimiter = createRateLimiter(20, 1); // 20 requests per minute

/**
 * @swagger
 * /api/ai/score-job:
 *   post:
 *     summary: Score a job description using AI
 *     tags: [AI Scorer]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - description
 *             properties:
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Quality score and improvement suggestions
 *       500:
 *         description: AI API not configured
 */
router.post("/score-job", scoringRateLimiter, async (req, res) => {
  try {
    if (!process.env.CLAUDE_API_KEY) {
      return res.status(500).json({ error: "Claude API not configured" });
    }

    const { description } = req.body;
    if (!description || description.trim().length === 0) {
      return res.status(400).json({ error: "Job description required" });
    }

    const analysisPrompt = `Analyze this job description and provide a quality score and specific suggestions for improvement.

Job Description:
"${description}"

Respond in JSON format:
{
  "score": <number 0-100>,
  "scoreBreakdown": {
    "clarity": <0-100>,
    "completeness": <0-100>,
    "budgetReasonableness": <0-100>,
    "skillSpecificity": <0-100>
  },
  "suggestions": [<array of specific improvement suggestions>],
  "missingInformation": [<array of missing details>],
  "strengths": [<array of what's good about the description>]
}`;

    // Call Claude API (using fetch for consistency with aiService.js)
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 1024,
        messages: [{ role: "user", content: analysisPrompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Claude API error: ${response.status} ${errText}`);
    }

    const result = await response.json();
    const content = result.content[0].text;
    let analysis;

    try {
      // Extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      analysis = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch {
      // Fallback if JSON parsing fails
      analysis = {
        score: 65,
        suggestions: ["Consider adding more specific skills required"],
        missingInformation: ["Budget range"],
      };
    }

    res.json({
      success: true,
      data: {
        score: analysis.score || 70,
        scoreBreakdown: analysis.scoreBreakdown || {},
        suggestions: analysis.suggestions || [],
        missingInformation: analysis.missingInformation || [],
        strengths: analysis.strengths || [],
      },
    });
  } catch (error) {
    // Fallback for API errors — returns a default score instead of crashing
    res.json({
      success: true,
      data: {
        score: 60,
        suggestions: ["Add more specific project requirements", "Include budget information"],
        missingInformation: ["Timeline", "Experience level required"],
      },
    });
  }
});

/**
 * Clamp an AI-provided score into the 0–100 range.
 */
function clampScore(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/**
 * Normalise the model output for a proposal into the shape the UI expects:
 * Relevance / Clarity / Completeness (0–100), an averaged overall score and a
 * short list of suggestions.
 */
function normalizeProposalScore(analysis) {
  const relevance = clampScore(analysis?.relevance);
  const clarity = clampScore(analysis?.clarity);
  const completeness = clampScore(analysis?.completeness);
  const suggestions = Array.isArray(analysis?.suggestions)
    ? analysis.suggestions.filter((s) => typeof s === "string" && s.trim()).slice(0, 5)
    : [];

  return {
    relevance,
    clarity,
    completeness,
    overall: Math.round((relevance + clarity + completeness) / 3),
    suggestions,
  };
}

const AI_UNAVAILABLE_WARNING =
  "AI scoring is unavailable right now. You can still submit your proposal.";

/**
 * @swagger
 * /api/ai-scorer/score-proposal:
 *   post:
 *     summary: Score a freelancer proposal for relevance, clarity and completeness
 *     tags: [AI Scorer]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - proposal
 *             properties:
 *               proposal:
 *                 type: string
 *               jobTitle:
 *                 type: string
 *               jobDescription:
 *                 type: string
 *               skills:
 *                 type: array
 *                 items:
 *                   type: string
 *     responses:
 *       200:
 *         description: Relevance, clarity and completeness scores (0–100). A `warning` is returned instead of an error when the AI is unavailable.
 *       400:
 *         description: Proposal text required
 */
router.post("/score-proposal", scoringRateLimiter, async (req, res) => {
  const { proposal, jobTitle, jobDescription, skills } = req.body || {};

  if (!proposal || typeof proposal !== "string" || proposal.trim().length === 0) {
    return res.status(400).json({ error: "Proposal text required" });
  }

  // AI scoring is best-effort: a missing key or a failed call is surfaced as a
  // warning so the applicant can still submit their proposal.
  if (!process.env.CLAUDE_API_KEY) {
    return res.json({ success: true, data: null, warning: AI_UNAVAILABLE_WARNING });
  }

  const context = [
    jobTitle ? `JOB TITLE: ${jobTitle}` : null,
    jobDescription ? `JOB DESCRIPTION:\n${jobDescription}` : null,
    Array.isArray(skills) && skills.length
      ? `REQUIRED SKILLS: ${skills.join(", ")}`
      : null,
  ]
    .filter(Boolean)
    .join("\n\n");

  const analysisPrompt = `You are an expert technical recruiter scoring a freelancer's proposal for a job on a blockchain marketplace.

${context}

PROPOSAL:
"${proposal}"

Score the proposal from 0 to 100 on each dimension:
- relevance: how well it addresses the job's requirements and required skills
- clarity: how clear, specific and well-organised the writing is
- completeness: whether it covers approach, relevant experience, timeline and deliverables

Respond ONLY with JSON in this format:
{
  "relevance": <number 0-100>,
  "clarity": <number 0-100>,
  "completeness": <number 0-100>,
  "suggestions": [<up to 3 short, specific improvement suggestions>]
}`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": process.env.CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 512,
        messages: [{ role: "user", content: analysisPrompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Claude API error: ${response.status} ${errText}`);
    }

    const result = await response.json();
    const content = result.content[0].text;
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const analysis = JSON.parse(jsonMatch ? jsonMatch[0] : content);

    res.json({ success: true, data: normalizeProposalScore(analysis) });
  } catch (error) {
    console.error("AI proposal scoring failed:", error.message);
    res.status(503).json({ score: null, reason: "AI scorer temporarily unavailable" });
  }
});

module.exports = router;
