# photo-editor-bridge

Claude Code(MCP)と、ブラウザの写真エディタを、**このPCの中だけ**でつなぐブリッジです。

```
Claude Code ─(MCP/標準入出力)─ ブリッジ ─(WebSocket, 127.0.0.1)─ ブラウザのエディタ
```

- 渡すのは、編集の数値・タブの名前・明るさの統計だけ。画像のピクセルは渡しません。
- 待ち受けは `127.0.0.1` のみ。接続には、起動のたびに作る8文字のペアリングコードが要ります。

## 登録

```
claude mcp add photo-editor -- npx -y github:<owner>/photo-editor-bridge#v0.1.0
```

`#v0.1.0` は版(タグ)です。取得したコードをそのまま実行するので、ブランチ名ではなく版で固定してください。

## 環境変数

| 名前 | 既定 | 意味 |
| --- | --- | --- |
| `PHOTO_EDITOR_BRIDGE_PORT` | `47821` | 待ち受けポート |
| `PHOTO_EDITOR_ORIGINS` | (なし) | 標準の `localhost` / `127.0.0.1` に加えて許す接続元(カンマ区切り) |

## 開発

`src/` が正本です。`dist/` はビルド済みの成果物で、`npx` で取得できるようにリポジトリに含めています。
変更したら `npm run build` して、`dist/` も一緒にコミットします。

```
npm test        # テスト
npm run typecheck
npm run build
```
