/** A user's choice; "system" follows the device's light/dark setting. */
export type Theme = "dark" | "light" | "system";
/** What is actually shown. */
export type ThemeMode = "dark" | "light";

export const THEME_KEY = "sf-theme-d";
/** Pre-redesign key, read once so existing preferences carry over. */
export const LEGACY_THEME_KEY = "savefirst-theme";
/** Fired on window when the shown theme changes from outside the toggle (e.g. the account's saved theme). */
export const THEME_EVENT = "sf-theme";

export const resolveTheme = (theme: Theme): ThemeMode =>
  theme === "system" ? (window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark") : theme;

/** Applies a theme to <html>. Dark is the default; light is html[data-theme="light"]. */
// shortcut: "system" is resolved when applied, not live; listen to the media query if the Settings screen needs it.
export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = resolveTheme(theme);
}

/**
 * The account's saved theme (user_settings.theme) wins over this device's last choice:
 * apply it, remember it locally for a flash-free next load, and tell the toggle.
 */
export function syncSavedTheme(saved: Theme | null | undefined) {
  if (!saved) return;
  applyTheme(saved);
  try {
    window.localStorage.setItem(THEME_KEY, saved);
  } catch {
    // Storage blocked (private mode): the theme still applies for this visit.
  }
  window.dispatchEvent(new Event(THEME_EVENT));
}

/** Inline <head> script: runs before paint so the page never flashes the wrong theme. */
export const THEME_INIT_SCRIPT = `try{var t=localStorage.getItem("${THEME_KEY}")||localStorage.getItem("${LEGACY_THEME_KEY}");if(t==="system")t=window.matchMedia&&matchMedia("(prefers-color-scheme: light)").matches?"light":"dark";t=t==="light"?"light":"dark";document.documentElement.dataset.theme=t}catch(e){document.documentElement.dataset.theme="dark"}`;
