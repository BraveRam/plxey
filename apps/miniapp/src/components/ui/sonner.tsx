import { Toaster as Sonner, type ToasterProps } from "sonner";
import { WebApp } from "@/lib/telegram";

function Toaster(props: ToasterProps) {
  const theme: ToasterProps["theme"] =
    WebApp.colorScheme === "dark" ? "dark" : "light";
  return (
    <Sonner
      theme={theme}
      position="top-center"
      toastOptions={{
        style: {
          background: "var(--card)",
          color: "var(--card-foreground)",
          border: "1px solid var(--border)",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
