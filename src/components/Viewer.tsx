import type { RecentItem } from "@/lib/api";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
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
  onUpscale: () => void;
  upscaling: boolean;
}

// Main screen: full-bleed hero image on top, status line, and the
// recent-generations thumbnail grid. Tapping a thumbnail swaps the
// hero; tapping the hero opens the original in a new tab. Long-
// pressing the hero (right-click on desktop) opens a context menu
// with upscale / restore-from-this-image / open-original actions
// (improvement #39).
export function Viewer({ heroUrl, status, items, onSelect, onRestoreFile, onRestoreHero, onUpscale, upscaling }: Props) {
  return (
    <>
      {heroUrl && (
        <ContextMenu>
          <ContextMenuTrigger className="block leading-none [-webkit-touch-callout:none]">
            <a href={heroUrl} target="_blank" rel="noopener noreferrer">
              <img
                src={heroUrl}
                alt=""
                draggable={false}
                className="block h-auto w-full [-webkit-touch-callout:none]"
              />
            </a>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem disabled={upscaling} onClick={onUpscale}>
              アップスケール
            </ContextMenuItem>
            <ContextMenuItem onClick={onRestoreHero}>
              この画像から復元
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => window.open(heroUrl, "_blank", "noopener,noreferrer")}
            >
              元画像を開く
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
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
