import { api } from "./client";

export interface CursorPosition {
  start: number;
  end: number;
  updatedAt?: number;
}

export type CursorMap = Record<string, CursorPosition>;

export interface ScopeSession {
  session_id: string;
  content: string;
  cursors: CursorMap;
  finalized: boolean;
  finalized_hash: string | null;
  finalized_payload: Record<string, any> | null;
  expires_at: string;
  updated_at: string;
  version?: number;
}

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

/** Retrieve an active scope session (GET /api/scope/:sessionId). */
export async function getScopeSession(
  sessionId: string,
): Promise<ScopeSession> {
  const { data } = await api.get<{
    success: boolean;
    session: ScopeSession;
  }>(`/api/scope/${encodeURIComponent(sessionId)}`);
  return data.session;
}

/** Save/patch a scope session (POST/PUT /api/scope/:sessionId). */
export async function saveScopeSession(
  sessionId: string,
  payload: {
    content?: string;
    cursors?: CursorMap;
    finalized?: boolean;
    finalizedPayload?: Record<string, any> | null;
    finalizedHash?: string | null;
  },
): Promise<ScopeSession> {
  const { data } = await api.post<{
    success: boolean;
    session: ScopeSession;
  }>(`/api/scope/${encodeURIComponent(sessionId)}`, payload);
  return data.session;
}
