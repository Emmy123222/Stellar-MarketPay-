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

/** Generate a collision-resistant id for a new co-writing session. */
function generateSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  // WebCrypto is available on every supported runtime; derive a random id from
  // getRandomValues rather than Math.random(), which CodeQL flags as insecure.
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `scope-${hex}`;
}

export interface CreatedScopeSession {
  sessionId: string;
  sharePath: string;
  expiresAt: string;
}

/**
 * Create a new co-writing session for a proposal and return the shareable path.
 */
export async function createScopeSession(input: {
  jobId: string;
  createdBy: string;
  content?: string;
}): Promise<CreatedScopeSession> {
  const sessionId = generateSessionId();
  const session = await saveScopeSession(sessionId, {
    content: input.content ?? "",
  });
  return {
    sessionId,
    sharePath: `/scope/${sessionId}`,
    expiresAt: session.expires_at,
  };
}

/**
 * Finalize (lock) a co-writing session once the proposal is submitted.
 */
export async function finalizeScopeSession(
  sessionId: string,
  input: { content: string; payload?: Record<string, unknown> },
): Promise<{ sessionId: string; finalizedHash: string | null; expiresAt: string }> {
  const session = await saveScopeSession(sessionId, {
    content: input.content,
    finalized: true,
    finalizedPayload: input.payload ?? null,
  });
  return {
    sessionId,
    finalizedHash: session.finalized_hash,
    expiresAt: session.expires_at,
  };
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
