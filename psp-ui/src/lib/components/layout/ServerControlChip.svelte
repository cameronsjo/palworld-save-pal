<script lang="ts">
	import Icon from '$lib/components/ui/icons/Icon.svelte';
	import { getControlState } from '$states';

	// The polling, the fetches and the status shape all live in controlState now,
	// so the edit-session flow on /servers can read `safe_to_edit` too. This
	// component is the rendering of that state, nothing more.
	const control = getControlState();

	const status = $derived(control.status);
	const unreachable = $derived(control.unreachable);
	const acting = $derived(control.acting);

	async function run(verb: 'stop' | 'start'): Promise<void> {
		// The chip's buttons are the deliberate, operator-driven path; a failure
		// here is already visible in the status line the next poll renders.
		await control.run(verb).catch((error) => console.error(`[psp] ${verb} failed:`, error));
	}

	$effect(() => control.acquirePolling());
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
