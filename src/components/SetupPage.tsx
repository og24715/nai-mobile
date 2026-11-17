import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/ThemeToggle";
import { TOKEN_KEY, readStored, removeStored, writeStored } from "@/lib/storage";

const hintCls = "text-xs text-muted-foreground";

// Token setup page (/setup). The token is saved ONLY to this browser's
// localStorage ("nai.token"); the server stores nothing.
export default function SetupPage() {
  const [token, setToken] = useState("");
  const [has, setHas] = useState(() => !!readStored(TOKEN_KEY));

  const save = () => {
    const t = token.trim();
    if (!t) {
      alert("The token is empty");
      return;
    }
    writeStored(TOKEN_KEY, t);
    location.replace("./");
  };

  const clear = () => {
    removeStored(TOKEN_KEY);
    setToken("");
    setHas(false);
  };

  return (
    <main className="mx-auto max-w-[640px] px-5 pt-14 pb-24">
      <header>
        <h1 className="mb-3 text-2xl font-bold">Token Settings</h1>
        <p className="text-muted-foreground">
          Save your NovelAI Persistent API Token in this browser
        </p>
      </header>

      <section className="mb-14">
        <div className="mt-6 rounded-[20px] border border-border bg-card px-6 py-7">
          <h2 className="mb-3 text-lg font-semibold">API Token</h2>
          <p className={hintCls}>
            {has
              ? "Saved token: yes (save a new token to replace it)"
              : "Saved token: none"}
          </p>
          <Label
            htmlFor="token"
            className="mt-[18px] mb-1.5 block text-sm font-medium text-muted-foreground"
          >
            Persistent API Token (stored only in this browser's localStorage)
          </Label>
          <Input
            id="token"
            type="password"
            autoComplete="off"
            placeholder="pst-..."
            className="text-base"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <Button
            type="button"
            variant="secondary"
            onClick={save}
            className="mt-6 h-[52px] w-full rounded-full border border-border text-base"
          >
            Save Token
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={clear}
            className="mt-6 h-[52px] w-full rounded-full border border-border text-base"
          >
            Delete Token
          </Button>
          <p className={`${hintCls} mt-4`}>
            It is never stored on the server. It is sent from this browser with each generation, and the server only relays it.
          </p>
          <p className={`${hintCls} mt-2`}>
            Storage is per browser and per URL (origin). Using a different browser or URL requires entering it again, as does clearing your browser data.
          </p>
          <p className={`${hintCls} mt-2`}>
            Get it at: novelai.net → Account Settings → Get Persistent API Token. Never send it in chat.
          </p>
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
    </main>
  );
}
