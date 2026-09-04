/**
 * Shared view of the deployment's `/control` endpoints (palworld-control.py).
 *
 * Lifted out of `ServerControlChip.svelte`, which owned the same `$state` and
 * `setInterval` privately. The chip was healthy; the problem was that
 * `safe_to_edit` — the one signal that says the game server has actually let go
 * of `Level.sav` — was readable nowhere else, so the edit-session flow could not
 * consult it.
 *
 * Relative URLs only: the editor and `/control` are same-origin behind one
 * Ingress host, so no CORS handling is needed on either side. `/control` guards
 * mutations with a CSRF header rather than a session, and answers no preflight,
 * which is what keeps a cross-origin page from reaching them.
 */

/** `X-Palworld-Control: 1`. `palworld-control.py` returns 403 without it. */
const CSRF_HEADER = 'X-Palworld-Control';
/** The server caches `/status` for 3s (`palworld-control.py`'s
 *  STATUS_CACHE_SECONDS), so polling faster only burns requests on a repeat. */
const POLL_MS = 5000;
/** How long "Begin edit session" waits for the pod to go away. The stop path's
 *  own pod-termination wait is 120s; this covers it plus the status cache and a
 *  slow first poll. */
const SAFE_TO_EDIT_TIMEOUT_MS = 180_000;

export type ControlStatus = {
	replicas?: string | null;
	suspended?: boolean;
	pod_phase?: string | null;
	/** An actual `get pod`, not `.spec.replicas`. See palworld-ctl.sh's
	 *  `pod_gone` — `.spec.replicas` reads 0 the instant `scale` returns. */
	pod_gone?: boolean;
	safe_to_edit?: boolean;
	busy?: boolean;
	error?: string;
};

class ControlState {
	status = $state<ControlStatus | null>(null);
	/** `/control/status` could not be reached at all — distinct from a reachable
	 *  endpoint reporting an error, which lands in `status.error`. */
	unreachable = $state(false);
	/** A stop or start POST issued from this browser is in flight. */
	acting = $state(false);

	#pollInterval: ReturnType<typeof setInterval> | null = null;
	#pollHolders = 0;
	#restartAfterSave = false;

	/** Armed by "Save & restart" immediately before it sends the write, consumed
	 *  by the SAVE_MODDED_SAVE success handler. Anything else that ends the write
	 *  — an error frame, a navigation away — must call `disarmRestartAfterSave`,
	 *  so a failed write can never be followed by a start. */
	armRestartAfterSave(): void {
		this.#restartAfterSave = true;
	}

	disarmRestartAfterSave(): void {
		this.#restartAfterSave = false;
	}

	/** True at most once per arm. */
	consumeRestartAfterSave(): boolean {
		const armed = this.#restartAfterSave;
		this.#restartAfterSave = false;
		return armed;
	}

	get podPhase(): string | null {
		return this.status?.pod_phase ?? null;
	}

	get suspended(): boolean {
		return this.status?.suspended === true;
	}

	get podGone(): boolean {
		return this.status?.pod_gone === true;
	}

	/** Fail-closed: an absent field, an unreachable endpoint, or a status the
	 *  server could not compute all read as NOT safe. */
	get safeToEdit(): boolean {
		return !this.unreachable && this.status?.safe_to_edit === true;
	}

	/** The server is running a stop or start of its own, from any client. */
	get busy(): boolean {
		return this.status?.busy === true;
	}

	async refresh(): Promise<void> {
		try {
			const response = await fetch('/control/status');
			this.status = (await response.json()) as ControlStatus;
			this.unreachable = false;
		} catch (error) {
			this.unreachable = true;
			console.error('[psp] /control/status unreachable:', error);
		}
	}

	/** Throws on a non-2xx so a caller chaining onto the result fails closed
	 *  rather than proceeding on a 403 or a 409 "already busy". */
	async run(verb: 'stop' | 'start'): Promise<void> {
		this.acting = true;
		try {
			const response = await fetch(`/control/${verb}`, {
				method: 'POST',
				headers: { [CSRF_HEADER]: '1' }
			});
			if (!response.ok) {
				throw new Error(`/control/${verb} returned ${response.status}`);
			}
		} finally {
			this.acting = false;
			await this.refresh();
		}
	}

	/**
	 * Reference-counted so the chip (mounted in the layout, always present) and a
	 * page that also wants fresh status share ONE interval — two independent
	 * `setInterval`s would double the request rate and let whichever unmounted
	 * last silently stop polling for the other.
	 *
	 * Returns the release function; call it on unmount.
	 */
	acquirePolling(intervalMs: number = POLL_MS): () => void {
		this.#pollHolders += 1;
		if (this.#pollInterval === null) {
			void this.refresh();
			this.#pollInterval = setInterval(() => void this.refresh(), intervalMs);
		}
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.#pollHolders -= 1;
			if (this.#pollHolders <= 0 && this.#pollInterval !== null) {
				clearInterval(this.#pollInterval);
				this.#pollInterval = null;
			}
		};
	}

	/**
	 * Polls until the server reports it is genuinely safe to open the save.
	 * Rejects on timeout rather than resolving — a caller that opened a world on
	 * a timed-out wait would be editing a save the game server still has open.
	 */
	async waitUntilSafeToEdit(
		timeoutMs: number = SAFE_TO_EDIT_TIMEOUT_MS,
		intervalMs: number = POLL_MS
	): Promise<void> {
		const deadline = Date.now() + timeoutMs;
		// Refresh FIRST: the cached status is up to POLL_MS stale, and acting on
		// it would let a `safe_to_edit` reading from before the stop through.
		await this.refresh();
		while (!this.safeToEdit) {
			if (Date.now() > deadline) {
				throw new Error(
					this.unreachable
						? 'Timed out: /control/status became unreachable while waiting for the server to stop.'
						: 'Timed out waiting for the server to stop. The world was not opened.'
				);
			}
			await new Promise((resolve) => setTimeout(resolve, intervalMs));
			await this.refresh();
		}
	}
}

let controlStateInstance: ControlState | undefined;

export function getControlState(): ControlState {
	if (!controlStateInstance) {
		controlStateInstance = new ControlState();
	}
	return controlStateInstance;
}
