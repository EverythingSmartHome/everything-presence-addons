import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { createTestApp, type TestApp } from "../helpers/testApp";
import { resetStorage } from "../helpers/tempStorage";
import { seedEpLite, seedEpOne, seedEpPro } from "../helpers/fixtures";

describe("Devices router — /api/devices", () => {
	let t: TestApp;

	beforeAll(async () => {
		t = await createTestApp();
	});

	afterAll(async () => {
		await t.close();
	});

	beforeEach(() => {
		resetStorage();
		t.readTransport.reset();
		t.writeClient.reset();
	});

	// ── GET /api/devices ───────────────────────────────────────────────

	it("GET /api/devices with no devices returns empty array", async () => {
		const res = await request(t.app).get("/api/devices");
		expect(res.status).toBe(200);
		expect(res.body.devices).toBeDefined();
		expect(res.body.devices).toEqual([]);
	});

	it("GET /api/devices with seeded EP devices returns all three", async () => {
		const liteId = seedEpLite(t.readTransport);
		const oneId = seedEpOne(t.readTransport);
		const proId = seedEpPro(t.readTransport);

		const res = await request(t.app).get("/api/devices");
		expect(res.status).toBe(200);
		expect(res.body.devices).toBeDefined();
		expect(Array.isArray(res.body.devices)).toBe(true);
		expect(res.body.devices.length).toBe(3);

		const ids = res.body.devices.map((d: { id: string }) => d.id);
		expect(ids).toContain(liteId);
		expect(ids).toContain(oneId);
		expect(ids).toContain(proId);

		// Verify all returned devices have correct manufacturer
		for (const device of res.body.devices) {
			expect(device.manufacturer).toBe("Everything Smart Technology");
		}
	});

	// ── GET /api/devices/profiles ──────────────────────────────────────

	it("GET /api/devices/profiles returns non-empty profiles array", async () => {
		const res = await request(t.app).get("/api/devices/profiles");
		expect(res.status).toBe(200);
		expect(res.body.profiles).toBeDefined();
		expect(Array.isArray(res.body.profiles)).toBe(true);
		expect(res.body.profiles.length).toBeGreaterThan(0);

		// Every profile should have an id and label
		for (const profile of res.body.profiles) {
			expect(profile.id).toBeDefined();
			expect(typeof profile.id).toBe("string");
			expect(profile.label).toBeDefined();
			expect(typeof profile.label).toBe("string");
		}
	});

	// ── GET /api/devices/:deviceId/readiness ───────────────────────────

	it("GET /api/devices/:deviceId/readiness returns ready: true for seeded EP Lite", async () => {
		const deviceId = seedEpLite(t.readTransport);

		const res = await request(t.app).get(`/api/devices/${deviceId}/readiness`);
		expect(res.status).toBe(200);
		expect(res.body.ready).toBe(true);
		expect(res.body.require).toBe("discover");
		// There should be entities for this device
		expect(res.body.deviceEntityCount).toBeGreaterThan(0);
		expect(res.body.enabledEntityCount).toBeGreaterThan(0);
		expect(res.body.availableEntityCount).toBeGreaterThan(0);
	});

	// ── GET /api/devices/:deviceId/zones ───────────────────────────────

	it("GET /api/devices/:deviceId/zones reads zone values with correct profile", async () => {
		const deviceId = seedEpLite(t.readTransport);

		// Get the Lite profile id from profiles endpoint
		const profilesRes = await request(t.app).get("/api/devices/profiles");
		const liteProfile = profilesRes.body.profiles.find(
			(p: { id: string }) => p.id === "everything_presence_lite",
		);
		expect(liteProfile).toBeDefined();

		const res = await request(t.app)
			.get(`/api/devices/${deviceId}/zones`)
			.query({
				profileId: liteProfile.id,
				entityNamePrefix: "ep_lite",
			});

		expect(res.status).toBe(200);
		expect(res.body.zones).toBeDefined();
		expect(Array.isArray(res.body.zones)).toBe(true);

		// The fixture seeds zone 1 with beginX=0, endX=1000, beginY=0, endY=1000
		// That zone has non-zero area, so it should be returned
		expect(res.body.zones.length).toBeGreaterThanOrEqual(1);
		const zone1 = res.body.zones.find((z: { id: string }) => z.id === "Zone 1");
		expect(zone1).toBeDefined();
		expect(zone1.type).toBe("regular");
	});

	// ── POST /api/devices/:deviceId/zones ──────────────────────────────

	it("POST /api/devices/:deviceId/zones writes zones and records writeClient calls", async () => {
		const deviceId = seedEpLite(t.readTransport);

		const res = await request(t.app)
			.post(`/api/devices/${deviceId}/zones`)
			.send({
				profileId: "everything_presence_lite",
				entityNamePrefix: "ep_lite",
				zones: [
					{
						id: "Zone 1",
						type: "regular",
						x: -500,
						y: 100,
						width: 1000,
						height: 800,
					},
				],
			});

		expect(res.status).toBe(200);
		expect(res.body.ok).toBe(true);

		// Verify that writeClient recorded service calls for zone coordinate entities
		const calls = t.writeClient.getCalls();
		expect(calls.length).toBeGreaterThan(0);

		// Should have set_value calls on number entities
		const setValueCalls = t.writeClient.getCallsForService("number", "set_value");
		expect(setValueCalls.length).toBeGreaterThan(0);
	});

	// ── Error cases ────────────────────────────────────────────────────

	it("GET /api/devices/:deviceId/zones without profileId returns 400", async () => {
		const deviceId = seedEpLite(t.readTransport);

		const res = await request(t.app)
			.get(`/api/devices/${deviceId}/zones`)
			.query({ entityNamePrefix: "ep_lite" });

		expect(res.status).toBe(400);
	});

	it("POST /api/devices/:deviceId/zones without profileId returns 400", async () => {
		const deviceId = seedEpLite(t.readTransport);

		const res = await request(t.app)
			.post(`/api/devices/${deviceId}/zones`)
			.send({
				entityNamePrefix: "ep_lite",
				zones: [],
			});

		expect(res.status).toBe(400);
	});
});
