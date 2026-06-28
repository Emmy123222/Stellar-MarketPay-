/**
 * components/NotificationPreferencesPanel.tsx
 * Notification settings including push notification toggle
 */

import { useEffect, useState } from "react";
import { usePushNotifications } from "@/hooks/usePushNotifications";

export default function NotificationPreferencesPanel() {
  const {
    isSupported,
    isSubscribed,
    isLoading,
    checkSubscriptionStatus,
    subscribe,
    unsubscribe,
  } = usePushNotifications();
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    if (isSupported) {
      checkSubscriptionStatus();
    }
  }, [isSupported, checkSubscriptionStatus]);

  if (!isMounted || !isSupported) {
    return null;
  }

  return (
    <div className="space-y-4">
      <div className="bg-ink-800 rounded-xl p-4 border border-market-500/15">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-amber-100 text-sm mb-1">
              💬 Push Notifications
            </h3>
            <p className="text-amber-800 text-xs">
              Get notified about applications and updates even when the app is
              closed
            </p>
          </div>

          <button
            onClick={isSubscribed ? unsubscribe : subscribe}
            disabled={isLoading}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              isSubscribed
                ? "btn-secondary"
                : "btn-primary"
            } disabled:opacity-50`}
          >
            {isLoading
              ? "Loading..."
              : isSubscribed
                ? "Disable"
                : "Enable"}
          </button>
        </div>

        {isSubscribed && (
          <div className="mt-3 pt-3 border-t border-market-500/10">
            <div className="flex items-center gap-2 text-xs">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              <span className="text-emerald-400">
                Push notifications enabled
              </span>
            </div>
          </div>
        )}
      </div>

      <div className="text-xs text-amber-800 p-3 bg-amber-500/10 rounded-lg border border-amber-500/20">
        <p className="font-medium text-amber-100 mb-1">About push notifications:</p>
        <ul className="space-y-1 list-disc list-inside">
          <li>You'll receive notifications for new applications</li>
          <li>Important updates like escrow releases and disputes</li>
          <li>Messages from other users</li>
          <li>Notifications work even when the browser is closed</li>
        </ul>
      </div>
    </div>
  );
}
