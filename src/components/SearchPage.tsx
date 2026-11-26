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
    <main className="mx-auto max-w-[640px] px-5 pt-14 pb-24">
      <header>
        <h1 className="mb-3 text-2xl font-bold">Search Images</h1>
        <p className="text-muted-foreground">
          Search all generated images by prompt tags, or by seed number
        </p>
      </header>

      <section className="mb-14">
        <div className="mt-6 rounded-[20px] border border-border bg-card px-6 py-7">
          <div className="flex gap-3">
            <Input
              type="search"
              autoComplete="off"
              placeholder="e.g. 1girl solo, or a seed"
              className="h-[52px] flex-1 text-base"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
            <Button
              type="button"
              variant="secondary"
              onClick={submit}
              className="h-[52px] min-w-[52px] rounded-full border border-border px-5 text-base"
            >
              <Search className="h-5 w-5" />
              Search
            </Button>
          </div>
          <Button
            type="button"
            variant={favoritesOnly ? "default" : "secondary"}
            onClick={toggleFavorites}
            className="mt-4 h-11 rounded-full border border-border px-5"
            aria-pressed={favoritesOnly}
          >
            <Heart className={favoritesOnly ? "h-4 w-4 fill-current" : "h-4 w-4"} />
            Favorites only
          </Button>
          <div className="mt-6 flex items-center gap-3">
            <a
              href="./"
              className="inline-block rounded-full border border-border bg-card px-3.5 py-1.5 text-sm text-muted-foreground no-underline"
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
          <p className="text-muted-foreground">No images matched.</p>
        )}
        <div className="mt-4 grid grid-cols-2 gap-3">
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
        {items.length > 0 && items.length < total && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="mt-8 h-[52px] w-full rounded-full border border-border text-base"
          >
            {loadingMore ? "Loading..." : `Load more (${total - items.length} remaining)`}
          </Button>
        )}
      </section>
    </main>
  );
}
