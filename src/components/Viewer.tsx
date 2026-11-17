import { useState } from "react";
import { Heart } from "lucide-react";
import type { RecentItem } from "@/lib/api";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "cn";

export interface StatusState {
  kind: "" | "ok" | "err";
  text: string;
}

interface Props {
  heroUrl: string;
  status: StatusState;
  // True while any operation that drives the status line is in
  // flight (generation — including its Vibe-encoding phase —
  // upscale, enhance): the status line shows a spinner (improvement
  // #55).
  busy: boolean;
  items: RecentItem[];
  onSelect: (url: string) => void;
  onRestoreHero: () => void;
  onUpscale: () => void;
  upscaling: boolean;
  onEnhance: () => void;
  enhancing: boolean;
  onHeroLoad: (w: number, h: number) => void;
  // Download the hero with its PNG text chunks stripped
  // (improvement #62).
  onDownloadClean: () => void;
  // Attach the hero itself as the form's img2img base image
  // (improvement #63).
  onUseAsBaseImage: () => void;
  // Favorites (improvement #61): the hero's favorite state and
  // its toggle (heart overlay button + context-menu item), plus
  // the whole-outputs/ counts and the bulk "Delete Others" run.
  heroFavorite: boolean;
  onToggleFavorite: () => void;
  othersCount: number;
  favoritesCount: number;
  onDeleteOthers: () => void;
  deletingOthers: boolean;
}

// Main screen: full-bleed hero image on top, status line, and the
// recent-generations thumbnail grid. Tapping a thumbnail swaps the
// hero; tapping the hero opens the original in a new tab. Long-
// pressing the hero (right-click on desktop) opens a context menu
// with upscale / enhance / restore-from-this-image / favorite /
// open-original / download-without-metadata /
// use-as-base-image actions (improvements #39 + #42 + #61 +
// #62 + #63); the
// upscale and enhance items open parameter dialogs first
// (improvements #41 + #42). The hero also carries a heart overlay
// button (bottom-right) toggling its favorite state, favorited
// thumbnails get a heart badge, and the Recent header has a
// "Delete Others" bulk-delete with a confirmation dialog
// (improvement #61).
export function Viewer({ heroUrl, status, busy, items, onSelect, onRestoreHero, onUpscale, upscaling, onEnhance, enhancing, onHeroLoad, onDownloadClean, onUseAsBaseImage, heroFavorite, onToggleFavorite, othersCount, favoritesCount, onDeleteOthers, deletingOthers }: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <>
      {heroUrl && (
        <div className="relative">
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
              <ContextMenuItem onClick={onUseAsBaseImage}>
                Use as Base Image
              </ContextMenuItem>
              <ContextMenuItem onClick={onToggleFavorite}>
                {heroFavorite ? "Remove from Favorites" : "Add to Favorites"}
              </ContextMenuItem>
              <ContextMenuItem
                onClick={() => window.open(heroUrl, "_blank", "noopener,noreferrer")}
              >
                Open Original
              </ContextMenuItem>
              <ContextMenuItem onClick={onDownloadClean}>
                Download without Metadata
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
          <button
            type="button"
            aria-label={heroFavorite ? "Remove from Favorites" : "Add to Favorites"}
            aria-pressed={heroFavorite}
            onClick={onToggleFavorite}
            className="absolute right-3 bottom-3 z-10 rounded-full bg-black/55 p-2.5 text-white backdrop-blur-sm transition hover:bg-black/70"
          >
            <Heart
              className={cn("size-5", heroFavorite && "fill-primary text-primary")}
            />
          </button>
        </div>
      )}
      <main className="mx-auto max-w-[640px] px-5 pt-8 pb-32">
        <div
          className={cn(
            "mt-4 flex items-center gap-2 text-sm text-muted-foreground",
            status.kind === "err" && "text-err",
            status.kind === "ok" && "text-ok",
          )}
        >
          {busy && <Spinner className="shrink-0" />}
          <span className="whitespace-pre-wrap">{status.text}</span>
        </div>
        <section className="mb-14">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-xl font-semibold">Recent</h2>
            <Button
              variant="ghost"
              size="sm"
              disabled={othersCount === 0 || deletingOthers}
              onClick={() => setConfirmOpen(true)}
            >
              Delete Others
            </Button>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {items.map((it) => (
              <a
                key={it.name}
                href={it.url}
                className="relative block"
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
                {it.favorite && (
                  <span className="absolute top-2 right-2 rounded-full bg-black/55 p-1.5 text-primary">
                    <Heart className="size-3.5 fill-current" />
                  </span>
                )}
              </a>
            ))}
          </div>
        </section>
      </main>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete other images?</AlertDialogTitle>
            <AlertDialogDescription>
              {favoritesCount > 0
                ? `Delete ${othersCount} ${othersCount === 1 ? "image" : "images"}? Your ${favoritesCount} ${favoritesCount === 1 ? "favorite" : "favorites"} will be kept.`
                : `Delete all ${othersCount} ${othersCount === 1 ? "image" : "images"}? You have no favorites, so everything will be deleted.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setConfirmOpen(false);
                onDeleteOthers();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
