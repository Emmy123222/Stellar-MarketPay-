import { useState, useEffect, useCallback } from "react";

export default function PWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<{
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: string }>;
  } | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const onInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(
        e as unknown as {
          prompt: () => Promise<void>;
          userChoice: Promise<{ outcome: string }>;
        }
      );
      setShow(true);
    };

    window.addEventListener("beforeinstallprompt", onInstall);
    return () => window.removeEventListener("beforeinstallprompt", onInstall);
  }, []);

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice?.outcome !== "accepted") setShow(false);
    setDeferredPrompt(null);
  }, [deferredPrompt]);

  const handleDismiss = useCallback(() => {
    setShow(false);
  }, []);

  if (!show) return null;

  return (
    <div
      role="dialog"
      aria-label="Install app"
      className="fixed bottom-4 left-4 right-4 z-50 flex items-center gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 shadow-lg sm:left-auto sm:max-w-sm"
    >
      <div className="flex-1">
        <p className="text-sm font-semibold text-amber-200">
          Install Stellar MarketPay
        </p>
        <p className="text-xs text-amber-600/80">
          Add to your home screen for a better experience.
        </p>
      </div>
      <div className="flex gap-2">
        <button
          onClick={handleInstall}
          className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-ink-900 transition-colors hover:bg-amber-400"
        >
          Install
        </button>
        <button
          onClick={handleDismiss}
          className="rounded-lg px-3 py-1.5 text-xs font-semibold text-amber-400 transition-colors hover:text-amber-300"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}