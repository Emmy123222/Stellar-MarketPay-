/**
 * components/illustrations/EmptyStateIllustrations.tsx
 *
 * A small set of hand-built SVG illustrations used by `StateMessage` (and
 * anywhere else) to make empty list views feel intentional instead of just
 * blank. Every illustration is drawn with the app's existing themeable CSS
 * custom properties (`--gold`, `--gold-light`, `--gold-dim`, `--surface-2`,
 * `--surface-3`, `--border`, `--text-muted`, all defined in
 * styles/globals.css) rather than hard-coded hex values or Tailwind color
 * utilities. Those variables already flip automatically when `html.dark` is
 * toggled, so these illustrations get light/dark theming for free and never
 * go out of sync with the rest of the UI.
 *
 * Keep these flat, warm, and a little playful — a few dashed lines and
 * floating dots go a long way without needing a full illustration library.
 */
import type { SVGProps } from "react";

export type EmptyStateVariant =
  | "no-jobs"
  | "no-applications"
  | "no-notifications"
  | "no-earnings";

type IllustrationProps = SVGProps<SVGSVGElement>;

/** Briefcase with a magnifying glass — "no jobs to show yet". */
function NoJobsIllustration(props: IllustrationProps) {
  return (
    <svg viewBox="0 0 200 150" fill="none" aria-hidden="true" {...props}>
      <ellipse cx="100" cy="128" rx="62" ry="10" fill="var(--gold-dim)" />
      <circle cx="38" cy="30" r="4" fill="var(--gold-light)" opacity="0.6" />
      <circle cx="162" cy="46" r="3" fill="var(--gold-light)" opacity="0.5" />
      <path d="M150 24 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3 z" fill="var(--gold-light)" opacity="0.55" />

      {/* Briefcase body */}
      <rect x="46" y="66" width="108" height="58" rx="10" fill="var(--surface-2)" stroke="var(--border)" strokeWidth="2" />
      {/* Handle */}
      <path d="M84 66 v-10 a16 16 0 0 1 32 0 v10" stroke="var(--gold)" strokeWidth="4" strokeLinecap="round" fill="none" />
      {/* Latch / seam */}
      <path d="M46 92 h108" stroke="var(--border)" strokeWidth="2" />
      <rect x="92" y="84" width="16" height="12" rx="2" fill="var(--gold-dim)" stroke="var(--gold)" strokeWidth="1.5" />

      {/* Empty dashed contents */}
      <rect x="60" y="102" width="34" height="6" rx="3" fill="none" stroke="var(--text-muted)" strokeWidth="2" strokeDasharray="4 5" opacity="0.6" />

      {/* Magnifying glass */}
      <circle cx="132" cy="46" r="16" fill="var(--gold-dim)" stroke="var(--gold)" strokeWidth="3" />
      <line x1="143" y1="57" x2="156" y2="70" stroke="var(--gold)" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

/** Blank document with a paper airplane taking off — "no applications yet". */
function NoApplicationsIllustration(props: IllustrationProps) {
  return (
    <svg viewBox="0 0 200 150" fill="none" aria-hidden="true" {...props}>
      <ellipse cx="94" cy="128" rx="58" ry="10" fill="var(--gold-dim)" />

      {/* Document */}
      <rect x="60" y="46" width="72" height="86" rx="8" fill="var(--surface-2)" stroke="var(--border)" strokeWidth="2" />
      <line x1="74" y1="66" x2="118" y2="66" stroke="var(--text-muted)" strokeWidth="3" strokeLinecap="round" strokeDasharray="3 6" opacity="0.6" />
      <line x1="74" y1="80" x2="118" y2="80" stroke="var(--text-muted)" strokeWidth="3" strokeLinecap="round" strokeDasharray="3 6" opacity="0.6" />
      <line x1="74" y1="94" x2="104" y2="94" stroke="var(--text-muted)" strokeWidth="3" strokeLinecap="round" strokeDasharray="3 6" opacity="0.6" />

      {/* Flight path */}
      <path d="M126 58 C 148 44, 156 30, 150 16" stroke="var(--gold)" strokeWidth="2" strokeDasharray="4 6" strokeLinecap="round" opacity="0.6" />

      {/* Paper airplane */}
      <g transform="translate(150 16) rotate(28)">
        <path d="M0 -12 L12 6 L0 2 L-12 6 Z" fill="var(--gold-light)" stroke="var(--gold)" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M0 -12 L0 2" stroke="var(--gold)" strokeWidth="1.2" opacity="0.7" />
      </g>

      <circle cx="46" cy="40" r="3" fill="var(--gold-light)" opacity="0.5" />
      <circle cx="152" cy="98" r="4" fill="var(--gold-light)" opacity="0.4" />
    </svg>
  );
}

/** Resting bell, all caught up — "no notifications". */
function NoNotificationsIllustration(props: IllustrationProps) {
  return (
    <svg viewBox="0 0 200 150" fill="none" aria-hidden="true" {...props}>
      <ellipse cx="100" cy="128" rx="52" ry="10" fill="var(--gold-dim)" />
      <circle cx="100" cy="70" r="48" fill="var(--gold-dim)" opacity="0.5" />

      {/* Bell */}
      <path
        d="M100 34 c17 0 26 13 26 30 v10 c0 8 4 13 9 17 H65 c5 -4 9 -9 9 -17 v-10 c0 -17 9 -30 26 -30 z"
        fill="var(--surface-2)"
        stroke="var(--gold)"
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <path d="M88 100 a12 12 0 0 0 24 0" fill="var(--surface-2)" stroke="var(--gold)" strokeWidth="3" strokeLinecap="round" />
      <rect x="96" y="24" width="8" height="10" rx="4" fill="var(--gold)" />

      {/* All-caught-up check badge */}
      <circle cx="132" cy="46" r="14" fill="var(--gold-light)" stroke="var(--surface-2)" strokeWidth="3" />
      <path d="M126 46 l4 4 8 -8" stroke="var(--surface)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" fill="none" />

      <circle cx="52" cy="52" r="3" fill="var(--gold-light)" opacity="0.5" />
      <circle cx="150" cy="94" r="3" fill="var(--gold-light)" opacity="0.4" />
    </svg>
  );
}

/** Coin stack with a dashed, still-flat earnings line — "no earnings yet". */
function NoEarningsIllustration(props: IllustrationProps) {
  return (
    <svg viewBox="0 0 200 150" fill="none" aria-hidden="true" {...props}>
      <ellipse cx="100" cy="128" rx="60" ry="10" fill="var(--gold-dim)" />

      {/* Dashed empty trend line in the background */}
      <path
        d="M40 100 C 70 100, 80 88, 110 88 S 150 60, 168 42"
        stroke="var(--border)"
        strokeWidth="2.5"
        strokeDasharray="5 7"
        strokeLinecap="round"
        fill="none"
        opacity="0.7"
      />

      {/* Coin stack */}
      <ellipse cx="90" cy="112" rx="30" ry="9" fill="var(--surface-2)" stroke="var(--gold)" strokeWidth="2" />
      <ellipse cx="90" cy="100" rx="30" ry="9" fill="var(--surface-2)" stroke="var(--gold)" strokeWidth="2" />
      <ellipse cx="90" cy="88" rx="30" ry="9" fill="var(--gold-dim)" stroke="var(--gold)" strokeWidth="2" />

      {/* Star mark (Stellar / XLM nod) on the top coin */}
      <path
        d="M90 80 l2.6 5.6 6.1 0.7 -4.5 4.1 1.1 6 -5.3 -3 -5.3 3 1.1 -6 -4.5 -4.1 6.1 -0.7 z"
        fill="var(--gold-light)"
      />

      <circle cx="146" cy="90" r="3" fill="var(--gold-light)" opacity="0.5" />
      <circle cx="50" cy="66" r="3" fill="var(--gold-light)" opacity="0.4" />
    </svg>
  );
}

const ILLUSTRATIONS: Record<EmptyStateVariant, (props: IllustrationProps) => JSX.Element> = {
  "no-jobs": NoJobsIllustration,
  "no-applications": NoApplicationsIllustration,
  "no-notifications": NoNotificationsIllustration,
  "no-earnings": NoEarningsIllustration,
};

interface EmptyStateIllustrationProps extends IllustrationProps {
  variant: EmptyStateVariant;
}

/**
 * Renders the illustration for a given empty-state variant. Pass a
 * `className` (e.g. `"w-40 h-32"`) to size it — the SVGs use a fixed
 * viewBox and scale cleanly.
 */
export default function EmptyStateIllustration({ variant, ...props }: EmptyStateIllustrationProps) {
  const Illustration = ILLUSTRATIONS[variant];
  if (!Illustration) return null;
  return <Illustration {...props} />;
}

export {
  NoJobsIllustration,
  NoApplicationsIllustration,
  NoNotificationsIllustration,
  NoEarningsIllustration,
};