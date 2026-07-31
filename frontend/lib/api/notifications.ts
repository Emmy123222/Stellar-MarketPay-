import { api } from "./client";
import type { NotificationItem } from "@/utils/types";

export interface NotificationsResponse {
  notifications: NotificationItem[];
  unreadCount: number;
  nextCursor: string | null;
  hasMore: boolean;
}

export async function fetchNotifications(params?: {
  limit?: number;
  after?: string;
  cursor?: string | null;
}): Promise<NotificationsResponse> {
  const { data } = await api.get<{
    success: boolean;
    data: NotificationsResponse;
  }>("/api/notifications", {
    params: {
      limit: params?.limit,
      after: params?.after,
      cursor: params?.cursor || undefined,
    },
  });
  return {
    ...data.data,
    hasMore: data.data.has_more ?? Boolean(data.data.next_cursor),
  };
}

export async function markNotificationRead(id: string): Promise<NotificationItem> {
  const { data } = await api.patch<{
    success: boolean;
    data: NotificationItem;
  }>(`/api/notifications/${id}/read`);
  return data.data;
}

export async function markAllNotificationsRead(): Promise<{ updatedCount: number }> {
  const { data } = await api.patch<{
    success: boolean;
    data: { updatedCount: number };
  }>("/api/notifications/read-all");
  return data.data;
}
