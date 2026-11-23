// ブリッジの中核: エディタ(ブラウザ)との1本の接続と、Claude Code からの呼び出しを結ぶ。
// 通信の実体(WebSocket)は知らない。送る・閉じるだけの口(PageLink)を受け取る。

export interface PageLink {
	send(text: string): void;
	close(): void;
}

/** 会話欄から届く1通の長さの上限(信頼境界での検証)。アプリ側の上限と同じ値にする。 */
export const MAX_CHAT_LENGTH = 4000;

export type CallError = { code: string; message: string };
export type CallResult = { ok: true; result: unknown } | { ok: false; error: CallError };

const NOT_CONNECTED: CallError = {
	code: 'not-connected',
	message:
		'The editor is not connected. Ask the user to open the app, press "Claude Code と接続", and enter the pairing code from connection_info.'
};

export class Bridge {
	#page: PageLink | undefined;
	#nextId = 1;
	#onChat: ((text: string) => void) | undefined;
	readonly #pending = new Map<number, { resolve: (r: CallResult) => void; timer: ReturnType<typeof setTimeout> }>();

	readonly #timeoutMs: number;

	constructor(timeoutMs = 10_000) {
		this.#timeoutMs = timeoutMs;
	}

	get connected(): boolean {
		return this.#page !== undefined;
	}

	/** エディタの会話欄から届いた発言の受け取り先を決める。 */
	onChat(listener: (text: string) => void): void {
		this.#onChat = listener;
	}

	/** Claude の返事を会話欄へ送る。エディタが接続していなければ false。 */
	sendChatReply(text: string): boolean {
		const page = this.#page;
		if (!page) return false;
		try {
			page.send(JSON.stringify({ type: 'chat-reply', text }));
			return true;
		} catch {
			return false;
		}
	}

	/** 新しい接続を受け入れる。すでに接続があれば、古い方を閉じて置き換える(ページの再読み込み用)。 */
	attach(page: PageLink): void {
		const old = this.#page;
		this.#page = page;
		if (old && old !== page) {
			this.#failAll(NOT_CONNECTED);
			old.close();
		}
	}

	detach(page: PageLink): void {
		if (this.#page !== page) return;
		this.#page = undefined;
		this.#failAll(NOT_CONNECTED);
	}

	/** エディタから届いた返信を、待っている呼び出しに渡す。現在の接続以外からのものは無視する。 */
	receive(page: PageLink, text: string): void {
		if (this.#page !== page) return;
		let message: unknown;
		try {
			message = JSON.parse(text);
		} catch {
			return;
		}
		if (typeof message !== 'object' || message === null) return;
		const { id, ok, result, error, type, text: chatText } = message as Record<string, unknown>;
		if (type === 'chat') {
			if (typeof chatText === 'string' && chatText.trim() !== '' && chatText.length <= MAX_CHAT_LENGTH) {
				this.#onChat?.(chatText);
			}
			return;
		}
		if (typeof id !== 'number') return;
		const waiting = this.#pending.get(id);
		if (!waiting) return;
		clearTimeout(waiting.timer);
		this.#pending.delete(id);
		if (ok === true) {
			waiting.resolve({ ok: true, result });
			return;
		}
		const e = typeof error === 'object' && error !== null ? (error as Partial<CallError>) : {};
		waiting.resolve({
			ok: false,
			error: { code: String(e.code ?? 'error'), message: String(e.message ?? 'The editor reported an error.') }
		});
	}

	call(command: string, args: unknown): Promise<CallResult> {
		const page = this.#page;
		if (!page) return Promise.resolve({ ok: false, error: NOT_CONNECTED });
		const id = this.#nextId++;
		return new Promise((resolve) => {
			const timer = setTimeout(() => {
				this.#pending.delete(id);
				resolve({ ok: false, error: { code: 'timeout', message: 'The editor did not answer in time.' } });
			}, this.#timeoutMs);
			this.#pending.set(id, { resolve, timer });
			try {
				page.send(JSON.stringify({ id, command, args }));
			} catch {
				clearTimeout(timer);
				this.#pending.delete(id);
				resolve({ ok: false, error: NOT_CONNECTED });
			}
		});
	}

	#failAll(error: CallError): void {
		for (const [id, waiting] of this.#pending) {
			clearTimeout(waiting.timer);
			waiting.resolve({ ok: false, error });
			this.#pending.delete(id);
		}
	}
}
