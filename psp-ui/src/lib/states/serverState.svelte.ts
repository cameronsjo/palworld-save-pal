import type {
	Server,
	ServerMod,
	ServerApiResponse,
	ContainerStats,
	CreateServerData,
	ImportServerData
} from '$types';
import { MessageType } from '$types';
import { send, sendAndWait, sendOrThrow } from '$utils/websocketUtils';

class ServerState {
	servers = $state<Server[]>([]);
	selectedServer = $state<Server | null>(null);
	loading = $state(false);
	mods = $state<ServerMod[]>([]);
	apiResponse = $state<ServerApiResponse | null>(null);
	containerStats = $state<ContainerStats | null>(null);
	saving = $state(false);
	creationProgress = $state('');
	detectedWorkshopDir = $state('');

	#pollInterval: ReturnType<typeof setInterval> | null = null;

	/** Set when the list request itself could not be sent. Rendered in place of
	 *  the "No servers configured" card so a transport failure never wears the
	 *  appearance of an empty estate. */
	loadError = $state('');

	async loadServers(): Promise<void> {
		this.loading = true;
		try {
			await sendOrThrow(MessageType.LIST_SERVERS);
			this.loadError = '';
		} catch (error) {
			// `loading` must be cleared here: nothing else will, because the
			// response frame that normally clears it is never coming.
			this.loading = false;
			this.loadError = error instanceof Error ? error.message : String(error);
			console.error('[psp] list_servers could not be sent:', error);
		}
	}

	async selectServer(serverId: number): Promise<void> {
		send(MessageType.GET_SERVER, { server_id: serverId });
	}

	async createServer(data: CreateServerData): Promise<void> {
		send(MessageType.CREATE_SERVER, data);
	}

	async importServer(data: ImportServerData): Promise<void> {
		send(MessageType.IMPORT_SERVER, data);
	}

	async updateServer(serverId: number, updates: Record<string, any>): Promise<void> {
		this.saving = true;
		send(MessageType.UPDATE_SERVER, { server_id: serverId, updates });
	}

	async deleteServer(serverId: number): Promise<void> {
		send(MessageType.DELETE_SERVER, { server_id: serverId });
	}

	async startServer(serverId: number): Promise<void> {
		send(MessageType.START_SERVER, { server_id: serverId });
	}

	async stopServer(serverId: number): Promise<void> {
		send(MessageType.STOP_SERVER, { server_id: serverId });
	}

	async callApi(
		serverId: number,
		endpoint: string,
		method: string = 'GET',
		payload?: Record<string, any>
	): Promise<void> {
		send(MessageType.SERVER_API_CALL, {
			server_id: serverId,
			endpoint,
			method,
			payload
		});
	}

	async loadMods(serverId: number): Promise<void> {
		send(MessageType.LIST_SERVER_MODS, { server_id: serverId });
	}

	async toggleMod(serverId: number, modName: string, enabled: boolean): Promise<void> {
		send(MessageType.TOGGLE_SERVER_MOD, {
			server_id: serverId,
			mod_name: modName,
			enabled
		});
	}

	async installMod(
		serverId: number,
		modName: string,
		modData: string,
		modType: string = 'ue4ss'
	): Promise<void> {
		send(MessageType.INSTALL_SERVER_MOD, {
			server_id: serverId,
			mod_name: modName,
			mod_data: modData,
			mod_type: modType
		});
	}

	async detectWorkshopDir(): Promise<void> {
		send(MessageType.DETECT_WORKSHOP_DIR);
	}

	/** Throws if the request could not be sent. The response
	 *  (`loaded_save_files`) is what navigates to the editor, so a dropped frame
	 *  here means the editor silently never opens. */
	async loadServerSave(serverId: number): Promise<void> {
		await sendOrThrow(MessageType.LOAD_SERVER_SAVE, { server_id: serverId });
	}

	async loadStats(serverId: number): Promise<void> {
		send(MessageType.GET_SERVER_STATS, { server_id: serverId });
	}

	startPolling(intervalMs: number = 15000): void {
		this.stopPolling();
		this.#pollInterval = setInterval(() => {
			this.loadServers();
		}, intervalMs);
	}

	stopPolling(): void {
		if (this.#pollInterval) {
			clearInterval(this.#pollInterval);
			this.#pollInterval = null;
		}
	}
}

let serverStateInstance: ServerState | undefined;

export function getServerState(): ServerState {
	if (!serverStateInstance) {
		serverStateInstance = new ServerState();
	}
	return serverStateInstance;
}
