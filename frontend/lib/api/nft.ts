import { api } from "./client";

export interface NftCertificateData {
  id: string;
  jobId: string;
  jobTitle: string;
  freelancerAddress: string;
  clientAddress: string;
  freelancerName: string | null;
  clientName: string | null;
  amountXlm: string | null;
  completionDate: string | null;
  txHash: string | null;
  contractId: string | null;
  createdAt: string;
  verifyUrl: string | null;
}

export interface MintCertificateParams {
  jobId: string;
  clientAddress: string;
  contractTxHash: string;
}

export async function mintCompletionCertificate(
  params: MintCertificateParams,
): Promise<NftCertificateData> {
  const { data } = await api.post<{ success: boolean; data: NftCertificateData }>(
    "/api/nft/mint-completion-certificate",
    params,
  );
  return data.data;
}

export async function fetchNftCertificateByJob(
  jobId: string,
): Promise<NftCertificateData> {
  const { data } = await api.get<{ success: boolean; data: NftCertificateData }>(
    `/api/nft/job/${encodeURIComponent(jobId)}`,
  );
  return data.data;
}

export async function fetchFreelancerNftCertificates(
  publicKey: string,
): Promise<NftCertificateData[]> {
  const { data } = await api.get<{
    success: boolean;
    data: NftCertificateData[];
  }>(`/api/nft/freelancer/${encodeURIComponent(publicKey)}`);
  return data.data;
}
