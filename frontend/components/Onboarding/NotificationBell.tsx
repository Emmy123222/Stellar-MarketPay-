import React from 'react';

export interface NotificationBellProps {
  unreadCount: number;
  onClick?: () => void;
}

export function NotificationBell({ unreadCount, onClick }: NotificationBellProps) {
  const displayCount = unreadCount > 99 ? '99+' : unreadCount;
  const ariaLabel = `${unreadCount} unread notifications`;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="relative p-2 text-gray-600 hover:text-gray-900 focus:outline-none"
    >
      {/* Bell Icon SVG */}
      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
        />
      </svg>

      {unreadCount > 0 && (
        <span
          aria-hidden="true"
          className="absolute top-0 right-0 inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-bold leading-none text-red-100 bg-red-600 rounded-full transform translate-x-1/2 -translate-y-1/2"
        >
          {displayCount}
        </span>
      )}
    </button>
  );
}

// Alias kept for the onboarding barrel/tests that import the onboarding-specific name.
export const OnboardingNotificationBell = NotificationBell;