// 最小のMCPサーバー(標準入出力・JSON-RPC 2.0)。initialize / ping / tools/list / tools/call だけを扱う。
// ツールの中身は知らない。呼び出しは callTool に任せる。

export type ToolDef = {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
};

export type ToolOutput = { text: string; isError?: boolean };

export type McpDeps = {
	serverInfo: { name: string; version: string };
	tools: readonly ToolDef[];
	callTool: (name: string, args: unknown) => Promise<ToolOutput>;
};

const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

const reply = (id: unknown, result: unknown) => ({ jsonrpc: '2.0', id, result });
const failure = (id: unknown, code: number, message: string) => ({
	jsonrpc: '2.0',
	id: id ?? null,
	error: { code, message }
});

/** 1つのメッセージを処理する。返信が要らない通知は undefined を返す。 */
export function createMcpHandler(deps: McpDeps) {
	return async function handle(message: unknown): Promise<object | undefined> {
		if (!isRecord(message) || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
			return failure(isRecord(message) ? message.id : null, -32600, 'Invalid Request');
		}
		const { id, method, params } = message;
		const isNotification = !('id' in message);
		switch (method) {
			case 'initialize': {
				const requested = isRecord(params) ? params.protocolVersion : undefined;
				const version = SUPPORTED_VERSIONS.includes(String(requested)) ? String(requested) : SUPPORTED_VERSIONS[0];
				return reply(id, {
					protocolVersion: version,
					capabilities: { tools: {} },
					serverInfo: deps.serverInfo
				});
			}
			case 'ping':
				return reply(id, {});
			case 'tools/list':
				return reply(id, { tools: deps.tools });
			case 'tools/call': {
				const name = isRecord(params) ? params.name : undefined;
				if (typeof name !== 'string' || !deps.tools.some((t) => t.name === name)) {
					return failure(id, -32602, `Unknown tool: ${String(name)}`);
				}
				const out = await deps.callTool(name, isRecord(params) ? params.arguments : undefined);
				return reply(id, { content: [{ type: 'text', text: out.text }], isError: out.isError === true });
			}
			default:
				// notifications/initialized などの通知には返信しない
				return isNotification ? undefined : failure(id, -32601, `Method not found: ${method}`);
		}
	};
}
