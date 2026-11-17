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
  onRestoreHero: () => void;
  onUpscale: () => void;
  upscaling: boolean;
  onEnhance: () => void;
  enhancing: boolean;
  onHeroLoad: (w: number, h: number) => void;
}

// Main screen: full-bleed hero image on top, status line, and the
// recent-generations thumbnail grid. Tapping a thumbnail swaps the
// hero; tapping the hero opens the original in a new tab. Long-
// pressing the hero (right-click on desktop) opens a context menu
// with upscale / enhance / restore-from-this-image / open-original
// actions (improvements #39 + #42); the upscale and enhance items
// open parameter dialogs first (improvements #41 + #42).
export function Viewer({ heroUrl, status, items, onSelect, onRestoreHero, onUpscale, upscaling, onEnhance, enhancing, onHeroLoad }: Props) {
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
                onLoad={(e) =>
                  onHeroLoad(
                    e.currentTarget.naturalWidth,
                    e.currentTarget.naturalHeight,
                  )
                }
                className="block h-auto w-full [-webkit-touch-callout:none]"
              />
            </a>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem disabled={upscaling} onClick={onUpscale}>
              Upscale
            </ContextMenuItem>
            <ContextMenuItem disabled={enhancing} onClick={onEnhance}>
              Enhance
            </ContextMenuItem>
            <ContextMenuItem onClick={onRestoreHero}>
              Restore from This Image
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() => window.open(heroUrl, "_blank", "noopener,noreferrer")}
            >
              Open Original
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
        <section className="mb-14">
          <h2 className="mb-3 text-xl font-semibold">Recent</h2>
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
