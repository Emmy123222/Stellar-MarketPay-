import { api } from "./client";

export async function fetchEscrow(jobId: string) {
  const { data } = await api.get<{ success: boolean; data: any }>(
    `/api/escrow/${jobId}`,
  );
  return data.data;
}

export async function releaseEscrow(
  jobId: string,
  clientAddress: string,
  contractTxHash?: string,
  releaseCurrency?: "XLM" | "USDC",
) {
  const { data } = await api.post(`/api/escrow/${jobId}/release`, {
    clientAddress,
    ...(contractTxHash ? { contractTxHash } : {}),
    ...(releaseCurrency ? { releaseCurrency } : {}),
  });
  return data.data;
}

export async function releaseMilestone(
  jobId: string,
  clientAddress: string,
  milestoneIndex: number,
  contractTxHash?: string,
) {
  const { data } = await api.post(`/api/escrow/${jobId}/release-milestone`, {
    clientAddress,
    milestoneIndex,
    ...(contractTxHash ? { contractTxHash } : {}),
  });
  return data.data;
}

export async function rejectMilestone(
  jobId: string,
  clientAddress: string,
  milestoneIndex: number,
  contractTxHash?: string,
) {
  const { data } = await api.post(`/api/escrow/${jobId}/reject-milestone`, {
    clientAddress,
    milestoneIndex,
    ...(contractTxHash ? { contractTxHash } : {}),
  });
  return data.data;
}

export async function disputeMilestone(
  jobId: string,
  raisedBy: string,
  milestoneIndex: number,
) {
  const { data } = await api.post(`/api/escrow/${jobId}/dispute-milestone`, {
    raisedBy,
    milestoneIndex,
  });
  return data.data;
}

export async function timeoutRefund(
  jobId: string,
  clientAddress: string,
  contractTxHash?: string,
) {
  const { data } = await api.post(`/api/escrow/${jobId}/timeout-refund`, {
    clientAddress,
    ...(contractTxHash ? { contractTxHash } : {}),
  });
  return data.data;
}
