/**
 * components/MessageThread.tsx
 * Private 1-1 message thread between job client and freelancer.
 * Messages are uploaded to IPFS for persistence and notarized on-chain
 * via Soroban events for censorship resistance.
 * Supports E2E encrypted file attachments via NaCl box (Issue #498).
 */

import { useState, useEffect, useRef, useCallback, type FormEvent } from "react";
import {
  fetchMessages,
  sendMessage,
  attachMessageTxHash,
  fetchRecipientEncryptionKey,
  publishMyEncryptionKey,
  uploadMessageAttachment,
} from "@/lib/api";
import { publishMessageOnChain } from "@/lib/stellar";
import {
  myPublicKeyBase64,
  encryptForRecipient,
  decryptFromSender,
} from "@/lib/crypto";
import type { Message } from "@/utils/types";
import { shortenAddress, timeAgo } from "@/utils/format";
import clsx from "clsx";

interface MessageThreadProps {
  jobId: string;
  currentUserAddress: string;
  otherUserAddress: string;
}

// ── AttachmentLine ─────────────────────────────────────────────────────────────

interface AttachmentLineProps {
  cid: string;
  name: string | null | undefined;
  mime: string | null | undefined;
  senderNaclPub: string | null | undefined;
}

function AttachmentLine({ cid, name, mime, senderNaclPub }: AttachmentLineProps) {
  const [decrypting, setDecrypting] = useState(false);
  const [thumbUrl, setThumbUrl] = useState<string | null>(null);
  const [decryptError, setDecryptError] = useState<string | null>(null);

  const displayName = name?.replace(/\.enc$/, "") ?? "file";
  const isImage = mime?.startsWith("image/") || /\.(jpg|jpeg|png|gif|webp)$/i.test(displayName);

  const handleDecrypt = async () => {
    if (!senderNaclPub) {
      setDecryptError("Sender key unavailable — cannot decrypt");
      return;
    }
    setDecrypting(true);
    setDecryptError(null);
    try {
      const gatewayUrl = `https://gateway.pinata.cloud/ipfs/${cid}`;
      const res = await fetch(gatewayUrl);
      if (!res.ok) throw new Error(`IPFS fetch failed: ${res.status}`);
      const raw = new Uint8Array(await res.arrayBuffer());
      const plain = decryptFromSender(raw, senderNaclPub);
      const blob = new Blob([plain as BlobPart]);
      const url = URL.createObjectURL(blob);

      if (isImage) {
        setThumbUrl(url);
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.download = displayName;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
      }
    } catch (e: unknown) {
      setDecryptError(e instanceof Error ? e.message : "Decryption failed");
    } finally {
      setDecrypting(false);
    }
  };

  return (
    <div className="mt-2 rounded-lg border border-market-500/20 bg-market-900/50 px-3 py-2 text-xs">
      {thumbUrl ? (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={thumbUrl}
          alt={displayName}
          className="max-w-[200px] max-h-[200px] rounded object-contain"
        />
      ) : (
        <div className="flex items-center gap-2">
          <svg className="w-3.5 h-3.5 text-market-400 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M4 1.5h5l3 3V14a.5.5 0 01-.5.5h-7A.5.5 0 014 14V2a.5.5 0 010-.5z" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M9 1.5V5h3.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-market-300 truncate max-w-[140px]">{displayName}</span>
          <button
            type="button"
            onClick={handleDecrypt}
            disabled={decrypting}
            className="ml-auto text-amber-600 hover:text-amber-400 underline disabled:opacity-50 shrink-0"
          >
            {decrypting ? "Decrypting…" : isImage ? "View" : "Download"}
          </button>
        </div>
      )}
      {decryptError && <p className="mt-1 text-red-400">{decryptError}</p>}
    </div>
  );
}

// ── MessageThread ──────────────────────────────────────────────────────────────

export default function MessageThread({ jobId, currentUserAddress, otherUserAddress }: MessageThreadProps) {
  const [messages, setMessages]   = useState<Message[]>([]);
  const [input, setInput]         = useState("");
  const [sending, setSending]     = useState(false);
  const [encrypting, setEncrypting] = useState(false);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);

  const messagesEndRef       = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef             = useRef<HTMLInputElement>(null);
  const fileInputRef         = useRef<HTMLInputElement>(null);
  const isMountedRef         = useRef<boolean>(true);

  // Fetch messages on mount
  useEffect(() => {
    isMountedRef.current = true;
    const loadMessages = async () => {
      try {
        setLoading(true);
        setError(null);
        const msgs = await fetchMessages(jobId);
        if (isMountedRef.current) setMessages(msgs);
      } catch (e: unknown) {
        if (isMountedRef.current) {
          setError(e instanceof Error ? e.message : "Failed to load messages");
        }
      } finally {
        if (isMountedRef.current) setLoading(false);
      }
    };
    loadMessages();
    return () => { isMountedRef.current = false; };
  }, [jobId]);

  // Register this user's NaCl public key once
  useEffect(() => {
    if (!currentUserAddress) return;
    try {
      const myKey = myPublicKeyBase64();
      publishMyEncryptionKey(currentUserAddress, myKey).catch(() => {});
    } catch { /* noop — SSR guard inside myPublicKeyBase64 */ }
  }, [currentUserAddress]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleSend = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || sending) return;

    const tempId = `temp-${Date.now()}`;
    const optimisticMessage: Message = {
      id: tempId,
      jobId,
      senderAddress: currentUserAddress,
      receiverAddress: otherUserAddress,
      content: trimmed,
      read: false,
      createdAt: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, optimisticMessage]);
    setInput("");
    setSending(true);

    try {
      const sentMessage = await sendMessage(jobId, trimmed);

      if (sentMessage.ipfsCid) {
        try {
          const txHash = await publishMessageOnChain({
            jobId,
            senderPublicKey: currentUserAddress,
            recipientPublicKey: otherUserAddress,
            ipfsCid: sentMessage.ipfsCid,
          });
          const updatedMessage = await attachMessageTxHash(sentMessage.id, txHash);
          sentMessage.txHash = updatedMessage.txHash;
        } catch (onChainError) {
          console.warn("[MessageThread] On-chain notarization failed (non-fatal):", onChainError);
        }
      }

      if (isMountedRef.current) {
        setMessages((prev) => prev.map((m) => (m.id === tempId ? sentMessage : m)));
      }
    } catch (e: unknown) {
      if (isMountedRef.current) {
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        setInput(trimmed);
        setError(e instanceof Error ? e.message : "Failed to send message");
      }
    } finally {
      if (isMountedRef.current) {
        setSending(false);
        inputRef.current?.focus();
      }
    }
  };

  const handleFileAttach = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      setError("File must be under 10 MB");
      return;
    }
    setEncrypting(true);
    setError(null);
    try {
      const recipientKey = await fetchRecipientEncryptionKey(otherUserAddress);
      if (!recipientKey) {
        setError("Recipient hasn't enabled file encryption yet. Ask them to open this thread first.");
        return;
      }
      const data = new Uint8Array(await file.arrayBuffer());
      const encrypted = encryptForRecipient(data, recipientKey);
      const blob = new Blob([encrypted], { type: "application/octet-stream" });
      const senderPub = myPublicKeyBase64();
      const msg = await uploadMessageAttachment(jobId, blob, file.name + ".enc", senderPub);
      if (isMountedRef.current) setMessages((prev) => [...prev, msg]);
    } catch (e: unknown) {
      if (isMountedRef.current) {
        setError(e instanceof Error ? e.message : "File upload failed");
      }
    } finally {
      if (isMountedRef.current) setEncrypting(false);
    }
  };

  const isOwnMessage = (senderAddress: string) => senderAddress === currentUserAddress;

  if (loading) {
    return (
      <div className="card border-market-500/12">
        <div className="flex flex-col gap-3 py-8">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className={clsx(
                "animate-pulse rounded-2xl px-4 py-3 max-w-[80%]",
                i === 2 ? "mx-auto w-fit" : "",
                i % 2 === 1 ? "ml-auto bg-market-500/10" : "bg-ink-800",
              )}
            >
              <div className="h-4 bg-market-500/20 rounded w-32 mb-2" />
              <div className="h-3 bg-market-500/15 rounded w-24" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error && messages.length === 0) {
    return (
      <div className="card border-red-500/20 bg-red-500/5 py-8 text-center">
        <p className="text-red-400 text-sm">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="mt-3 text-xs text-amber-600 hover:text-amber-400 underline"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="card border-market-500/12 flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 pt-4 pb-2 border-b border-market-500/8">
        <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
        <span className="text-xs font-mono text-market-400 uppercase tracking-wide">
          Private Conversation
        </span>
      </div>

      {/* Messages list */}
      <div
        ref={messagesContainerRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-[300px] max-h-[400px]"
      >
        {messages.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-amber-800 text-sm">No messages yet. Start the conversation!</p>
          </div>
        ) : (
          messages.map((msg) => {
            const own = isOwnMessage(msg.senderAddress);
            return (
              <div
                key={msg.id}
                className={clsx(
                  "flex flex-col max-w-[80%] rounded-2xl px-4 py-3",
                  own
                    ? "ml-auto bg-market-500/10 border border-market-500/15"
                    : "bg-ink-800",
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold text-market-400">
                    {own ? "You" : shortenAddress(msg.senderAddress)}
                  </span>
                  <span className="text-[10px] text-amber-900">{timeAgo(msg.createdAt)}</span>
                </div>
                <p className="text-amber-100 text-sm leading-relaxed break-words">
                  {msg.content}
                </p>
                {msg.attachmentCid && (
                  <AttachmentLine
                    cid={msg.attachmentCid}
                    name={msg.attachmentName}
                    mime={msg.attachmentMime}
                    senderNaclPub={msg.senderNaclPub}
                  />
                )}
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Error banner (non-blocking) */}
      {error && messages.length > 0 && (
        <div className="mx-4 mb-2 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p className="text-red-400 text-xs">{error}</p>
        </div>
      )}

      {/* Input form */}
      <form onSubmit={handleSend} className="p-4 border-t border-market-500/8">
        <div className="flex items-center gap-2">
          {/* Hidden file input */}
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".jpg,.jpeg,.png,.gif,.webp,.pdf,.txt,.doc,.docx"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) { handleFileAttach(f); e.target.value = ""; }
            }}
          />

          {/* Paperclip button */}
          <button
            type="button"
            aria-label="Attach encrypted file"
            disabled={encrypting || sending}
            onClick={() => fileInputRef.current?.click()}
            className="p-2.5 rounded-xl border border-market-500/15 text-amber-700 hover:text-market-400 hover:border-market-500/40 disabled:opacity-40 transition-colors shrink-0"
          >
            {encrypting ? (
              <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" strokeOpacity="0.3" />
                <path d="M12 2a10 10 0 0110 10" strokeLinecap="round" />
              </svg>
            ) : (
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>

          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, 2000))}
            placeholder="Type your message..."
            disabled={sending || encrypting}
            maxLength={2000}
            className="flex-1 bg-ink-800 border border-market-500/15 rounded-xl px-4 py-2.5 text-sm text-amber-100 placeholder-amber-900 focus:outline-none focus:border-market-500/40 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || sending || encrypting}
            className={clsx(
              "btn-primary text-sm py-2.5 px-5 whitespace-nowrap",
              (!input.trim() || sending || encrypting) ? "opacity-50 cursor-not-allowed" : "",
            )}
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
        <p className="text-[10px] text-amber-900 mt-2 text-right">{input.length}/2000</p>
      </form>
    </div>
  );
}
