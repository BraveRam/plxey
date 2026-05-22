/**
 * Caches the onboarding bot's @username, resolved once at startup via
 * getMe. The Mini App needs it to build the `t.me/<username>?start=...`
 * deep link for the billing "Manage" button.
 */

let onboardingBotUsername: string | null = null;

export function setOnboardingBotUsername(username: string | null): void {
  onboardingBotUsername = username;
}

export function getOnboardingBotUsername(): string | null {
  return onboardingBotUsername;
}
