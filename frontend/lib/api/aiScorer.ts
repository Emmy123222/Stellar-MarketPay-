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