<script lang="ts">
	import Icon from '$lib/components/ui/icons/Icon.svelte';

	// Relative URLs only -- this chip is same-origin with /control once the
	// editor and control services are merged behind one Ingress host, so no
	// CORS handling is needed here or on the /control side.
	const STATUS_URL = '/control/status';
	const CSRF_HEADER = 'X-Palworld-Control';
	const POLL_MS = 5000;

	type ControlStatus = {
		replicas?: string | null;
		suspended?: boolean;
		pod_phase?: string | null;
		safe_to_edit?: boolean;
		busy?: boolean;
		error?: string;
	};

	let status = $state<ControlStatus | null>(null);
	let unreachable = $state(false);
	let acting = $state(false);

	async function refresh(): Promise<void> {
		try {
			const response = await fetch(STATUS_URL);
			const body = (await response.json()) as ControlStatus;
			status = body;
			unreachable = false;
		} catch {
			unreachable = true;
		}
	}

	async function run(verb: 'stop' | 'start'): Promise<void> {
		acting = true;
		try {
			await fetch(`/control/${verb}`, {
				method: 'POST',
				headers: { [CSRF_HEADER]: '1' }
			});
		} finally {
			acting = false;
			await refresh();
		}
	}

	$effect(() => {
		refresh();
		const interval = setInterval(refresh, POLL_MS);
		return () => clearInterval(interval);
	});
</script>

<div class="server-control-chip" title={status?.error ?? undefined}>
	{#if unreachable}
		<Icon icon="tabler:plug-connected-x" class="h-3.5 w-3.5" />
		<span class="hidden md:inline">control unreachable</span>
	{:else if status}
		<Icon
			icon={status.pod_phase === 'Running' ? 'tabler:player-play' : 'tabler:player-stop'}
			class="h-3.5 w-3.5"
		/>
		<span class="hidden md:inline">{status.pod_phase ?? (status.suspended ? 'Stopped' : '…')}</span>
		<button
			type="button"
			class="server-control-button"
			disabled={acting || status.busy || status.pod_phase === 'Running'}
			onclick={() => run('start')}
		>
			Start
		</button>
		<button
			type="button"
			class="server-control-button"
			disabled={acting || status.busy || status.suspended}
			onclick={() => run('stop')}
		>
			Stop
		</button>
	{/if}
</div>

<style>
	.server-control-chip {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.75rem;
		color: var(--color-surface-300);
	}

	.server-control-button {
		border: 1px solid var(--color-surface-600);
		border-radius: 0.25rem;
		padding: 0.1rem 0.4rem;
		font-size: 0.7rem;
		cursor: pointer;
	}

	.server-control-button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
</style>
