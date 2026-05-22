import WebApp from "@twa-dev/sdk";

/**
 * Thin wrapper around @twa-dev/sdk. Initializes the WebApp, syncs the
 * Telegram theme onto our shadcn CSS variables, and exposes the signed
 * initData plus a few ergonomic helpers (back button, haptics).
 */

export function initTelegram(): void {
  WebApp.ready();
  WebApp.expand();
  applyTheme();
  WebApp.onEvent("themeChanged", applyTheme);
}

/** Raw signed initData string to send to the API as `Authorization: tma <…>`. */
export function getInitData(): string {
  return WebApp.initData ?? "";
}

export function getUser() {
  return WebApp.initDataUnsafe?.user ?? null;
}

/** True when running inside a real Telegram client (signed initData present). */
export function isInTelegram(): boolean {
  return Boolean(WebApp.initData && WebApp.initData.length > 0);
}

function applyTheme(): void {
  const root = document.documentElement;
  const tp = WebApp.themeParams ?? {};

  const set = (cssVar: string, value: string | undefined) => {
    if (value) root.style.setProperty(cssVar, value);
  };

  // Map Telegram theme params onto shadcn surface/text/accent tokens so
  // every component inherits the user's client palette.
  set("--background", tp.bg_color);
  set("--foreground", tp.text_color);
  set("--card", tp.secondary_bg_color ?? tp.bg_color);
  set("--card-foreground", tp.text_color);
  set("--popover", tp.secondary_bg_color ?? tp.bg_color);
  set("--popover-foreground", tp.text_color);
  set("--secondary", tp.secondary_bg_color);
  set("--muted", tp.secondary_bg_color);
  set("--muted-foreground", tp.hint_color);
  set("--primary", tp.button_color);
  set("--primary-foreground", tp.button_text_color);
  set("--ring", tp.button_color);

  root.classList.toggle("dark", WebApp.colorScheme === "dark");
  if (tp.bg_color) {
    WebApp.setHeaderColor("secondary_bg_color");
    WebApp.setBackgroundColor(tp.bg_color);
  }
}

export function showBackButton(onClick: () => void): () => void {
  WebApp.BackButton.show();
  WebApp.BackButton.onClick(onClick);
  return () => {
    WebApp.BackButton.offClick(onClick);
    WebApp.BackButton.hide();
  };
}

export const haptic = {
  success: () => WebApp.HapticFeedback?.notificationOccurred("success"),
  error: () => WebApp.HapticFeedback?.notificationOccurred("error"),
  tap: () => WebApp.HapticFeedback?.impactOccurred("light"),
};

export { WebApp };
