import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
import { ProgressIndicator, ProgressTrack } from "@/components/ui/progress";
import { cn } from "cn";
import {
  anlasAllowanceFromSubscription,
  type SubscriptionInfo,
} from "@/lib/api";

type Tone = "normal" | "low" | "empty";

function toneFor(percent: number, empty: boolean): Tone {
  if (empty || percent <= 0) return "empty";
  return percent <= 20 ? "low" : "normal";
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
          <ProgressIndicator
            className={cn(
              tone === "normal" && "bg-primary/60",
              tone === "low" && "bg-amber-400",
              tone === "empty" && "bg-err",
            )}
          />
        </ProgressTrack>
      </ProgressPrimitive.Root>
    </div>
  );
}

// Two thin allowance bars at the very top of the main screen,
// above the hero image (not sticky):
//   Opus Limit — the Opus V5 usage allowance (usage.percent
//     remaining; isNegative means generations now burn Anlas).
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
      {usage && (
        <AllowanceRow
          label="Opus Limit"
          percent={usage.percent}
          tone={toneFor(usage.percent, usage.isNegative)}
        />
      )}
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
