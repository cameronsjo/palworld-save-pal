import { PUBLIC_WS_URL } from '$env/static/public';
import { getDispatcher } from '$lib/ws/dispatcher';
import type { WSHandlerContext } from '$lib/ws/types';
import { type Message } from '$types';

const RECONNECT_DELAY = 5000;
/** How long `send` waits for a socket before giving up. Generous: it covers a
 *  reconnect (5s) plus the handshake, so only a genuinely dead backend trips it. */
const SEND_READY_TIMEOUT = 15000;
const READY_POLL_INTERVAL = 250;

/**
 * Resolves the websocket URL for this page.
 *
 * `PUBLIC_WS_URL` is `$env/static/public` — fixed at BUILD time — and the
 * Docker image bakes the loopback default `127.0.0.1:5174/ws`. Served from any
 * other origin, a browser then dials ITSELF, every frame is dropped, and the
 * page renders as though the backend had nothing to say. That is exactly how
 * the deployed `/servers` list came up empty.
 *
 * So when the baked host is loopback and the page is NOT, the page's own origin
 * is the only host that can be right: the server is same-origin with it by
 * construction (the ingress proxies `/ws` alongside the app), and the backend's
 * own `Origin` allowlist assumes precisely that. A baked host that is not
 * loopback is an explicit choice and is left alone, as is a genuinely
 * loopback-served page (desktop, `vite dev`).
 *
 * Exported for tests; `connect` is the only caller.
 */
export function resolveWebsocketUrl(
	bakedWsUrl: string,
	location: { protocol: string; hostname: string; host: string },
	clientId: number | string
): string {
	const protocol = location.protocol === 'https:' ? 'wss://' : 'ws://';
	const [bakedHost, ...pathParts] = bakedWsUrl.split('/');
	const isLoopback = (name: string) =>
		name === '127.0.0.1' || name === 'localhost' || name === '[::1]' || name === '::1';
	const bakedHostname = bakedHost.replace(/:\d+$/, '');

	const host =
		isLoopback(bakedHostname) && !isLoopback(location.hostname) ? location.host : bakedHost;
	const path = pathParts.length > 0 ? `/${pathParts.join('/')}` : '';
	return `${protocol}${host}${path}/${clientId}`;
}

class SocketState {
	#clientId = Date.now();
	// Optional, NOT `!`: a route's `onMount` runs BEFORE the layout's, so the
	// first `send()` of a page load routinely happens before `connect()` has
	// assigned this. Asserting it non-null turned that ordering into a
	// `TypeError` inside an unawaited async call — swallowed, leaving the caller
	// stuck on `loading` with an empty list and a clean console.
	#websocket: WebSocket | undefined;
	// $state.raw: handler-routed frames are dispatched and forgotten — nothing
	// reads `ws.message` deeply, so a deep proxy only adds per-payload cost.
	#message = $state.raw<Message | null>(null);
	#connected = $state(false);
	#dispatcher = getDispatcher();
	#messageQueue = new Map<string, (value: any) => void>();

	connect(context: WSHandlerContext) {
		const wsUrl = resolveWebsocketUrl(PUBLIC_WS_URL, window.location, this.#clientId);
		this.#websocket = new WebSocket(wsUrl);

		this.#websocket.onopen = () => {
			this.#connected = true;
			console.log('Connected to backend!');
		};

		this.#websocket.onmessage = async (event) => {
			const data = JSON.parse(event.data);
			if (!data) return;

			// Resolve queued sendAndWait calls with the raw parsed data: routing it
			// through the #message $state proxy makes every consumer read through a
			// deeply reactive proxy (thousands of tracked reads for large payloads).
			if (data.type && this.#messageQueue.has(data.type)) {
				const resolve = this.#messageQueue.get(data.type);
				if (resolve) {
					resolve(data);
					this.#messageQueue.delete(data.type);
					return;
				}
			}

			this.#message = data;

			// Dev-only and type-only: logging full payloads retains them in DevTools
			// (a leak sized to the save) and serializing MB-scale frames during a
			// load costs tens of milliseconds.
			if (import.meta.env.DEV) console.log('Received message:', data.type);

			await this.#dispatcher.dispatch(data, context);
		};

		this.#websocket.onclose = () => {
			this.#connected = false;
			setTimeout(() => this.connect(context), RECONNECT_DELAY);
		};
	}

	isConnected(): boolean {
		return this.#websocket?.readyState === WebSocket.OPEN;
	}

	async send(messageData: string) {
		const deadline = Date.now() + SEND_READY_TIMEOUT;
		while (!this.isConnected()) {
			if (Date.now() > deadline) {
				// Throwing beats waiting forever: a caller that set a `loading`
				// flag can only clear it if it hears about the failure.
				throw new Error('Timed out waiting for the websocket to connect');
			}
			await new Promise((resolve) => setTimeout(resolve, READY_POLL_INTERVAL));
		}
		// Dev-only and type-only — see the note in onmessage above. The type is
		// pulled out with a regex instead of JSON.parse so logging never pays a
		// second serialization pass on MB-scale frames.
		if (import.meta.env.DEV) {
			const type = messageData.match(/"type"\s*:\s*"([^"]+)"/)?.[1];
			console.log('Sending message:', type ?? messageData);
		}
		this.#websocket!.send(messageData);
	}

	// A WebSocket frame the backend parses as text, so bytes still go over as a
	// JSON number array here. The worker transport overrides this with a real
	// binary hand-off.
	async sendBytes(type: string, bytes: Uint8Array) {
		await this.send(JSON.stringify({ type, data: Array.from(bytes) }));
	}

	async sendAndWait(messageData: any): Promise<any> {
		return new Promise((resolve) => {
			const messageType = messageData.type;
			this.#messageQueue.set(messageType, resolve);
			this.send(JSON.stringify(messageData));
		});
	}

	clear(messageType: string) {
		if (this.#message?.type === messageType) {
			this.#message = null;
		}
	}

	get message() {
		return this.#message;
	}

	set message(newMessage: Message | null) {
		this.#message = newMessage;
	}

	get connected() {
		return this.#connected;
	}
}

import { WorkerTransport } from './workerTransport.svelte';

// Vite statically replaces `import.meta.env.VITE_TRANSPORT`; unset (desktop/Docker
// builds) → undefined → the WebSocket transport. `build:web` sets it to 'worker'.
const socketStateInstance =
	import.meta.env.VITE_TRANSPORT === 'worker' ? new WorkerTransport() : new SocketState();

export const getSocketState = () => socketStateInstance;
