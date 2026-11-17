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
      alert("トークンが空です");
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
        <h1 className="mb-3 text-[32px] font-bold">トークン設定</h1>
        <p className="text-muted-foreground">
          NovelAI の Persistent API Token をこのブラウザに保存します
        </p>
      </header>

      <section className="mb-14">
        <div className="mt-6 rounded-[20px] border border-border bg-card px-6 py-7">
          <h2 className="mb-3 text-lg font-semibold">APIトークン</h2>
          <p className={hintCls}>
            {has
              ? "保存済みトークン: あり（差し替える場合は新しいトークンを保存）"
              : "保存済みトークン: なし"}
          </p>
          <Label
            htmlFor="token"
            className="mt-[18px] mb-1.5 block text-[13px] font-normal text-muted-foreground"
          >
            Persistent API Token（このブラウザの localStorage にだけ保存されます）
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
            トークンを保存
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={clear}
            className="mt-6 h-[52px] w-full rounded-full border border-border text-base"
          >
            トークンを削除
          </Button>
          <p className={`${hintCls} mt-4`}>
            サーバーには一切保存されません。生成のたびにこのブラウザから送信され、サーバーは中継にだけ使います。
          </p>
          <p className={`${hintCls} mt-2`}>
            保存はブラウザ／URL（オリジン）ごとです。別のブラウザや別の URL から使うときは再入力が必要で、ブラウザのデータを消すと再入力が必要になります。
          </p>
          <p className={`${hintCls} mt-2`}>
            取得: novelai.net → Account Settings → Get Persistent API Token。チャットには送らないでください。
          </p>
          <div className="mt-6 flex items-center gap-3">
            <a
              href="./"
              className="inline-block rounded-full border border-border bg-card px-3.5 py-1.5 text-[13px] text-muted-foreground no-underline"
            >
              ← 生成画面へ戻る
            </a>
            <ThemeToggle />
          </div>
        </div>
      </section>
    </main>
  );
}
