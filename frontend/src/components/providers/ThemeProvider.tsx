"use client";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";

type ThemeMode = "light" | "dark" | "system";

interface ThemeContextType {
  theme: ThemeMode;
  resolvedTheme: "light" | "dark";
  setTheme: (t: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextType | null>(null);

export function useTheme(): ThemeContextType {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // SSR fallback — ThemeProvider hasn't mounted yet
    return {
      theme: "system",
      resolvedTheme: "light",
      setTheme: () => {},
    };
  }
  return ctx;
}

let selectedTheme: ThemeMode | null = null;
const listeners = new Set<() => void>();
function readTheme(): ThemeMode {
  if (selectedTheme) return selectedTheme;
  const saved = localStorage.getItem("shiftsafe-theme");
  return saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
}
function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", onChange);
  window.addEventListener("storage", onChange);
  return () => { listeners.delete(onChange); mq.removeEventListener("change", onChange); window.removeEventListener("storage", onChange); };
}
function readResolved(): "light" | "dark" {
  const theme = readTheme();
  return theme === "system" ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : theme;
}
export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "system" as ThemeMode);
  const resolvedTheme = useSyncExternalStore(subscribe, readResolved, () => "light" as const);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(resolvedTheme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolvedTheme === "dark" ? "#0f172a" : "#f97316");
  }, [resolvedTheme]);
  const setTheme = useCallback((value: ThemeMode) => {
    selectedTheme = value;
    localStorage.setItem("shiftsafe-theme", value);
    listeners.forEach((notify) => notify());
  }, []);
  return <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>{children}</ThemeContext.Provider>;
}
