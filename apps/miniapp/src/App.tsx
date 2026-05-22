import { Routes, Route } from "react-router-dom";
import { isInTelegram } from "@/lib/telegram";
import { BotList } from "@/screens/BotList";
import { ConnectBot } from "@/screens/ConnectBot";
import { BotDetail } from "@/screens/BotDetail";
import { Billing } from "@/screens/Billing";

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
      <Routes>
        <Route path="/" element={<BotList />} />
        <Route path="/connect" element={<ConnectBot />} />
        <Route path="/bot/:id" element={<BotDetail />} />
        <Route path="/billing" element={<Billing />} />
      </Routes>
    </div>
  );
}
