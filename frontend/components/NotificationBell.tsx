import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import clsx from "clsx";
import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/api";
import { timeAgo } from "@/utils/format";
import type { NotificationItem } from "@/utils/types";

interface NotificationBellProps {
  publicKey: string;
}

function resolveNotificationHref(notification: NotificationItem) {
  return notification.linkPath || (notification.jobId ? `/jobs/${notification.jobId}` : "/notifications");
}

export default function NotificationBell({ publicKey }: NotificationBellProps) {
  const router = useRouter();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadNotifications() {
      setLoading(true);
      try {
        const result = await fetchNotifications({ limit: 10 });
        if (!active) return;
        setNotifications(result.notifications);
        setUnreadCount(result.unreadCount);
      } catch {
        if (!active) return;
        setNotifications([]);
        setUnreadCount(0);
      } finally {
        if (active) setLoading(false);
      }
    }

    loadNotifications();
    const intervalId = window.setInterval(loadNotifications, 30000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [publicKey]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!panelRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  async function handleNotificationClick(notification: NotificationItem) {
    if (!notification.read) {
      setNotifications((items) =>
        items.map((item) =>
          item.id === notification.id ? { ...item, read: true } : item,
        ),
      );
      setUnreadCount((count) => Math.max(count - 1, 0));
      await markNotificationRead(notification.id).catch(() => undefined);
    }
    setOpen(false);
    router.push(resolveNotificationHref(notification));
  }

  async function handleMarkAllRead() {
    await markAllNotificationsRead();
    setNotifications((items) => items.map((item) => ({ ...item, read: true })));
    setUnreadCount(0);
  }

  return (
    <div className="relative" ref={panelRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="relative p-2 rounded-lg text-amber-700 hover:text-amber-300 hover:bg-market-500/8 transition-colors"
        aria-label="Notifications"
        title="Notifications"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0a3 3 0 11-6 0m6 0H9" />
        </svg>
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold leading-[1.1rem] text-center">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-11 w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-amber-900/30 bg-ink-900 shadow-2xl shadow-black/30 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-amber-900/30">
            <p className="text-sm font-semibold text-amber-100">Notifications</p>
            <button
              type="button"
              onClick={handleMarkAllRead}
              disabled={unreadCount === 0}
              className="text-xs text-market-400 hover:text-market-300 disabled:opacity-40"
            >
              Mark all read
            </button>
          </div>

          <div className="max-h-96 overflow-y-auto">
            {loading && notifications.length === 0 ? (
              <p className="px-4 py-6 text-sm text-amber-700">Loading notifications...</p>
            ) : notifications.length === 0 ? (
              <p className="px-4 py-6 text-sm text-amber-700">No notifications yet.</p>
            ) : (
              notifications.map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => handleNotificationClick(notification)}
                  className={clsx(
                    "w-full px-4 py-3 text-left border-b border-amber-900/20 hover:bg-market-500/8 transition-colors",
                    !notification.read && "bg-market-500/10",
                  )}
                >
                  <span className="flex items-start gap-2">
                    {!notification.read && (
                      <span className="mt-1.5 h-2 w-2 rounded-full bg-market-400 flex-shrink-0" />
                    )}
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-amber-100 truncate">
                        {notification.title}
                      </span>
                      <span className="block text-xs text-amber-700 line-clamp-2 mt-0.5">
                        {notification.body}
                      </span>
                      <span className="block text-[11px] text-amber-800 mt-1">
                        {timeAgo(notification.createdAt)}
                      </span>
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              setOpen(false);
              router.push("/notifications");
            }}
            className="w-full px-4 py-3 text-sm font-medium text-market-400 hover:text-market-300 hover:bg-market-500/8 border-t border-amber-900/30"
          >
            View all notifications
          </button>
        </div>
      )}
    </div>
  );
}
