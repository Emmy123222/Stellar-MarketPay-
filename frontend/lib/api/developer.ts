import { api } from "./client";

export interface DeveloperApiKey {
  id: string;
  label: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
  rotating_at: string | null;
  requests_today: number;
}

export interface CreatedDeveloperApiKey {
  id: string;
  label: string;
  keyPrefix: string;
  createdAt: string;
  apiKey: string;
}

export interface RotatedDeveloperApiKey {
  id: string;
  label: string;
  createdAt: string;
  rotatingAt: string;
  apiKey: string;
}

function buildApiKeyHeaders(apiKey: string) {
  return { headers: { "X-API-Key": apiKey } };
}

export async function fetchDeveloperApiKeys(): Promise<DeveloperApiKey[]> {
  const { data } = await api.get<{ success: boolean; data: DeveloperApiKey[] }>(
    "/api/developer/keys",
  );
  return data.data;
}

export async function createDeveloperApiKey(
  label?: string,
): Promise<CreatedDeveloperApiKey> {
  const { data } = await api.post<{ success: boolean; data: CreatedDeveloperApiKey }>(
    "/api/developer/keys",
    { label },
  );
  return data.data;
}

export async function revokeDeveloperApiKey(id: string): Promise<void> {
  await api.delete(`/api/developer/keys/${id}`);
}

export async function rotateDeveloperApiKey(id: string): Promise<RotatedDeveloperApiKey> {
  const { data } = await api.post<{ success: boolean; data: RotatedDeveloperApiKey }>(
    `/api/developer/keys/${id}/rotate`,
  );
  return data.data;
}

// ─── Public API (consumed by third parties via API key) ───────────────────

export async function fetchPublicJobs(apiKey: string, limit = 20) {
  const { data } = await api.get<{ success: boolean; data: any[] }>(
    "/api/public/jobs",
    {
      params: { limit },
      ...buildApiKeyHeaders(apiKey),
    },
  );
  return data.data;
}

export async function fetchPublicJob(apiKey: string, id: string) {
  const { data } = await api.get<{ success: boolean; data: any }>(
    `/api/public/jobs/${encodeURIComponent(id)}`,
    buildApiKeyHeaders(apiKey),
  );
  return data.data;
}

export async function fetchPublicFreelancerProfile(
  apiKey: string,
  publicKey: string,
) {
  const { data } = await api.get<{ success: boolean; data: any }>(
    `/api/public/freelancers/${encodeURIComponent(publicKey)}`,
    buildApiKeyHeaders(apiKey),
  );
  return data.data;
}
