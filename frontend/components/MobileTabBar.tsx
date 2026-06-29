/**
 * components/MobileTabBar.tsx
 *
 * Fixed bottom navigation bar for mobile viewports (< 768px).
 * Hidden at md breakpoint and above via `md:hidden`.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { fetchNotifications } from "@/lib/api";

// ---------------------------------------------------------------------------
// Tab configuration
// ---------------------------------------------------------------------------

interface TabConfig {
  href: string;
  label: string;
  ariaLabel: string;
  icon: React.ReactNode;
}

export const TABS: TabConfig[] = [
  {
    href: "/",
    label: "Home",
    ariaLabel: "Home",
    icon: (
      <svg
        aria-hidden="true"
        className="w-6 h-6"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 12l2-2m0 0l7-7 7 7m-2 0v10a1 1 0 01-1 1H14a1 1 0 01-1-1v-4H11v4a1 1 0 01-1 1H6a1 1 0 01-1-1V10m-2 0l2-2"
        />
      </svg>
    ),
  },
  {
    href: "/jobs",
    label: "Jobs",
    ariaLabel: "Jobs",
    icon: (
      <svg
        aria-hidden="true"
        className="w-6 h-6"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M20.25 14.15v4.25c0 1.094-.787 2.036-1.872 2.18A48.194 48.194 0 0112 21a48.194 48.194 0 01-6.378-.42C4.537 20.186 3.75 19.244 3.75 18.15v-4.25m16.5 0a2.18 2.18 0 00.75-1.661V8.706c0-1.081-.768-2.015-1.837-2.175a48.111 48.111 0 00-3.413-.387m4.5 8.006c-.194.165-.42.295-.673.38A23.978 23.978 0 0112 15.75c-2.648 0-5.195-.429-7.577-1.22a2.016 2.016 0 01-.673-.38m0 0A2.18 2.18 0 013 12.489V8.706c0-1.081.768-2.015 1.837-2.175a48.111 48.111 0 013.413-.387m7.5 0V5.25A2.25 2.25 0 0013.5 3h-3a2.25 2.25 0 00-2.25 2.25v.894m7.5 0a48.667 48.667 0 00-7.5 0"
        />
      </svg>
    ),
  },
  {
    href: "/dashboard",
    label: "Dashboard",
    ariaLabel: "Dashboard",
    icon: (
      <svg
        aria-hidden="true"
        className="w-6 h-6"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z"
        />
      </svg>
    ),
  },
  {
    href: "/notifications",
    label: "Notifications",
    ariaLabel: "Notifications",
    icon: (
      <svg
        aria-hidden="true"
        className="w-6 h-6"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
        />
      </svg>
    ),
  },
  {
    href: "/profile",
    label: "Profile",
    ariaLabel: "Profile",
    icon: (
      <svg
        aria-hidden="true"
        className="w-6 h-6"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.75}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M17.982 18.725A7.488 7.488 0 0012 15.75a7.488 7.488 0 00-5.982 2.975m11.963 0a9 9 0 10-11.963 0m11.963 0A8.966 8.966 0 0112 21a8.966 8.966 0 01-5.982-2.275M15 9.75a3 3 0 11-6 0 3 3 0 016 0z"
        />
      </svg>
    ),
  },
];

// ---------------------------------------------------------------------------
// Notification badge helper
// ---------------------------------------------------------------------------

function badgeText(count: number): string {
  if (count > 99) return "99+";
  return String(count);
}

// ---------------------------------------------------------------------------
// MobileTabBar component
// ---------------------------------------------------------------------------

interface MobileTabBarProps {
  publicKey: string | null;
  /** Test-injection prop: sets the initial unread count without polling. */
  initialUnreadCount?: number;
}

export default function MobileTabBar({
  publicKey,
  initialUnreadCount,
}: MobileTabBarProps) {
  const router = useRouter();
  const { pathname } = router;

  const [unreadCount, setUnreadCount] = useState<number>(
    initialUnreadCount ?? 0,
  );

  // When initialUnreadCount prop changes (test injection), sync to state.
  useEffect(() => {
    if (initialUnreadCount !== undefined) {
      setUnreadCount(initialUnreadCount);
    }
  }, [initialUnreadCount]);

  // Clear badge when viewing the notifications page.
  useEffect(() => {
    if (pathname === "/notifications") {
      setUnreadCount(0);
    }
  }, [pathname]);

  // Poll for unread notifications when authenticated.
  useEffect(() => {
    if (!publicKey) return;
    // Skip polling when initialUnreadCount is provided (test mode).
    if (initialUnreadCount !== undefined) return;

    let active = true;

    async function poll() {
      try {
        const result = await fetchNotifications({ limit: 1 });
        if (!active) return;
        setUnreadCount(result.unreadCount);
      } catch {
        // Non-critical — keep previous count on failure.
      }
    }

    poll();
    const id = window.setInterval(poll, 30_000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [publicKey, initialUnreadCount]);

  return (
    <nav
      aria-label="Mobile navigation"
      className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex items-stretch border-t border-amber-900/20 bg-ink-900/95 backdrop-blur-xl"
    >
      {TABS.map((tab) => {
        const isActive = pathname === tab.href;
        const isNotifications = tab.href === "/notifications";
        const showBadge = isNotifications && unreadCount > 0;

        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-label={tab.ariaLabel}
            aria-current={isActive ? "page" : undefined}
            className={`
              relative flex flex-1 flex-col items-center justify-center gap-0.5
              py-2 px-1 text-[10px] font-medium transition-colors duration-150
              min-h-[56px] min-w-0
              ${isActive
                ? "text-market-400"
                : "text-amber-700 hover:text-amber-300"
              }
            `}
          >
            {/* Icon */}
            <span className="relative flex-shrink-0">
              {tab.icon}

              {/* Notification badge */}
              {showBadge && (
                <span
                  role="status"
                  className="absolute -top-1 -right-1 min-w-[1.1rem] h-[1.1rem] px-0.5 rounded-full bg-rose-500 text-white text-[10px] font-bold leading-[1.1rem] text-center flex items-center justify-center"
                >
                  {badgeText(unreadCount)}
                  <span className="sr-only">
                    {unreadCount > 99
                      ? "99+ unread notifications"
                      : `${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`}
                  </span>
                </span>
              )}
            </span>

            {/* Label */}
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
