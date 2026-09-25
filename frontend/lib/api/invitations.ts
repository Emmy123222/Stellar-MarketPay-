import { api } from "./client";
import type { Application, JobInvitation } from "@/utils/types";

export type { JobInvitation };

/**
 * Fetch all pending invitations for the authenticated freelancer.
 */
export async function fetchMyInvitations(): Promise<JobInvitation[]> {
  const { data } = await api.get<{ success: boolean; data: JobInvitation[] }>(
    "/api/invitations",
  );
  return data.data;
}

/**
 * Decline a job invitation.
 */
export async function declineInvitation(invitationId: string): Promise<void> {
  await api.patch(`/api/invitations/${invitationId}/decline`);
}

/**
 * Accept a job invitation (auto-creates an application).
 */
export async function acceptInvitation(
  invitationId: string,
  proposal: string,
  bidAmount: string,
): Promise<Application> {
  const { data } = await api.post<{ success: boolean; data: Application }>(
    `/api/invitations/${invitationId}/accept`,
    { proposal, bidAmount },
  );
  return data.data;
}
