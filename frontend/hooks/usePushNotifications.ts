/**
 * hooks/usePushNotifications.ts
 * Web Push notification subscription management
 */

import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/Toast";

interface PushNotificationState {
  isSupported: boolean;
  isSubscribed: boolean;
  isLoading: boolean;
  vapidPublicKey: string | null;
}

export function usePushNotifications() {
  const { success, error } = useToast();
  const [state, setState] = useState<PushNotificationState>({
    isSupported: false,
    isSubscribed: false,
    isLoading: false,
    vapidPublicKey: null,
  });

  // Check if push notifications are supported
  useEffect(() => {
    const isSupported =
      typeof window !== "undefined" &&
      "serviceWorker" in navigator &&
      "PushManager" in window &&
      "Notification" in window;

    setState((prev) => ({ ...prev, isSupported }));
  }, []);

  // Fetch VAPID public key
  useEffect(() => {
    if (!state.isSupported) return;

    const fetchVapidKey = async () => {
      try {
        const response = await fetch("/api/notifications/vapid-public-key");
        if (!response.ok) throw new Error("Failed to fetch VAPID key");

        const data = await response.json();
        if (data.success) {
          setState((prev) => ({ ...prev, vapidPublicKey: data.data.publicKey }));
        }
      } catch (err) {
        console.error("[Push] Error fetching VAPID key:", err);
      }
    };

    fetchVapidKey();
  }, [state.isSupported]);

  // Check current subscription status
  const checkSubscriptionStatus = useCallback(async () => {
    if (!state.isSupported) return false;

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      const isSubscribed = subscription !== null;

      setState((prev) => ({ ...prev, isSubscribed }));
      return isSubscribed;
    } catch (err) {
      console.error("[Push] Error checking subscription:", err);
      return false;
    }
  }, [state.isSupported]);

  // Request notification permission
  const requestPermission = useCallback(async (): Promise<boolean> => {
    if (!state.isSupported) {
      error("Push notifications are not supported in your browser");
      return false;
    }

    try {
      const permission = await Notification.requestPermission();
      return permission === "granted";
    } catch (err) {
      console.error("[Push] Error requesting permission:", err);
      error("Failed to request notification permission");
      return false;
    }
  }, [state.isSupported, error]);

  // Subscribe to push notifications
  const subscribe = useCallback(async (): Promise<boolean> => {
    if (!state.isSupported) {
      error("Push notifications are not supported");
      return false;
    }

    if (Notification.permission !== "granted") {
      const granted = await requestPermission();
      if (!granted) {
        return false;
      }
    }

    setState((prev) => ({ ...prev, isLoading: true }));

    try {
      const registration = await navigator.serviceWorker.ready;

      // Check if already subscribed
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(state.vapidPublicKey!),
        });
      }

      // Send subscription to backend
      const response = await fetch("/api/notifications/push-subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });

      if (!response.ok) {
        throw new Error("Failed to save subscription on backend");
      }

      setState((prev) => ({ ...prev, isSubscribed: true });
      success("Push notifications enabled");
      return true;
    } catch (err) {
      console.error("[Push] Subscription error:", err);
      error("Failed to enable push notifications");
      return false;
    } finally {
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  }, [state.isSupported, state.vapidPublicKey, requestPermission, success, error]);

  // Unsubscribe from push notifications
  const unsubscribe = useCallback(async (): Promise<boolean> => {
    if (!state.isSupported) {
      error("Push notifications are not supported");
      return false;
    }

    setState((prev) => ({ ...prev, isLoading: true }));

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (!subscription) {
        setState((prev) => ({ ...prev, isSubscribed: false }));
        return true;
      }

      // Notify backend
      const endpoint = subscription.endpoint;
      await fetch("/api/notifications/push-unsubscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ endpoint }),
      }).catch((err) => {
        console.error("[Push] Backend unsubscribe error:", err);
        // Continue with local unsubscribe even if backend fails
      });

      // Unsubscribe locally
      await subscription.unsubscribe();

      setState((prev) => ({ ...prev, isSubscribed: false }));
      success("Push notifications disabled");
      return true;
    } catch (err) {
      console.error("[Push] Unsubscribe error:", err);
      error("Failed to disable push notifications");
      return false;
    } finally {
      setState((prev) => ({ ...prev, isLoading: false }));
    }
  }, [state.isSupported, success, error]);

  return {
    ...state,
    checkSubscriptionStatus,
    requestPermission,
    subscribe,
    unsubscribe,
  };
}

/**
 * Convert VAPID public key from base64 to Uint8Array
 */
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/\-/g, "+").replace(/_/g, "/");

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}
