import { v4 as uuidv4 } from "uuid";
import type {
	IHaReadTransport,
	DeviceRegistryEntry,
	EntityState,
	AreaRegistryEntry,
	HaTarget,
	StateChangeCallback,
} from "../../ha/readTransport";
import type { EntityRegistryEntry } from "../../ha/types";

/**
 * In-memory mock of IHaReadTransport for integration tests.
 *
 * Provides helpers to seed devices, entities, areas, states, and services,
 * and faithfully implements subscriptions so tests can verify state-change flows.
 */
export class MockReadTransport implements IHaReadTransport {
	readonly activeTransport = "websocket" as const;
	readonly isConnected = true;

	private devices: DeviceRegistryEntry[] = [];
	private entities: EntityRegistryEntry[] = [];
	private areas: AreaRegistryEntry[] = [];
	private states = new Map<string, EntityState>();
	private services = new Map<string, string[]>(); // domain -> service names
	private subscriptions = new Map<
		string,
		{ entityIds: string[]; callback: StateChangeCallback }
	>();

	// ── Seeders ──────────────────────────────────────────────────────

	addDevice(device: DeviceRegistryEntry): void {
		this.devices.push(device);
	}

	addEntity(entity: EntityRegistryEntry): void {
		this.entities.push(entity);
	}

	addArea(area: AreaRegistryEntry): void {
		this.areas.push(area);
	}

	setState(entityId: string, state: EntityState): void {
		const oldState = this.states.get(entityId) ?? null;
		this.states.set(entityId, state);

		// Fire subscriptions
		for (const sub of this.subscriptions.values()) {
			if (sub.entityIds.length === 0 || sub.entityIds.includes(entityId)) {
				sub.callback(entityId, state, oldState);
			}
		}
	}

	addService(domain: string, service: string): void {
		const existing = this.services.get(domain) ?? [];
		existing.push(`${domain}.${service}`);
		this.services.set(domain, existing);
	}

	reset(): void {
		this.devices = [];
		this.entities = [];
		this.areas = [];
		this.states.clear();
		this.services.clear();
		this.subscriptions.clear();
	}

	// ── IHaReadTransport implementation ──────────────────────────────

	async listDevices(): Promise<DeviceRegistryEntry[]> {
		return [...this.devices];
	}

	async listEntityRegistry(): Promise<EntityRegistryEntry[]> {
		return [...this.entities];
	}

	async listAreaRegistry(): Promise<AreaRegistryEntry[]> {
		return [...this.areas];
	}

	async getServicesForTarget(
		_target: HaTarget,
		_expandGroup?: boolean,
	): Promise<string[]> {
		// Return all registered services for simplicity
		return Array.from(this.services.values()).flat();
	}

	async getServicesByDomain(domain: string): Promise<string[]> {
		return this.services.get(domain) ?? [];
	}

	async getState(entityId: string): Promise<EntityState | null> {
		return this.states.get(entityId) ?? null;
	}

	async getStates(entityIds: string[]): Promise<Map<string, EntityState>> {
		const result = new Map<string, EntityState>();
		for (const id of entityIds) {
			const s = this.states.get(id);
			if (s) result.set(id, s);
		}
		return result;
	}

	async getAllStates(): Promise<EntityState[]> {
		return Array.from(this.states.values());
	}

	subscribeToStateChanges(
		entityIds: string[],
		callback: StateChangeCallback,
	): string {
		const id = uuidv4();
		this.subscriptions.set(id, { entityIds, callback });
		return id;
	}

	unsubscribe(subscriptionId: string): void {
		this.subscriptions.delete(subscriptionId);
	}

	unsubscribeAll(): void {
		this.subscriptions.clear();
	}

	async connect(): Promise<void> {
		// no-op
	}

	disconnect(): void {
		// no-op
	}

	async waitUntilReady(): Promise<void> {
		// no-op — always ready
	}
}
