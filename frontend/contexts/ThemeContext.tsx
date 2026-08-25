/**
 * contexts/ThemeContext.tsx
 * Manages dark/light/high-contrast themes with localStorage persistence and system preference.
 * Anti-FOUC: an inline script in _document.tsx applies the class before hydration.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type Theme = "dark" | "light" | "high-contrast";

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "dark",
  toggleTheme: () => {},
  setTheme: () => {},
});

export const THEME_STORAGE_KEY = "smp_theme";

function getInitialTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  const stored = localStorage.getItem(THEME_STORAGE_KEY) as Theme | null;
  if (stored === "dark" || stored === "light" || stored === "high-contrast") return stored;
  
  // Check for OS high contrast mode preference
  if (window.matchMedia("(prefers-contrast: more)").matches) {
    return "high-contrast";
  }
  
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  
  // Remove all theme classes first
  document.documentElement.classList.remove("dark", "high-contrast");
  
  // Apply the selected theme
  if (theme === "dark") {
    document.documentElement.classList.add("dark");
  } else if (theme === "high-contrast") {
    document.documentElement.classList.add("high-contrast", "dark");
  }
  // light theme = no classes (default)
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    const initial = getInitialTheme();
    setThemeState(initial);
    applyTheme(initial);

    // Listen for OS contrast preference changes
    const contrastMediaQuery = window.matchMedia("(prefers-contrast: more)");
    const handleContrastChange = (e: MediaQueryListEvent) => {
      if (e.matches && localStorage.getItem(THEME_STORAGE_KEY) === null) {
        setTheme("high-contrast");
      }
    };
    
    contrastMediaQuery.addEventListener("change", handleContrastChange);
    return () => contrastMediaQuery.removeEventListener("change", handleContrastChange);
  }, []);

  const setTheme = (t: Theme) => {
    setThemeState(t);
    applyTheme(t);
    localStorage.setItem(THEME_STORAGE_KEY, t);
  };

  const toggleTheme = () => {
    // Cycle through themes: light -> dark -> high-contrast -> light
    const nextTheme = 
      theme === "light" ? "dark" : 
      theme === "dark" ? "high-contrast" : 
      "light";
    setTheme(nextTheme);
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
