/**
 * pages/api/og/[jobId].tsx
 *
 * Dynamic Open Graph image generator for /jobs/[id] social previews.
 * Runs on the Edge runtime and returns a 1200×630 PNG that combines
 * the job title, budget, category, and Stellar MarketPay brand.
 *
 * Why Edge runtime?
 *   - @vercel/og ImageResponse relies on Satori (WASM) and tiny fonts,
 *     both of which are designed for the edge runtime with minimal cold
 *     start and small bundle size.
 *   - Caching on the CDN layer keeps social scrapers fast (~5s) and
 *     frees the Node.js origin from repeat image renders.
 *
 * Brand:  Stellar MarketPay  (amber/gold on dark ink background)
 */

import { ImageResponse } from "@vercel/og";

// Force the Edge runtime for this route.
export const config = {
  runtime: "edge",
};

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
  "https://marketpay.stellar.org";

const API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ||
  "http://localhost:4000";

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;

// ─── Brand palette (mirrors tailwind.config.ts) ───────────────────────────────
//
// market:  amber/gold (500 = #f59e0b, 400 = #fbbf24, 300 = #fcd34d,
//                  200 = #fde68a, 100 = #fef3c7)
// ink:     deep brown black (900 = #0c0a06, 800 = #151208, 700 = #1f1a0d)

const COLORS = {
  bgDark: "#0c0a06",
  bgPanel: "#151208",
  border: "rgba(245, 158, 11, 0.35)",
  gold: "#fbbf24",
  goldSoft: "#fde68a",
  amber100: "#fef3c7",
  amber700: "#b45309",
  amber800: "#92400e",
  emerald: "#34d399",
};

const STATUS_COLORS: Record<string, { bg: string; fg: string; label: string }> = {
  open: { bg: "rgba(251, 191, 36, 0.15)", fg: "#fcd34d", label: "Open" },
  in_progress: {
    bg: "rgba(52, 211, 153, 0.15)",
    fg: "#34d399",
    label: "In Progress",
  },
  completed: {
    bg: "rgba(110, 231, 183, 0.15)",
    fg: "#6ee7b7",
    label: "Completed",
  },
  disputed: { bg: "rgba(248, 113, 113, 0.15)", fg: "#f87171", label: "Disputed" },
  cancelled: {
    bg: "rgba(180, 83, 9, 0.18)",
    fg: "#b45309",
    label: "Cancelled",
  },
};

// ─── Font loading ─────────────────────────────────────────────────────────────
//
// Satori (the renderer under @vercel/og) accepts only the font subsets we
// pass in as ArrayBuffers. We pull two semi-bold weights from the Google
// Fonts CDN at module init so the first request doesn't pay a network hop.

const FONT_HEADERS =
  'User-Agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"';

const playfairRegular = fetch(
  "https://fonts.gstatic.com/s/playfairdisplay/v37/nuFvD-vYSZviVYUb_rj3ij__anPXJzDwcbmjWBN2PKdFvXDXbtXKQTR0.ttf",
  { headers: { "User-Agent": FONT_HEADERS } }
).then((res) => {
  if (!res.ok) throw new Error(`Playfair font fetch failed: ${res.status}`);
  return res.arrayBuffer();
});

const playfairBold = fetch(
  "https://fonts.gstatic.com/s/playfairdisplay/v37/nuFvD-vYSZviVYUb_rj3ij__anPXJzDwcbmjWBN2PKdFvUDYbtXKQTR0.ttf",
  { headers: { "User-Agent": FONT_HEADERS } }
).then((res) => {
  if (!res.ok) throw new Error(`Playfair bold fetch failed: ${res.status}`);
  return res.arrayBuffer();
});

const dmSansRegular = fetch(
  "https://fonts.gstatic.com/s/dmsans/v15/rP2tp2ywxg089UriI5-g4vlH9VoD8Cmcqbu0-K4.woff",
  { headers: { "User-Agent": FONT_HEADERS } }
).then((res) => {
  if (!res.ok) throw new Error(`DM Sans font fetch failed: ${res.status}`);
  return res.arrayBuffer();
});

const dmSansBold = fetch(
  "https://fonts.gstatic.com/s/dmsans/v15/rP2tp2ywxg089UriI5-g4vlH9VoD8CmcqZG0-K4.woff",
  { headers: { "User-Agent": FONT_HEADERS } }
).then((res) => {
  if (!res.ok) throw new Error(`DM Sans bold fetch failed: ${res.status}`);
  return res.arrayBuffer();
});

const jetbrainsRegular = fetch(
  "https://fonts.gstatic.com/s/jetbrainsmono/v20/tDbY2o-flEEny0FZhs7Ku-yKVW3U0zE4FwE9oD0bQAfNWA.woff",
  { headers: { "User-Agent": FONT_HEADERS } }
).then((res) => {
  if (!res.ok) throw new Error(`JetBrains font fetch failed: ${res.status}`);
  return res.arrayBuffer();
});

// ─── Types ────────────────────────────────────────────────────────────────────

interface JobPayload {
  id: string;
  title: string;
  description?: string;
  budget: string;
  currency: string;
  category: string;
  status?: string;
  skills?: string[];
  createdAt?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Trim a string to a target length, word-aware if possible. */
function clamp(text: string, max: number): string {
  if (!text) return "";
  if (text.length <= max) return text;
  const slice = text.slice(0, max - 1);
  const lastSpace = slice.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice).trim()}…`;
}

/** Format XLM-style figures without floating point noise in the image. */
function formatBudget(amount: string | number, currency: string): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (Number.isNaN(num)) return "—";
  const formatted = num.toLocaleString("en-US", {
    maximumFractionDigits: 4,
  });
  return `${formatted} ${currency || "XLM"}`;
}

/** Best-effort fetch of a job from the backend. Returns null on any failure.
 *
 * The jobId regex restricts to URL-safe characters so that any path
 * injection attempt fails fast (Next.js dynamic routes already URL-encode
 * the segment, but we double-check defensively). The current backend
 * issues Postgres bigint-encoded string IDs (no UUIDs / colons / dots), so
 * this character class matches everything the platform actually issues.
 */
async function loadJob(jobId: string): Promise<JobPayload | null> {
  if (!jobId || !/^[A-Za-z0-9_-]+$/.test(jobId)) return null;
  try {
    const res = await fetch(`${API_URL}/api/jobs/${encodeURIComponent(jobId)}`, {
      headers: { Accept: "application/json" },
      // Edge runtime fetch defaults are sensible; explicit cache disabled.
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = await res.json();
    if (!body || !body.success || !body.data) return null;
    return body.data as JobPayload;
  } catch {
    return null;
  }
}

// ─── Fallback image (no job data) ─────────────────────────────────────────────

function FallbackImage() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: COLORS.bgDark,
        backgroundImage:
          "radial-gradient(circle at 25% 20%, rgba(245, 158, 11, 0.18) 0%, transparent 45%), radial-gradient(circle at 80% 80%, rgba(245, 158, 11, 0.10) 0%, transparent 50%)",
        color: COLORS.amber100,
        padding: "64px 72px",
        fontFamily: "DM Sans",
        position: "relative",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            color: COLORS.gold,
            fontSize: "28px",
            fontWeight: 700,
            letterSpacing: "1px",
          }}
        >
          <span style={{ fontSize: "32px" }}>✦</span>
          <span>STELLAR MARKETPAY</span>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          flex: 1,
          marginTop: "40px",
        }}
      >
        <div
          style={{
            fontSize: "78px",
            fontFamily: "Playfair Display",
            fontWeight: 700,
            color: COLORS.amber100,
            lineHeight: 1.1,
          }}
        >
          Trustless escrow.
          <br />
          <span style={{ color: COLORS.gold }}>Freelance without middlemen.</span>
        </div>
        <div
          style={{
            fontSize: "26px",
            color: COLORS.amber700,
            marginTop: "28px",
            lineHeight: 1.4,
            maxWidth: "900px",
          }}
        >
          Post a job, lock the budget in a Soroban smart contract, and release
          payment the instant work is approved.
        </div>
      </div>
      <div
        style={{
          display: "flex",
          fontSize: "22px",
          color: COLORS.amber800,
          fontFamily: "JetBrains Mono",
        }}
      >
        {SITE_URL.replace(/^https?:\/\//, "")}
      </div>
    </div>
  );
}

// ─── Job image ────────────────────────────────────────────────────────────────

function JobImage({ job }: { job: JobPayload }) {
  const title = clamp(job.title || "Untitled job", 110);
  const category = job.category || "Other";
  const budgetLine = formatBudget(job.budget, job.currency);
  const status = (job.status || "open").toLowerCase();
  const statusInfo = STATUS_COLORS[status] || STATUS_COLORS.open;
  const skills = (job.skills || []).slice(0, 4).map((s) => s.trim()).filter(Boolean);

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: COLORS.bgDark,
        backgroundImage:
          "radial-gradient(circle at 15% 15%, rgba(245, 158, 11, 0.18) 0%, transparent 45%), radial-gradient(circle at 85% 90%, rgba(245, 158, 11, 0.08) 0%, transparent 50%)",
        color: COLORS.amber100,
        padding: "56px 64px",
        fontFamily: "DM Sans",
        position: "relative",
      }}
    >
      {/* Top row: brand + status badge */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            color: COLORS.gold,
            fontSize: "22px",
            fontWeight: 700,
            letterSpacing: "1px",
          }}
        >
          <span style={{ fontSize: "26px" }}>✦</span>
          <span>STELLAR MARKETPAY</span>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            color: statusInfo.fg,
            backgroundColor: statusInfo.bg,
            border: `1px solid ${statusInfo.fg}55`,
            padding: "8px 18px",
            borderRadius: "999px",
            fontSize: "20px",
            fontWeight: 700,
            letterSpacing: "0.5px",
          }}
        >
          <span
            style={{
              width: "10px",
              height: "10px",
              borderRadius: "50%",
              backgroundColor: statusInfo.fg,
            }}
          />
          {statusInfo.label.toUpperCase()}
        </div>
      </div>

      {/* Middle: category + title + budget */}
      <div
        style={{
          display: "flex",
          marginTop: "36px",
          marginBottom: "4px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            color: COLORS.gold,
            backgroundColor: "rgba(245, 158, 11, 0.10)",
            border: `1px solid ${COLORS.border}`,
            padding: "8px 18px",
            borderRadius: "8px",
            fontSize: "22px",
            fontWeight: 700,
            letterSpacing: "0.6px",
          }}
        >
          {category.toUpperCase()}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          fontFamily: "Playfair Display",
          fontWeight: 700,
          fontSize: "62px",
          lineHeight: 1.1,
          color: COLORS.amber100,
          marginTop: "18px",
        }}
      >
        {title}
      </div>

      {skills.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: "10px",
            marginTop: "20px",
            flexWrap: "wrap",
          }}
        >
          {skills.map((skill) => (
            <div
              key={skill}
              style={{
                display: "flex",
                color: COLORS.goldSoft,
                border: `1px solid ${COLORS.border}`,
                padding: "6px 14px",
                borderRadius: "999px",
                fontSize: "18px",
                fontWeight: 500,
              }}
            >
              {skill}
            </div>
          ))}
        </div>
      )}

      {/* Budget + URL pinned to bottom */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          marginTop: "auto",
          paddingTop: "32px",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
          }}
        >
          <span
            style={{
              fontSize: "18px",
              color: COLORS.amber700,
              letterSpacing: "1.5px",
              fontWeight: 700,
            }}
          >
            BUDGET
          </span>
          <span
            style={{
              fontFamily: "JetBrains Mono",
              fontWeight: 700,
              fontSize: "54px",
              color: COLORS.gold,
              lineHeight: 1.1,
            }}
          >
            {budgetLine}
          </span>
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            color: COLORS.amber800,
            fontSize: "20px",
            fontFamily: "JetBrains Mono",
          }}
        >
          <span>View &amp; apply at</span>
          <span style={{ color: COLORS.amber700 }}>
            {SITE_URL.replace(/^https?:\/\//, "")}/jobs/{job.id}
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req: Request) {
  // /api/og/<jobId>?... — pull the last segment of the URL path.
  //
  // Note: backreferences to /api/og/missing are emitted by
  // pages/jobs/[id].tsx when SSR data is still loading. The string
  // "missing" fails the jobId regex in `loadJob` and so renders the
  // branded FallbackImage — that is intentional, not a typo.
  let jobId = "";
  try {
    const u = new URL(req.url);
    const parts = u.pathname.split("/").filter(Boolean);
    jobId = parts[parts.length - 1] || "";
  } catch {
    /* ignore — jobId stays empty */
  }

  const job = await loadJob(jobId);

  let playfairRegularData: ArrayBuffer;
  let playfairBoldData: ArrayBuffer;
  let dmSansRegularData: ArrayBuffer;
  let dmSansBoldData: ArrayBuffer;
  let jetbrainsData: ArrayBuffer;

  try {
    [playfairRegularData, playfairBoldData, dmSansRegularData, dmSansBoldData, jetbrainsData] =
      await Promise.all([
        playfairRegular,
        playfairBold,
        dmSansRegular,
        dmSansBold,
        jetbrainsRegular,
      ]);
  } catch (err) {
    // If fonts fail, render with whatever Satori's built-in defaults give us.
    // This keeps the endpoint resilient on first deploy when the font cache
    // hasn't warmed up yet.
    console.warn("[og] font fetch failed, falling back to default fonts", err);
    return new ImageResponse(job ? <JobImage job={job} /> : <FallbackImage />, {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      headers: {
        "Cache-Control": "public, max-age=300, s-maxage=300",
      },
    });
  }

  return new ImageResponse(job ? <JobImage job={job} /> : <FallbackImage />, {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts: [
      {
        name: "Playfair Display",
        data: playfairRegularData,
        weight: 400,
        style: "normal",
      },
      {
        name: "Playfair Display",
        data: playfairBoldData,
        weight: 700,
        style: "normal",
      },
      {
        name: "DM Sans",
        data: dmSansRegularData,
        weight: 400,
        style: "normal",
      },
      {
        name: "DM Sans",
        data: dmSansBoldData,
        weight: 700,
        style: "normal",
      },
      {
        name: "JetBrains Mono",
        data: jetbrainsData,
        weight: 400,
        style: "normal",
      },
    ],
    headers: {
      "Cache-Control":
        "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
      // Help Twitter/Facebook scrapers tag the response correctly.
      "Content-Type": "image/png",
    },
  });
}
