import { api } from "./client";

export interface JobDescriptionScore {
  score: number;
  scoreBreakdown?: {
    clarity?: number;
    completeness?: number;
    budgetReasonableness?: number;
    skillSpecificity?: number;
  };
  suggestions?: string[];
  missingInformation?: string[];
  strengths?: string[];
}

export async function scoreJobDescription(description: string): Promise<JobDescriptionScore> {
  const { data } = await api.post<{
    success: boolean;
    data: JobDescriptionScore;
  }>("/api/ai/score-job", { description });
  return data.data;
}

// ─── Real-time proposal scoring (Issue #1548) ───────────────────────────────

export interface ProposalScore {
  relevance: number;
  clarity: number;
  completeness: number;
  overall: number;
  suggestions: string[];
}

export interface ProposalScoreInput {
  proposal: string;
  jobTitle?: string;
  jobDescription?: string;
  skills?: string[];
}

export interface ProposalScoreResult {
  /** Null when the AI was unavailable — see `warning`. */
  data: ProposalScore | null;
  /** Set when scoring failed; the proposal can still be submitted. */
  warning: string | null;
}

/**
 * Score a proposal for relevance, clarity and completeness. Scoring is
 * best-effort: an unavailable AI returns `{ data: null, warning }` rather than
 * throwing, so it never blocks submission.
 */
export async function scoreProposal(
  input: ProposalScoreInput,
): Promise<ProposalScoreResult> {
  const { data } = await api.post<{
    success: boolean;
    data: ProposalScore | null;
    warning?: string;
  }>("/api/ai-scorer/score-proposal", input);
  return { data: data.data ?? null, warning: data.warning ?? null };
}