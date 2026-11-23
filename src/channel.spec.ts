import { describe, expect, it, vi } from 'vitest';
import { Bridge, MAX_CHAT_LENGTH, type PageLink } from './bridge-core.ts';
import { channelNotification, createMcpHandler } from './mcp.ts';

const fakePage = () => {
	const sent: string[] = [];
	const page: PageLink = { send: (t) => sent.push(t), close: vi.fn() };
	return { page, sent };
};

const chat = (text: unknown) => JSON.stringify({ type: 'chat', text });

describe('Bridge の会話', () => {
	it('エディタからの発言を、受け取り先に渡す', () => {
		const bridge = new Bridge();
		const heard: string[] = [];
		bridge.onChat((t) => heard.push(t));
		const { page } = fakePage();
		bridge.attach(page);
		bridge.receive(page, chat('暗いので明るくして'));
		expect(heard).toEqual(['暗いので明るくして']);
	});

	it('空・長すぎる・文字でない発言は捨てる', () => {
		const bridge = new Bridge();
		const heard: string[] = [];
		bridge.onChat((t) => heard.push(t));
		const { page } = fakePage();
		bridge.attach(page);
		bridge.receive(page, chat(''));
		bridge.receive(page, chat('   '));
		bridge.receive(page, chat('あ'.repeat(MAX_CHAT_LENGTH + 1)));
		bridge.receive(page, chat(42));
		expect(heard).toEqual([]);
		bridge.receive(page, chat('あ'.repeat(MAX_CHAT_LENGTH)));
		expect(heard).toHaveLength(1);
	});

	it('いまの接続以外からの発言は無視する', () => {
		const bridge = new Bridge();
		const heard: string[] = [];
		bridge.onChat((t) => heard.push(t));
		const first = fakePage();
		const second = fakePage();
		bridge.attach(first.page);
		bridge.attach(second.page);
		bridge.receive(first.page, chat('古い接続から'));
		expect(heard).toEqual([]);
	});

	it('返事をエディタへ送る。接続がなければ false', () => {
		const bridge = new Bridge();
		expect(bridge.sendChatReply('こんにちは')).toBe(false);
		const { page, sent } = fakePage();
		bridge.attach(page);
		expect(bridge.sendChatReply('こんにちは')).toBe(true);
		expect(JSON.parse(sent[0] ?? '')).toEqual({ type: 'chat-reply', text: 'こんにちは' });
	});

	it('会話の発言は、呼び出しの返信待ちに影響しない', async () => {
		const bridge = new Bridge();
		const { page, sent } = fakePage();
		bridge.attach(page);
		const pending = bridge.call('get_state', undefined);
		bridge.receive(page, chat('途中の発言'));
		const { id } = JSON.parse(sent[0] ?? '');
		bridge.receive(page, JSON.stringify({ id, ok: true, result: 'done' }));
		expect(await pending).toEqual({ ok: true, result: 'done' });
	});
});

describe('チャンネルの通知と宣言', () => {
	it('通知は notifications/claude/channel で、本文と meta を持つ(id なし)', () => {
		expect(channelNotification('本文', { chat_id: 'editor' })).toEqual({
			jsonrpc: '2.0',
			method: 'notifications/claude/channel',
			params: { content: '本文', meta: { chat_id: 'editor' } }
		});
	});

	it('initialize でチャンネルを宣言し、説明(instructions)を渡す', async () => {
		const handler = createMcpHandler({
			serverInfo: { name: 't', version: '1' },
			tools: [],
			instructions: '使い方',
			callTool: async () => ({ text: '' })
		});
		const res = (await handler({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })) as {
			result: { capabilities: { tools: object; experimental: Record<string, object> }; instructions: string };
		};
		expect(res.result.capabilities.experimental['claude/channel']).toEqual({});
		expect(res.result.capabilities.tools).toEqual({});
		expect(res.result.instructions).toBe('使い方');
	});

	it('instructions が無ければ、項目ごと出さない', async () => {
		const handler = createMcpHandler({ serverInfo: { name: 't', version: '1' }, tools: [], callTool: async () => ({ text: '' }) });
		const res = (await handler({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })) as { result: object };
		expect(res.result).not.toHaveProperty('instructions');
	});
});
