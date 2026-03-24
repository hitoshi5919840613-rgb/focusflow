"use client";

import { useEffect, useState } from "react";

const themeStorageKey = "focusflow-theme";

type ThemeMode = "light" | "dark";

export function ThemeToggle() {
  const [theme, setTheme] = useState<ThemeMode>("light");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem(themeStorageKey);
    const preferredDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const nextTheme = storedTheme === "dark" || storedTheme === "light"
      ? storedTheme
      : preferredDark
        ? "dark"
        : "light";

    document.documentElement.classList.toggle("dark", nextTheme === "dark");
    setTheme(nextTheme);
    setReady(true);
  }, []);

  const toggleTheme = () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", nextTheme === "dark");
    window.localStorage.setItem(themeStorageKey, nextTheme);
    setTheme(nextTheme);
  };

  return (
    <button
      type="button"
      onClick={toggleTheme}
      disabled={!ready}
      className="inline-flex items-center gap-3 rounded-full border border-slate-200/70 bg-white/70 px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-primary/40 hover:text-primary disabled:opacity-60 dark:border-slate-700/70 dark:bg-slate-950/35 dark:text-slate-100"
      aria-label="ダークモード切り替え"
    >
      <span className="text-base leading-none">{theme === "dark" ? "☾" : "☀"}</span>
      <span>{theme === "dark" ? "ダーク" : "ライト"}</span>
    </button>
  );
}
