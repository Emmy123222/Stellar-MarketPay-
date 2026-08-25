/**
 * components/Onboarding/ProgressBar.tsx
 * Compact progress bar showing profile completion percentage
 */
import clsx from "clsx";

interface ProgressBarProps {
  current: number;
  total: number;
  showLabel?: boolean;
  size?: "sm" | "md" | "lg";
}

export default function ProgressBar({ 
  current, 
  total, 
  showLabel = true,
  size = "md" 
}: ProgressBarProps) {
  const percentage = Math.round((current / total) * 100);
  const isComplete = current === total;

  const heightClasses = {
    sm: "h-1.5",
    md: "h-2",
    lg: "h-3",
  };

  return (
    <div className="w-full">
      {showLabel && (
        <div className="flex items-center justify-between text-xs mb-2">
          <span className="text-amber-700 font-medium">
            Profile Completion
          </span>
          <span
            className={clsx(
              "font-mono font-semibold",
              isComplete ? "text-emerald-400" : "text-market-400"
            )}
          >
            {current}/{total} ({percentage}%)
          </span>
        </div>
      )}
      <div
        className={clsx(
          "w-full bg-ink-900 rounded-full overflow-hidden border border-market-500/10",
          heightClasses[size]
        )}
      >
        <div
          className={clsx(
            "h-full transition-all duration-500 rounded-full",
            isComplete
              ? "bg-gradient-to-r from-emerald-500 to-emerald-400"
              : "bg-gradient-to-r from-market-500 to-market-400"
          )}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
