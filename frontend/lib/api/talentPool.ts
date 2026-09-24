import { api } from "./client";
import type { JobInvitation } from "@/utils/types";

export interface TalentPoolEntry {
  id: string;
  freelancer_address: string;
  note: string | null;
  created_at: string;
  display_name: string | null;
  skills: string[];
  rating: number | null;
  completed_jobs: number;
  availability: { status: string } | null;
  tier: string | null;
}

export async function fetchTalentPool(): Promise<TalentPoolEntry[]> {
  const { data } = await api.get<{ success: boolean; data: TalentPoolEntry[] }>(
    "/api/talent-pools",
  );
  return data.data;
}

export async function addToTalentPool(freelancerId: string, note?: string): Promise<TalentPoolEntry> {
  const { data } = await api.post<{ success: boolean; data: TalentPoolEntry }>(
    "/api/talent-pools",
    { freelancerId, note },
  );
  return data.data;
}

export async function removeFromTalentPool(entryId: string): Promise<void> {
  await api.delete(`/api/talent-pools/${entryId}`);
}

export async function inviteFromTalentPool(entryId: string, jobId: string): Promise<JobInvitation> {
  const { data } = await api.post<{ success: boolean; data: JobInvitation }>(
    `/api/talent-pools/${entryId}/invite`,
    { jobId },
  );
  return data.data;
}
