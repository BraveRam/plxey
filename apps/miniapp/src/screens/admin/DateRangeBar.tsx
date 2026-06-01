import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/telegram";
import { PRESETS, type PresetKey, type RangeState } from "./lib";

interface DateRangeBarProps {
  value: RangeState;
  onChange: (next: RangeState) => void;
}

/**
 * Date-window control: preset chips (7d / 30d / 90d / 1y / All) plus a
 * Custom chip that reveals from/to date pickers. Drives every range-bound
 * metric on the dashboard. Custom bounds are partial-tolerant — the server
 * fills missing ones — so the inputs never need to be both set at once.
 */
export function DateRangeBar({ value, onChange }: DateRangeBarProps) {
  const selectPreset = (preset: PresetKey) => {
    haptic.tap();
    onChange({ preset, from: value.from, to: value.to });
  };

  const chips: Array<{ key: PresetKey; label: string }> = [
    ...PRESETS,
    { key: "custom", label: "Custom" },
  ];

  return (
    <div className="space-y-3">
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {chips.map((c) => {
          const active = value.preset === c.key;
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => selectPreset(c.key)}
              aria-pressed={active}
              className={cn(
                "shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] font-semibold tracking-tight",
                "transition-colors duration-200",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-transparent text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground",
              )}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      {value.preset === "custom" ? (
        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1">
            <span className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              From
            </span>
            <Input
              type="date"
              value={value.from ?? ""}
              max={value.to || undefined}
              onChange={(e) =>
                onChange({ preset: "custom", from: e.target.value, to: value.to })
              }
            />
          </label>
          <label className="space-y-1">
            <span className="px-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              To
            </span>
            <Input
              type="date"
              value={value.to ?? ""}
              min={value.from || undefined}
              onChange={(e) =>
                onChange({ preset: "custom", from: value.from, to: e.target.value })
              }
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}
