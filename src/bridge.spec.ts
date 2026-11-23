import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Bridge, type PageLink } from './bridge-core.ts';
import { createMcpHandler } from './mcp.ts';
import { PairingGuard, isAllowedOrigin } from './pairing.ts';

const fakePage = () => {
	const sent: string[] = [];
	const page: PageLink = { send: (t) => sent.push(t), close: vi.fn() };
	return { page, sent };
};

describe('Bridge', () => {
	beforeEach(() => vi.useFakeTimers());
	afterEach(() => vi.useRealTimers());

	it('接続されていなければ not-connected で、エディタには何も送らない', async () => {
		const r = await new Bridge().call('get_state', undefined);
		expect(r).toMatchObject({ ok: false, error: { code: 'not-connected' } });
	});
	it('呼び出しを送り、同じidの返信を結果として返す', async () => {
		const bridge = new Bridge();
		const { page, sent } = fakePage();
		bridge.attach(page);
		const pending = bridge.call('set_params', { params: { exposure: 1 } });
		const { id, command, args } = JSON.parse(sent[0] ?? '');
		expect(command).toBe('set_params');
		expect(args).toEqual({ params: { exposure: 1 } });
		bridge.receive(page, JSON.stringify({ id, ok: true, result: { done: 1 } }));
		expect(await pending).toEqual({ ok: true, result: { done: 1 } });
	});
	it('エディタが返したエラーは、コードとメッセージのまま返す', async () => {
		const bridge = new Bridge();
		const { page, sent } = fakePage();
		bridge.attach(page);
		const pending = bridge.call('undo', undefined);
		const { id } = JSON.parse(sent[0] ?? '');
		bridge.receive(page, JSON.stringify({ id, ok: false, error: { code: 'edit-not-allowed', message: 'no' } }));
		expect(await pending).toEqual({ ok: false, error: { code: 'edit-not-allowed', message: 'no' } });
	});
	it('並行した呼び出しを、idで取り違えない', async () => {
		const bridge = new Bridge();
		const { page, sent } = fakePage();
		bridge.attach(page);
		const a = bridge.call('get_state', undefined);
		const b = bridge.call('get_stats', undefined);
		const [ida, idb] = sent.map((s) => JSON.parse(s).id);
		bridge.receive(page, JSON.stringify({ id: idb, ok: true, result: 'B' }));
		bridge.receive(page, JSON.stringify({ id: ida, ok: true, result: 'A' }));
		expect(await a).toEqual({ ok: true, result: 'A' });
		expect(await b).toEqual({ ok: true, result: 'B' });
	});
	it('返信が来なければ timeout', async () => {
		const bridge = new Bridge(1000);
		bridge.attach(fakePage().page);
		const pending = bridge.call('get_state', undefined);
		await vi.advanceTimersByTimeAsync(1000);
		expect(await pending).toMatchObject({ ok: false, error: { code: 'timeout' } });
	});
	it('待っている間に切断されたら、すぐ not-connected で終える', async () => {
		const bridge = new Bridge();
		const { page } = fakePage();
		bridge.attach(page);
		const pending = bridge.call('get_state', undefined);
		bridge.detach(page);
		expect(await pending).toMatchObject({ ok: false, error: { code: 'not-connected' } });
		expect(bridge.connected).toBe(false);
	});
	it('新しい接続が来たら古い接続を閉じて置き換え、古い接続からの返信は無視する', async () => {
		const bridge = new Bridge();
		const oldPage = fakePage();
		const newPage = fakePage();
		bridge.attach(oldPage.page);
		bridge.attach(newPage.page);
		expect(oldPage.page.close).toHaveBeenCalled();
		const pending = bridge.call('get_state', undefined);
		const { id } = JSON.parse(newPage.sent[0] ?? '');
		bridge.receive(oldPage.page, JSON.stringify({ id, ok: true, result: 'from-old' }));
		bridge.receive(newPage.page, JSON.stringify({ id, ok: true, result: 'from-new' }));
		expect(await pending).toEqual({ ok: true, result: 'from-new' });
	});
	it('壊れた返信・知らないidの返信は無視する', async () => {
		const bridge = new Bridge(500);
		const { page } = fakePage();
		bridge.attach(page);
		const pending = bridge.call('get_state', undefined);
		for (const bad of ['nope', 'null', '{"id":999,"ok":true}', '{"ok":true}']) bridge.receive(page, bad);
		await vi.advanceTimersByTimeAsync(500);
		expect(await pending).toMatchObject({ ok: false, error: { code: 'timeout' } });
	});
});

describe('PairingGuard', () => {
	it('正しいコードだけを通す', () => {
		const g = new PairingGuard(() => 'ABCD2345');
		expect(g.verify('ABCD2345')).toBe('ok');
		expect(g.verify('abcd2345')).toBe('wrong');
		expect(g.verify('')).toBe('wrong');
		expect(g.verify('ABCD23456')).toBe('wrong');
	});
	it('間違いが続くと、コードを作り直して古いコードを無効にする', () => {
		const codes = ['AAAAAAAA', 'BBBBBBBB'];
		const g = new PairingGuard(() => codes.shift() ?? 'ZZZZZZZZ', 3);
		g.verify('x');
		g.verify('y');
		g.verify('z'); // 3回目で作り直し
		expect(g.code).toBe('BBBBBBBB');
		expect(g.verify('AAAAAAAA')).toBe('wrong');
		expect(g.verify('BBBBBBBB')).toBe('ok');
	});
	it('成功すると、間違いの回数は数え直しになる', () => {
		const g = new PairingGuard(() => 'ABCD2345', 3);
		g.verify('x');
		g.verify('y');
		expect(g.verify('ABCD2345')).toBe('ok');
		g.verify('x');
		g.verify('y');
		expect(g.code).toBe('ABCD2345'); // 2回だけなので、まだ作り直していない
	});
});

describe('isAllowedOrigin', () => {
	it('標準では自分のPC上のページだけを許す', () => {
		expect(isAllowedOrigin('http://localhost:5173')).toBe(true);
		expect(isAllowedOrigin('http://127.0.0.1:8080')).toBe(true);
		expect(isAllowedOrigin('https://localhost')).toBe(true);
	});
	it('ほかのサイト・Originの無い接続・ほかのプロトコルは許さない', () => {
		expect(isAllowedOrigin('https://evil.example')).toBe(false);
		expect(isAllowedOrigin('http://localhost.evil.example')).toBe(false);
		expect(isAllowedOrigin(undefined)).toBe(false);
		expect(isAllowedOrigin('null')).toBe(false);
		expect(isAllowedOrigin('file://localhost')).toBe(false);
	});
	it('追加で許したOriginは通す', () => {
		expect(isAllowedOrigin('https://me.example', ['https://me.example'])).toBe(true);
	});
});

describe('MCP handler', () => {
	const handler = createMcpHandler({
		serverInfo: { name: 't', version: '1' },
		tools: [{ name: 'echo', description: 'd', inputSchema: { type: 'object' } }],
		callTool: async (name, args) => ({ text: JSON.stringify({ name, args }), isError: name === 'boom' })
	});

	it('initialize は、対応する版ならその版で、未対応なら最新の対応版で返す', async () => {
		const a = (await handler({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } })) as {
			result: { protocolVersion: string };
		};
		expect(a.result.protocolVersion).toBe('2024-11-05');
		const b = (await handler({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } })) as {
			result: { protocolVersion: string };
		};
		expect(b.result.protocolVersion).toBe('2025-06-18');
	});
	it('tools/list でツールを返し、tools/call で呼び出す', async () => {
		const list = (await handler({ jsonrpc: '2.0', id: 3, method: 'tools/list' })) as { result: { tools: { name: string }[] } };
		expect(list.result.tools.map((t) => t.name)).toEqual(['echo']);
		const call = (await handler({
			jsonrpc: '2.0',
			id: 4,
			method: 'tools/call',
			params: { name: 'echo', arguments: { a: 1 } }
		})) as { result: { content: { text: string }[]; isError: boolean } };
		expect(JSON.parse(call.result.content[0]?.text ?? '')).toEqual({ name: 'echo', args: { a: 1 } });
		expect(call.result.isError).toBe(false);
	});
	it('知らないツールはエラー、通知には返信しない', async () => {
		const bad = (await handler({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope' } })) as {
			error: { code: number };
		};
		expect(bad.error.code).toBe(-32602);
		expect(await handler({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeUndefined();
	});
	it('知らないメソッドと不正なメッセージはエラーを返す', async () => {
		const unknown = (await handler({ jsonrpc: '2.0', id: 6, method: 'resources/list' })) as { error: { code: number } };
		expect(unknown.error.code).toBe(-32601);
		const invalid = (await handler({ nope: true })) as { error: { code: number } };
		expect(invalid.error.code).toBe(-32600);
	});
});
