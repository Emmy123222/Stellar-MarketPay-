/**
 * src/services/aiService.js
 * Integration with Claude API for scoring proposals.
 */
"use strict";

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;
const CLAUDE_MODEL = "claude-3-haiku-20240307";

/**
 * Scores job proposals using Claude API.
 * 
 * @param {Object} job - Job description and context.
 * @param {Array} applications - List of applications with proposals.
 * @returns {Promise<Array>} List of scores and reasonings.
 */
async function scoreProposals(job, applications) {
  if (!CLAUDE_API_KEY) {
    throw new Error("CLAUDE_API_KEY is not configured on the server.");
  }

  if (!applications || applications.length === 0) {
    return [];
  }

  const prompt = `
You are an expert technical recruiter evaluating freelancer proposals for a specific job on a blockchain-based marketplace.

JOB TITLE: ${job.title}
JOB DESCRIPTION:
${job.description}

REQUIRED SKILLS: ${job.skills.join(", ")}

PROPOSALS TO EVALUATE:
${applications.map((app, i) => `
--- PROPOSAL #${i} (ID: ${app.id}) ---
FREELANCER: ${app.freelancer_address}
PROPOSAL TEXT:
${app.proposal}
BID AMOUNT: ${app.bid_amount}
`).join("\n")}

For each proposal, provide a quality score from 1 to 10 and a brief reasoning (max 2 sentences).
Respond ONLY with a JSON array of objects, one for each proposal in the same order, with fields:
- id: (the proposal ID)
- score: (integer 1-10)
- reasoning: (string)

JSON Output:
`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 1024,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Claude API error: ${response.status} ${errText}`);
    }

    const result = await response.json();
    const content = result.content[0].text;
    
    // Parse JSON from response
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error("Could not parse AI response as JSON.");
    }

    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.error("AI Scoring Error:", error);
    throw error;
  }
}

module.exports = {
  scoreProposals,
};
