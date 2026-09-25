// Auth session lifecycle (challenge, verify, refresh, logout) lives in
// client.ts because it reads/writes the module-private token state used by
// the shared axios interceptors. Re-exported here so callers can import
// auth endpoints from a resource-shaped path like the rest of lib/api/*.
export {
  fetchAuthChallenge,
  verifyAuthChallenge,
  refreshAccessToken,
  logout,
  setJwtToken,
  getJwtToken,
} from "./client";
