import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";

type CursorMap = Record<string, { start: number; end: number; updatedAt: number }>;

type ScopeMessage =
  | { event: "scope:init"; payload: { sessionId: string; participantId: string; content: string; cursors: CursorMap } }
  | { event: "scope:update"; payload: { sessionId: string; content: string; cursors: CursorMap } }
  | { event: "scope:finalized"; payload: { sessionId: string; content: string; payload?: Record<string, string> } }
  | { event: "scope:error"; payload: { error: string } }
  | { event: "connected"; payload: { channel: string } };

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
  const socketRef = useRef<WebSocket | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

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
          return;
        }
        if (msg.event === "scope:update") {
          setDocumentText(msg.payload.content || "");
          setCursors(msg.payload.cursors || {});
          return;
        }
        if (msg.event === "scope:finalized") {
          setDocumentText(msg.payload.content || "");
          setStatus("Scope finalized");
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
    setDocumentText(value);
    const el = textareaRef.current;
    const start = el?.selectionStart || 0;
    const end = el?.selectionEnd || 0;
    sendUpdate(value, start, end);
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

  const activePeerCursors = Object.entries(cursors).filter(([id]) => id !== participantId);

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10">
      <div className="card space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold text-amber-100">Scope Collaboration Session</h1>
            <p className="text-sm text-amber-800">Live status: {status}</p>
          </div>
          <button
            type="button"
            onClick={finalizeScope}
            className="btn-primary px-4 py-2 text-sm"
            disabled={!documentText.trim()}
          >
            Finalize Scope
          </button>
        </div>

        <div className="rounded-xl border border-market-500/20 bg-market-900/30 p-4 space-y-2">
          <p className="text-xs uppercase tracking-wider text-amber-800/70">Share this session URL</p>
          <div className="flex gap-2">
            <input className="input-field flex-1 text-xs" value={shareUrl} readOnly />
            <button type="button" className="btn-secondary px-4 py-2 text-sm" onClick={() => navigator.clipboard.writeText(shareUrl)}>
              Copy
            </button>
          </div>
        </div>

        <div>
          <label className="label">Shared Scope Document</label>
          <textarea
            ref={textareaRef}
            value={documentText}
            onChange={(e) => handleTextChange(e.target.value)}
            onSelect={(e) => {
              const target = e.target as HTMLTextAreaElement;
              sendUpdate(documentText, target.selectionStart, target.selectionEnd);
            }}
            rows={16}
            className="textarea-field"
            placeholder="Write requirements, milestones, and acceptance criteria together..."
          />
        </div>

        <div className="rounded-xl border border-market-500/20 bg-market-900/30 p-4">
          <p className="text-xs uppercase tracking-wider text-amber-800/70 mb-3">Live collaborator cursors</p>
          {activePeerCursors.length === 0 ? (
            <p className="text-sm text-amber-800">No other active collaborator right now.</p>
          ) : (
            <div className="space-y-2">
              {activePeerCursors.map(([peerId, cursor]) => (
                <p key={peerId} className="text-sm text-amber-100">
                  {peerId}: selection {cursor.start} to {cursor.end}
                </p>
              ))}
            </div>
          )}
        </div>

        {error && <p className="text-sm text-red-400">{error}</p>}
      </div>
    </div>
  );
}
