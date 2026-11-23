// ブリッジの中核: エディタ(ブラウザ)との1本の接続と、Claude Code からの呼び出しを結ぶ。
// 通信の実体(WebSocket)は知らない。送る・閉じるだけの口(PageLink)を受け取る。
const NOT_CONNECTED = {
    code: 'not-connected',
    message: 'The editor is not connected. Ask the user to open the app, press "Claude Code と接続", and enter the pairing code from connection_info.'
};
export class Bridge {
    #page;
    #nextId = 1;
    #pending = new Map();
    #timeoutMs;
    constructor(timeoutMs = 10_000) {
        this.#timeoutMs = timeoutMs;
    }
    get connected() {
        return this.#page !== undefined;
    }
    /** 新しい接続を受け入れる。すでに接続があれば、古い方を閉じて置き換える(ページの再読み込み用)。 */
    attach(page) {
        const old = this.#page;
        this.#page = page;
        if (old && old !== page) {
            this.#failAll(NOT_CONNECTED);
            old.close();
        }
    }
    detach(page) {
        if (this.#page !== page)
            return;
        this.#page = undefined;
        this.#failAll(NOT_CONNECTED);
    }
    /** エディタから届いた返信を、待っている呼び出しに渡す。現在の接続以外からのものは無視する。 */
    receive(page, text) {
        if (this.#page !== page)
            return;
        let message;
        try {
            message = JSON.parse(text);
        }
        catch {
            return;
        }
        if (typeof message !== 'object' || message === null)
            return;
        const { id, ok, result, error } = message;
        if (typeof id !== 'number')
            return;
        const waiting = this.#pending.get(id);
        if (!waiting)
            return;
        clearTimeout(waiting.timer);
        this.#pending.delete(id);
        if (ok === true) {
            waiting.resolve({ ok: true, result });
            return;
        }
        const e = typeof error === 'object' && error !== null ? error : {};
        waiting.resolve({
            ok: false,
            error: { code: String(e.code ?? 'error'), message: String(e.message ?? 'The editor reported an error.') }
        });
    }
    call(command, args) {
        const page = this.#page;
        if (!page)
            return Promise.resolve({ ok: false, error: NOT_CONNECTED });
        const id = this.#nextId++;
        return new Promise((resolve) => {
            const timer = setTimeout(() => {
                this.#pending.delete(id);
                resolve({ ok: false, error: { code: 'timeout', message: 'The editor did not answer in time.' } });
            }, this.#timeoutMs);
            this.#pending.set(id, { resolve, timer });
            try {
                page.send(JSON.stringify({ id, command, args }));
            }
            catch {
                clearTimeout(timer);
                this.#pending.delete(id);
                resolve({ ok: false, error: NOT_CONNECTED });
            }
        });
    }
    #failAll(error) {
        for (const [id, waiting] of this.#pending) {
            clearTimeout(waiting.timer);
            waiting.resolve({ ok: false, error });
            this.#pending.delete(id);
        }
    }
}
