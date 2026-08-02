// Barrel re-export so existing `import { ... } from "@/lib/api"` call sites
// keep working unchanged while the implementation lives in per-resource
// files under lib/api/*. New code should prefer importing directly from
// the specific resource module (e.g. `@/lib/api/jobs`).
// Note: auth.ts re-exports session functions that already live in client.ts
// (fetchAuthChallenge, verifyAuthChallenge, refreshAccessToken, logout,
// setJwtToken, getJwtToken) — it's not re-starred here to avoid ambiguous
// duplicate exports. Import it directly (`@/lib/api/auth`) if preferred.
export * from "./client";
export * from "./passkeys";
export * from "./categories";
export * from "./skills";
export * from "./jobs";
export * from "./insights";
export * from "./applications";
export * from "./profiles";
export * from "./endorsements";
export * from "./escrow";
export * from "./proposalTemplates";
export * from "./xlmPrice";
export * from "./timeEntries";
export * from "./ratings";
export * from "./assessments";
export * from "./admin";
export * from "./faucet";
export * from "./tokens";
export * from "./turrets";
export * from "./messages";
export * from "./notifications";
export * from "./disputes";
export * from "./developer";
export * from "./certificates";
export * from "./nft";
export * from "./referrals";
export * from "./savedSearches";
export * from "./invitations";
export * from "./dao";
export * from "./health";
export * from "./scope";
export * from "./priceAlerts";
