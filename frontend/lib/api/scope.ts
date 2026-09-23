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

export interface CreatedScopeSession {
  sessionId: string;
  /** Path (relative to the frontend origin) that collaborators open to co-write. */
  sharePath: string;
  expiresAt: string;
}

/**
 * Create a new collaborative scope session for co-writing a proposal
 * (POST /api/scope). The server generates the session id.
 */
export async function createScopeSession(payload: {
  jobId?: string;
  createdBy?: string;
  content?: string;
}): Promise<CreatedScopeSession> {
  const { data } = await api.post<{
    success: boolean;
    sessionId: string;
    sharePath: string;
    expiresAt: string;
  }>("/api/scope", payload);
  return {
    sessionId: data.sessionId,
    sharePath: data.sharePath,
    expiresAt: data.expiresAt,
  };
}

/**
 * Lock a scope session when the proposal is submitted
 * (POST /api/scope/:sessionId/finalize). After this call the session is
 * read-only for every collaborator, including over WebSocket.
 */
export async function finalizeScopeSession(
  sessionId: string,
  payload: { content?: string; finalizedHash?: string; payload?: Record<string, unknown> } = {},
): Promise<{ sessionId: string; finalizedHash: string; expiresAt: string }> {
  const { data } = await api.post<{
    success: boolean;
    sessionId: string;
    finalizedHash: string;
    expiresAt: string;
  }>(`/api/scope/${encodeURIComponent(sessionId)}/finalize`, payload);
  return {
    sessionId: data.sessionId,
    finalizedHash: data.finalizedHash,
    expiresAt: data.expiresAt,
  };
}
