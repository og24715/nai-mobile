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
