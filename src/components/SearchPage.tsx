import { useCallback, useEffect, useState } from "react";
import { Heart, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ThemeToggle } from "@/components/ThemeToggle";
import { fetchSearch, type SearchItem } from "@/lib/api";

// Search page (/search, improvement #95): full-text search over every
// generated image in outputs/. The server matches each term against
// the PNG prompt metadata (prompt / UC / character captions) or, for
// an all-digits term, exactly against the seed. Tapping a thumbnail
// opens the original in a new tab, like the main viewer.
//
// Restyle (improvement #96): the results are a responsive CSS-columns
// masonry (2 columns on phones, up to 5 on wide screens), and the
// page carries its own Muse Dash theme — warm ivory background,
// white surfaces, restrained radius, a blue accent used only as
// text color and as the filled Search action — scoped to this page
// through explicit classes, so it looks the same under the app's
// light and dark modes. Every resting border on the page is a
// neutral stone hairline; no accent color is ever used as a border
// color. The ui components' focus-visible outlines/rings are left
// exactly as they are, for accessibility.
export default function SearchPage() {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [items, setItems] = useState<SearchItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searched, setSearched] = useState(false);

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
      <div className="mx-auto w-full max-w-[1200px] px-5 pt-14 pb-24 sm:px-8">
        <header>
          <h1 className="mb-3 text-2xl font-bold">Search Images</h1>
          <p className="text-stone-500">
            Search all generated images by prompt tags, or by seed number
          </p>
        </header>

        <section className="mb-14">
          <div className="mt-6 rounded-xl border border-stone-200 bg-white px-6 py-7">
            <div className="flex gap-3">
              <Input
                type="search"
                autoComplete="off"
                placeholder="e.g. 1girl solo, or a seed"
                className="h-[52px] flex-1 border-stone-300 bg-white text-base text-stone-900 placeholder:text-stone-400 dark:bg-white dark:text-stone-900"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                }}
              />
              <Button
                type="button"
                onClick={submit}
                className="h-[52px] min-w-[52px] rounded-lg border border-transparent bg-blue-600 px-5 text-base text-white hover:bg-blue-700"
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
                  ? "mt-4 h-11 rounded-lg border border-transparent bg-blue-600 px-5 text-white hover:bg-blue-700"
                  : "mt-4 h-11 rounded-lg border border-stone-300 bg-white px-5 text-stone-700 hover:bg-stone-100"
              }
            >
              <Heart className={favoritesOnly ? "h-4 w-4 fill-current" : "h-4 w-4"} />
              Favorites only
            </Button>
            <div className="mt-6 flex items-center gap-3">
              <a
                href="./"
                className="inline-block rounded-lg border border-stone-300 bg-white px-3.5 py-1.5 text-sm text-blue-600 no-underline hover:bg-stone-100"
              >
                ← Back to Generate
              </a>
              <ThemeToggle />
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
          <div className="mt-4 columns-2 gap-5 sm:columns-3 lg:columns-4 xl:columns-5">
            {items.map((it) => (
              <a
                key={it.name}
                href={it.url}
                target="_blank"
                rel="noopener noreferrer"
                className="relative mb-5 block break-inside-avoid"
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
                  className="block h-auto w-full rounded-lg border border-stone-200"
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
              className="mt-8 h-[52px] w-full rounded-lg border border-stone-300 bg-white text-base text-stone-900 hover:bg-stone-100"
            >
              {loadingMore ? "Loading..." : `Load more (${total - items.length} remaining)`}
            </Button>
          )}
        </section>
      </div>
    </main>
  );
}
