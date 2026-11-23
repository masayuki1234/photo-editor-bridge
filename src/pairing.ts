// ペアリングコード: エディタ(ブラウザ)が正しい持ち主のものかを確かめる合言葉。
// 同じPCの別のWebページが勝手につないでくるのを防ぐ。間違いが続けば、コードを作り直して古いコードを無効にする。
import { randomInt, timingSafeEqual } from 'node:crypto';

// 紛らわしい文字(0/O、1/I/L)を除いた英数字
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

export function generateCode(): string {
	return Array.from({ length: CODE_LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
}

export type PairingResult = 'ok' | 'wrong';

export class PairingGuard {
	#code: string;
	#failures = 0;
	readonly #newCode: () => string;
	readonly #maxFailures: number;

	constructor(newCode: () => string = generateCode, maxFailures = 5) {
		this.#newCode = newCode;
		this.#maxFailures = maxFailures;
		this.#code = newCode();
	}

	get code(): string {
		return this.#code;
	}

	verify(candidate: string): PairingResult {
		const a = Buffer.from(candidate);
		const b = Buffer.from(this.#code);
		if (a.length === b.length && timingSafeEqual(a, b)) {
			this.#failures = 0;
			return 'ok';
		}
		if (++this.#failures >= this.#maxFailures) {
			// 当てずっぽうを許さない。新しいコードに替え、古いコードを無効にする
			this.#code = this.#newCode();
			this.#failures = 0;
		}
		return 'wrong';
	}
}

/** 接続元(Origin)を許すか。標準は自分のPC上のページ(localhost / 127.0.0.1)だけ。公開したアプリを使うなら extra に足す。 */
export function isAllowedOrigin(origin: string | undefined, extra: readonly string[] = []): boolean {
	if (!origin) return false;
	if (extra.includes(origin)) return true;
	try {
		const { protocol, hostname } = new URL(origin);
		return (
			(protocol === 'http:' || protocol === 'https:') &&
			(hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]')
		);
	} catch {
		return false;
	}
}
