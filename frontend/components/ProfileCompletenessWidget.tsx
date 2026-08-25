/**
 * components/ProfileCompletenessWidget.tsx
 *
 * Persistent profile completeness indicator shown on the dashboard.
 * Shows a progress bar with percentage and actionable checklist items.
 * Collapsible, dismissible ("Remind me later"), and auto-hides at 100%.
 */
import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import clsx from "clsx";
import type { ChecklistItem } from "@/components/Onboarding/ProfileChecklist";

const WIDGET_DISMISSED_KEY = "marketpay_completeness_widget_dismissed_until";

interface ProfileCompletenessWidgetProps {
  completionPercentage: number;
  isComplete: boolean;
  checklistItems: ChecklistItem[];
}

export default function ProfileCompletenessWidget({
  completionPercentage,
  isComplete,
  checklistItems,
}: ProfileCompletenessWidgetProps) {
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Check if the widget was previously dismissed ("Remind me later")
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const dismissedUntil = localStorage.getItem(WIDGET_DISMISSED_KEY);
      if (dismissedUntil) {
        const until = new Date(dismissedUntil);
        if (until > new Date()) {
          setDismissed(true);
        } else {
          // Reminder period expired — show again
          localStorage.removeItem(WIDGET_DISMISSED_KEY);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  // Re-show widget when profile becomes complete (so the 100% state is visible briefly)
  useEffect(() => {
    if (isComplete) {
      setDismissed(false);
      setCollapsed(false);
    }
  }, [isComplete]);

  const handleRemindLater = () => {
    // Dismiss for 3 days
    const until = new Date();
    until.setDate(until.getDate() + 3);
    try {
      localStorage.setItem(WIDGET_DISMISSED_KEY, until.toISOString());
    } catch {
      // ignore
    }
    setDismissed(true);
  };

  const handleItemClick = (item: ChecklistItem) => {
    if (!item.completed) {
      router.push(item.route);
    }
  };

  // Don't render if dismissed (and not complete) or if complete and user has seen it
  if (dismissed && !isComplete) return null;

  const completedCount = checklistItems.filter((i) => i.completed).length;
  const totalCount = checklistItems.length;

  return (
    <div
      className={clsx(
        "rounded-2xl border bg-gradient-to-br from-ink-800 to-ink-900 overflow-hidden transition-all duration-300",
        isComplete ? "border-emerald-500/30" : "border-market-500/20",
      )}
      role="region"
      aria-label="Profile completeness"
    >
      {/* Header row — always visible */}
      <div className="flex items-center gap-3 px-4 py-3">
        {/* Compact progress ring / percentage */}
        <div
          className={clsx(
            "flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-xs font-mono font-bold border-2",
            isComplete
              ? "border-emerald-400 text-emerald-400 bg-emerald-500/10"
              : "border-market-400 text-market-400 bg-market-500/10",
          )}
          aria-hidden="true"
        >
          {completionPercentage}%
        </div>

        {/* Label + progress bar */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm font-medium text-amber-100">
              {isComplete ? "Profile complete 🎉" : "Profile completeness"}
            </span>
            <span className="text-xs text-amber-700 ml-2 flex-shrink-0">
              {completedCount}/{totalCount}
            </span>
          </div>
          <div className="w-full bg-ink-950 rounded-full h-1.5 overflow-hidden border border-market-500/10">
            <div
              className={clsx(
                "h-full rounded-full transition-all duration-500",
                isComplete
                  ? "bg-gradient-to-r from-emerald-500 to-emerald-400"
                  : "bg-gradient-to-r from-market-500 to-market-400",
              )}
              style={{ width: `${completionPercentage}%` }}
              role="progressbar"
              aria-valuenow={completionPercentage}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Profile ${completionPercentage}% complete`}
            />
          </div>
        </div>

        {/* Collapse / expand toggle */}
        {!isComplete && (
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="flex-shrink-0 p-1.5 rounded-lg text-amber-600 hover:text-amber-300 hover:bg-amber-400/10 transition-all"
            aria-expanded={!collapsed}
            aria-controls="completeness-checklist"
            title={collapsed ? "Show checklist" : "Hide checklist"}
          >
            <svg
              className={clsx(
                "w-4 h-4 transition-transform duration-200",
                collapsed ? "rotate-180" : "",
              )}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 15l7-7 7 7"
              />
            </svg>
          </button>
        )}
      </div>

      {/* Expandable checklist */}
      {!isComplete && !collapsed && (
        <div id="completeness-checklist" className="px-4 pb-4 space-y-1.5">
          <div className="w-full h-px bg-market-500/10 mb-3" />

          {checklistItems.map((item) => (
            <button
              key={item.id}
              onClick={() => handleItemClick(item)}
              disabled={item.completed}
              className={clsx(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left transition-all",
                item.completed
                  ? "bg-emerald-500/5 border-emerald-500/15 cursor-default"
                  : "bg-ink-900/60 border-market-500/15 hover:border-market-500/40 hover:bg-ink-900/80 cursor-pointer group",
              )}
            >
              {/* Status icon */}
              <div
                className={clsx(
                  "flex-shrink-0 w-7 h-7 rounded-lg flex items-center justify-center",
                  item.completed
                    ? "bg-emerald-500/10 text-emerald-400"
                    : "bg-market-500/10 text-market-400",
                )}
              >
                {item.completed ? (
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2.5}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                ) : (
                  <span className="w-4 h-4 flex items-center justify-center">
                    {item.icon}
                  </span>
                )}
              </div>

              {/* Label */}
              <span
                className={clsx(
                  "flex-1 text-sm font-medium",
                  item.completed
                    ? "text-emerald-400 line-through"
                    : "text-amber-100",
                )}
              >
                {item.label}
              </span>

              {/* CTA arrow for incomplete items */}
              {!item.completed && (
                <span className="flex-shrink-0 flex items-center gap-1 text-xs text-market-400 group-hover:text-market-300 transition-colors">
                  Add
                  <svg
                    className="w-3.5 h-3.5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </span>
              )}
            </button>
          ))}

          {/* Remind me later */}
          <div className="pt-2 flex justify-end">
            <button
              onClick={handleRemindLater}
              className="text-xs text-amber-700 hover:text-amber-500 transition-colors underline underline-offset-2"
            >
              Remind me later
            </button>
          </div>
        </div>
      )}

      {/* Complete state body */}
      {isComplete && (
        <div className="px-4 pb-4">
          <div className="w-full h-px bg-emerald-500/10 mb-3" />
          <p className="text-sm text-amber-700">
            Your profile is fully set up. Clients can find everything they need
            to hire you.
          </p>
        </div>
      )}
    </div>
  );
}
