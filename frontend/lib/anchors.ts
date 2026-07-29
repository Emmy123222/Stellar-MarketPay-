/**
 * lib/anchors.ts
 * Stellar anchor integration: SEP-0001 (TOML discovery), SEP-0010 (auth),
 * SEP-0024 (interactive deposit/withdraw), SEP-0031 (cross-border send).
 *
 * Powers the "Buy XLM" (Issue #220) and "Withdraw to Bank" (Issue #231) flows.
 */

import { signTransactionWithWallet } from "./wallet";

const NETWORK = (process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet") as "testnet" | "mainnet";

/** Anchor home domain. The Stellar reference anchor is used on testnet. */
export const ANCHOR_HOME_DOMAIN =
  process.env.NEXT_PUBLIC_ANCHOR_HOME_DOMAIN ||
  (NETWORK === "mainnet" ? "" : "testanchor.stellar.org");

export interface AnchorEndpoints {
  homeDomain: string;
  webAuthEndpoint: string;
  transferServerSep24: string | null;
  directPaymentServer: string | null; // SEP-0031
  signingKey: string;
  currencies: Array<{ code: string; issuer?: string }>;
}

/** Cache TOML lookups for the lifetime of the page. */
const tomlCache = new Map<string, AnchorEndpoints>();

/**
 * Fetch the anchor's stellar.toml and parse the endpoints we care about.
 * Uses a tiny line-based parser — enough for the keys we need without pulling
 * in a TOML library.
 */
export async function fetchAnchorEndpoints(homeDomain = ANCHOR_HOME_DOMAIN): Promise<AnchorEndpoints> {
  if (!homeDomain) throw new Error("No anchor configured. Set NEXT_PUBLIC_ANCHOR_HOME_DOMAIN.");
  const cached = tomlCache.get(homeDomain);
  if (cached) return cached;

  const url = `https://${homeDomain}/.well-known/stellar.toml`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not fetch anchor TOML (${response.status}).`);
  const text = await response.text();

  const single = (key: string): string | null => {
    const match = text.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, "m"));
    return match ? match[1] : null;
  };

  const currencies: AnchorEndpoints["currencies"] = [];
  const currencyBlockRegex = /\[\[CURRENCIES\]\]([\s\S]*?)(?=\n\[|$)/g;
  let block: RegExpExecArray | null;
  while ((block = currencyBlockRegex.exec(text)) !== null) {
    const code = block[1].match(/code\s*=\s*"([^"]+)"/)?.[1];
    const issuer = block[1].match(/issuer\s*=\s*"([^"]+)"/)?.[1];
    if (code) currencies.push({ code, issuer });
  }

  const endpoints: AnchorEndpoints = {
    homeDomain,
    webAuthEndpoint: single("WEB_AUTH_ENDPOINT") || "",
    transferServerSep24: single("TRANSFER_SERVER_SEP0024") || single("TRANSFER_SERVER"),
    directPaymentServer: single("DIRECT_PAYMENT_SERVER"),
    signingKey: single("SIGNING_KEY") || "",
    currencies,
  };

  if (!endpoints.webAuthEndpoint) throw new Error("Anchor TOML is missing WEB_AUTH_ENDPOINT.");
  tomlCache.set(homeDomain, endpoints);
  return endpoints;
}

// ─── SEP-0010 — Web Authentication ───────────────────────────────────────────

const tokenCache = new Map<string, { jwt: string; expiresAt: number }>();

/**
 * Performs the SEP-0010 challenge flow against an anchor and returns a JWT.
 * Cached for ~50 minutes per (homeDomain, account) pair to avoid repeated prompts.
 */
export async function getAnchorJwt(homeDomain: string, account: string): Promise<string> {
  const cacheKey = `${homeDomain}:${account}`;
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.jwt;

  const endpoints = await fetchAnchorEndpoints(homeDomain);
  const challengeUrl = `${endpoints.webAuthEndpoint}?account=${encodeURIComponent(account)}&home_domain=${encodeURIComponent(homeDomain)}`;

  const challengeResponse = await fetch(challengeUrl);
  if (!challengeResponse.ok) throw new Error(`Anchor auth challenge failed (${challengeResponse.status}).`);
  const { transaction } = (await challengeResponse.json()) as { transaction: string };
  if (!transaction) throw new Error("Anchor did not return a challenge transaction.");

  const { signedXDR, error: signError } = await signTransactionWithWallet(transaction);
  if (signError || !signedXDR) throw new Error(signError || "Anchor sign-in was cancelled.");

  const verifyResponse = await fetch(endpoints.webAuthEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transaction: signedXDR }),
  });
  if (!verifyResponse.ok) throw new Error(`Anchor JWT exchange failed (${verifyResponse.status}).`);
  const { token } = (await verifyResponse.json()) as { token: string };
  if (!token) throw new Error("Anchor did not return a JWT.");

  tokenCache.set(cacheKey, { jwt: token, expiresAt: Date.now() + 50 * 60 * 1000 });
  return token;
}

// ─── SEP-0024 — Interactive Deposit / Withdraw ───────────────────────────────

export interface InteractiveTxResponse {
  type: string;
  url: string;
  id: string;
}

export interface AnchorTransactionRecord {
  id: string;
  kind: "deposit" | "withdrawal";
  status: string;
  status_eta?: number;
  amount_in?: string;
  amount_out?: string;
  amount_fee?: string;
  started_at?: string;
  completed_at?: string;
  stellar_transaction_id?: string;
  external_transaction_id?: string;
  message?: string;
  more_info_url?: string;
}

async function startInteractive(
  flow: "deposit" | "withdraw",
  params: { homeDomain: string; account: string; assetCode: string; lang?: string }
): Promise<InteractiveTxResponse> {
  const endpoints = await fetchAnchorEndpoints(params.homeDomain);
  if (!endpoints.transferServerSep24) {
    throw new Error("This anchor does not support SEP-0024 interactive transfers.");
  }
  const jwt = await getAnchorJwt(params.homeDomain, params.account);

  const formBody = new URLSearchParams({
    asset_code: params.assetCode,
    account: params.account,
    lang: params.lang || "en",
  }).toString();

  const response = await fetch(`${endpoints.transferServerSep24}/transactions/${flow}/interactive`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formBody,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Anchor ${flow} request failed (${response.status}): ${detail.slice(0, 200)}`);
  }
  return (await response.json()) as InteractiveTxResponse;
}

export function startInteractiveDeposit(params: {
  homeDomain?: string;
  account: string;
  assetCode: string;
  lang?: string;
}) {
  return startInteractive("deposit", { ...params, homeDomain: params.homeDomain || ANCHOR_HOME_DOMAIN });
}

export function startInteractiveWithdraw(params: {
  homeDomain?: string;
  account: string;
  assetCode: string;
  lang?: string;
}) {
  return startInteractive("withdraw", { ...params, homeDomain: params.homeDomain || ANCHOR_HOME_DOMAIN });
}

export async function fetchAnchorTransaction(params: {
  homeDomain?: string;
  account: string;
  id: string;
}): Promise<AnchorTransactionRecord | null> {
  const homeDomain = params.homeDomain || ANCHOR_HOME_DOMAIN;
  const endpoints = await fetchAnchorEndpoints(homeDomain);
  if (!endpoints.transferServerSep24) return null;
  const jwt = await getAnchorJwt(homeDomain, params.account);

  const response = await fetch(`${endpoints.transferServerSep24}/transaction?id=${encodeURIComponent(params.id)}`, {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  if (!response.ok) return null;
  const data = (await response.json()) as { transaction?: AnchorTransactionRecord };
  return data.transaction || null;
}

/** SEP-0024 terminal statuses — once reached, no further polling is useful. */
export const ANCHOR_TERMINAL_STATUSES = new Set([
  "completed",
  "refunded",
  "expired",
  "no_market",
  "too_small",
  "too_large",
  "error",
]);

/**
 * Polls the anchor every `intervalMs` until a terminal status is reached or
 * `timeoutMs` elapses. Calls `onUpdate` on every fetched record.
 */
export async function pollAnchorTransaction(params: {
  homeDomain?: string;
  account: string;
  id: string;
  intervalMs?: number;
  timeoutMs?: number;
  onUpdate?: (record: AnchorTransactionRecord) => void;
  isCancelled?: () => boolean;
}): Promise<AnchorTransactionRecord | null> {
  const interval = params.intervalMs || 4000;
  const deadline = Date.now() + (params.timeoutMs || 20 * 60 * 1000);

  while (Date.now() < deadline) {
    if (params.isCancelled?.()) return null;
    const record = await fetchAnchorTransaction(params).catch(() => null);
    if (record) {
      params.onUpdate?.(record);
      if (ANCHOR_TERMINAL_STATUSES.has(record.status)) return record;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  return null;
}

// ─── SEP-0031 — Direct (Cross-Border) Payments ───────────────────────────────

export interface Sep31Info {
  receive: Record<
    string,
    {
      enabled: boolean;
      min_amount?: number;
      max_amount?: number;
      sep12: { sender?: { types?: Record<string, unknown> }; receiver?: { types?: Record<string, unknown> } };
      fields?: { transaction?: Record<string, { description?: string; optional?: boolean }> };
    }
  >;
}

export async function fetchSep31Info(homeDomain = ANCHOR_HOME_DOMAIN): Promise<Sep31Info | null> {
  const endpoints = await fetchAnchorEndpoints(homeDomain);
  if (!endpoints.directPaymentServer) return null;
  const response = await fetch(`${endpoints.directPaymentServer}/info`);
  if (!response.ok) return null;
  return (await response.json()) as Sep31Info;
}

/**
 * Initiate a SEP-0031 send. The caller is responsible for collecting any
 * KYC fields the anchor needs (via SEP-0012) and passing them in `fields`.
 *
 * Returns the anchor's payout instructions: the Stellar address to send to,
 * a memo, and the transaction id used for status polling.
 */
export async function initiateSep31Send(params: {
  homeDomain?: string;
  account: string;
  amount: string;
  assetCode: string;
  assetIssuer?: string;
  senderId?: string;
  receiverId?: string;
  fields?: Record<string, Record<string, string>>;
  quoteId?: string;
}): Promise<{
  id: string;
  stellar_account_id: string;
  stellar_memo?: string;
  stellar_memo_type?: string;
} | null> {
  const homeDomain = params.homeDomain || ANCHOR_HOME_DOMAIN;
  const endpoints = await fetchAnchorEndpoints(homeDomain);
  if (!endpoints.directPaymentServer) {
    throw new Error("This anchor does not support SEP-0031 cross-border payments.");
  }
  const jwt = await getAnchorJwt(homeDomain, params.account);

  const response = await fetch(`${endpoints.directPaymentServer}/transactions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: params.amount,
      asset_code: params.assetCode,
      asset_issuer: params.assetIssuer,
      sender_id: params.senderId,
      receiver_id: params.receiverId,
      quote_id: params.quoteId,
      fields: params.fields,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`SEP-0031 transaction failed (${response.status}): ${detail.slice(0, 200)}`);
  }
  return await response.json();
}
