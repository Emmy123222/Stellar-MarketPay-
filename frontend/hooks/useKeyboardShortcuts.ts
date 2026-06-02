import { useEffect } from "react";

type UseKeyboardShortcutsOptions = {
  onGoToJobs: () => void;
  onGoToDashboard: () => void;
  onPostJob: () => void;
  onToggleShortcutsModal: () => void;
  onFocusSearch: () => void;
  onToggleBookmark: () => void;
  shortcutsModalOpen: boolean;
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  const tagName = target.tagName.toLowerCase();
  if (tagName === "input" || tagName === "textarea" || tagName === "select") {
    return true;
  }

  return target.isContentEditable;
}

export function useKeyboardShortcuts({
  onGoToJobs,
  onGoToDashboard,
  onPostJob,
  onToggleShortcutsModal,
  onFocusSearch,
  onToggleBookmark,
  shortcutsModalOpen,
}: UseKeyboardShortcutsOptions) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;

      if (event.key === "Escape") {
        if (shortcutsModalOpen) {
          event.preventDefault();
          onToggleShortcutsModal();
        }
        return;
      }

      if (shortcutsModalOpen) return;

      const key = event.key.toLowerCase();

      if (key === "g") {
        event.preventDefault();
        onGoToJobs();
        return;
      }

      if (key === "d") {
        event.preventDefault();
        onGoToDashboard();
        return;
      }

      if (key === "p") {
        event.preventDefault();
        onPostJob();
        return;
      }

      if (event.key === "?" || (event.key === "/" && event.shiftKey)) {
        event.preventDefault();
        onToggleShortcutsModal();
        return;
      }

      if (key === "/") {
        event.preventDefault();
        onFocusSearch();
        return;
      }

      if (key === "b") {
        event.preventDefault();
        onToggleBookmark();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    onGoToJobs,
    onGoToDashboard,
    onPostJob,
    onToggleShortcutsModal,
    onFocusSearch,
    onToggleBookmark,
    shortcutsModalOpen,
  ]);
}
