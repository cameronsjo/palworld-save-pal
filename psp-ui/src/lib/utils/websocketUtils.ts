import { getSocketState } from '$states/websocketState.svelte';
import { MessageType } from '$types';

export async function sendAndWait<T>(type: MessageType, data?: any): Promise<T> {
	const ws = getSocketState();
	const response = await ws.sendAndWait({
		type,
		data
	});

	if (response.type === 'error') {
		throw new Error(response.data);
	}

	return response.data;
}

/** Rejects when the frame could not be put on the wire. Callers that show a
 *  loading state MUST use this, not `send`: a dropped frame means the response
 *  they are waiting for is never coming. */
export function sendOrThrow(type: MessageType, data?: any): Promise<void> {
	return getSocketState().send(JSON.stringify({ type, data }));
}

/** Fire-and-forget. Logs a send failure rather than leaving it as an unhandled
 *  rejection — a silently dropped frame is how `/servers` rendered an empty
 *  list with a clean console. */
export function send(type: MessageType, data?: any): void {
	void sendOrThrow(type, data).catch((error) => {
		console.error(`[psp] failed to send ${type}:`, error);
	});
}

/** Sends bulk bytes. May transfer the buffer — do not reuse `bytes` after. */
export function sendBytes(type: MessageType, bytes: Uint8Array): void {
	getSocketState().sendBytes(type, bytes);
}

export function isReady(): boolean {
	const ws = getSocketState();
	return ws.isConnected();
}

export function pushProgressMessage(data: any): void {
	const ws = getSocketState();
	ws.message = { type: MessageType.PROGRESS_MESSAGE, data };
}
