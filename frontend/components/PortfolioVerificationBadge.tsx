/**
 * components/PortfolioVerificationBadge.tsx
 *
 * Visual badge for portfolio link verification status. Rendered next to
 * each portfolio link on the public freelancer profile. Three tones:
 *
 *   - verified  (emerald)
 *   - failed    (rose)
 *   - pending   (amber, subtle)
 */

import clsx from "clsx";

type Tone = "verified" | "failed" | "pending";

export interface VerificationBadge {
  tone: Tone;
  label: string;
}

interface Props {
  badge: VerificationBadge;
}

function iconFor(tone: Tone) {
  if (tone === "verified") {
    return (
      <svg
        className="w-3.5 h-3.5"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M16.704 5.29a1 1 0 010 1.42l-7.99 7.99a1 1 0 01-1.42 0L3.296 10.7a1 1 0 111.42-1.42l3.29 3.3 7.28-7.29a1 1 0 011.418 0z"
          clipRule="evenodd"
        />
      </svg>
    );
  }
  if (tone === "failed") {
    return (
      <svg
        className="w-3.5 h-3.5"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-11.5a.75.75 0 00-1.5 0v4a.75.75 0 00.4.66l3 1.5a.75.75 0 10.66-1.34l-2.56-1.28V6.5z"
          clipRule="evenodd"
        />
      </svg>
    );
  }
  // pending
  return (
    <svg
      className="w-3.5 h-3.5 animate-spin"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="10"
        cy="10"
        r="7"
        stroke="currentColor"
        strokeOpacity="0.3"
        strokeWidth="2"
      />
      <path
        d="M17 10a7 7 0 00-7-7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

export default function PortfolioVerificationBadge({ badge }: Props) {
  const palette =
    badge.tone === "verified"
      ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
      : badge.tone === "failed"
      ? "bg-rose-500/10 text-rose-400 border-rose-500/25"
      : "bg-amber-500/10 text-amber-300 border-amber-500/25";

  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.14em] px-2 py-0.5 rounded-full border",
        palette
      )}
      title={badge.label}
      aria-label={badge.label}
      role={badge.tone === "failed" ? "status" : undefined}
    >
      {iconFor(badge.tone)}
      <span className="hidden sm:inline">{badge.label}</span>
    </span>
  );
}
