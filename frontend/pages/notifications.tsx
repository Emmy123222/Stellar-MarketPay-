import { useEffect, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import clsx from "clsx";
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/api";
import { timeAgo } from "@/utils/format";
import type { NotificationItem } from "@/utils/types";

interface NotificationsPageProps {
  publicKey: string | null;
  onConnect: () => void;
}

function notificationHref(notification: NotificationItem) {
  return notification.linkPath || (notification.jobId ? `/jobs/${notification.jobId}` : "/notifications");
}

export default function NotificationsPage({ publicKey, onConnect }: NotificationsPageProps) {
  const router = useRouter();
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  async function loadNotifications(cursor?: string | null) {
    if (!publicKey) return;
    if (cursor) setLoadingMore(true);
    else setLoading(true);

    try {
      const result = await fetchNotifications({ limit: 20, cursor });
      setNotifications((current) =>
        cursor ? [...current, ...result.notifications] : result.notifications,
      );
      setUnreadCount(result.unreadCount);
      setNextCursor(result.nextCursor);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    loadNotifications();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey]);

  async function openNotification(notification: NotificationItem) {
    if (!notification.read) {
      setNotifications((items) =>
        items.map((item) =>
          item.id === notification.id ? { ...item, read: true } : item,
        ),
      );
      setUnreadCount((count) => Math.max(count - 1, 0));
      await markNotificationRead(notification.id).catch(() => undefined);
    }
    router.push(notificationHref(notification));
  }

  async function markEverythingRead() {
    await markAllNotificationsRead();
    setNotifications((items) => items.map((item) => ({ ...item, read: true })));
    setUnreadCount(0);
  }

  return (
    <>
      <Head>
        <title>Notifications | Stellar MarketPay</title>
      </Head>
      <section className="max-w-4xl mx-auto px-4 sm:px-6 py-10">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
          <div>
            <h1 className="font-display text-3xl font-bold text-amber-100">Notifications</h1>
            <p className="text-sm text-amber-700 mt-1">
              {publicKey ? `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}` : "Connect your wallet to view notifications."}
            </p>
          </div>
          {publicKey && (
            <button
              type="button"
              onClick={markEverythingRead}
              disabled={unreadCount === 0}
              className="btn-secondary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Mark all read
            </button>
          )}
        </div>

        {!publicKey ? (
          <div className="border border-amber-900/30 rounded-lg p-6 bg-ink-800/50">
            <p className="text-amber-200 mb-4">Notifications are tied to your wallet account.</p>
            <button type="button" onClick={onConnect} className="btn-primary">
              Connect wallet
            </button>
          </div>
        ) : loading ? (
          <div className="border border-amber-900/30 rounded-lg p-6 bg-ink-800/50 text-amber-700">
            Loading notifications...
          </div>
        ) : notifications.length === 0 ? (
          <div className="border border-amber-900/30 rounded-lg p-6 bg-ink-800/50 text-amber-700">
            No notifications yet.
          </div>
        ) : (
          <div className="border border-amber-900/30 rounded-lg bg-ink-800/50 overflow-hidden">
            {notifications.map((notification) => (
              <button
                key={notification.id}
                type="button"
                onClick={() => openNotification(notification)}
                className={clsx(
                  "w-full px-5 py-4 text-left border-b border-amber-900/20 last:border-b-0 hover:bg-market-500/8 transition-colors",
                  !notification.read && "bg-market-500/10",
                )}
              >
                <span className="flex gap-3">
                  {!notification.read && (
                    <span className="mt-2 h-2.5 w-2.5 rounded-full bg-market-400 flex-shrink-0" />
                  )}
                  <span className="min-w-0">
                    <span className="block text-base font-semibold text-amber-100">
                      {notification.title}
                    </span>
                    <span className="block text-sm text-amber-600 mt-1">
                      {notification.body}
                    </span>
                    <span className="block text-xs text-amber-800 mt-2">
                      {timeAgo(notification.createdAt)}
                    </span>
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}

        {publicKey && nextCursor && (
          <div className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={() => loadNotifications(nextCursor)}
              disabled={loadingMore}
              className="btn-secondary text-sm"
            >
              {loadingMore ? "Loading..." : "Load more"}
            </button>
          </div>
        )}
      </section>
    </>
  );
}
