import WebSocket from "ws";

/**
 * Lightweight WebSocket test client for asserting server-sent messages.
 */
export class WsTestClient {
	private ws: WebSocket | null = null;
	private messageQueue: unknown[] = [];
	private waiters: Array<(value: unknown) => void> = [];
	private readonly baseUrl: string;

	constructor(baseUrl: string) {
		// Convert http(s):// to ws(s)://
		this.baseUrl = baseUrl.replace(/^http/, "ws");
	}

	connect(path = "/api/live/ws"): Promise<void> {
		return new Promise((resolve, reject) => {
			this.ws = new WebSocket(`${this.baseUrl}${path}`);
			this.ws.on("open", () => resolve());
			this.ws.on("error", (err) => reject(err));
			this.ws.on("message", (data) => {
				const parsed = JSON.parse(data.toString());
				// If someone is waiting for a message, resolve immediately
				if (this.waiters.length > 0) {
					const waiter = this.waiters.shift()!;
					waiter(parsed);
				} else {
					this.messageQueue.push(parsed);
				}
			});
		});
	}

	send(message: object): void {
		if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
			throw new Error("WsTestClient: not connected");
		}
		this.ws.send(JSON.stringify(message));
	}

	waitForMessage(timeout = 2000): Promise<unknown> {
		// Return from queue if already available
		if (this.messageQueue.length > 0) {
			return Promise.resolve(this.messageQueue.shift());
		}
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				// Remove this waiter
				const idx = this.waiters.indexOf(resolve);
				if (idx >= 0) this.waiters.splice(idx, 1);
				reject(new Error(`WsTestClient: timed out after ${timeout}ms`));
			}, timeout);

			this.waiters.push((value) => {
				clearTimeout(timer);
				resolve(value);
			});
		});
	}

	async waitForType(type: string, timeout = 2000): Promise<unknown> {
		const deadline = Date.now() + timeout;
		while (Date.now() < deadline) {
			const remaining = deadline - Date.now();
			if (remaining <= 0) break;
			const msg = (await this.waitForMessage(remaining)) as Record<
				string,
				unknown
			>;
			if (msg && msg.type === type) return msg;
		}
		throw new Error(
			`WsTestClient: did not receive message of type "${type}" within ${timeout}ms`,
		);
	}

	close(): void {
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
		this.messageQueue = [];
		this.waiters = [];
	}
}
