import { api } from "./client";

/** Extend a scope-drafting session by 24 hours (POST /api/scope/:sessionId/renew). */
export async function renewScopeSession(
  sessionId: string,
): Promise<{ sessionId: string; expiresAt: string }> {
  const { data } = await api.post<{
    success: boolean;
    sessionId: string;
    expiresAt: string;
  }>(`/api/scope/${encodeURIComponent(sessionId)}/renew`);
  return { sessionId: data.sessionId, expiresAt: data.expiresAt };
}
