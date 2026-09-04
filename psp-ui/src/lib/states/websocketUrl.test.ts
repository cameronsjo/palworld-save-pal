import { describe, expect, it } from 'vitest';
import { resolveWebsocketUrl } from './websocketState.svelte';

/** The Docker image's baked default (Dockerfile ARG PUBLIC_WS_URL). */
const BAKED_LOOPBACK = '127.0.0.1:5174/ws';

const at = (protocol: string, host: string) => ({
	protocol,
	host,
	hostname: host.replace(/:\d+$/, '')
});

describe('resolveWebsocketUrl', () => {
	it('dials the page origin when the baked host is loopback but the page is not', () => {
		// The regression this exists for: served from the deployment, the baked
		// loopback made every browser dial ITSELF, so the server list rendered
		// empty with the backend perfectly healthy.
		expect(
			resolveWebsocketUrl(BAKED_LOOPBACK, at('https:', 'palworld-editor.sjo.lol'), 42)
		).toBe('wss://palworld-editor.sjo.lol/ws/42');
	});

	it('leaves a genuinely loopback-served page alone', () => {
		// Desktop and `vite dev` both serve from loopback, where the baked value
		// is correct and rewriting it would break them.
		expect(resolveWebsocketUrl(BAKED_LOOPBACK, at('http:', '127.0.0.1:5174'), 7)).toBe(
			'ws://127.0.0.1:5174/ws/7'
		);
		expect(resolveWebsocketUrl(BAKED_LOOPBACK, at('http:', 'localhost:5173'), 7)).toBe(
			'ws://127.0.0.1:5174/ws/7'
		);
	});

	it('never overrides a deliberately configured non-loopback host', () => {
		expect(
			resolveWebsocketUrl('ws.example.com/ws', at('https:', 'app.example.com'), 1)
		).toBe('wss://ws.example.com/ws/1');
	});

	it('follows the page protocol, so an https page never dials plain ws', () => {
		expect(resolveWebsocketUrl(BAKED_LOOPBACK, at('https:', 'editor.example'), 1)).toBe(
			'wss://editor.example/ws/1'
		);
		expect(resolveWebsocketUrl(BAKED_LOOPBACK, at('http:', 'editor.example'), 1)).toBe(
			'ws://editor.example/ws/1'
		);
	});

	it('handles a baked value with no path and a bare loopback host', () => {
		expect(resolveWebsocketUrl('127.0.0.1:5174', at('https:', 'editor.example'), 3)).toBe(
			'wss://editor.example/3'
		);
		expect(resolveWebsocketUrl('localhost/ws', at('https:', 'editor.example'), 3)).toBe(
			'wss://editor.example/ws/3'
		);
	});
});
