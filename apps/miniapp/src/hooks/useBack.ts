import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { showBackButton } from "@/lib/telegram";

/**
 * Wire Telegram's native BackButton to navigate. Pass an explicit handler
 * or default to `navigate(-1)`. The button is shown on mount and hidden on
 * unmount.
 */
export function useBack(onBack?: () => void): void {
  const navigate = useNavigate();
  useEffect(() => {
    const handler = onBack ?? (() => navigate(-1));
    return showBackButton(handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
