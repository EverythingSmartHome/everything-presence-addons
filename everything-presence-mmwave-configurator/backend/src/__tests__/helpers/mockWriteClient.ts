import type { IHaWriteClient } from "../../ha/writeClient";

interface ServiceCall {
	domain: string;
	service: string;
	data: Record<string, unknown>;
	options?: { returnResponse?: boolean };
}

/**
 * In-memory mock of IHaWriteClient for integration tests.
 *
 * Records every service call for assertion and allows configuring
 * per-service responses.
 */
export class MockWriteClient implements IHaWriteClient {
	private calls: ServiceCall[] = [];
	private responses = new Map<string, unknown>(); // "domain.service" -> response

	// ── Helpers ──────────────────────────────────────────────────────

	getCalls(): ServiceCall[] {
		return [...this.calls];
	}

	getLastCall(): ServiceCall | undefined {
		return this.calls[this.calls.length - 1];
	}

	getCallsForService(domain: string, service: string): ServiceCall[] {
		return this.calls.filter(
			(c) => c.domain === domain && c.service === service,
		);
	}

	setResponse(domain: string, service: string, response: unknown): void {
		this.responses.set(`${domain}.${service}`, response);
	}

	reset(): void {
		this.calls = [];
		this.responses.clear();
	}

	// ── IHaWriteClient implementation ────────────────────────────────

	async callService(
		domain: string,
		service: string,
		data: Record<string, unknown>,
		options?: { returnResponse?: boolean },
	): Promise<unknown> {
		this.calls.push({ domain, service, data, options });
		return this.responses.get(`${domain}.${service}`) ?? undefined;
	}

	async setNumberEntity(entityId: string, value: number): Promise<void> {
		await this.callService("number", "set_value", {
			entity_id: entityId,
			value,
		});
	}

	async setSelectEntity(entityId: string, option: string): Promise<void> {
		await this.callService("select", "select_option", {
			entity_id: entityId,
			option,
		});
	}

	async setSwitchEntity(entityId: string, on: boolean): Promise<void> {
		await this.callService("switch", on ? "turn_on" : "turn_off", {
			entity_id: entityId,
		});
	}

	async setInputBooleanEntity(entityId: string, on: boolean): Promise<void> {
		await this.callService("input_boolean", on ? "turn_on" : "turn_off", {
			entity_id: entityId,
		});
	}

	async setTextEntity(entityId: string, value: string): Promise<void> {
		await this.callService("text", "set_value", {
			entity_id: entityId,
			value,
		});
	}
}
