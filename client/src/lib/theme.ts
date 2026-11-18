export type Theme = "dark" | "light";

export const THEME_KEY = "sf-theme-d";
/** Pre-redesign key, read once so existing preferences carry over. */
export const LEGACY_THEME_KEY = "savefirst-theme";

/** Applies a theme to <html>. Dark is the default; light is html[data-theme="light"]. */
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

/** Inline <head> script: runs before paint so the page never flashes the wrong theme. */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}")||localStorage.getItem("${LEGACY_THEME_KEY}");t=t==="light"?"light":"dark";document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="dark"}`;
