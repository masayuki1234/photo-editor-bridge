#!/usr/bin/env node
// ブリッジの起動: Claude Code(標準入出力のMCP)と、エディタ(WebSocket、127.0.0.1のみ)を結ぶ。
// 標準出力はMCPの通信専用。ログは標準エラーへ出す。
import { createInterface } from 'node:readline';
import { WebSocketServer, type WebSocket } from 'ws';
import { Bridge, MAX_CHAT_LENGTH, type PageLink } from './bridge-core.ts';
import { channelNotification, createMcpHandler, type ToolOutput } from './mcp.ts';
import { PairingGuard, isAllowedOrigin } from './pairing.ts';
import { CHANNEL_INSTRUCTIONS, CHAT_REPLY_TOOL, CONNECTION_INFO_TOOL, EDITOR_TOOLS } from './tool-defs.ts';

const PORT = Number(process.env.PHOTO_EDITOR_BRIDGE_PORT ?? 47821);
const EXTRA_ORIGINS = (process.env.PHOTO_EDITOR_ORIGINS ?? '')
	.split(',')
	.map((s) => s.trim())
	.filter(Boolean);
const CLOSE_POLICY = 1008;

const log = (text: string) => process.stderr.write(`[photo-editor-bridge] ${text}\n`);

// 標準出力はMCPの通信専用。1行1メッセージで書く
const writeMessage = (message: object) => process.stdout.write(`${JSON.stringify(message)}\n`);

const bridge = new Bridge();
// エディタの会話欄からの発言を、Claude Code の会話へ差し込む(チャンネル)
bridge.onChat((text) => writeMessage(channelNotification(text, { chat_id: 'editor' })));
const pairing = new PairingGuard();

// 127.0.0.1 だけで待ち受ける(ほかの機器からは届かない)
const wss = new WebSocketServer({ host: '127.0.0.1', port: PORT });
wss.on('error', (e) => {
	log(`WebSocketサーバーを開始できません: ${e.message}`);
	process.exit(1);
});
wss.on('listening', () => {
	log(`待ち受け中: ws://127.0.0.1:${PORT}  ペアリングコード: ${pairing.code}`);
	if (EXTRA_ORIGINS.length > 0) log(`許可する接続元(追加): ${EXTRA_ORIGINS.join(', ')}`);
});

wss.on('connection', (socket: WebSocket, request) => {
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
	const page: PageLink = { send: (t) => socket.send(t), close: () => socket.close(1000, 'replaced') };
	bridge.attach(page);
	log(`エディタが接続しました(${origin})`);
	socket.on('message', (data) => bridge.receive(page, data.toString()));
	socket.on('close', () => {
		bridge.detach(page);
		log('エディタが切断しました');
	});
});

const asText = (value: unknown) => JSON.stringify(value, null, 2);

async function callTool(name: string, args: unknown): Promise<ToolOutput> {
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
	if (name === CHAT_REPLY_TOOL.name) {
		const text = typeof args === 'object' && args !== null ? (args as { text?: unknown }).text : undefined;
		if (typeof text !== 'string' || text.trim() === '' || text.length > MAX_CHAT_LENGTH) {
			return { text: `text must be a non-empty string of up to ${MAX_CHAT_LENGTH} characters.`, isError: true };
		}
		return bridge.sendChatReply(text)
			? { text: 'sent' }
			: { text: 'The editor is not connected, so the reply was not delivered.', isError: true };
	}
	const result = await bridge.call(name, args);
	return result.ok ? { text: asText(result.result) } : { text: asText(result.error), isError: true };
}

const handle = createMcpHandler({
	serverInfo: { name: 'photo-editor', version: '0.0.1' },
	tools: [CONNECTION_INFO_TOOL, CHAT_REPLY_TOOL, ...EDITOR_TOOLS],
	instructions: CHANNEL_INSTRUCTIONS,
	callTool
});

const lines = createInterface({ input: process.stdin });
lines.on('line', (line) => {
	if (line.trim() === '') return;
	void (async () => {
		let message: unknown;
		try {
			message = JSON.parse(line);
		} catch {
			writeMessage({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
			return;
		}
		const response = await handle(message);
		if (response) writeMessage(response);
	})();
});
// Claude Code が終了(標準入力が閉じる)したら、ブリッジも終える
lines.on('close', () => {
	wss.close();
	process.exit(0);
});
