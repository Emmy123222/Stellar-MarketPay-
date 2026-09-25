export interface XlmPriceHistoryPoint {
  timestamp: number;
  priceUsd: number;
}

export interface XlmPriceHistory {
  points: XlmPriceHistoryPoint[];
  currentPriceUsd: number | null;
  change24hPercent: number | null;
  updatedAt?: string;
  cached?: boolean;
}

export type Timeframe = '1D' | '7D' | '30D';

const HORIZON_URL =
  process.env.NEXT_PUBLIC_HORIZON_URL || "https://horizon-testnet.stellar.org";

const NETWORK = (process.env.NEXT_PUBLIC_STELLAR_NETWORK || "testnet") as "testnet" | "mainnet";

const USDC_ISSUER =
  NETWORK === "mainnet"
    ? "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN"
    : "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

const TIMEFRAME_CONFIG: Record<Timeframe, { resolutionMs: number; lookbackMs: number }> = {
  '1D':  { resolutionMs: 3_600_000,  lookbackMs: 24 * 60 * 60 * 1000 },
  '7D':  { resolutionMs: 86_400_000, lookbackMs: 7  * 24 * 60 * 60 * 1000 },
  '30D': { resolutionMs: 86_400_000, lookbackMs: 30 * 24 * 60 * 60 * 1000 },
};

/**
 * Fetches XLM/USDC trade aggregations directly from Stellar Horizon.
 * Not routed through `client.ts` — Horizon is a third-party service, not
 * our own backend, so the auth/CSRF/base-URL plumbing doesn't apply here.
 */
export async function fetchXlmPriceHistory(timeframe: Timeframe = '7D'): Promise<XlmPriceHistory> {
  const { resolutionMs, lookbackMs } = TIMEFRAME_CONFIG[timeframe];
  const nowMs = Date.now();
  const startMs = nowMs - lookbackMs;

  const url = new URL(`${HORIZON_URL}/trade_aggregations`);
  url.searchParams.set('base_asset_type',      'native');
  url.searchParams.set('counter_asset_code',   'USDC');
  url.searchParams.set('counter_asset_issuer', USDC_ISSUER);
  url.searchParams.set('counter_asset_type',   'credit_alphanum4');
  url.searchParams.set('resolution',           String(resolutionMs));
  url.searchParams.set('start_time',           String(startMs));
  url.searchParams.set('end_time',             String(nowMs));
  url.searchParams.set('order',                'asc');
  url.searchParams.set('limit',                '200');

  const response = await fetch(url.toString());

  if (!response.ok) {
    throw new Error(`Horizon API error: ${response.status}`);
  }

  const json = await response.json();
  const records: { timestamp: string; close: string }[] =
    json?._embedded?.records ?? [];

  const points: XlmPriceHistoryPoint[] = records.map((r) => ({
    timestamp: Number(r.timestamp),
    priceUsd:  parseFloat(r.close),
  }));

  const last  = points.length > 0 ? points[points.length - 1] : null;
  const first = points.length > 0 ? points[0] : null;

  const currentPriceUsd = last ? last.priceUsd : null;
  const change24hPercent =
    points.length >= 2 && first && last
      ? ((last.priceUsd - first.priceUsd) / first.priceUsd) * 100
      : null;

  return { points, currentPriceUsd, change24hPercent };
}
