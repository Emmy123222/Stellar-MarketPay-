import "./setup/snapshotMocks";

import { render, screen, fireEvent, act } from "@testing-library/react";
import Navbar from "@/components/Navbar";
import { ThemeProvider, THEME_STORAGE_KEY } from "@/contexts/ThemeContext";

// #given a helper to grab the toggle button by its accessible name, whichever
// theme it currently reflects (light/dark button text flips based on state).
function getThemeToggleButton() {
  return (
    screen.queryByRole("button", { name: /switch to light mode/i }) ??
    screen.queryByRole("button", { name: /switch to dark mode/i })
  );
}

const noop = () => {};

describe("ThemeProvider wiring (regression for issue #1402)", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark", "high-contrast");
  });

  // #given Navbar's toggle button is rendered without an ancestor ThemeProvider
  // #when the button is clicked
  // #then useTheme() silently returns the context's no-op defaults, so nothing
  // happens: no class change, no persistence. This reproduces the exact bug
  // reported in #1402 (dark: classes are dead code because the toggle is a
  // no-op) and pins the failure mode so it cannot silently regress.
  it("is a no-op when Navbar is rendered without a ThemeProvider ancestor", () => {
    render(<Navbar publicKey={null} onConnect={noop} onDisconnect={noop} />);

    const toggle = getThemeToggleButton();
    expect(toggle).not.toBeNull();

    act(() => {
      fireEvent.click(toggle!);
    });

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  // #given Navbar is wrapped in ThemeProvider, the same way pages/_app.tsx
  // must wrap it, and no stored preference or OS dark-mode preference exists
  // (jsdom's matchMedia is mocked to always report "no match" in this suite)
  // #when the toggle button is clicked
  // #then the theme actually changes: the <html> element's class list updates
  // and the choice is persisted to localStorage.
  it("toggles the document class and persists the choice when wrapped in ThemeProvider", () => {
    render(
      <ThemeProvider>
        <Navbar publicKey={null} onConnect={noop} onDisconnect={noop} />
      </ThemeProvider>,
    );

    // With no stored preference and matchMedia reporting no match, the
    // resolved initial theme is "light".
    expect(screen.getByRole("button", { name: /switch to dark mode/i })).toBeInTheDocument();
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /switch to dark mode/i }));
    });

    // light -> dark is the next step in the toggle cycle.
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /switch to light mode/i }));
    });

    // dark -> high-contrast is the next step in the toggle cycle. The
    // toggle button's label only distinguishes "dark" from everything else,
    // so a high-contrast theme (which also carries the "dark" class) reads
    // as "Switch to dark mode".
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("high-contrast");
    expect(document.documentElement.classList.contains("high-contrast")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(screen.getByRole("button", { name: /switch to dark mode/i })).toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /switch to dark mode/i }));
    });

    // high-contrast -> light.
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.classList.contains("high-contrast")).toBe(false);
    expect(screen.getByRole("button", { name: /switch to dark mode/i })).toBeInTheDocument();
  });

  // #given a persisted theme choice already exists in localStorage from a
  // previous visit
  // #when the app mounts with ThemeProvider wired in
  // #then that stored preference is applied on load, proving persistence
  // round-trips and isn't only written, never read.
  it("restores a persisted theme from localStorage on mount", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");

    render(
      <ThemeProvider>
        <Navbar publicKey={null} onConnect={noop} onDisconnect={noop} />
      </ThemeProvider>,
    );

    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(screen.getByRole("button", { name: /switch to dark mode/i })).toBeInTheDocument();
  });
});
