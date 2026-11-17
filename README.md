# nai-mobile

NovelAI 画像生成 API 用の、スマホ向けの薄いフロントエンド。TypeScript / Node.js 製。
公式クライアントの代わりに、よく使う設定だけで手早く生成するための個人用ページ。

## 機能 (v1)

- プロンプト / ネガティブプロンプト
- モデル選択 (V5 Full / Curated、V4.5 Full / Curated、V4 Full / Curated、V3)
- サイズ (832×1216 / 1216×832 / 1024×1024)、steps、scale、sampler、seed (空ならランダム)
- キャラクタープロンプト ×2 (それぞれネガティブ付き、v4_prompt の char_captions で送信。V3 ではメインプロンプトへ統合)
- 画面上部に最新の生成を全幅表示 (タップで原寸表示 / ダウンロード)。最近の生成はサムネイル表示で、タップすると上部の表示が切り替わる
- 生成はユーザーがボタンを押したときの単発リクエストのみ (バッチ / 自動ループなし)

## セットアップ

```sh
npm install
npm run build   # tsc で src/server.ts を dist/server.js へ
npm start       # node dist/server.js
```

## トークン

NovelAI の Persistent API Token が必要 (NovelAI の Account Settings から取得)。

- 設定ページ (`/setup`、生成画面右上の ⚙ からも移動可) で入力して保存するか、`token.txt` に直接書く。未登録のときは生成画面を開くと自動で設定ページへ移動する
- トークンはこの PC 上の `token.txt` (権限 600) にだけ保存され、API への送信以外に使わない
- `token.txt` は .gitignore で除外されており、リポジトリには絶対に含めない

## 実行

開発 / 手動起動は `npm start`。常駐させる場合は systemd ユーザーサービスを使う。
サービス定義は `nai-mobile.service.example` として置いてあるので、コピーして配置する。

```sh
cp nai-mobile.service.example ~/.config/systemd/user/nai-mobile.service
systemctl --user daemon-reload
systemctl --user enable --now nai-mobile
```

example は systemd の `%h` (使う人のホーム) 記法で書かれており、クローン先が `~/workspace/nai-mobile`、node が `~/.local/bin/node` にある前提。配置先や node の場所が違う場合は、コピーしたファイルのパスを直すこと。

ポートは 8196 (`http://localhost:8196/`)。

## 出力

生成した PNG はメタデータそのまま `outputs/` に保存される。
`outputs/*.png` は .gitignore で除外されており、リポジトリには含めない。
