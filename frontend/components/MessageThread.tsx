/**
 * components/MessageThread.tsx
 * Private 1-1 message thread between job client and freelancer.
 */

import { useState, useEffect, useRef, useCallback, type FormEvent } from "react";
import { fetchMessages, sendMessage } from "@/lib/api";
import type { Message } from "@/utils/types";
import { shortenAddress, timeAgo } from "@/utils/format";
import clsx from "clsx";

interface MessageThreadProps {
  jobId: string;
  currentUserAddress: string;
  otherUserAddress: string;
}

export default function MessageThread({ jobId, currentUserAddress, otherUserAddress }: MessageThreadProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isMountedRef = useRef<boolean>(true);
  const isMountedRef = useRef<boolean>(true);

  // Fetch messages on mount
  useEffect(() => {
    isMountedRef.current = true;

    const loadMessages = async () => {
      try {
        setLoading(true);
        setError(null);
        const msgs = await fetchMessages(jobId);
        if (isMountedRef.current) {
          setMessages(msgs);
        }
      } catch (e: unknown) {
        if (isMountedRef.current) {
          const msg = e instanceof Error ? e.message : "Failed to load messages";
          setError(msg);
        }
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
        }
      }
    };

    loadMessages();

    return () => {
      isMountedRef.current = false;
    };
  }, [jobId]);

  // Auto-scroll to bottom when messages change
  const scrollToBottom = useCallback(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
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

    // Optimistic UI update
    setMessages((prev) => [...prev, optimisticMessage]);
    setInput("");
    setSending(true);

    try {
      const sentMessage = await sendMessage(jobId, trimmed);
      // Replace optimistic message with real one
      if (isMountedRef.current) {
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? sentMessage : m))
        );
      }
    } catch (e: unknown) {
      // Remove optimistic message on error
      if (isMountedRef.current) {
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        setInput(trimmed);
        const msg = e instanceof Error ? e.message : "Failed to send message";
        setError(msg);
      }
    } finally {
      if (isMountedRef.current) {
        setSending(false);
        inputRef.current?.focus();
      }
    }
  };

  const isOwnMessage = (senderAddress: string) => senderAddress === currentUserAddress;

  if (loading) {
    return (
      <div className="card border-market-500/12">
        <div className="flex flex-col gap-3 py-8">
          {[1, 2, 3].map((i) => (
            <div key={i} className={clsx(
              "animate-pulse rounded-2xl px-4 py-3 max-w-[80%]",
              i === 2 ? "mx-auto w-fit" : "",
              i % 2 === 1 ? "ml-auto bg-market-500/10" : "bg-ink-800"
            )}>
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
            <p className="text-amber-800 text-sm">
              No messages yet. Start the conversation!
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const own = isOwnMessage(msg.senderAddress);
            return (
              <div
                key={msg.id}
                className={clsx(
                  "flex flex-col max-w-[80%] rounded-2xl px-4 py-3",
                  own ? "ml-auto bg-market-500/10 border border-market-500/15" : "bg-ink-800"
                )}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold text-market-400">
                    {own ? "You" : shortenAddress(msg.senderAddress)}
                  </span>
                  <span className="text-[10px] text-amber-900">
                    {timeAgo(msg.createdAt)}
                  </span>
                </div>
                <p className="text-amber-100 text-sm leading-relaxed break-words">
                  {msg.content}
                </p>
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
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value.slice(0, 2000))}
            placeholder="Type your message..."
            disabled={sending}
            maxLength={2000}
            className="flex-1 bg-ink-800 border border-market-500/15 rounded-xl px-4 py-2.5 text-sm text-amber-100 placeholder-amber-900 focus:outline-none focus:border-market-500/40 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || sending}
            className={clsx(
              "btn-primary text-sm py-2.5 px-5 whitespace-nowrap",
              (!input.trim() || sending) ? "opacity-50 cursor-not-allowed" : ""
            )}
          >
            {sending ? "Sending…" : "Send"}
          </button>
        </div>
        <p className="text-[10px] text-amber-900 mt-2 text-right">
          {input.length}/2000
        </p>
      </form>
    </div>
  );
}
