import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
import { ProgressIndicator, ProgressTrack } from "@/components/ui/progress";
import { cn } from "cn";
import {
  anlasAllowanceFromSubscription,
  type SubscriptionInfo,
  type SubscriptionUsage,
} from "@/lib/api";

type Tone = "normal" | "low" | "empty";

function toneFor(percent: number, empty: boolean): Tone {
  if (empty || percent <= 0) return "empty";
  return percent <= 20 ? "low" : "normal";
}

function toneClass(tone: Tone): string {
  return cn(
    tone === "normal" && "bg-primary/60",
    tone === "low" && "bg-amber-400",
    tone === "empty" && "bg-err",
  );
}

// One labelled thin bar. The tiny text label is the only text —
// no numbers, no percent, no raw balance anywhere (the user has
// repeatedly declined numeric display). Color carries the state:
//   > 20% remaining ....... primary at muted intensity
//   <= 20% ................ amber (running low)
//   empty ................. red
// The track from shadcn's Progress is already h-1 (~4px).
function AllowanceRow({
  label,
  percent,
  tone,
}: {
  label: string;
  percent: number;
  tone: Tone;
}) {
  const width = Math.min(100, Math.max(0, percent));
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-xs text-muted-foreground">
        {label}
      </span>
      <ProgressPrimitive.Root value={width} className="min-w-0 flex-1">
        <ProgressTrack>
          <ProgressIndicator className={toneClass(tone)} />
        </ProgressTrack>
      </ProgressPrimitive.Root>
    </div>
  );
}

// The Opus Limit bar combines both V5 usage pools in a single
// bar on a 500-point scale (his choice, 2026-11-28):
//   regular usage (usage.percent, up to 100) in the usual tone
//     colors, then
//   Extra Usage from Opus Usage Boosts (usage.purchasedPercent,
//     up to 400) in cyan, appended after the regular segment.
// With no boost the regular 100 points fill only the first
// fifth of the bar; that is the accepted trade-off of the
// combined scale. Still no numbers anywhere.
function OpusAllowanceRow({ usage }: { usage: SubscriptionUsage }) {
  const regular = Math.min(500, Math.max(0, usage.percent));
  const extra = Math.min(
    Math.max(0, usage.purchasedPercent),
    Math.max(0, 500 - regular),
  );
  const totalPercent = ((regular + extra) / 500) * 100;
  const regularWidth = (regular / 500) * 100;
  const extraWidth = (extra / 500) * 100;
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 shrink-0 text-xs text-muted-foreground">
        Opus Limit
      </span>
      <ProgressPrimitive.Root value={totalPercent} className="min-w-0 flex-1">
        <ProgressTrack>
          <div
            className={cn(
              "h-full shrink-0 transition-all",
              toneClass(toneFor(usage.percent, usage.isNegative)),
            )}
            style={{ width: `${regularWidth}%` }}
          />
          {extra > 0 && (
            <div
              className="h-full shrink-0 bg-cyan-400 transition-all"
              style={{ width: `${extraWidth}%` }}
            />
          )}
        </ProgressTrack>
      </ProgressPrimitive.Root>
    </div>
  );
}

// Two thin allowance bars at the very top of the main screen,
// above the hero image (not sticky):
//   Opus Limit — regular V5 usage plus Boost Extra Usage in one
//     combined, color-coded bar (see OpusAllowanceRow).
//   Anlas — the Anlas balance (subscription + purchased) against
//     the tier's monthly Subscription Anlas allotment (#37).
// Each bar hides itself when its source field is absent from the
// subscription response; when both are absent nothing renders.
export function AllowanceBars({
  subscription,
}: {
  subscription: SubscriptionInfo;
}) {
  const usage = subscription.usage;
  const anlas = anlasAllowanceFromSubscription(subscription);
  if (!usage && !anlas) return null;
  return (
    <div className="w-full space-y-1.5 px-3 py-2">
      {usage && <OpusAllowanceRow usage={usage} />}
      {anlas && (
        <AllowanceRow
          label="Anlas"
          percent={anlas.percent}
          tone={toneFor(anlas.percent, false)}
        />
      )}
    </div>
  );
}
