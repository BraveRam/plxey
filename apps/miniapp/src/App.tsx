import { lazy, Suspense, useEffect, useRef } from "react";
import { Routes, Route, useNavigate } from "react-router-dom";
import { getStartParam, isInTelegram } from "@/lib/telegram";
import { Screen } from "@/components/Screen";
import { Skeleton } from "@/components/ui/skeleton";
import { BotList } from "@/screens/BotList";
import { ConnectBot } from "@/screens/ConnectBot";
import { BotDetail } from "@/screens/BotDetail";
import { Billing } from "@/screens/Billing";

// Admin surface is operator-only — lazy-load so the recharts-heavy dashboard
// never ships in the bundle every owner downloads on app open.
const AdminDashboard = lazy(() =>
  import("@/screens/admin/AdminDashboard").then((m) => ({ default: m.AdminDashboard })),
);
const AdminOwner = lazy(() =>
  import("@/screens/admin/AdminOwner").then((m) => ({ default: m.AdminOwner })),
);

// Shown while the lazy admin chunk downloads (recharts is heavy — on a slow
// Telegram webview this gap is visible). Renders the Screen chrome + a
// skeleton so it never flashes a blank page, matching the dashboard's own
// data-loading state.
const adminRouteFallback = (
  <Screen eyebrow={<>Operations</>} title="Dashboard">
    <Skeleton className="h-44 w-full rounded-2xl" />
    <Skeleton className="h-56 w-full rounded-2xl" />
  </Screen>
);

/**
 * Map from Telegram `?startapp=<param>` value to in-app route. Adding more
 * deep links later (e.g. `startapp=bots`, `startapp=connect`) is just an
 * entry in this table. (The admin dashboard at `/admin` is reached via the
 * in-app button in the home header, not a deep link — `?startapp=` would
 * need a BotFather Main Mini App this bot doesn't have.)
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
        <Route
          path="/admin"
          element={
            <Suspense fallback={adminRouteFallback}>
              <AdminDashboard />
            </Suspense>
          }
        />
        <Route
          path="/admin/owner/:id"
          element={
            <Suspense fallback={adminRouteFallback}>
              <AdminOwner />
            </Suspense>
          }
        />
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
