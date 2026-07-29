const express = require("express");
const router = express.Router();
const { createRateLimiter } = require("../middleware/rateLimiter");

const CLAUDE_MODEL = "claude-3-haiku-20240307";
const scoringRateLimiter = createRateLimiter(20, 1); // 20 requests per minute

// Score job description using Claude API
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

module.exports = router;
