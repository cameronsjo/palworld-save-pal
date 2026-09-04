<script lang="ts">
	import Icon from '$lib/components/ui/icons/Icon.svelte';
	import { onMount, onDestroy } from 'svelte';
	import { getControlState, getServerState, getModalState } from '$states';
	import { Button, Card } from '$components/ui';
	import {
		ServerCard,
		ServerDetailPanel,
		CreateServerModal,
		ImportServerModal
	} from '$components/servers';
	import type { CreateServerData, ImportServerData, Server as ServerType } from '$types';

	const serverState = getServerState();
	const control = getControlState();
	const modal = getModalState();

	const servers = $derived(serverState.servers);
	const selectedServer = $derived(serverState.selectedServer);
	const loading = $derived(serverState.loading);
	const loadError = $derived(serverState.loadError);
	const creationProgress = $derived(serverState.creationProgress);

	// An explicit two-click session, NOT an auto-load on mount. Opening this page
	// stops nothing: a stray tab must never drop a running game — and stopping
	// here suspends the whole ms-a2-workloads kustomization (Traefik, Vikunja,
	// the runners), not just Palworld.
	type SessionStage = 'idle' | 'stopping' | 'waiting' | 'loading';
	let stage = $state<SessionStage>('idle');
	let sessionError = $state('');

	const stageLabel: Record<SessionStage, string> = {
		idle: '',
		stopping: 'Stopping the server…',
		waiting: 'Waiting for the world to close…',
		loading: 'Loading the save…'
	};

	const sessionBusy = $derived(stage !== 'idle');

	async function beginEditSession(server: ServerType) {
		if (sessionBusy) return;
		sessionError = '';
		try {
			stage = 'stopping';
			await control.run('stop');

			// The server-side "Server must be stopped" guard cannot help here: it
			// reads native_process::process_status(record.pid), and the
			// auto-registered row has pid: null, which reports "exited". So the
			// stop is confirmed HERE, against safe_to_edit, or not at all.
			stage = 'waiting';
			await control.waitUntilSafeToEdit();

			// loadedSaveFilesHandler navigates to /edit on the response frame; a
			// goto() here would race it.
			stage = 'loading';
			await serverState.loadServerSave(server.id);
		} catch (error) {
			sessionError = error instanceof Error ? error.message : String(error);
		} finally {
			stage = 'idle';
		}
	}

	let releaseControlPolling: (() => void) | null = null;

	onMount(() => {
		serverState.loadServers();
		serverState.startPolling(15000);
		releaseControlPolling = control.acquirePolling();
	});

	onDestroy(() => {
		serverState.stopPolling();
		releaseControlPolling?.();
	});

	function handleSelect(server: ServerType) {
		serverState.selectServer(server.id);
	}

	function handleStart(server: ServerType) {
		serverState.startServer(server.id);
	}

	function handleStop(server: ServerType) {
		serverState.stopServer(server.id);
	}

	async function handleCreate() {
		const allocatedPorts = new Set<number>();
		for (const s of servers) {
			allocatedPorts.add(s.game_port);
			allocatedPorts.add(s.query_port);
			allocatedPorts.add(s.rest_api_port);
		}

		let offset = 0;
		let suggestedPorts = { game_port: 8211, query_port: 27015, rest_api_port: 8212 };
		while (true) {
			const candidate = {
				game_port: 8211 + offset,
				query_port: 27015 + offset,
				rest_api_port: 8212 + offset
			};
			if (
				!allocatedPorts.has(candidate.game_port) &&
				!allocatedPorts.has(candidate.query_port) &&
				!allocatedPorts.has(candidate.rest_api_port)
			) {
				suggestedPorts = candidate;
				break;
			}
			offset++;
		}

		// @ts-ignore
		const result = await modal.showModal<CreateServerData | null>(CreateServerModal, {
			title: 'Create Server',
			suggestedPorts
		});

		if (result) {
			await serverState.createServer(result);
		}
	}

	async function handleImport() {
		// @ts-ignore
		const result = await modal.showModal<ImportServerData | null>(ImportServerModal, {
			title: 'Import Existing Server'
		});
		if (result) {
			await serverState.importServer(result);
		}
	}
</script>

<div class="flex h-full min-h-screen w-full gap-4 p-4">
	<div class="flex w-80 shrink-0 flex-col gap-4">
		<div class="flex items-center justify-between">
			<h2 class="heading-gradient text-xl font-bold">Servers</h2>
			<div class="flex items-center gap-2">
				<Button
					variant="secondary"
					size="sm"
					class="flex items-center gap-2"
					onclick={handleImport}
				>
					<Icon icon="tabler:download" size={14} />
					Import
				</Button>
				<Button variant="primary" size="sm" class="flex items-center gap-2" onclick={handleCreate}>
					<Icon icon="tabler:plus" size={14} />
					New
				</Button>
			</div>
		</div>

		{#if creationProgress}
			<div class="bg-surface-800 flex items-center gap-3 rounded-sm p-3">
				<div
					class="border-secondary-400 h-4 w-4 animate-spin rounded-full border-2 border-t-transparent"
				></div>
				<p class="text-surface-200 text-sm">{creationProgress}</p>
			</div>
		{/if}

		<div class="flex flex-col gap-2">
			{#if loadError}
				<!-- A transport failure must never wear the appearance of an empty
				     estate — that read cost a whole debugging session once. -->
				<Card class="text-center text-red-400">
					<Icon icon="tabler:plug-connected-x" size={32} class="mx-auto mb-2 opacity-70" />
					<p>Could not reach the backend</p>
					<p class="mt-1 text-sm">{loadError}</p>
				</Card>
			{:else if servers.length === 0 && !loading}
				<Card class="text-surface-400 text-center">
					<Icon icon="tabler:server" size={32} class="mx-auto mb-2 opacity-50" />
					<p>No servers configured</p>
					<p class="mt-1 text-sm">Create one to get started</p>
				</Card>
			{:else}
				{#each servers as server (server.id)}
					<ServerCard
						{server}
						selected={selectedServer?.id === server.id}
						onselect={handleSelect}
						onstart={handleStart}
						onstop={handleStop}
					/>
				{/each}
			{/if}
		</div>
	</div>

	<div class="min-w-0 flex-1 overflow-y-auto">
		{#if selectedServer}
			<Card class="mb-4">
				<div class="flex flex-wrap items-center justify-between gap-3">
					<div>
						<p class="font-semibold">Edit session</p>
						<p class="text-surface-400 text-sm">
							Stops the server, waits until the world is closed, then opens the save.
						</p>
					</div>
					<Button
						variant="primary"
						size="sm"
						class="flex items-center gap-2"
						disabled={sessionBusy || control.busy || control.unreachable}
						onclick={() => beginEditSession(selectedServer)}
					>
						<Icon icon="tabler:pencil" size={14} />
						Begin edit session
					</Button>
				</div>
				{#if sessionBusy}
					<p class="text-secondary-300 mt-3 text-sm">{stageLabel[stage]}</p>
				{/if}
				{#if sessionError}
					<p class="mt-3 text-sm text-red-400">{sessionError}</p>
				{/if}
				{#if control.unreachable}
					<p class="mt-3 text-sm text-red-400">
						The control endpoint is unreachable, so the server cannot be stopped safely.
					</p>
				{/if}
			</Card>
			<ServerDetailPanel server={selectedServer} />
		{:else}
			<div class="text-surface-400 flex h-full items-center justify-center">
				<div class="text-center">
					<Icon icon="tabler:server" size={48} class="mx-auto mb-4 opacity-30" />
					<p class="text-lg">Select a server to view details</p>
				</div>
			</div>
		{/if}
	</div>
</div>
