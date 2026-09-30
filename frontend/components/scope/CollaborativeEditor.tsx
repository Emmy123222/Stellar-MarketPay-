import React, { useRef, useMemo } from "react";
import ConflictBanner from "./ConflictBanner";
import RemoteCursors, {
  getCollaboratorColor,
  getCursorPosition,
} from "./RemoteCursors";
import SanitizedHtml from "@/components/SanitizedHtml";
import { CursorMap } from "@/lib/api/scope";

interface CollaborativeEditorProps {
  documentText: string;
  onChange: (value: string) => void;
  onSelectionChange?: (start: number, end: number) => void;
  cursors: CursorMap;
  participantId: string;
  finalized?: boolean;
  hasConflict: boolean;
  onDismissConflict: () => void;
  onReloadConflict: () => void;
  serverUpdatedAt?: string | null;
  onSave?: () => void;
  onFinalize?: () => void;
  previewTab?: "edit" | "preview" | "split";
  setPreviewTab?: (tab: "edit" | "preview" | "split") => void;
  renderMarkdown?: (text: string) => string;
  textareaRef?: React.RefObject<HTMLTextAreaElement>;
}

function defaultRenderMarkdown(text: string): string {
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  const html = escaped
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/^- (.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, "<ul>$&</ul>")
    .replace(/^(\d+)\. (.+)$/gm, "<li>$2</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, "<ol>$&</ol>")
    .replace(/\n\n/g, "</p><p>")
    .replace(/\n/g, "<br>");
  return `<div class="prose prose-sm max-w-none">${html}</div>`;
}

export default function CollaborativeEditor({
  documentText,
  onChange,
  onSelectionChange,
  cursors,
  participantId,
  finalized = false,
  hasConflict,
  onDismissConflict,
  onReloadConflict,
  serverUpdatedAt,
  onSave,
  onFinalize,
  previewTab = "edit",
  setPreviewTab,
  renderMarkdown = defaultRenderMarkdown,
  textareaRef: externalTextareaRef,
}: CollaborativeEditorProps) {
  const internalTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const textareaRef = externalTextareaRef || internalTextareaRef;

  const previewHtml = useMemo(
    () => renderMarkdown(documentText),
    [documentText, renderMarkdown],
  );

  const activePeerCursors = useMemo(() => {
    return Object.entries(cursors || {}).filter(
      ([peerId]) => Boolean(peerId) && peerId !== participantId,
    );
  }, [cursors, participantId]);

  const handleSelect = (e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    if (finalized) return;
    const target = e.currentTarget;
    onSelectionChange?.(target.selectionStart, target.selectionEnd);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (finalized) return;
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      onSave?.();
    } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      e.preventDefault();
      if (documentText.trim()) onFinalize?.();
    }
  };

  return (
    <div className="space-y-4" data-testid="collaborative-scope-editor">
      {/* Real-time remote collaborator cursors bar */}
      <RemoteCursors
        cursors={cursors}
        currentParticipantId={participantId}
        documentText={documentText}
      />

      {/* Conflict Detection & Last-Write-Wins Warning Banner */}
      {hasConflict && (
        <ConflictBanner
          onDismiss={onDismissConflict}
          onReload={onReloadConflict}
          serverUpdatedAt={serverUpdatedAt}
        />
      )}

      {/* Editor Content Area */}
      <div className="space-y-2" data-testid="editor-content-area">
        <div className="flex items-center justify-between">
          <label className="label mb-0" htmlFor="scope-textarea">
            Shared Scope Document
            {!finalized && (
              <span className="ml-2 text-xs text-amber-800 font-normal">
                (auto-saves every 2s)
              </span>
            )}
          </label>
          {setPreviewTab && (
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => setPreviewTab("edit")}
                data-testid="tab-edit"
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  previewTab === "edit"
                    ? "bg-market-700 text-amber-100 font-medium"
                    : "text-amber-800 hover:text-amber-300"
                }`}
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => setPreviewTab("preview")}
                data-testid="tab-preview"
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  previewTab === "preview"
                    ? "bg-market-700 text-amber-100 font-medium"
                    : "text-amber-800 hover:text-amber-300"
                }`}
              >
                Preview
              </button>
              <button
                type="button"
                onClick={() => setPreviewTab("split")}
                data-testid="tab-split"
                className={`px-3 py-1 text-xs rounded-md transition-colors ${
                  previewTab === "split"
                    ? "bg-market-700 text-amber-100 font-medium"
                    : "text-amber-800 hover:text-amber-300"
                }`}
              >
                Split
              </button>
            </div>
          )}
        </div>

        {/* Remote cursor position indicator tags above text editor */}
        {activePeerCursors.length > 0 && previewTab !== "preview" && (
          <div
            data-testid="remote-cursor-indicators"
            className="flex flex-wrap gap-2 text-xs py-1"
          >
            {activePeerCursors.map(([peerId, cursor], idx) => {
              const color = getCollaboratorColor(peerId, idx);
              const pos = getCursorPosition(documentText, cursor?.start ?? 0);
              return (
                <div
                  key={peerId}
                  data-testid="remote-cursor-marker"
                  data-participant-id={peerId}
                  className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded border"
                  style={{
                    backgroundColor: `${color}15`,
                    borderColor: `${color}60`,
                    color,
                  }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full inline-block"
                    style={{ backgroundColor: color }}
                  />
                  <span className="font-mono font-medium">
                    {peerId.slice(0, 8)}:
                  </span>
                  <span className="opacity-90">
                    Ln {pos.line}, Col {pos.col}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {previewTab === "edit" && (
          <div className="relative">
            <textarea
              id="scope-textarea"
              ref={textareaRef}
              value={documentText}
              onChange={(e) => onChange(e.target.value)}
              onSelect={handleSelect}
              onKeyUp={handleSelect}
              onClick={handleSelect}
              onKeyDown={handleKeyDown}
              rows={16}
              data-testid="scope-textarea"
              className="textarea-field font-mono text-sm w-full"
              placeholder="Write requirements, milestones, and acceptance criteria together...

Use markdown: # Title, **bold**, *italic*, `code`, - lists"
              readOnly={finalized}
              disabled={finalized}
            />
          </div>
        )}

        {previewTab === "preview" && (
          <SanitizedHtml
            as="div"
            data-testid="scope-preview"
            className="border border-market-500/20 bg-market-900/30 rounded-xl p-4 min-h-[16rem] overflow-auto"
            html={previewHtml}
          />
        )}

        {previewTab === "split" && (
          <div className="flex gap-2">
            <textarea
              id="scope-textarea-split"
              ref={textareaRef}
              value={documentText}
              onChange={(e) => onChange(e.target.value)}
              onSelect={handleSelect}
              onKeyUp={handleSelect}
              onClick={handleSelect}
              onKeyDown={handleKeyDown}
              rows={16}
              data-testid="scope-textarea"
              className="textarea-field font-mono text-sm w-1/2"
              placeholder="Write in markdown..."
              readOnly={finalized}
              disabled={finalized}
            />
            <SanitizedHtml
              as="div"
              data-testid="scope-preview"
              className="border border-market-500/20 bg-market-900/30 rounded-xl p-4 min-h-[16rem] w-1/2 overflow-auto"
              html={previewHtml}
            />
          </div>
        )}

        <p className="text-xs text-amber-800 mt-2">
          Supports markdown: # Heading, **bold**, *italic*, `code`, - unordered
          list, 1. ordered list &mdash; Ctrl+S to save, Ctrl+Enter to finalize
        </p>
      </div>
    </div>
  );
}
