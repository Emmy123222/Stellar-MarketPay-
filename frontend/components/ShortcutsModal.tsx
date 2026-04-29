import { useEffect } from "react";

interface ShortcutsModalProps {
  isOpen: boolean;
  onClose: () => void;
  showJobDetailShortcuts: boolean;
}

function Key({ children }: { children: string }) {
  return <kbd className="rounded border border-market-500/25 bg-ink-800 px-2 py-1 text-xs font-semibold text-market-300">{children}</kbd>;
}

export default function ShortcutsModal({ isOpen, onClose, showJobDetailShortcuts }: ShortcutsModalProps) {
  useEffect(() => {
    if (!isOpen) return;

    const onEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        aria-label="Close keyboard shortcuts"
        onClick={onClose}
      />

      <div className="relative w-full max-w-xl rounded-2xl border border-market-500/20 bg-ink-900 p-6 shadow-2xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-xl font-bold text-amber-100">Keyboard Shortcuts</h2>
          <button type="button" onClick={onClose} className="btn-ghost px-3 py-1 text-xs">Close</button>
        </div>

        <div className="space-y-2 text-sm">
          <ShortcutRow keys={["G", "J"]} description="Go to jobs" />
          <ShortcutRow keys={["G", "D"]} description="Go to dashboard" />
          <ShortcutRow keys={["N"]} description="Create a new job post" />
          <ShortcutRow keys={["?"]} description="Toggle this shortcuts guide" />
          {showJobDetailShortcuts && (
            <>
              <div className="my-2 border-t border-market-500/10" />
              <ShortcutRow keys={["A"]} description="Open apply flow (job detail page)" />
              <ShortcutRow keys={["Esc"]} description="Back to job listings (job detail page)" />
            </>
          )}
        </div>

        <p className="mt-5 text-xs text-amber-800">Shortcuts are disabled while typing in form fields.</p>
      </div>
    </div>
  );
}

function ShortcutRow({ keys, description }: { keys: string[]; description: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-market-500/10 bg-ink-800/50 px-3 py-2">
      <div className="flex items-center gap-1.5">
        {keys.map((key, idx) => (
          <div key={`${key}-${idx}`} className="flex items-center gap-1.5">
            <Key>{key}</Key>
            {idx < keys.length - 1 && <span className="text-xs text-amber-700">then</span>}
          </div>
        ))}
      </div>
      <span className="text-amber-200/90">{description}</span>
    </div>
  );
}
