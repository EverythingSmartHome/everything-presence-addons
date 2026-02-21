import {
	describe,
	it,
	expect,
	beforeAll,
	afterAll,
	beforeEach,
	afterEach,
} from "vitest";
import { createTestApp, type TestApp } from "../helpers/testApp";
import { WsTestClient } from "../helpers/wsTestClient";
import { resetStorage } from "../helpers/tempStorage";
import { seedEpLite } from "../helpers/fixtures";
import request from "supertest";

describe("Live WebSocket — /api/live/ws", () => {
	let t: TestApp;
	let liteProfileId: string;
	const wsClients: WsTestClient[] = [];

	beforeAll(async () => {
		t = await createTestApp();

		// Fetch actual EP Lite profile ID
		const profilesRes = await request(t.app).get("/api/devices/profiles");
		const profiles = profilesRes.body.profiles as Array<{
			id: string;
			label: string;
		}>;
		const liteProfile = profiles.find((p) =>
			p.label.toLowerCase().includes("lite"),
		);
		liteProfileId = liteProfile!.id;
	});

	afterAll(async () => {
		await t.close();
	});

	beforeEach(() => {
		resetStorage();
		// NOTE: Do NOT call t.readTransport.reset() here.
		// createLiveWebSocketServer registers a global subscription on the
		// readTransport at server startup. reset() clears all subscriptions,
		// which would break the WS server's state-change broadcasting.
		// Instead, we seed fresh data per test without clearing subscriptions.
		t.writeClient.reset();
	});

	afterEach(() => {
		// Close all WS clients to prevent test hangs
		for (const ws of wsClients) {
			ws.close();
		}
		wsClients.length = 0;
	});

	function createWs(): WsTestClient {
		const ws = new WsTestClient(t.baseUrl);
		wsClients.push(ws);
		return ws;
	}

	it("subscribe and receive subscribed message", async () => {
		const deviceId = seedEpLite(t.readTransport);

		const ws = createWs();
		await ws.connect("/api/live/ws");

		ws.send({
			type: "subscribe",
			deviceId,
			profileId: liteProfileId,
			entityNamePrefix: "ep_lite",
		});

		// The server may send a "warning" (MAPPING_NOT_FOUND) before "subscribed"
		// because we have no device-level mappings stored. Use waitForType to skip it.
		const msg = (await ws.waitForType("subscribed", 3000)) as Record<
			string,
			unknown
		>;

		expect(msg.type).toBe("subscribed");
		expect(msg.deviceId).toBe(deviceId);
		expect(msg.profileId).toBe(liteProfileId);
		expect(Array.isArray(msg.entities)).toBe(true);
		expect((msg.entities as string[]).length).toBeGreaterThan(0);
	});

	it("state update fires on transport setState after subscribe", async () => {
		const deviceId = seedEpLite(t.readTransport);

		const ws = createWs();
		await ws.connect("/api/live/ws");

		ws.send({
			type: "subscribe",
			deviceId,
			profileId: liteProfileId,
			entityNamePrefix: "ep_lite",
		});

		// Wait for subscribed confirmation
		await ws.waitForType("subscribed", 3000);

		// Now trigger a state change on a subscribed entity
		const entityId = "binary_sensor.ep_lite_occupancy";
		const now = new Date().toISOString();
		t.readTransport.setState(entityId, {
			entity_id: entityId,
			state: "on",
			attributes: {},
			last_changed: now,
			last_updated: now,
		});

		// Should receive state_update
		const update = (await ws.waitForType("state_update", 3000)) as Record<
			string,
			unknown
		>;

		expect(update.type).toBe("state_update");
		expect(update.entityId).toBe(entityId);
		expect(update.state).toBe("on");
		expect(update.timestamp).toBeTypeOf("number");
	});

	it("unsubscribe stops state updates", async () => {
		const deviceId = seedEpLite(t.readTransport);

		const ws = createWs();
		await ws.connect("/api/live/ws");

		ws.send({
			type: "subscribe",
			deviceId,
			profileId: liteProfileId,
			entityNamePrefix: "ep_lite",
		});

		await ws.waitForType("subscribed", 3000);

		// Unsubscribe
		ws.send({ type: "unsubscribe" });

		// Small delay to let unsubscribe process
		await new Promise((r) => setTimeout(r, 100));

		// Trigger a state change
		const entityId = "binary_sensor.ep_lite_occupancy";
		const now = new Date().toISOString();
		t.readTransport.setState(entityId, {
			entity_id: entityId,
			state: "on",
			attributes: {},
			last_changed: now,
			last_updated: now,
		});

		// Should NOT receive any message — wait briefly and expect timeout
		await expect(ws.waitForMessage(500)).rejects.toThrow(/timed out/);
	});

	it("multiple clients both receive state updates", async () => {
		const deviceId = seedEpLite(t.readTransport);

		const ws1 = createWs();
		const ws2 = createWs();
		await ws1.connect("/api/live/ws");
		await ws2.connect("/api/live/ws");

		// Both subscribe
		ws1.send({
			type: "subscribe",
			deviceId,
			profileId: liteProfileId,
			entityNamePrefix: "ep_lite",
		});
		ws2.send({
			type: "subscribe",
			deviceId,
			profileId: liteProfileId,
			entityNamePrefix: "ep_lite",
		});

		const sub1 = (await ws1.waitForType("subscribed", 3000)) as Record<
			string,
			unknown
		>;
		await ws2.waitForType("subscribed", 3000);

		// Use an entity that is actually in the subscribed entities set.
		// The subscribed response includes the resolved entity list.
		const subscribedEntities = sub1.entities as string[];
		// Pick the first entity that starts with "sensor." for a clear state change
		const entityId =
			subscribedEntities.find((e) => e.startsWith("sensor.")) ??
			subscribedEntities[0];

		const now = new Date().toISOString();
		t.readTransport.setState(entityId, {
			entity_id: entityId,
			state: "42",
			attributes: {},
			last_changed: now,
			last_updated: now,
		});

		// Both should receive the update
		const update1 = (await ws1.waitForType("state_update", 3000)) as Record<
			string,
			unknown
		>;
		const update2 = (await ws2.waitForType("state_update", 3000)) as Record<
			string,
			unknown
		>;

		expect(update1.entityId).toBe(entityId);
		expect(update1.state).toBe("42");
		expect(update2.entityId).toBe(entityId);
		expect(update2.state).toBe("42");
	});

	it("disconnect cleanup does not cause errors", async () => {
		const deviceId = seedEpLite(t.readTransport);

		const ws = createWs();
		await ws.connect("/api/live/ws");

		ws.send({
			type: "subscribe",
			deviceId,
			profileId: liteProfileId,
			entityNamePrefix: "ep_lite",
		});

		await ws.waitForType("subscribed", 3000);

		// Close the client
		ws.close();

		// Small delay for the server to process the close event
		await new Promise((r) => setTimeout(r, 100));

		// Trigger a state change — server should not crash
		const entityId = "binary_sensor.ep_lite_occupancy";
		const now = new Date().toISOString();
		t.readTransport.setState(entityId, {
			entity_id: entityId,
			state: "on",
			attributes: {},
			last_changed: now,
			last_updated: now,
		});

		// If we get here without errors, the test passes.
		// Verify the server is still responsive by making a REST call.
		const healthRes = await request(t.app).get("/api/health");
		expect(healthRes.status).toBe(200);
	});
});
