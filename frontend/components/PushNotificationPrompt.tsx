/**
 * components/PushNotificationPrompt.tsx
 * Prompts user to enable push notifications after first job action
 */

import { useEffect, useState } from "react";
import { usePushNotifications } from "@/hooks/usePushNotifications";

interface PushNotificationPromptProps {
  /** Show prompt when this trigger occurs (e.g., after job application) */
  trigger?: boolean;
  /** Callback when user dismisses prompt */
  onDismiss?: () => void;
}

export default function PushNotificationPrompt({
  trigger = false,
  onDismiss,
}: PushNotificationPromptProps) {
  const { isSupported, isSubscribed, isLoading, subscribe } =
    usePushNotifications();
  const [showPrompt, setShowPrompt] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Check localStorage for dismissal
  useEffect(() => {
    const isDismissed = localStorage.getItem("push-notification-prompt-dismissed");
    if (isDismissed) {
      setDismissed(true);
    }
  }, []);

  // Show prompt when trigger occurs and conditions are met
  useEffect(() => {
    if (
      trigger &&
      !dismissed &&
      isSupported &&
      !isSubscribed &&
      typeof window !== "undefined"
    ) {
      // Show prompt after a small delay
      const timer = setTimeout(() => {
        setShowPrompt(true);
      }, 1000);

      return () => clearTimeout(timer);
    }
  }, [trigger, dismissed, isSupported, isSubscribed]);

  const handleEnable = async () => {
    const success = await subscribe();
    if (success) {
      setShowPrompt(false);
      setDismissed(true);
      localStorage.setItem("push-notification-prompt-dismissed", "true");
      onDismiss?.();
    }
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    setDismissed(true);
    localStorage.setItem("push-notification-prompt-dismissed", "true");
    onDismiss?.();
  };

  if (!showPrompt || !isSupported) {
    return null;
  }

  return (
    <div
      className="fixed bottom-5 right-5 max-w-sm bg-ink-900 border border-market-500/30 rounded-xl p-4 shadow-lg z-40 animate-in fade-in slide-in-from-bottom-5 duration-300"
      role="alert"
    >
      <div className="flex items-start gap-3">
        <div className="flex-1">
          <h3 className="font-semibold text-amber-100 text-sm mb-1">
            💬 Stay Updated
          </h3>
          <p className="text-amber-800 text-sm mb-3">
            Get notified about new applications and important updates even when
            the app is closed.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleEnable}
              disabled={isLoading}
              className="btn-primary text-xs py-2 px-3 flex-1 disabled:opacity-50"
            >
              {isLoading ? "Enabling..." : "Enable"}
            </button>
            <button
              onClick={handleDismiss}
              disabled={isLoading}
              className="btn-secondary text-xs py-2 px-3 flex-1 disabled:opacity-50"
            >
              Later
            </button>
          </div>
        </div>
        <button
          onClick={handleDismiss}
          className="text-amber-700 hover:text-amber-400 transition-colors pt-1"
          aria-label="Close"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
