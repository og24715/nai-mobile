import { useEffect, useRef, useState } from "react";
import { Heart, ImagePlus } from "lucide-react";
import AutoHeight from "embla-carousel-auto-height";
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
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
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
  // True once the first /api/recent load has settled. The empty
  // state (improvement #72) is only shown after that, so a user
  // who does have images never sees a false "No images yet"
  // flash while the list is still loading.
  recentLoaded: boolean;
  // Opens the generate form Drawer — the same action as the
  // ✎ FAB; the empty state's button uses it.
  onOpenForm: () => void;
  onSelect: (url: string) => void;
  onRestoreHero: () => void;
  onUpscale: () => void;
  upscaling: boolean;
  onEnhance: () => void;
  enhancing: boolean;
  // Natural size of a loaded slide image, reported with the
  // slide's own URL; the Enhance dialog reads the entry for the
  // currently selected slide.
  onHeroLoad: (url: string, w: number, h: number) => void;
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

// Main screen: hero carousel on top, status line, and the
// recent-generations thumbnail grid. The hero is a shadcn
// Carousel (Embla) with one slide per recent item, newest first
// — the same order as the thumbnail grid; swiping it moves
// through the images, and tapping a thumbnail scrolls it to
// that slide (improvement #71). Tapping the current slide
// opens the original in a new tab. Long-pressing the hero
// (right-click on desktop) opens a context menu with upscale /
// enhance / restore-from-this-image / favorite /
// open-original / download-without-metadata /
// use-as-base-image actions (improvements #39 + #42 + #61 +
// #62 + #63); the
// upscale and enhance items open parameter dialogs first
// (improvements #41 + #42). The hero also carries a heart overlay
// button (bottom-right) toggling its favorite state, favorited
// thumbnails get a heart badge, and the Recent header has a
// "Delete Others" bulk-delete with a confirmation dialog
// (improvement #61). When there are no images at all (and no
// operation is in flight), a shadcn Empty state stands where
// the carousel would be (improvement #72).
export function Viewer({ heroUrl, status, busy, items, recentLoaded, onOpenForm, onSelect, onRestoreHero, onUpscale, upscaling, onEnhance, enhancing, onHeroLoad, onDownloadClean, onUseAsBaseImage, heroFavorite, onToggleFavorite, othersCount, favoritesCount, onDeleteOthers, deletingOthers }: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);

  // --- Hero carousel selection sync (improvement #71) ---
  // The carousel's selected snap IS the current image; it stays
  // in sync with the heroUrl selection state both ways (the two
  // effects below). Embla owns all touch interpretation — the
  // original hand-rolled pointer-gesture version never engaged
  // on the user's Android phone, so it was replaced wholesale.
  // Embla also suppresses the click that follows a drag, so a
  // swipe never opens the original, and its AutoHeight plugin
  // sizes the viewport to the selected slide (the recent list
  // mixes portrait / landscape / square images).
  const [carouselApi, setCarouselApi] = useState<CarouselApi>();
  const autoHeight = useRef(AutoHeight());
  const heroIndex = items.findIndex((i) => i.url === heroUrl);
  // Latest values for the Embla callback, which is subscribed
  // once per api instance and must never go stale.
  const syncRef = useRef({ items, heroUrl, onSelect });
  syncRef.current = { items, heroUrl, onSelect };

  // Carousel -> selection: settling on a new snap (a swipe)
  // reports that slide's URL as the new selection.
  useEffect(() => {
    if (!carouselApi) return;
    const onSelectSnap = () => {
      const s = syncRef.current;
      const it = s.items[carouselApi.selectedScrollSnap()];
      if (it && it.url !== s.heroUrl) s.onSelect(it.url);
    };
    carouselApi.on("select", onSelectSnap);
    return () => {
      carouselApi.off("select", onSelectSnap);
    };
  }, [carouselApi]);

  // Selection -> carousel: an outside change (thumbnail tap, a
  // fresh generation / upscale / enhance result, the
  // delete-others fallback) scrolls the carousel to match.
  useEffect(() => {
    if (!carouselApi || heroIndex < 0) return;
    if (carouselApi.selectedScrollSnap() !== heroIndex) {
      carouselApi.scrollTo(heroIndex);
    }
  }, [carouselApi, heroIndex, items]);

  return (
    <>
      {items.length > 0 ? (
        <div className="relative">
          <ContextMenu>
            <ContextMenuTrigger className="block leading-none [-webkit-touch-callout:none]">
              <Carousel
                setApi={setCarouselApi}
                opts={{ loop: false }}
                plugins={[autoHeight.current]}
              >
                <CarouselContent className="ml-0">
                  {items.map((it) => (
                    <CarouselItem key={it.name} className="pl-0">
                      <a
                        href={it.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block leading-none"
                      >
                        <img
                          src={it.url}
                          alt=""
                          draggable={false}
                          onLoad={(e) =>
                            onHeroLoad(
                              it.url,
                              e.currentTarget.naturalWidth,
                              e.currentTarget.naturalHeight,
                            )
                          }
                          className="block h-auto w-full [-webkit-touch-callout:none]"
                        />
                      </a>
                    </CarouselItem>
                  ))}
                </CarouselContent>
              </Carousel>
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
      ) : (
        recentLoaded &&
        !busy && (
          <div className="mx-auto max-w-[640px] px-5 pt-10">
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ImagePlus />
                </EmptyMedia>
                <EmptyTitle>No images yet</EmptyTitle>
                <EmptyDescription>
                  Images you generate will appear here.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button type="button" onClick={onOpenForm}>
                  Open the generation form
                </Button>
              </EmptyContent>
            </Empty>
          </div>
        )
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
