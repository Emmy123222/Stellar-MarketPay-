import { act, renderHook } from "@testing-library/react";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";

describe("useKeyboardShortcuts command palette shortcut", () => {
  const onOpenCommandPalette = jest.fn();
  const noop = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    renderHook(() =>
      useKeyboardShortcuts({
        onGoToJobs: noop,
        onGoToDashboard: noop,
        onPostJob: noop,
        onToggleShortcutsModal: noop,
        onFocusSearch: noop,
        onToggleBookmark: noop,
        onOpenCommandPalette,
        shortcutsModalOpen: false,
      }),
    );
  });

  it("opens the palette on Ctrl/Cmd+Shift+K and prevents the browser shortcut", () => {
    const event = new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });

    act(() => window.dispatchEvent(event));

    expect(onOpenCommandPalette).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves Ctrl/Cmd+K to the browser", () => {
    const event = new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });

    act(() => window.dispatchEvent(event));

    expect(onOpenCommandPalette).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it("does not consume an event another handler already prevented", () => {
    const event = new KeyboardEvent("keydown", {
      key: "k",
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    event.preventDefault();

    act(() => window.dispatchEvent(event));

    expect(onOpenCommandPalette).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });
});
