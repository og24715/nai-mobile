import { AllowanceBar } from "@/components/AllowanceBar";
import type { RecentItem, SubscriptionUsage } from "@/lib/api";
import { cn } from "cn";

export interface StatusState {
  kind: "" | "ok" | "err";
  text: string;
}

interface Props {
  heroUrl: string;
  status: StatusState;
  usage: SubscriptionUsage | null;
  items: RecentItem[];
  onSelect: (url: string) => void;
}

// Main screen: full-bleed hero image on top, status line, and the
// recent-generations thumbnail grid. Tapping a thumbnail swaps the
// hero; tapping the hero opens the original in a new tab.
export function Viewer({ heroUrl, status, usage, items, onSelect }: Props) {
  return (
    <>
      {heroUrl && (
        <div className="leading-none">
          <a href={heroUrl} target="_blank" rel="noopener noreferrer">
            <img src={heroUrl} alt="" className="block h-auto w-full" />
          </a>
        </div>
      )}
      <main className="mx-auto max-w-[640px] px-5 pt-8 pb-32">
        <div
          className={cn(
            "mt-4 text-sm whitespace-pre-wrap text-muted-foreground",
            status.kind === "err" && "text-err",
            status.kind === "ok" && "text-ok",
          )}
        >
          {status.text}
        </div>
        {usage && <AllowanceBar usage={usage} />}
        <section className="mb-14">
          <h2 className="mb-3 text-lg font-semibold">最近の生成</h2>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {items.map((it) => (
              <a
                key={it.name}
                href={it.url}
                onClick={(e) => {
                  e.preventDefault();
                  onSelect(it.url);
                }}
              >
                <img
                  src={it.url}
                  loading="lazy"
                  alt=""
                  className="block h-auto w-full rounded-xl"
                />
              </a>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}
