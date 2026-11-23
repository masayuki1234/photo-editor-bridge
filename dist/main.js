#!/usr/bin/env node
// ブリッジの起動: Claude Code(標準入出力のMCP)と、エディタ(WebSocket、127.0.0.1のみ)を結ぶ。
// 標準出力はMCPの通信専用。ログは標準エラーへ出す。
import { createInterface } from 'node:readline';
import { WebSocketServer } from 'ws';
import { Bridge } from "./bridge-core.js";
import { createMcpHandler } from "./mcp.js";
import { PairingGuard, isAllowedOrigin } from "./pairing.js";
import { CONNECTION_INFO_TOOL, EDITOR_TOOLS } from "./tool-defs.js";
const PORT = Number(process.env.PHOTO_EDITOR_BRIDGE_PORT ?? 47821);
const EXTRA_ORIGINS = (process.env.PHOTO_EDITOR_ORIGINS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
const CLOSE_POLICY = 1008;
const log = (text) => process.stderr.write(`[photo-editor-bridge] ${text}\n`);
const bridge = new Bridge();
const pairing = new PairingGuard();
// 127.0.0.1 だけで待ち受ける(ほかの機器からは届かない)
const wss = new WebSocketServer({ host: '127.0.0.1', port: PORT });
wss.on('error', (e) => {
    log(`WebSocketサーバーを開始できません: ${e.message}`);
    process.exit(1);
});
wss.on('listening', () => {
    log(`待ち受け中: ws://127.0.0.1:${PORT}  ペアリングコード: ${pairing.code}`);
    if (EXTRA_ORIGINS.length > 0)
        log(`許可する接続元(追加): ${EXTRA_ORIGINS.join(', ')}`);
});
wss.on('connection', (socket, request) => {
    const origin = request.headers.origin;
    const code = new URL(request.url ?? '/', 'ws://127.0.0.1').searchParams.get('code') ?? '';
    if (!isAllowedOrigin(origin, EXTRA_ORIGINS)) {
        log(`接続元を拒否しました: ${origin ?? '(なし)'}`);
        socket.close(CLOSE_POLICY, 'origin not allowed');
        return;
    }
    if (pairing.verify(code) !== 'ok') {
        log('ペアリングコードが違うため拒否しました');
        socket.close(CLOSE_POLICY, 'wrong code');
        return;
    }
    const page = { send: (t) => socket.send(t), close: () => socket.close(1000, 'replaced') };
    bridge.attach(page);
    log(`エディタが接続しました(${origin})`);
    socket.on('message', (data) => bridge.receive(page, data.toString()));
    socket.on('close', () => {
        bridge.detach(page);
        log('エディタが切断しました');
    });
});
const asText = (value) => JSON.stringify(value, null, 2);
async function callTool(name, args) {
    if (name === CONNECTION_INFO_TOOL.name) {
        return {
            text: asText({
                connected: bridge.connected,
                port: PORT,
                pairingCode: pairing.code,
                howTo: 'Tell the user to open the editor, press the plug icon ("Claude Code と接続"), and enter this port and code.'
            })
        };
    }
    const result = await bridge.call(name, args);
    return result.ok ? { text: asText(result.result) } : { text: asText(result.error), isError: true };
}
const handle = createMcpHandler({
    serverInfo: { name: 'photo-editor', version: '0.0.1' },
    tools: [CONNECTION_INFO_TOOL, ...EDITOR_TOOLS],
    callTool
});
const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
    if (line.trim() === '')
        return;
    void (async () => {
        let message;
        try {
            message = JSON.parse(line);
        }
        catch {
            process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`);
            return;
        }
        const response = await handle(message);
        if (response)
            process.stdout.write(`${JSON.stringify(response)}\n`);
    })();
});
// Claude Code が終了(標準入力が閉じる)したら、ブリッジも終える
lines.on('close', () => {
    wss.close();
    process.exit(0);
});
