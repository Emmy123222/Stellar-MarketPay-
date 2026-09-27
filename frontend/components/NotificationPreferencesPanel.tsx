/**
 * components/NotificationPreferencesPanel.tsx
 * Notification settings including push notification toggle
 */

import { useEffect, useState, useCallback } from "react";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import debounce from "lodash.debounce";
import { useToast } from "@/components/Toast";
import { fetchNotificationPreferences, updateNotificationPreferences } from "@/lib/api";

const TYPE_LABELS: Record<string, string> = {
  new_application: "New Applications",
  application_accepted: "Application Accepted",
  application_rejected: "Application Rejected",
  payment_released: "Payment Released",
  new_message: "New Messages",
  job_expiring: "Job Expiring",
  dispute_filed: "Dispute Filed",
  weekly_digest: "Weekly Digest",
  announcements: "Announcements",
};

export default function NotificationPreferencesPanel() {
  const toast = useToast();
  const {
    isSupported,
    isSubscribed,
    isLoading: isPushLoading,
    checkSubscriptionStatus,
    subscribe,
    unsubscribe,
  } = usePushNotifications();

  const [isMounted, setIsMounted] = useState(false);
  const [preferences, setPreferences] = useState<Record<string, { email: boolean; inapp: boolean }>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setIsMounted(true);
    if (isSupported) {
      checkSubscriptionStatus();
    }
  }, [isSupported, checkSubscriptionStatus]);

  useEffect(() => {
    let mounted = true;
    fetchNotificationPreferences().then((data) => {
      if (mounted) {
        setPreferences(data.preferences || {});
        setLoading(false);
      }
    }).catch(err => {
      console.error(err);
      if (mounted) setLoading(false);
    });
    return () => { mounted = false; };
  }, []);

  // Use useCallback so debounce isn't recreated on every render
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const savePreferences = useCallback(
    debounce(async (newPrefs) => {
      try {
        await updateNotificationPreferences(newPrefs);
        toast.success("Saved");
      } catch (err) {
        toast.error("Failed to save preferences");
      }
    }, 1000),
    [toast]
  );

  const handleToggle = (type: string, channel: "email" | "inapp", checked: boolean) => {
    const newPrefs = {
      ...preferences,
      [type]: {
        ...(preferences[type] || { email: true, inapp: true }),
        [channel]: checked
      }
    };
    setPreferences(newPrefs);
    savePreferences(newPrefs);
  };

  if (!isMounted) {
    return null;
  }

  return (
    <div className="space-y-6">
      {/* Existing push notification panel */}
      {isSupported && (
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
              disabled={isPushLoading}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                isSubscribed
                  ? "btn-secondary"
                  : "btn-primary"
              } disabled:opacity-50`}
            >
              {isPushLoading
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
      )}

      {/* Email & In-App Preferences */}
      <div className="bg-ink-800 rounded-xl p-4 border border-market-500/15">
        <h3 className="font-semibold text-amber-100 text-sm mb-4">Notification Preferences</h3>
        {loading ? (
          <p className="text-amber-800 text-xs">Loading preferences...</p>
        ) : (
          <div className="space-y-4">
            {Object.keys(preferences).map((type) => (
              <div key={type} className="flex items-center justify-between py-2 border-b border-market-500/10 last:border-0">
                <span className="text-sm text-amber-100 capitalize">
                  {TYPE_LABELS[type] || type.replace(/_/g, " ")}
                </span>
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 text-xs text-amber-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={preferences[type]?.inapp ?? true}
                      onChange={(e) => handleToggle(type, "inapp", e.target.checked)}
                      className="rounded border-market-500/30 bg-ink-900 text-market-400 focus:ring-market-400"
                    />
                    In-App
                  </label>
                  <label className="flex items-center gap-2 text-xs text-amber-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={preferences[type]?.email ?? true}
                      onChange={(e) => handleToggle(type, "email", e.target.checked)}
                      className="rounded border-market-500/30 bg-ink-900 text-market-400 focus:ring-market-400"
                    />
                    Email
                  </label>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="text-xs text-amber-800 p-3 bg-amber-500/10 rounded-lg border border-amber-500/20">
        <p className="font-medium text-amber-100 mb-1">About push notifications:</p>
        <ul className="space-y-1 list-disc list-inside">
          <li>You&apos;ll receive notifications for new applications</li>
          <li>Important updates like escrow releases and disputes</li>
          <li>Messages from other users</li>
          <li>Notifications work even when the browser is closed</li>
        </ul>
      </div>
    </div>
  );
}
