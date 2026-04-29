/**
 * components/Onboarding/ProfileChecklist.tsx
 * Checklist component showing profile completion progress
 */
import { useRouter } from "next/router";
import clsx from "clsx";

export interface ChecklistItem {
  id: string;
  label: string;
  completed: boolean;
  route: string;
  icon: React.ReactNode;
}

interface ProfileChecklistProps {
  items: ChecklistItem[];
  onItemClick: (route: string) => void;
  onDismiss?: () => void;
}

export default function ProfileChecklist({ items, onItemClick, onDismiss }: ProfileChecklistProps) {
  const router = useRouter();
  const completedCount = items.filter((item) => item.completed).length;
  const totalCount = items.length;
  const isComplete = completedCount === totalCount;

  const handleItemClick = (item: ChecklistItem) => {
    if (!item.completed) {
      onItemClick(item.route);
      router.push(item.route);
    }
  };

  return (
    <div className="card bg-gradient-to-br from-ink-800 to-ink-900 border-market-500/20 relative overflow-hidden">
      {/* Decorative background */}
      <div className="absolute top-0 right-0 w-32 h-32 bg-market-500/5 rounded-full blur-2xl pointer-events-none" />

      <div className="relative">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <h3 className="font-display text-xl font-semibold text-amber-100 mb-1">
              {isComplete ? "Profile Complete! 🎉" : "Complete Your Profile"}
            </h3>
            <p className="text-sm text-amber-800">
              {isComplete 
                ? "You're all set to start using the platform"
                : "Finish these steps to get the most out of MarketPay"
              }
            </p>
          </div>
          {onDismiss && (
            <button
              onClick={onDismiss}
              className="text-amber-600 hover:text-amber-400 transition-colors p-1"
              title="Dismiss checklist"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>

        {/* Progress indicator */}
        <div className="mb-6">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-amber-700 font-medium">
              {completedCount} of {totalCount} completed
            </span>
            <span className="text-market-400 font-mono font-semibold">
              {Math.round((completedCount / totalCount) * 100)}%
            </span>
          </div>
          <div className="w-full bg-ink-900 rounded-full h-2 overflow-hidden border border-market-500/10">
            <div
              className={clsx(
                "h-full transition-all duration-500 rounded-full",
                isComplete 
                  ? "bg-gradient-to-r from-emerald-500 to-emerald-400"
                  : "bg-gradient-to-r from-market-500 to-market-400"
              )}
              style={{ width: `${(completedCount / totalCount) * 100}%` }}
            />
          </div>
        </div>

        {/* Checklist items */}
        <div className="space-y-2">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => handleItemClick(item)}
              disabled={item.completed}
              className={clsx(
                "w-full flex items-center gap-4 p-4 rounded-xl border transition-all text-left",
                item.completed
                  ? "bg-emerald-500/5 border-emerald-500/20 cursor-default"
                  : "bg-ink-900/50 border-market-500/20 hover:border-market-500/40 hover:bg-ink-900/70 cursor-pointer"
              )}
            >
              {/* Icon */}
              <div
                className={clsx(
                  "flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center transition-all",
                  item.completed
                    ? "bg-emerald-500/10 text-emerald-400"
                    : "bg-market-500/10 text-market-400"
                )}
              >
                {item.completed ? (
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  item.icon
                )}
              </div>

              {/* Label */}
              <div className="flex-1">
                <p
                  className={clsx(
                    "font-medium transition-colors",
                    item.completed ? "text-emerald-400 line-through" : "text-amber-100"
                  )}
                >
                  {item.label}
                </p>
              </div>

              {/* Arrow */}
              {!item.completed && (
                <svg
                  className="w-5 h-5 text-amber-600 flex-shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              )}
            </button>
          ))}
        </div>

        {/* Complete badge */}
        {isComplete && (
          <div className="mt-6 p-4 rounded-xl bg-gradient-to-r from-emerald-500/10 to-market-500/10 border border-emerald-500/20">
            <div className="flex items-center gap-3">
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-emerald-500/20 flex items-center justify-center">
                <svg className="w-6 h-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div>
                <p className="font-display font-semibold text-emerald-400 mb-0.5">
                  Profile Complete!
                </p>
                <p className="text-sm text-amber-800">
                  You're ready to start posting jobs or applying to projects
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
