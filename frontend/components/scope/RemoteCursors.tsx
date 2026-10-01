import React from "react";
import { CursorMap } from "@/lib/api/scope";

export const CURSOR_COLORS = [
  "#f59e0b", // amber
  "#34d399", // emerald
  "#60a5fa", // sky
  "#f472b6", // pink
  "#a78bfa", // purple
  "#fb923c", // orange
  "#2dd4bf", // teal
  "#e879f9", // fuchsia
];

export function getCollaboratorColor(id: string, index = 0): string {
  if (!id) return CURSOR_COLORS[0];
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash << 5) - hash + id.charCodeAt(i);
    hash |= 0;
  }
  const idx = Math.abs(hash) % CURSOR_COLORS.length;
  return CURSOR_COLORS[idx] || CURSOR_COLORS[index % CURSOR_COLORS.length];
}

export function getCursorPosition(text: string, offset: number) {
  const clamped = Math.max(0, Math.min(offset, text.length));
  const lines = text.slice(0, clamped).split("\n");
  const line = lines.length;
  const col = lines[lines.length - 1].length + 1;
  return { line, col, offset: clamped };
}

interface RemoteCursorsProps {
  cursors: CursorMap;
  currentParticipantId: string;
  documentText: string;
  className?: string;
  showOverlay?: boolean;
}

export default function RemoteCursors({
  cursors,
  currentParticipantId,
  documentText,
  className = "",
}: RemoteCursorsProps) {
  const remotePeers = Object.entries(cursors || {}).filter(
    ([peerId]) => Boolean(peerId) && peerId !== currentParticipantId,
  );

  if (remotePeers.length === 0) return null;

  return (
    <div
      data-testid="remote-cursors-container"
      className={`space-y-2 ${className}`}
    >
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-amber-800/80 uppercase tracking-wider font-semibold">
          Active Collaborators ({remotePeers.length}):
        </span>
        {remotePeers.map(([peerId, cursor], idx) => {
          const color = getCollaboratorColor(peerId, idx);
          const startPos = getCursorPosition(documentText, cursor?.start ?? 0);
          const isSelection =
            cursor?.start !== undefined &&
            cursor?.end !== undefined &&
            cursor.start !== cursor.end;

          const labelText = peerId.slice(0, 8);

          return (
            <div
              key={peerId}
              data-testid={`remote-cursor-${peerId}`}
              data-participant-id={peerId}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium transition-all shadow-sm"
              style={{
                backgroundColor: `${color}18`,
                color,
                border: `1px solid ${color}55`,
              }}
            >
              <span
                className="w-2 h-2 rounded-full animate-pulse"
                style={{ backgroundColor: color }}
                aria-hidden="true"
              />
              <span
                className="font-mono font-semibold"
                data-testid="remote-cursor-label"
              >
                {labelText}
              </span>
              <span
                className="text-[10px] opacity-80 font-mono ml-0.5"
                data-testid="remote-cursor-coords"
              >
                {isSelection
                  ? `[${cursor.start}–${cursor.end}]`
                  : `Ln ${startPos.line}, Col ${startPos.col}`}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
