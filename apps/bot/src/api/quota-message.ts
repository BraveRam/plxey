import type { QuotaCheckResult, QuotaKind } from "../lib/owners";
import type { PlanKey } from "../lib/plans";
import {
  SUBSCRIBE_TO_CREATE_BOT,
  SUBSCRIBE_TO_UPLOAD,
  botCreateBlocked,
  docUploadBlocked,
} from "../lib/text";

function planLabel(plan: PlanKey | null): string {
  switch (plan) {
    case "trial":
      return "Trial";
    case "pro":
      return "Pro";
    case "business":
      return "Business";
    default:
      return "Your plan";
  }
}

function plain(html: string): string {
  return html.replace(/<\/?b>/g, "");
}

export function quotaErrorMessage(
  quota: QuotaCheckResult,
  kind: QuotaKind,
): string {
  if (kind === "message") {
    return "Quota reached. Try again later.";
  }

  const isLapsedOrBanned =
    quota.reason === "lapsed" || quota.reason === "banned" || !quota.reason;

  if (kind === "bot") {
    if (isLapsedOrBanned) return SUBSCRIBE_TO_CREATE_BOT;
    return plain(
      botCreateBlocked({
        cap: quota.limit,
        planLabel: planLabel(quota.plan),
      }),
    );
  }

  // kind === "doc"
  if (isLapsedOrBanned) return SUBSCRIBE_TO_UPLOAD;
  return plain(
    docUploadBlocked({
      cap: quota.limit,
      planLabel: planLabel(quota.plan),
    }),
  );
}
