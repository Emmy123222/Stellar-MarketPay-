import React from 'react';
import clsx from 'clsx';

type StateMessageProps = {
  /** "empty" for no data, "error" for API failures */
  type: 'empty' | 'error';
  /** Optional icon component */
  icon?: React.ReactNode;
  /** Heading text */
  title: string;
  /** Subtext description */
  description: string;
  /** Optional CTA button label */
  ctaLabel?: string;
  /** Callback for CTA button click */
  onCta?: () => void;
};

/**
 * A reusable UI element for displaying thoughtful empty or error states.
 * Uses a centered card layout with an optional illustration/icon, a heading,
 * a descriptive paragraph, and an optional call‑to‑action button.
 *
 * Design follows the project’s dark theme with accent colors and subtle
 * animations (icon pulse). It can be used across any page to replace raw
 * error messages or blank placeholders.
 */
export default function StateMessage({
  type,
  icon,
  title,
  description,
  ctaLabel,
  onCta,
}: StateMessageProps) {
  const bgClass = type === 'error' ? 'bg-red-500/10 border-red-500/20' : 'bg-amber-500/10 border-amber-500/20';
  const textClass = type === 'error' ? 'text-red-400' : 'text-amber-100';
  const borderClass = type === 'error' ? 'border-red-500' : 'border-amber-500';

  return (
    <div className={clsx('card text-center py-16 border', borderClass, bgClass)}>
      {icon && (
        <div className="mb-4 flex justify-center animate-pulse">
          {icon}
        </div>
      )}
      <h2 className={clsx('font-display text-xl mb-2', textClass)}>{title}</h2>
      <p className="text-sm text-amber-800 mb-6 max-w-xs mx-auto">{description}</p>
      {ctaLabel && onCta && (
        <button className={clsx('btn-primary text-sm', type === 'error' ? 'bg-red-500/30 hover:bg-red-500/50' : '')} onClick={onCta}>
          {ctaLabel}
        </button>
      )}
    </div>
  );
}
