import { api } from "./client";
import type { Message } from "@/utils/types";

/**
 * Fetches all messages for a specific job.
 * Automatically marks messages as read for the current user.
 *
 * @param jobId Job identifier.
 * @returns Messages sorted chronologically (oldest first).
 * @throws {import("axios").AxiosError} If unauthorized, job not found, or request fails.
 * @see backend/src/routes/messageRoutes.js
 */
export async function fetchMessages(jobId: string): Promise<Message[]> {
  const { data } = await api.get<{ success: boolean; data: Message[] }>(
    `/api/messages/job/${jobId}`,
  );
  return data.data;
}

/**
 * Sends a message in a job thread.
 *
 * Request payload shape:
 * - `content` (string): message text (1-2000 characters).
 *
 * @param jobId Job identifier.
 * @param content Message content.
 * @returns The created message object.
 * @throws {import("axios").AxiosError} If unauthorized, validation fails, or request fails.
 * @see backend/src/routes/messageRoutes.js
 */
export async function sendMessage(
  jobId: string,
  content: string,
  contractTxHash?: string,
): Promise<Message> {
  const { data } = await api.post<{ success: boolean; data: Message }>(
    `/api/messages/job/${jobId}`,
    { content, contractTxHash },
  );
  return data.data;
}

/**
 * Fetches the total unread message count for the authenticated user.
 *
 * @returns Number of unread messages.
 * @throws {import("axios").AxiosError} If not authenticated or request fails.
 * @see backend/src/routes/messageRoutes.js
 */
export async function fetchUnreadCount(): Promise<number> {
  const { data } = await api.get<{
    success: boolean;
    data: { unreadCount: number };
  }>("/api/messages/unread-count");
  return data.data.unreadCount;
}

/**
 * Attaches an on-chain Soroban transaction hash to a message record.
 * Called after the frontend signs and submits the publish_message event.
 */
export async function attachMessageTxHash(
  messageId: string,
  txHash: string,
): Promise<Message> {
  const { data } = await api.patch<{ success: boolean; data: Message }>(
    `/api/messages/${messageId}/tx-hash`,
    { txHash },
  );
  return data.data;
}

// ── Encrypted file attachment (#498) ────────────────────────────────────────

export async function uploadMessageAttachment(
  jobId: string,
  encryptedBlob: Blob,
  fileName: string,
  senderNaclPub: string,
): Promise<Message> {
  const formData = new FormData();
  formData.append("file", encryptedBlob, fileName);
  formData.append("senderNaclPub", senderNaclPub);
  const { data } = await api.post<{ success: boolean; data: Message }>(
    `/api/messages/job/${jobId}/attachments`,
    formData,
    { headers: { "Content-Type": "multipart/form-data" }, timeout: 60_000 },
  );
  return data.data;
}
