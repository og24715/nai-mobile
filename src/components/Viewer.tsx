import type { RecentItem } from "@/lib/api";
import { cn } from "cn";

export interface StatusState {
  kind: "" | "ok" | "err";
  text: string;
}

interface Props {
  heroUrl: string;
  status: StatusState;
  items: RecentItem[];
  onSelect: (url: string) => void;
  onRestoreFile: (f: File) => void;
  onRestoreHero: () => void;
}

// Main screen: full-bleed hero image on top, status line, and the
// recent-generations thumbnail grid. Tapping a thumbnail swaps the
// hero; tapping the hero opens the original in a new tab.
export function Viewer({ heroUrl, status, items, onSelect, onRestoreFile, onRestoreHero }: Props) {
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
        {/* Two ways to restore the form settings from a NovelAI PNG:
            from a file saved on this device (improvement #23), or from
            the history image currently shown as the hero (improvement
            #10). Both run through the same local parse + selection
            dialog; nothing is uploaded. */}
        <div className="mt-1 flex flex-wrap items-center gap-1">
          <label className="inline-flex cursor-pointer items-center rounded-full px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
            画像から復元
            <input
              type="file"
              accept="image/png,image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) onRestoreFile(f);
              }}
            />
          </label>
          {heroUrl && (
            <button
              type="button"
              onClick={onRestoreHero}
              className="inline-flex cursor-pointer items-center rounded-full px-2.5 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              この画像から復元
            </button>
          )}
        </div>
        <section className="mb-14">
          <h2 className="mb-3 text-xl font-semibold">最近の生成</h2>
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
