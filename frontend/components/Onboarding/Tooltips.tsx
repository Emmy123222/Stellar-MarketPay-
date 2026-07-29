/**
 * components/Onboarding/Tooltips.tsx
 * Contextual tooltips for guiding new users
 */
import { useEffect, useState } from "react";
import clsx from "clsx";

export interface TooltipConfig {
  id: string;
  targetSelector: string;
  title: string;
  description: string;
  position?: "top" | "bottom" | "left" | "right";
  action?: {
    label: string;
    onClick: () => void;
  };
}

interface TooltipsProps {
  tooltips: TooltipConfig[];
  onDismiss: (tooltipId: string) => void;
  onDismissAll: () => void;
}

export default function Tooltips({ tooltips, onDismiss, onDismissAll }: TooltipsProps) {
  const [activeTooltips, setActiveTooltips] = useState<TooltipConfig[]>([]);

  useEffect(() => {
    // Filter tooltips whose target elements exist in the DOM
    const visibleTooltips = tooltips.filter((tooltip) => {
      const element = document.querySelector(tooltip.targetSelector);
      return element !== null;
    });

    setActiveTooltips(visibleTooltips);
  }, [tooltips]);

  if (activeTooltips.length === 0) return null;

  return (
    <>
      {activeTooltips.map((tooltip) => (
        <TooltipOverlay
          key={tooltip.id}
          tooltip={tooltip}
          onDismiss={() => onDismiss(tooltip.id)}
        />
      ))}

      {/* Dismiss all button */}
      {activeTooltips.length > 1 && (
        <div className="fixed bottom-6 right-6 z-50">
          <button
            onClick={onDismissAll}
            className="btn-secondary text-sm py-2 px-4 shadow-lg"
          >
            Dismiss All Tips ({activeTooltips.length})
          </button>
        </div>
      )}
    </>
  );
}

interface TooltipOverlayProps {
  tooltip: TooltipConfig;
  onDismiss: () => void;
}

function TooltipOverlay({ tooltip, onDismiss }: TooltipOverlayProps) {
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    const element = document.querySelector(tooltip.targetSelector);
    if (!element) return;

    const rect = element.getBoundingClientRect();
    const tooltipPosition = tooltip.position || "bottom";

    let top = 0;
    let left = 0;

    switch (tooltipPosition) {
      case "top":
        top = rect.top - 10;
        left = rect.left + rect.width / 2;
        break;
      case "bottom":
        top = rect.bottom + 10;
        left = rect.left + rect.width / 2;
        break;
      case "left":
        top = rect.top + rect.height / 2;
        left = rect.left - 10;
        break;
      case "right":
        top = rect.top + rect.height / 2;
        left = rect.right + 10;
        break;
    }

    setPosition({ top, left });

    // Highlight the target element
    element.classList.add("onboarding-highlight");

    return () => {
      element.classList.remove("onboarding-highlight");
    };
  }, [tooltip]);

  if (!position) return null;

  const positionClasses = {
    top: "-translate-x-1/2 -translate-y-full",
    bottom: "-translate-x-1/2",
    left: "-translate-x-full -translate-y-1/2",
    right: "-translate-y-1/2",
  };

  return (
    <div
      className={clsx(
        "fixed z-50 w-80 animate-fade-in",
        positionClasses[tooltip.position || "bottom"]
      )}
      style={{ top: `${position.top}px`, left: `${position.left}px` }}
    >
      <div className="bg-gradient-to-br from-ink-800 to-ink-900 border border-market-500/30 rounded-xl shadow-2xl p-4">
        {/* Arrow indicator */}
        <div
          className={clsx(
            "absolute w-3 h-3 bg-ink-800 border-market-500/30 transform rotate-45",
            tooltip.position === "top" && "bottom-[-6px] left-1/2 -translate-x-1/2 border-b border-r",
            tooltip.position === "bottom" && "top-[-6px] left-1/2 -translate-x-1/2 border-t border-l",
            tooltip.position === "left" && "right-[-6px] top-1/2 -translate-y-1/2 border-r border-t",
            tooltip.position === "right" && "left-[-6px] top-1/2 -translate-y-1/2 border-l border-b"
          )}
        />

        {/* Content */}
        <div className="relative">
          <div className="flex items-start justify-between gap-3 mb-2">
            <h4 className="font-display font-semibold text-amber-100 text-sm">
              {tooltip.title}
            </h4>
            <button
              onClick={onDismiss}
              className="text-amber-600 hover:text-amber-400 transition-colors flex-shrink-0"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <p className="text-xs text-amber-800 mb-3">
            {tooltip.description}
          </p>

          {tooltip.action && (
            <button
              onClick={() => {
                tooltip.action!.onClick();
                onDismiss();
              }}
              className="btn-primary text-xs py-1.5 px-3 w-full"
            >
              {tooltip.action.label}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
