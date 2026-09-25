import { api } from "./client";
import type { AssessmentQuestion, SkillBadge } from "@/utils/types";

export async function fetchAssessment(skill: string) {
  const { data } = await api.get<{
    success: boolean;
    data: {
      label: string;
      skill: string;
      questions: AssessmentQuestion[];
      durationSeconds: number;
      canRetake: boolean;
      retakeAvailableAt?: string;
      lastAttempt?: { score: number; passed: boolean };
    };
  }>(`/api/assessments/${encodeURIComponent(skill)}`);
  return data.data;
}

export async function submitAssessment(
  skill: string,
  answers: Record<number, number>,
) {
  const { data } = await api.post<{
    success: boolean;
    data: {
      score: number;
      passed: boolean;
      correct: number;
      total: number;
    };
  }>(`/api/assessments/${encodeURIComponent(skill)}/submit`, { answers });
  return data.data;
}

export async function fetchSkillBadges(
  publicKey: string,
): Promise<SkillBadge[]> {
  const { data } = await api.get<{
    success: boolean;
    data: SkillBadge[];
  }>(`/api/assessments/results/${encodeURIComponent(publicKey)}`);
  return data.data;
}
