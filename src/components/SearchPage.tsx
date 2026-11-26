import { useCallback, useEffect, useState } from "react";
import { Heart, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { usePersistedField } from "@/hooks/usePersistedField";
import { fetchSearch, type SearchItem } from "@/lib/api";

// Search page (/search, improvement #95): full-text search over every
// generated image in outputs/. The server matches each term against
// the PNG prompt metadata (prompt / UC / character captions) or, for
// an all-digits term, exactly against the seed. Tapping a thumbnail
// opens the original in a new tab, like the main viewer.
//
// Restyle (improvement #96): the page carries its own Muse Dash
// theme — warm ivory background, white surfaces, restrained radius,
// a blue accent used only as text color and as the filled Search
// action — scoped to this page through explicit classes, so it
// looks the same under the app's light and dark modes.
//
// Fixes (improvement #97): no static element on this page renders a
// border at all — not even a neutral one. Elements that sat on the
// white card (input, plain buttons, back link) are set apart by a
// stone-100 background instead. The only "border" utility left
// below is a border-transparent override, which renders nothing and
// exists solely to cancel the border color the ui Input paints by
// default (the ui Button's base style is already border-transparent).
// The ui components' focus-visible outlines/rings are left exactly
// as they are, for accessibility. The results also moved from CSS
// columns (which filled vertically, scrambling the reading order)
// to a responsive grid, so items read strictly left-to-right,
// top-to-bottom in API order, Load-more appends included.
//
// Improvement #98: the theme toggle is gone from this page (the
// page has its own fixed Dash theme, so switching was meaningless),
// and the results grid's column count is now selectable: "Auto"
// keeps the responsive counts, a number pins that many columns at
// every width. The choice persists in localStorage under
// "nai.searchCols" (via usePersistedField, like the form fields).
//
// Improvement #100: a compact sticky header. Once the page is
// scrolled past the form card (scrollY > 320px) a slim bar slides
// in at the top with a back link, a compact search field bound to
// the same input state, a favorites toggle and the result count,
// so re-searching never needs a scroll back up. It carries no
// border (per #97) — a soft shadow separates it from the results.
// While hidden it is translated off-screen with pointer-events
// off, visibility hidden and its controls removed from the tab
// order, so nothing off-screen stays focusable.
type ColsChoice = "auto" | "1" | "2" | "3" | "4" | "5" | "6";

const COLS_OPTIONS: { value: ColsChoice; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "1", label: "1" },
  { value: "2", label: "2" },
  { value: "3", label: "3" },
  { value: "4", label: "4" },
  { value: "5", label: "5" },
  { value: "6", label: "6" },
];

// Complete literal class strings per choice, so Tailwind's scanner
// sees every grid-cols-* utility; never interpolate fragments.
const GRID_COLS: Record<ColsChoice, string> = {
  auto: "grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5",
  "1": "grid-cols-1",
  "2": "grid-cols-2",
  "3": "grid-cols-3",
  "4": "grid-cols-4",
  "5": "grid-cols-5",
  "6": "grid-cols-6",
};

function isColsChoice(v: string): v is ColsChoice {
  return COLS_OPTIONS.some((o) => o.value === v);
}

export default function SearchPage() {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [items, setItems] = useState<SearchItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searched, setSearched] = useState(false);
  // Compact sticky header visibility (improvement #100).
  const [showBar, setShowBar] = useState(false);
  // Column-count choice, persisted under "nai.searchCols". A stored
  // value outside the known choices (older build, hand-edited
  // storage) falls back to "auto" instead of breaking the grid.
  const [colsStored, setColsStored] = usePersistedField("searchCols", "auto");
  const cols: ColsChoice = isColsChoice(colsStored) ? colsStored : "auto";

  const runSearch = useCallback(async (q: string, fav: boolean) => {
    setLoading(true);
    try {
      const { items: list, total: t } = await fetchSearch(q, fav, 0);
      setItems(list);
      setTotal(t);
    } catch {
      setItems([]);
      setTotal(0);
    }
    setSearched(true);
    setLoading(false);
  }, []);

  useEffect(() => {
    void runSearch("", false);
  }, [runSearch]);

  // Show the compact header once the form card is scrolled past.
  useEffect(() => {
    const onScroll = () => setShowBar(window.scrollY > 320);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const submit = () => {
    setQuery(input);
    void runSearch(input, favoritesOnly);
  };

  const toggleFavorites = () => {
    const next = !favoritesOnly;
    setFavoritesOnly(next);
    void runSearch(query, next);
  };

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const { items: more, total: t } = await fetchSearch(query, favoritesOnly, items.length);
      setItems((prev) => [...prev, ...more]);
      setTotal(t);
    } catch {
      /* keep what is shown */
    }
    setLoadingMore(false);
  };

  return (
    <main className="min-h-screen bg-[#faf7f2] text-stone-900">
      <div
        aria-label="Compact search header"
        aria-hidden={!showBar}
        className={`fixed inset-x-0 top-0 z-40 bg-[#faf7f2]/95 shadow-sm backdrop-blur transition-all duration-200 ${
          showBar
            ? "translate-y-0"
            : "invisible -translate-y-full pointer-events-none"
        }`}
      >
        <div className="mx-auto flex w-full max-w-[1200px] items-center gap-3 px-5 py-3 sm:px-8">
          <a
            href="./"
            tabIndex={showBar ? undefined : -1}
            className="flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-stone-100 px-3 text-sm text-blue-600 no-underline hover:bg-stone-200"
          >
            <span aria-hidden="true">←</span>
            <span className="hidden sm:inline">Generate</span>
          </a>
          <div className="flex min-w-0 flex-1 gap-2">
            <Input
              type="search"
              autoComplete="off"
              placeholder="e.g. 1girl solo, or a seed"
              tabIndex={showBar ? undefined : -1}
              className="h-11 min-w-0 flex-1 border-transparent bg-white text-base text-stone-900 placeholder:text-stone-400 dark:bg-white dark:text-stone-900"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
            <Button
              type="button"
              onClick={submit}
              tabIndex={showBar ? undefined : -1}
              aria-label="Search"
              className="h-11 min-w-11 shrink-0 rounded-lg bg-blue-600 px-3 text-white hover:bg-blue-700"
            >
              <Search className="h-5 w-5" />
            </Button>
          </div>
          <Button
            type="button"
            variant="secondary"
            onClick={toggleFavorites}
            tabIndex={showBar ? undefined : -1}
            aria-label="Favorites only"
            aria-pressed={favoritesOnly}
            className={
              favoritesOnly
                ? "h-11 min-w-11 shrink-0 rounded-lg bg-blue-600 px-3 text-white hover:bg-blue-700"
                : "h-11 min-w-11 shrink-0 rounded-lg bg-stone-100 px-3 text-stone-700 hover:bg-stone-200"
            }
          >
            <Heart className={favoritesOnly ? "h-4 w-4 fill-current" : "h-4 w-4"} />
          </Button>
          {searched && (
            <span className="hidden shrink-0 text-sm text-stone-500 sm:block">
              {total} {total === 1 ? "result" : "results"}
            </span>
          )}
        </div>
      </div>
      <div className="mx-auto w-full max-w-[1200px] px-5 pt-14 pb-24 sm:px-8">
        <header>
          <h1 className="mb-3 text-2xl font-bold">Search Images</h1>
          <p className="text-stone-500">
            Search all generated images by prompt tags, or by seed number
          </p>
        </header>

        <section className="mb-14">
          <div className="mt-6 rounded-xl bg-white px-6 py-7">
            <div className="flex gap-3">
              <Input
                type="search"
                autoComplete="off"
                placeholder="e.g. 1girl solo, or a seed"
                className="h-[52px] flex-1 border-transparent bg-stone-100 text-base text-stone-900 placeholder:text-stone-400 dark:bg-stone-100 dark:text-stone-900"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
              />
              <Button
                type="button"
                onClick={submit}
                className="h-[52px] min-w-[52px] rounded-lg bg-blue-600 px-5 text-base text-white hover:bg-blue-700"
              >
                <Search className="h-5 w-5" />
                Search
              </Button>
            </div>
            <Button
              type="button"
              variant="secondary"
              onClick={toggleFavorites}
              aria-pressed={favoritesOnly}
              className={
                favoritesOnly
                  ? "mt-4 h-11 rounded-lg bg-blue-600 px-5 text-white hover:bg-blue-700"
                  : "mt-4 h-11 rounded-lg bg-stone-100 px-5 text-stone-700 hover:bg-stone-200"
              }
            >
              <Heart className={favoritesOnly ? "h-4 w-4 fill-current" : "h-4 w-4"} />
              Favorites only
            </Button>
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <span className="text-sm text-stone-500">Columns</span>
              <div className="flex flex-wrap gap-2" role="group" aria-label="Columns">
                {COLS_OPTIONS.map((o) => (
                  <Button
                    key={o.value}
                    type="button"
                    variant="secondary"
                    onClick={() => setColsStored(o.value)}
                    aria-pressed={cols === o.value}
                    className={
                      cols === o.value
                        ? "h-11 min-w-11 rounded-lg bg-blue-600 px-3.5 text-white hover:bg-blue-700"
                        : "h-11 min-w-11 rounded-lg bg-stone-100 px-3.5 text-stone-700 hover:bg-stone-200"
                    }
                  >
                    {o.label}
                  </Button>
                ))}
              </div>
            </div>
            <div className="mt-6 flex items-center gap-3">
              <a
                href="./"
                className="inline-block rounded-lg bg-stone-100 px-3.5 py-1.5 text-sm text-blue-600 no-underline hover:bg-stone-200"
              >
                ← Back to Generate
              </a>
            </div>
          </div>
        </section>

        <section>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="text-xl font-semibold">
              {searched ? `${total} ${total === 1 ? "result" : "results"}` : "Results"}
            </h2>
            {loading && <Spinner className="shrink-0" />}
          </div>
          {searched && !loading && items.length === 0 && (
            <p className="text-stone-500">No images matched.</p>
          )}
          <div className={`mt-4 grid items-start gap-5 ${GRID_COLS[cols]}`}>
            {items.map((it) => (
              <a
                key={it.name}
                href={it.url}
                target="_blank"
                rel="noopener noreferrer"
                className="relative block"
              >
                <img
                  src={it.url}
                  loading="lazy"
                  alt=""
                  width={it.width}
                  height={it.height}
                  style={{
                    aspectRatio:
                      it.width && it.height ? `${it.width} / ${it.height}` : undefined,
                  }}
                  className="block h-auto w-full rounded-lg"
                />
                {it.favorite && (
                  <span className="absolute top-2 right-2 rounded-full bg-black/55 p-1.5 text-white">
                    <Heart className="size-3.5 fill-current" />
                  </span>
                )}
              </a>
            ))}
          </div>
          {items.length > 0 && items.length < total && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => void loadMore()}
              disabled={loadingMore}
              className="mt-8 h-[52px] w-full rounded-lg bg-stone-100 text-base text-stone-900 hover:bg-stone-200"
            >
              {loadingMore ? "Loading..." : `Load more (${total - items.length} remaining)`}
            </Button>
          )}
        </section>
      </div>
    </main>
  );
}
