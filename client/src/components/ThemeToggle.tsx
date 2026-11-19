"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { applyTheme, THEME_EVENT, THEME_KEY, type ThemeMode } from "@/lib/theme";

/** `onChange` lets a signed-in page save the choice to the account. */
export default function ThemeToggle({ onChange }: { onChange?: (theme: ThemeMode) => void } = {}) {
  const [theme, setTheme] = useState<ThemeMode>("dark");

  useEffect(() => {
    const read = () => setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
    read();
    window.addEventListener(THEME_EVENT, read);
    return () => window.removeEventListener(THEME_EVENT, read);
  }, []);

  const toggleTheme = () => {
    const next: ThemeMode = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    try {
      window.localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage blocked (private mode): the theme still applies for this visit.
    }
    setTheme(next);
    onChange?.(next);
  };

  const label = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      className="flex h-[38px] w-[38px] flex-none cursor-pointer items-center justify-center rounded-full border border-line bg-transparent text-ink-2 transition-[transform,color] duration-300 hover:text-ink active:-rotate-30 active:scale-[.92]"
    >
      {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}
