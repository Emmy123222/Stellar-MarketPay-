import { api } from "./client";

export interface CertificateData {
  id: string;
  publicKey: string;
  displayName: string | null;
  skill: string;
  score: number;
  certificateHash: string;
  ipfsCid: string | null;
  txHash: string | null;
  issuedAt: string;
  verifyUrl: string;
}

export async function fetchCertificate(id: string): Promise<CertificateData> {
  const { data } = await api.get<{ success: boolean; data: CertificateData }>(
    `/api/certificates/${id}`,
  );
  return data.data;
}

export async function fetchUserCertificates(
  publicKey: string,
): Promise<CertificateData[]> {
  const { data } = await api.get<{
    success: boolean;
    data: CertificateData[];
  }>(`/api/certificates/user/${encodeURIComponent(publicKey)}`);
  return data.data;
}
