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

/**
 * Telegram's `start_param` passed via `t.me/<bot>?startapp=<param>`. Used by
 * lifecycle DMs to deep-link into a specific Mini App screen (e.g.
 * `?startapp=billing` lands on /billing).
 */
export function getStartParam(): string | null {
  const raw = WebApp.initDataUnsafe?.start_param;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
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

  // The flat design is border-load-bearing: cards have no shadow, so the 1px
  // hairline is the only thing separating a card from the page. Telegram may
  // send secondary_bg_color == bg_color (or omit it), collapsing --card onto
  // --background. So derive --border/--input from the *resolved* palette — a
  // fixed step toward the text color — instead of leaving them at the static
  // defaults, guaranteeing the hairline stays visible in every theme.
  root.style.setProperty(
    "--border",
    "color-mix(in oklch, var(--foreground) 12%, var(--card))",
  );
  root.style.setProperty(
    "--input",
    "color-mix(in oklch, var(--foreground) 12%, var(--card))",
  );

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

/** Native Telegram confirm dialog. Resolves true if the user confirms. */
export function confirm(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    WebApp.showConfirm(message, (ok) => resolve(ok));
  });
}

/**
 * Open a t.me link inside Telegram. On Bot API 8.0+ this minimizes the
 * Mini App to the bottom bar and brings the target chat forward — there
 * is no programmatic minimize method, so this is the intended path.
 */
export function openTelegramLink(url: string): void {
  WebApp.openTelegramLink(url);
}

export const haptic = {
  success: () => WebApp.HapticFeedback?.notificationOccurred("success"),
  error: () => WebApp.HapticFeedback?.notificationOccurred("error"),
  tap: () => WebApp.HapticFeedback?.impactOccurred("light"),
};

export { WebApp };
