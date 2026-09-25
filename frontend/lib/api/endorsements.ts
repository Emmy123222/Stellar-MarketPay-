import { api } from "./client";

export interface SkillEndorsementData {
  skill: string;
  count: number;
  endorsers: string[];
}

export async function fetchSkillEndorsements(
  publicKey: string,
): Promise<SkillEndorsementData[]> {
  const { data } = await api.get<{
    success: boolean;
    data: SkillEndorsementData[];
  }>(`/api/profiles/${encodeURIComponent(publicKey)}/endorsements`);
  return data.data;
}

export async function endorseSkill(
  publicKey: string,
  skill: string,
): Promise<void> {
  await api.post(`/api/profiles/${encodeURIComponent(publicKey)}/endorse`, {
    skill,
  });
}
