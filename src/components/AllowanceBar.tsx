import { Progress as ProgressPrimitive } from "@base-ui/react/progress";
import { ProgressIndicator, ProgressTrack } from "@/components/ui/progress";
import { cn } from "cn";
import type { SubscriptionUsage } from "@/lib/api";

// Thin bar under the status line showing how much of the Opus V5
// free allowance remains. Color is the only signal — no numbers,
// no percent text, no Anlas figure anywhere (the user asked for
// exactly that):
//   > 20% remaining ....... primary at muted intensity
//   <= 20% ................ amber (running low)
//   empty / isNegative .... red (generations now burn Anlas)
// The track from shadcn's Progress is already h-1 (~4px).
export function AllowanceBar({ usage }: { usage: SubscriptionUsage }) {
  const width = Math.min(100, Math.max(0, usage.percent));
  const state =
    usage.isNegative || usage.percent <= 0
      ? "empty"
      : usage.percent <= 20
        ? "low"
        : "normal";
  return (
    <ProgressPrimitive.Root value={width} className="my-2 w-full">
      <ProgressTrack>
        <ProgressIndicator
          className={cn(
            state === "normal" && "bg-primary/60",
            state === "low" && "bg-amber-400",
            state === "empty" && "bg-err",
          )}
        />
      </ProgressTrack>
    </ProgressPrimitive.Root>
  );
}
