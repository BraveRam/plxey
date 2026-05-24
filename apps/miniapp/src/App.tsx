import { useEffect, useRef } from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
import { getStartParam, isInTelegram } from "@/lib/telegram";
import { BotList } from "@/screens/BotList";
import { ConnectBot } from "@/screens/ConnectBot";
import { BotDetail } from "@/screens/BotDetail";
import { Billing } from "@/screens/Billing";

/**
 * Map from Telegram `?startapp=<param>` value to in-app route. Adding more
 * deep links later (e.g. `startapp=bots`, `startapp=connect`) is just an
 * entry in this table.
 */
const START_PARAM_ROUTES: Record<string, string> = {
  billing: "/billing",
};

export function App() {
  if (!isInTelegram()) {
    return (
      <div className="flex min-h-dvh items-center justify-center p-8 text-center">
        <div className="space-y-2">
          <h1 className="text-lg font-semibold">Open in Telegram</h1>
          <p className="text-sm text-muted-foreground">
            This Mini App must be launched from the bot inside Telegram.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto min-h-dvh w-full max-w-md">
      <StartParamRouter />
      <Routes>
        <Route path="/" element={<BotList />} />
        <Route path="/connect" element={<ConnectBot />} />
        <Route path="/bot/:id" element={<BotDetail />} />
        <Route path="/billing" element={<Billing />} />
      </Routes>
    </div>
  );
}

/**
 * Reads `WebApp.initDataUnsafe.start_param` once on mount and navigates to
 * the matching route. Keeps the redirect idempotent via a ref so subsequent
 * re-renders (theme change, focus toggles) don't yank the user away from
 * wherever they've navigated since.
 */
function StartParamRouter(): null {
  const navigate = useNavigate();
  const handledRef = useRef(false);

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;

    const param = getStartParam();
    if (!param) return;

    const target = START_PARAM_ROUTES[param];
    if (target) {
      navigate(target, { replace: true });
    }
  }, [navigate]);

  return null;
}
