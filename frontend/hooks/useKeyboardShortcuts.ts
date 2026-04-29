import { useEffect } from "react";

type UseKeyboardShortcutsOptions = {
  isJobDetailPage: boolean;
  onGoToJobs: () => void;
  onGoToDashboard: () => void;
  onNewJobPost: () => void;
  onToggleShortcutsModal: () => void;
  onJobApply: () => void;
  onJobBackToListing: () => void;
  shortcutsModalOpen: boolean;
};

const SEQUENCE_TIMEOUT_MS = 900;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  const tagName = target.tagName.toLowerCase();
  if (tagName === "input" || tagName === "textarea" || tagName === "select") {
    return true;
  }

  return target.isContentEditable;
}

export function useKeyboardShortcuts({
  isJobDetailPage,
  onGoToJobs,
  onGoToDashboard,
  onNewJobPost,
  onToggleShortcutsModal,
  onJobApply,
  onJobBackToListing,
  shortcutsModalOpen,
}: UseKeyboardShortcutsOptions) {
  useEffect(() => {
    let sequencePrefix: "g" | null = null;
    let sequenceTimer: ReturnType<typeof setTimeout> | null = null;

    const clearSequence = () => {
      sequencePrefix = null;
      if (sequenceTimer) {
        clearTimeout(sequenceTimer);
        sequenceTimer = null;
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (isTypingTarget(event.target)) return;

      const key = event.key.toLowerCase();

      if (sequencePrefix === "g") {
        if (key === "j") {
          event.preventDefault();
          onGoToJobs();
          clearSequence();
          return;
        }

        if (key === "d") {
          event.preventDefault();
          onGoToDashboard();
          clearSequence();
          return;
        }
      }

      if (key === "g") {
        clearSequence();
        sequencePrefix = "g";
        sequenceTimer = setTimeout(clearSequence, SEQUENCE_TIMEOUT_MS);
        return;
      }

      clearSequence();

      if (key === "n") {
        event.preventDefault();
        onNewJobPost();
        return;
      }

      const isQuestionMark = event.key === "?" || (event.key === "/" && event.shiftKey);
      if (isQuestionMark) {
        event.preventDefault();
        onToggleShortcutsModal();
        return;
      }

      if (!isJobDetailPage) return;

      if (key === "a") {
        event.preventDefault();
        onJobApply();
        return;
      }

      if (event.key === "Escape") {
        if (shortcutsModalOpen) return;
        event.preventDefault();
        onJobBackToListing();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      clearSequence();
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    isJobDetailPage,
    onGoToJobs,
    onGoToDashboard,
    onNewJobPost,
    onToggleShortcutsModal,
    onJobApply,
    onJobBackToListing,
    shortcutsModalOpen,
  ]);
}
