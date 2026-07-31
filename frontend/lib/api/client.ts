import axios from "axios";
import { optionalClientEnv } from "../env";

// ─── Structured error code → user-facing string map (#461) ───────────────────
export const API_ERROR_MESSAGES: Record<string, string> = {
  INTERNAL_SERVER_ERROR:      "Something went wrong. Please try again.",
  VALIDATION_ERROR:           "Invalid input. Please check your data.",
  NOT_FOUND:                  "The requested resource was not found.",
  UNAUTHORIZED:               "You need to sign in to do that.",
  FORBIDDEN:                  "You don't have permission to do that.",
  RATE_LIMITED:               "Too many requests. Please slow down.",
  BAD_REQUEST:                "Bad request. Please check your input.",
  INVALID_TOKEN:              "Your session is invalid. Please sign in again.",
  TOKEN_EXPIRED:              "Your session has expired. Please sign in again.",
  ADDRESS_MISMATCH:           "Wallet address does not match.",
  PROFILE_NOT_FOUND:          "Profile not found.",
  PROFILE_DELETED:            "This profile has been deleted.",
  ENCRYPTION_KEY_INVALID:     "Invalid encryption key format.",
  JOB_NOT_FOUND:              "Job not found.",
  JOB_ALREADY_EXPIRED:        "This job has already expired.",
  JOB_NOT_OPEN:               "This job is no longer accepting applications.",
  APPLICATION_NOT_FOUND:      "Application not found.",
  ALREADY_APPLIED:            "You have already applied to this job.",
  ESCROW_ALREADY_EXISTS:      "An escrow already exists for this job.",
  ESCROW_NOT_FOUND:           "Escrow not found.",
  INSUFFICIENT_BALANCE:       "Insufficient balance for this operation.",
  ESCROW_ALREADY_RELEASED:    "Escrow has already been released.",
  ESCROW_TIMEOUT_NOT_REACHED: "The escrow timeout period has not been reached yet.",
  DISPUTE_NOT_FOUND:          "Dispute not found.",
  DISPUTE_ALREADY_EXISTS:     "A dispute already exists for this job.",
  EVIDENCE_LIMIT_REACHED:     "You have reached the maximum number of evidence files.",
  EVIDENCE_NOT_FOUND:         "Evidence file not found.",
  MESSAGE_NOT_FOUND:          "Message not found.",
  MESSAGE_TOO_LONG:           "Message exceeds the maximum length.",
  NOT_JOB_PARTICIPANT:        "You are not a participant in this job.",
  FILE_TOO_LARGE:             "File is too large.",
  FILE_TYPE_NOT_ALLOWED:      "This file type is not allowed.",
  PORTFOLIO_LIMIT_REACHED:    "You have reached the maximum number of portfolio items.",
  IPFS_UPLOAD_FAILED:         "File upload failed. Please try again.",
  PINATA_NOT_CONFIGURED:      "File storage is temporarily unavailable.",
  SIGNED_URL_EXPIRED:         "This download link has expired. Please request a new one.",
  SIGNED_URL_INVALID:         "This download link is invalid.",
  JSONB_DEPTH_EXCEEDED:       "Input data is too deeply nested.",
  JSONB_SCHEMA_INVALID:       "Input data does not match the expected format.",
};

/**
 * Extract a user-facing message from an API error response.
 * Handles both the new structured { error: { code, message } } shape
 * and the legacy { error: "string" } shape.
 */
export function getApiErrorMessage(error: unknown, fallback = "An unexpected error occurred."): string {
  if (!axios.isAxiosError(error)) return fallback;
  const data = error.response?.data;
  if (!data) return fallback;
  // Structured shape
  if (data.error && typeof data.error === "object" && data.error.code) {
    return API_ERROR_MESSAGES[data.error.code] ?? data.error.message ?? fallback;
  }
  // Legacy shape
  if (typeof data.error === "string") return data.error;
  return fallback;
}

export const api = axios.create({
  baseURL: optionalClientEnv("NEXT_PUBLIC_API_URL", "http://localhost:4000"),
  headers: { "Content-Type": "application/json" },
  withCredentials: true,
  timeout: 10000,
});

let jwtToken: string | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let refreshPromise: Promise<string | null> | null = null;

// ── Request tracing (Issue #453) ────────────────────────────────────────────
const REQUEST_ID_HEADER = "X-Request-ID";
const IS_DEV = process.env.NODE_ENV !== "production";

/** Generate a UUID v4 using crypto.randomUUID when available, with RFC4122 fallback. */
function generateRequestId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // fall through to manual generator
  }
  // Fallback for environments without crypto.randomUUID (older browsers / SSR):
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  }
  // Per RFC 4122 §4.4
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex: string[] = [];
  for (let i = 0; i < bytes.length; i += 1) {
    hex.push(bytes[i].toString(16).padStart(2, "0"));
  }
  return (
    `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex[6]}-${hex[7]}-` +
    `${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`
  );
}

/**
 * Capture the server-issued X-Request-ID from a successful response so
 * components can surface it in error toasts / support tickets. Returns
 * `null` when the header is absent (older backends).
 */
export function getResponseRequestId(error: unknown): string | null {
  if (!axios.isAxiosError(error)) return null;
  return error.response?.headers?.[REQUEST_ID_HEADER.toLowerCase()] ?? null;
}

// ── CSRF (Issue #451) ────────────────────────────────────────────────────────
const CSRF_HEADER = "X-CSRF-Token";
const CSRF_TOKEN_URL = "/api/auth/csrf-token";
const MUTATING_METHODS = new Set(["post", "put", "patch", "delete"]);

let csrfToken: string | null = null;
let csrfFetchPromise: Promise<string | null> | null = null;

async function fetchCsrfToken(): Promise<string | null> {
  if (csrfFetchPromise) return csrfFetchPromise;
  // /api/auth/csrf-token is exempt from CSRF (it's a safe-method bootstrap
  // endpoint), so we do NOT set the X-CSRF-Token header on this request —
  // doing so would risk an infinite loop if the server refused it.
  csrfFetchPromise = api
    .get<{ csrfToken: string }>(CSRF_TOKEN_URL, { skipCsrf: true } as any)
    .then(({ data }) => {
      csrfToken = data.csrfToken;
      return csrfToken;
    })
    .catch(() => {
      csrfToken = null;
      return null;
    })
    .finally(() => {
      csrfFetchPromise = null;
    });
  return csrfFetchPromise;
}

export function clearCsrfToken() {
  csrfToken = null;
}

/**
 * Invalidate the cached token and mint a fresh one. Used by the response
 * interceptor when a mutation rejects with 403 (cookie mismatch) and by
 * `verifyAuthChallenge` / `refreshAccessToken` when the server returns a
 * new token in-band. Deduplicates concurrent callers to avoid racing
 * parallel mutations against different cookie versions.
 */
async function refreshCsrfToken(): Promise<string | null> {
  clearCsrfToken();
  return fetchCsrfToken();
}

const TOKEN_REFRESH_BUFFER_MS = 60 * 1000;

function getJwtExpiryMs(token: string) {
  try {
    const encodedPayload = token.split(".")[1] || "";
    const base64Payload = encodedPayload
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(encodedPayload.length / 4) * 4, "=");
    const payload = JSON.parse(atob(base64Payload));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function clearRefreshTimer() {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

function scheduleTokenRefresh(token: string) {
  if (typeof window === "undefined") return;

  const expiryMs = getJwtExpiryMs(token);
  if (!expiryMs) return;

  const delayMs = Math.max(expiryMs - Date.now() - TOKEN_REFRESH_BUFFER_MS, 0);
  refreshTimer = setTimeout(() => {
    refreshAccessToken().catch(() => setJwtToken(null));
  }, delayMs);
}

function shouldRefreshToken() {
  if (!jwtToken) return false;
  const expiryMs = getJwtExpiryMs(jwtToken);
  return Boolean(expiryMs && expiryMs - Date.now() <= TOKEN_REFRESH_BUFFER_MS);
}

export function setJwtToken(token: string | null) {
  jwtToken = token;
  clearRefreshTimer();
  if (token) scheduleTokenRefresh(token);
}

export function getJwtToken() {
  return jwtToken;
}

api.interceptors.request.use(async (config: any) => {
  if (!config.skipAuthRefresh && shouldRefreshToken()) {
    await refreshAccessToken();
  }

  // Issue #453: attach a request id so server logs can be correlated with
  // client-side debugging. Generated fresh per request unless caller
  // supplied one via `config.requestId` (useful for tracing flows).
  if (!config.skipTracing && !config.headers?.[REQUEST_ID_HEADER]) {
    config.headers = config.headers || {};
    config.headers[REQUEST_ID_HEADER] = config.requestId || generateRequestId();
  }

  // Attach the CSRF token to every mutating request so the backend's
  // double-submit cookie check passes (Issue #451).
  if (!config.skipCsrf && MUTATING_METHODS.has((config.method || "").toLowerCase())) {
    if (!csrfToken) await fetchCsrfToken();
    if (csrfToken) {
      config.headers = config.headers || {};
      config.headers[CSRF_HEADER] = csrfToken;
    }
  }
  return config;
});

api.interceptors.response.use(
  (response) => {
    // Issue #453 dev-mode logging: print the correlation id so a developer
    // can paste it straight into backend log search.
    if (IS_DEV && typeof console !== "undefined") {
      const serverId =
        response.headers?.[REQUEST_ID_HEADER.toLowerCase()] ||
        response.config?.headers?.[REQUEST_ID_HEADER];
      if (serverId) {
        // eslint-disable-next-line no-console
        console.debug(`[api] ${response.config?.method?.toUpperCase()} ${response.config?.url} → ${response.status} requestId=${serverId}`);
      }
    }
    return response;
  },
  async (error) => {
    // Capture the request id on errors too so error toasts can show it.
    if (IS_DEV && typeof console !== "undefined" && axios.isAxiosError(error)) {
      const serverId = error.response?.headers?.[REQUEST_ID_HEADER.toLowerCase()];
      const clientId = error.config?.headers?.[REQUEST_ID_HEADER];
      // eslint-disable-next-line no-console
      console.warn(
        `[api] ${error.config?.method?.toUpperCase()} ${error.config?.url} → ${error.response?.status || "NETWORK"} ` +
          `requestId=${serverId || clientId || "?"}`,
      );
    }

    const originalRequest = error.config || {};
    // 401 → refresh the JWT once and replay (existing behavior).
    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !originalRequest.skipAuthRefresh
    ) {
      originalRequest._retry = true;
      const token = await refreshAccessToken();
      if (token) {
        return api(originalRequest);
      }
    }
    // 403 on a mutating request → CSRF token may have been rotated or the
    // cookie was replaced by another tab. Mint a fresh pair and retry once.
    // We route through refreshCsrfToken() so concurrent 403s share a single
    // in-flight mint instead of all racing the server independently.
    if (
      error.response?.status === 403 &&
      !originalRequest._csrfRetry &&
      !originalRequest.skipCsrf &&
      MUTATING_METHODS.has((originalRequest.method || "").toLowerCase())
    ) {
      originalRequest._csrfRetry = true;
      const fresh = await refreshCsrfToken();
      if (fresh) {
        originalRequest.headers = originalRequest.headers || {};
        originalRequest.headers[CSRF_HEADER] = fresh;
        return api(originalRequest);
      }
    }
    throw error;
  },
);

// ─── Session (auth token / CSRF lifecycle) ─────────────────────────────────
// Kept here rather than in auth.ts because these functions read and write
// the module-private jwtToken/csrfToken state used by the interceptors above.

export async function fetchAuthChallenge(publicKey: string) {
  const { data } = await api.get<{ transaction: string }>(
    `/api/auth?account=${publicKey}`,
  );
  return data.transaction;
}

export async function verifyAuthChallenge(transaction: string) {
  const { data } = await api.post<{ success: boolean; token: string; csrfToken?: string }>(
    "/api/auth",
    { transaction },
  );
  // The login response may ship a fresh CSRF token alongside the JWT so we
  // can skip the post-login /api/auth/csrf-token round-trip (#451).
  if (data.csrfToken) csrfToken = data.csrfToken;
  return data.token;
}

export async function refreshAccessToken() {
  if (!refreshPromise) {
    refreshPromise = api
      .post<{ success: boolean; token: string; csrfToken?: string }>(
        "/api/auth/refresh",
        undefined,
        { skipAuthRefresh: true } as any,
      )
      .then(({ data }) => {
        setJwtToken(data.token);
        // A token rotation also rotates the CSRF pair; pick up the new one
        // so the next mutation doesn't hit a stale-cookie 403.
        if (data.csrfToken) csrfToken = data.csrfToken;
        return data.token;
      })
      .catch((error) => {
        setJwtToken(null);
        throw error;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }

  return refreshPromise;
}

export async function logout() {
  try {
    await api.post("/api/auth/logout", undefined, { skipAuthRefresh: true } as any);
  } finally {
    setJwtToken(null);
    clearCsrfToken();
  }
}
