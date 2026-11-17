export type Theme = "dark" | "light";

export const THEME_KEY = "sf-theme-d";
/** Pre-redesign key, read once so existing preferences carry over. */
export const LEGACY_THEME_KEY = "savefirst-theme";

/** Applies a theme to <html>. Dark is the default; light is html[data-theme="light"]. */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  // shortcut: keeps the legacy html.dark overrides working for pre-redesign components; drop in the cleanup phase.
  root.classList.toggle("dark", theme === "dark");
}

/** Inline <head> script: runs before paint so the page never flashes the wrong theme. */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}")||localStorage.getItem("${LEGACY_THEME_KEY}");t=t==="light"?"light":"dark";var r=document.documentElement;r.dataset.theme=t;r.classList.toggle("dark",t==="dark")}catch(e){document.documentElement.dataset.theme="dark";document.documentElement.classList.add("dark")}`;
