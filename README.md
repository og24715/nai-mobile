# nai-mobile

NovelAI 画像生成 API 用の、スマホ向けの薄いフロントエンド。
公式クライアントの代わりに、よく使う設定だけで手早く生成するための個人用ページ。

構成は React + Tailwind CSS + shadcn/ui 製のフロントエンドと、API 専用の Node サーバー。
(2026-11-17 に単一ファイルの素の TypeScript から移行した。挙動と localStorage のキーは移行前と同一。)

## 機能

- プロンプト / ネガティブプロンプト
- モデル選択 (V5 Full / Curated、V4.5 Full / Curated、V4 Full / Curated、V3)
- サイズ (832×1216 / 1216×832 / 1024×1024)、steps / scale はスライダー (スマホで操作しやすいよう縦に積み、横には並べない)、sampler、seed (空ならランダム)
- キャラクタープロンプトは追加・削除可能 (0〜6人、それぞれネガティブ付き、配置は横方向に自動で均等割り。v4_prompt の char_captions で送信。V3 ではメインプロンプトへ統合)
- メイン画面は画像ビューアのみ: 画面上部に最新の生成を全幅表示 (タップで原寸表示)。最近の生成はサムネイル表示で、タップすると上部の表示が切り替わる
- 生成フォームは右下の FAB (✎) から開く全画面モーダル (マージンなし) に収納 (モーダルは入力専用、ブラウザの戻る操作でも閉じられる)。生成ボタンも右下の FAB (▶) としてビューア側にあり、押すとモーダルを開かずにそのまま生成が始まって、ビューア側で進捗表示 → 完成画像に切り替わる
- 入力した設定はすべてブラウザの localStorage に保持され、次回開いたときに復元される (使われた seed はステータス表示のみで、seed 欄には書き戻されない)
- 生成はユーザーがボタンを押したときの単発リクエストのみ (バッチ / 自動ループなし)
- プロンプト欄の下にはタグチップ表示があり、タップすると重み (`n:: tag ::` 形式、±0.1 ステッパー / マイナス重みへの反転)、キャラ欄では `source#` / `target#` / `mutual#` 接頭辞の付け替え、削除ができる (`{}` `[]` を含む部分は表示のみ)
- メイン画面の「画像から復元」から端末上の PNG を選ぶと、埋め込まれた NovelAI メタデータを端末内だけで読み取り、プロンプトや設定をフォームへ復元できる (アップロードはしない)。フォーム内の「Restore from Clipboard」からはクリップボードの画像でも同じ復元ができる (Clipboard API のため HTTPS ページでのみ動作し、フォームを開いている間の画像のみの貼り付けでも受け付ける)
- 生成画像の検索ページ (`/search`、メイン画面の Recent 見出し横の Search から移動可) で、`outputs/` の全画像をプロンプト等から検索できる

## タグサジェスト

プロンプト入力中、現在のタグ (カンマ以降の入力) に対して候補を表示する。

- サーバー側エンドポイント `GET /api/tags?q=<部分タグ>&model=<モデル>` が、NovelAI 公式の suggest-tags API をブラウザのトークンで中継した結果と、個人タグをマージして返す。トークンは従来どおりリクエスト単位でメモリ内でのみ使われ、保存・ログ出力はされない
- 個人タグは `outputs/*.png` のメタデータ (プロンプト / UC / キャラクターキャプション) からタグを集計したもので、一致したものは「よく使う」として先頭に表示される。集計結果は `data/personal-tags.json` にファイル単位でキャッシュされ、増えた／変わったファイルだけを差分解析して更新される (初回のみ全件解析) (`data/` は .gitignore で除外)
- トークンがない場合や公式 API が失敗した場合は個人タグのみ返す (UI がエラーになることはない)

## 画像検索

検索ページ (`/search`) から、`outputs/` に保存された全生成画像を検索できる。メイン画面の Recent 見出し横にある Search リンクから移動する。

- サーバー側エンドポイント `GET /api/search?q=<検索語>&favorites=0|1&offset=<開始位置>&limit=<件数>` が結果を返す。`limit` は既定 60、最大 120 で、新しい順にページングする
- 検索対象は各 PNG のメタデータ (プロンプト / UC / キャラクターキャプション) で、空白またはカンマで区切った語はすべて一致する必要がある (AND 検索)。アンダースコアと空白は同一視される。数字だけの語は seed の完全一致として扱われる
- `favorites=1` でお気に入りのみに絞り込める。レスポンスは `/api/recent` と同じ形の `items` (name / url / favorite / width / height に seed / model を追加) と、一致した総数 `total` を返す
- 索引は `data/search-index.json` に永続化され、検索のたびに増えた／変わったファイルだけを差分解析する (初回のみ全件解析)。`/api/recent` と同じくトークンは不要なローカル読み取り専用エンドポイント

## リポジトリ構成

```
server/   API 専用サーバー (TypeScript)。生成プロキシ、outputs/ の配信、
          ビルド済みフロントエンド (dist/) の静的配信と SPA フォールバック
src/      React フロントエンド (Vite + Tailwind CSS + shadcn/ui)
  components/   Viewer / FabRow / FormModal / GenerateForm / SetupPage など
  components/ui/ shadcn/ui コンポーネント (button, dialog, slider, select, ...)
  hooks/        localStorage 永続化フック
  lib/          API クライアント、選択肢、ストレージキー
index.html  Vite のエントリ
```

## セットアップ

```sh
npm install
npm run build   # フロントエンドを dist/ へ、サーバーを dist-server/ へビルド
npm start       # node dist-server/server.js
```

開発時にフロントだけ触る場合は `npm run dev` (Vite 開発サーバー)。
ただし API は別途 `npm start` したサーバー側にしかないので、実機確認は build + start で行う。

## トークン

NovelAI の Persistent API Token が必要 (NovelAI の Account Settings から取得)。

- 設定ページ (`/setup`、生成フォームのモーダル下部にある ⚙ 設定からも移動可) で入力して保存する。未登録のときは生成画面を開くと自動で設定ページへ移動する
- トークンはブラウザの localStorage にだけ保存される (キー `nai.token`)。サーバーには一切保存されず、生成リクエストのたびにブラウザから `Authorization` ヘッダーで送られ、サーバーはその1回の API 呼び出しに使うだけ (ディスクにもログにも残らない)
- 保存はブラウザ / オリジン (URL) ごとに別々。別のブラウザや別の URL から使うときや、ブラウザのデータを消したあとは、そのブラウザで再入力が必要

## 実行

開発 / 手動起動は `npm start`。常駐させる場合は systemd ユーザーサービスを使う。
サービス定義は `nai-mobile.service.example` として置いてあるので、コピーして配置する。

```sh
cp nai-mobile.service.example ~/.config/systemd/user/nai-mobile.service
systemctl --user daemon-reload
systemctl --user enable --now nai-mobile
```

example は systemd の `%h` (使う人のホーム) 記法で書かれており、クローン先が `~/workspace/nai-mobile`、node が `~/.local/bin/node` にある前提。配置先や node の場所が違う場合は、コピーしたファイルのパスを直すこと。

ポートは 8196 (`http://localhost:8196/`)。環境変数 `PORT` で変更可。
自宅の home-index ゲートウェイ配下 (`/nai/`) でも動くよう、フロントのパスはすべて相対パスにしている。

## 出力

生成した PNG はメタデータそのまま `outputs/` に保存される。
`outputs/*.png` は .gitignore で除外されており、リポジトリには含めない。
