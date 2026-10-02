import { renderHook } from "@testing-library/react";
import { fireEvent } from "@testing-library/dom";
import fs from "fs";
import path from "path";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";

/**
 * Guards the contract that page #1123 broke: `pages/_app.tsx` has to hand the
 * hook every callback it calls, and the events it dispatches for `/` and `b`
 * have to be the events the jobs page listens for. Both halves are asserted
 * here because the earlier drift was invisible — the call site compiled (the
 * names simply did not exist on the options type checked as excess properties
 * one at a time) while the key handlers threw `undefined is not a function`.
 */
function renderShortcuts(overrides: Record<string, unknown> = {}) {
  const spies = {
    onGoToJobs: jest.fn(),
    onGoToDashboard: jest.fn(),
    onPostJob: jest.fn(),
    onFocusSearch: jest.fn(),
    onToggleBookmark: jest.fn(),
    onOpenCommandPalette: jest.fn(),
    onToggleShortcutsModal: jest.fn(),
  };
  renderHook(() =>
    useKeyboardShortcuts({
      ...spies,
      shortcutsModalOpen: false,
      ...overrides,
    } as never)
  );
  return spies;
}

function press(init: KeyboardEventInit) {
  fireEvent.keyDown(document, init);
}

describe("useKeyboardShortcuts wiring", () => {
  it("calls the callback each single-letter shortcut belongs to", () => {
    const spies = renderShortcuts();

    press({ key: "g" });
    expect(spies.onGoToJobs).toHaveBeenCalledTimes(1);

    press({ key: "d" });
    expect(spies.onGoToDashboard).toHaveBeenCalledTimes(1);

    press({ key: "p" });
    expect(spies.onPostJob).toHaveBeenCalledTimes(1);

    press({ key: "/" });
    expect(spies.onFocusSearch).toHaveBeenCalledTimes(1);

    press({ key: "b" });
    expect(spies.onToggleBookmark).toHaveBeenCalledTimes(1);
  });

  it("opens the command palette on Cmd/Ctrl+K and the modal on ?", () => {
    const spies = renderShortcuts();

    press({ key: "k", metaKey: true });
    expect(spies.onOpenCommandPalette).toHaveBeenCalledTimes(1);

    press({ key: "k", ctrlKey: true });
    expect(spies.onOpenCommandPalette).toHaveBeenCalledTimes(2);

    press({ key: "?" });
    expect(spies.onToggleShortcutsModal).toHaveBeenCalledTimes(1);
  });

  it("leaves the letter shortcuts alone while a modifier is held", () => {
    const spies = renderShortcuts();

    press({ key: "p", metaKey: true });
    press({ key: "b", ctrlKey: true });

    expect(spies.onPostJob).not.toHaveBeenCalled();
    expect(spies.onToggleBookmark).not.toHaveBeenCalled();
  });
});

describe("app wiring matches the jobs page listeners", () => {
  const read = (relative: string) =>
    fs.readFileSync(path.join(__dirname, "..", relative), "utf8");

  it("dispatches exactly the shortcut events the jobs page subscribes to", () => {
    const app = read("pages/_app.tsx");
    const jobs = read("pages/jobs/index.tsx");

    const dispatched = [...app.matchAll(/CustomEvent\("(shortcut-[a-z-]+)"\)/g)].map((m) => m[1]);
    const listened = [...jobs.matchAll(/addEventListener\("(shortcut-[a-z-]+)"/g)].map((m) => m[1]);

    expect(dispatched.length).toBeGreaterThan(0);
    for (const name of dispatched) {
      expect(listened).toContain(name);
    }
  });

  it("passes every callback the hook declares as required", () => {
    const hook = read("hooks/useKeyboardShortcuts.ts");
    const app = read("pages/_app.tsx");

    const optionsType = hook.slice(hook.indexOf("UseKeyboardShortcutsOptions"));
    const declared = [...optionsType.matchAll(/^\s{2}(on[A-Z]\w+)(\??):/gm)].map((m) => [
      m[1],
      m[2] === "?",
    ]);

    expect(declared.length).toBeGreaterThan(0);
    for (const [name, optional] of declared) {
      if (optional === true) continue;
      expect(app).toContain(`${name}:`);
    }
  });
});
