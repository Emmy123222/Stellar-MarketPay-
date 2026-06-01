import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";

type CursorMap = Record<string, { start: number; end: number; updatedAt: number }>;

type ScopeMessage =
  | { event: "scope:init"; payload: { sessionId: string; participantId: string; content: string; cursors: CursorMap; finalized?: boolean; expiresAt?: string } }
  | { event: "scope:update"; payload: { sessionId: string; content: string; cursors: CursorMap } }
  | { event: "scope:finalized"; payload: { sessionId: string; content: string; payload?: Record<string, string> } }
  | { event: "scope:error"; payload: { error: string } }
  | { event: "connected"; payload: { channel: string } };

// Distinct colours for up to 6 peer cursors
const CURSOR_COLORS = ["#f59e0b", "#34d399", "#60a5fa", "#f472b6", "#a78bfa", "#fb923c"];

const PREFILL_KEY = "marketpay_scope_prefill";

function randomSessionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function ScopeSessionPage() {
  const router = useRouter();
  const sessionId = useMemo(() => {
    const raw = router.query.sessionId;
    if (!raw) return "";
    return Array.isArray(raw) ? raw[0] : raw;
  }, [router.query.sessionId]);

  const [participantId, setParticipantId] = useState("");
  const [documentText, setDocumentText] = useState("");
  const [cursors, setCursors] = useState<CursorMap>({});
  const [status, setStatus] = useState("Connecting...");
  const [shareUrl, setShareUrl] = useState("");
  const [error, setError] = useState("");
  const [finalized, setFinalized] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [showExpiryWarning, setShowExpiryWarning] = useState(false);
  const socketRef   = useRef<WebSocket | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const saveTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!router.isReady) return;
    if (!sessionId || sessionId === "new") {
      router.replace(`/scope/${randomSessionId()}`);
    }
  }, [router, sessionId]);

  useEffect(() => {
    if (!sessionId || typeof window === "undefined") return;
    const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
    const api = new URL(apiUrl);
    const protocol = api.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${api.host}/ws/scope/${encodeURIComponent(sessionId)}?participantId=${encodeURIComponent(
      randomSessionId().slice(0, 12)
    )}`;

    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;
    setStatus("Connecting...");
    setShareUrl(window.location.href);

    socket.onopen = () => setStatus("Connected");
    socket.onclose = () => setStatus("Disconnected");
    socket.onerror = () => {
      setStatus("Connection error");
      setError("Unable to connect realtime scope session.");
    };
    socket.onmessage = (event) => {
      try {
        const msg: ScopeMessage = JSON.parse(event.data);
        if (msg.event === "scope:init") {
          setDocumentText(msg.payload.content || "");
          setCursors(msg.payload.cursors || {});
          setParticipantId(msg.payload.participantId);
          if (msg.payload.finalized) setFinalized(true);
          if (msg.payload.expiresAt) setExpiresAt(msg.payload.expiresAt);
          return;
        }
        if (msg.event === "scope:update") {
          setDocumentText(msg.payload.content || "");
          setCursors(msg.payload.cursors || {});
          return;
        }
        if (msg.event === "scope:finalized") {
          setDocumentText(msg.payload.content || "");
          setFinalized(true);
          setStatus("Scope finalized — document is now locked");
          return;
        }
        if (msg.event === "scope:error") {
          setError(msg.payload.error || "Session error");
        }
      } catch (_) {
        setError("Received invalid realtime message");
      }
    };

    return () => {
      socket.close();
      socketRef.current = null;
    };
  }, [sessionId]);

  // Timer to track session expiry and show warning
  useEffect(() => {
    if (!expiresAt) return;

    const updateTimer = () => {
      const now = Date.now();
      const expiryTime = new Date(expiresAt).getTime();
      const remaining = expiryTime - now;
      
      setTimeRemaining(remaining);
      
      // Show warning when less than 30 minutes remain
      if (remaining > 0 && remaining <= 30 * 60 * 1000) {
        setShowExpiryWarning(true);
      } else {
        setShowExpiryWarning(false);
      }

      // Session expired
      if (remaining <= 0) {
        setStatus("Session expired");
        setError("This session has expired. Please save your content.");
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [expiresAt]);

  const sendUpdate = (content: string, selectionStart: number, selectionEnd: number) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !participantId) return;
    const nextCursors = {
      [participantId]: {
        start: selectionStart,
        end: selectionEnd,
        updatedAt: Date.now(),
      },
    };
    socket.send(
      JSON.stringify({
        type: "scope:update",
        content,
        cursors: nextCursors,
      })
    );
  };

  const handleTextChange = (value: string) => {
    if (finalized) return;
    setDocumentText(value);
    // Debounce WS send to ~2 seconds to avoid per-keystroke saves
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const el = textareaRef.current;
      sendUpdate(value, el?.selectionStart || 0, el?.selectionEnd || 0);
    }, 2000);
  };

  const finalizeScope = () => {
    const payload = {
      title: documentText.split("\n").find((line) => line.trim()) || "New freelance scope",
      description: documentText,
      category: "Backend Development",
    };
    if (typeof window !== "undefined") {
      window.localStorage.setItem(PREFILL_KEY, JSON.stringify(payload));
    }

    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "scope:finalize", content: documentText, payload }));
    }

    router.push("/post-job?fromScope=1");
  };

  const downloadContent = () => {
    const blob = new Blob([documentText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `scope-${sessionId}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const renewSession = async () => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000";
      const response = await fetch(`${apiUrl}/api/scope/${sessionId}/renew`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      
      if (response.ok) {
        const data = await response.json();
        setExpiresAt(data.expiresAt);
        setShowExpiryWarning(false);
        setError("");
      } else {
        setError("Failed to renew session");
      }
    } catch (err) {
      setError("Failed to renew session");
    }
  };

  const formatTimeRemaining = (ms: number) => {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  };

  const activePeerCursors = Object.entries(cursors).filter(([id]) => id !== participantId);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
      <div className="card space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold text-amber-100">Scope Collaboration Session</h1>
            <div className="flex items-center gap-2 mt-1">
              <span className={`w-2 h-2 rounded-full ${finalized ? "bg-emerald-400" : status === "Connected" ? "bg-emerald-400 animate-pulse" : "bg-amber-600"}`} />
              <p className="text-sm text-amber-800">{status}</p>
            </div>
          </div>
          {!finalized && (
            <button
              type="button"
              onClick={finalizeScope}
              className="btn-primary px-4 py-2 text-sm"
              disabled={!documentText.trim()}
            >
              Finalize Scope
            </button>
          )}
        </div>

        {finalized && (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 flex items-center gap-3">
            <span className="text-emerald-400 text-lg">✓</span>
            <div>
              <p className="text-sm font-medium text-emerald-300">Scope finalized</p>
              <p className="text-xs text-emerald-600">This document is locked and has been used to create the job.</p>
            </div>
          </div>
        )}

        {/* Session expiry warning banner */}
        {showExpiryWarning && !finalized && timeRemaining !== null && timeRemaining > 0 && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 space-y-3">
            <div className="flex items-start gap-3">
              <span className="text-amber-400 text-lg">⚠</span>
              <div className="flex-1">
                <p className="text-sm font-medium text-amber-300">Session expiring soon</p>
                <p className="text-xs text-amber-600 mt-1">
                  This session will expire in {formatTimeRemaining(timeRemaining)}. Save your content now.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={downloadContent}
                className="btn-secondary px-3 py-1.5 text-xs"
              >
                Download Content
              </button>
              <button
                type="button"
                onClick={renewSession}
                className="btn-primary px-3 py-1.5 text-xs"
              >
                Extend Session (24h)
              </button>
            </div>
          </div>
        )}

        {/* Session expired banner */}
        {timeRemaining !== null && timeRemaining <= 0 && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
            <div className="flex items-start gap-3">
              <span className="text-red-400 text-lg">✕</span>
              <div className="flex-1">
                <p className="text-sm font-medium text-red-300">Session expired</p>
                <p className="text-xs text-red-600 mt-1">
                  This session has expired. You can still download your content below.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={downloadContent}
              className="btn-secondary px-3 py-1.5 text-xs mt-3"
            >
              Download Content
            </button>
          </div>
        )}

        <div className="rounded-xl border border-market-500/20 bg-market-900/30 p-4 space-y-2">
          <p className="text-xs uppercase tracking-wider text-amber-800/70">Share this session URL</p>
          <div className="flex gap-2">
            <input className="input-field flex-1 text-xs" value={shareUrl} readOnly />
            <button type="button" className="btn-secondary px-4 py-2 text-sm" onClick={() => navigator.clipboard.writeText(shareUrl)}>
              Copy
            </button>
          </div>
        </div>

        {/* Live presence indicators */}
        {activePeerCursors.length > 0 && (
          <div className="flex flex-wrap gap-2 items-center">
            <p className="text-xs text-amber-800/70 uppercase tracking-wider">Online:</p>
            {activePeerCursors.map(([peerId], idx) => (
              <span
                key={peerId}
                className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium"
                style={{
                  background: `${CURSOR_COLORS[idx % CURSOR_COLORS.length]}18`,
                  color: CURSOR_COLORS[idx % CURSOR_COLORS.length],
                  border: `1px solid ${CURSOR_COLORS[idx % CURSOR_COLORS.length]}40`,
                }}
              >
                <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: CURSOR_COLORS[idx % CURSOR_COLORS.length] }} />
                {peerId.slice(0, 8)}
              </span>
            ))}
          </div>
        )}

        <div>
          <label className="label">
            Shared Scope Document
            {!finalized && <span className="ml-2 text-xs text-amber-800 font-normal">(auto-saves every 2s)</span>}
          </label>
          <textarea
            ref={textareaRef}
            value={documentText}
            onChange={(e) => handleTextChange(e.target.value)}
            onSelect={(e) => {
              if (finalized) return;
              const target = e.target as HTMLTextAreaElement;
              sendUpdate(documentText, target.selectionStart, target.selectionEnd);
            }}
            rows={16}
            className="textarea-field"
            placeholder="Write requirements, milestones, and acceptance criteria together..."
            readOnly={finalized}
            disabled={finalized}
          />
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>
    </div>
  );
}
