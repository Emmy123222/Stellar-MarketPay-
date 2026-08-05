import { api } from "./client";

export interface DisputeEvidence {
  id: string;
  uploaderAddress: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  ipfsCid: string;
  gatewayUrl: string;
  createdAt: string;
}

export interface DisputeDetail {
  job: {
    id: string;
    title: string;
    status: string;
    client_address: string;
    freelancer_address: string;
    created_at: string;
  };
  evidence: DisputeEvidence[];
}

export async function fetchDisputeDetail(
  jobId: string,
): Promise<DisputeDetail> {
  const { data } = await api.get<{ success: boolean; data: DisputeDetail }>(
    `/api/disputes/${jobId}`,
  );
  return data.data;
}

export async function uploadDisputeEvidence(
  jobId: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<DisputeEvidence> {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await api.post<{ success: boolean; data: DisputeEvidence }>(
    `/api/disputes/${jobId}/evidence`,
    formData,
    {
      headers: { "Content-Type": "multipart/form-data" },
      timeout: 60000,
      onUploadProgress: onProgress
        ? (e) => { if (e.total) onProgress(Math.round((e.loaded / e.total) * 100)); }
        : undefined,
    },
  );
  return data.data;
}

export interface SignedEvidenceUrl {
  url: string;
  expiresAt: string;
  fileName: string;
  mimeType: string;
}

/** Fetch a 15-minute signed proxy URL for a dispute evidence file (Issue #467). */
export async function fetchEvidenceSignedUrl(
  jobId: string,
  evidenceId: string,
): Promise<SignedEvidenceUrl> {
  const { data } = await api.get<{ success: boolean; data: SignedEvidenceUrl }>(
    `/api/disputes/${jobId}/evidence/${evidenceId}/url`,
  );
  return data.data;
}

/**
 * Fetch the IPFS CIDs of dispute evidence anchored on-chain for a job.
 * Backed by GET /api/disputes/:jobId/onchain-cids. Returns an empty array
 * if the contract has no entries yet or the network is unreachable.
 */
export async function fetchDisputeOnchainCids(jobId: string): Promise<string[]> {
  try {
    const { data } = await api.get<{ success: boolean; data: { cids: string[] } }>(
      `/api/disputes/${encodeURIComponent(jobId)}/onchain-cids`,
    );
    return Array.isArray(data?.data?.cids) ? data.data.cids : [];
  } catch {
    return [];
  }
}
