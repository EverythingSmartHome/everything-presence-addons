import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { createTestApp, type TestApp } from "../helpers/testApp";
import { resetStorage } from "../helpers/tempStorage";
import { seedEpLite } from "../helpers/fixtures";

describe("Entity Discovery router — /api/devices/:deviceId", () => {
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

	// ── GET /:deviceId/entities ─────────────────────────────────────────

	it("GET /:deviceId/entities returns entities for a seeded device", async () => {
		const deviceId = seedEpLite(t.readTransport);

		const res = await request(t.app).get(`/api/devices/${deviceId}/entities`);
		expect(res.status).toBe(200);
		expect(res.body.entities).toBeDefined();
		expect(Array.isArray(res.body.entities)).toBe(true);
		expect(res.body.entities.length).toBeGreaterThan(0);

		// Verify entities belong to this device
		for (const entity of res.body.entities) {
			expect(entity.device_id).toBe(deviceId);
		}

		// Verify at least one known EP Lite entity is present
		const entityIds = res.body.entities.map((e: { entity_id: string }) => e.entity_id);
		expect(entityIds).toContain("binary_sensor.ep_lite_occupancy");
	});

	// ── GET /:deviceId/discover-entities ────────────────────────────────

	it("GET /:deviceId/discover-entities discovers entities with matching profileId", async () => {
		const deviceId = seedEpLite(t.readTransport);

		const res = await request(t.app)
			.get(`/api/devices/${deviceId}/discover-entities`)
			.query({ profileId: "everything_presence_lite" });

		expect(res.status).toBe(200);
		expect(res.body.deviceId).toBe(deviceId);
		expect(res.body.profileId).toBe("everything_presence_lite");
		expect(res.body.matchedCount).toBeGreaterThan(0);
		expect(Array.isArray(res.body.results)).toBe(true);
		expect(res.body.results.length).toBeGreaterThan(0);

		// Check that suggestedMappings is populated
		expect(res.body.suggestedMappings).toBeDefined();

		// At least occupancy and target_count should have matched
		const matchedKeys = res.body.results
			.filter((r: { matchedEntityId: string | null }) => r.matchedEntityId !== null)
			.map((r: { templateKey: string }) => r.templateKey);
		expect(matchedKeys.length).toBeGreaterThan(0);
	});

	it("GET /:deviceId/discover-entities without profileId returns 400", async () => {
		const deviceId = seedEpLite(t.readTransport);

		const res = await request(t.app).get(`/api/devices/${deviceId}/discover-entities`);
		expect(res.status).toBe(400);
		expect(res.body.error).toBeDefined();
	});

	// ── POST /:deviceId/discover-and-save ───────────────────────────────

	it("POST /:deviceId/discover-and-save discovers and creates mapping", async () => {
		const deviceId = seedEpLite(t.readTransport);

		const res = await request(t.app)
			.post(`/api/devices/${deviceId}/discover-and-save`)
			.send({
				profileId: "everything_presence_lite",
				deviceName: "My EP Lite",
			});

		expect(res.status).toBe(200);
		expect(res.body.mapping).toBeDefined();
		expect(res.body.discovery).toBeDefined();

		// Verify the mapping was created correctly
		const mapping = res.body.mapping;
		expect(mapping.deviceId).toBe(deviceId);
		expect(mapping.profileId).toBe("everything_presence_lite");
		expect(mapping.deviceName).toBe("My EP Lite");
		expect(mapping.mappings).toBeDefined();
		expect(typeof mapping.mappings).toBe("object");
		expect(Object.keys(mapping.mappings).length).toBeGreaterThan(0);

		// Verify discovery result
		const discovery = res.body.discovery;
		expect(discovery.matchedCount).toBeGreaterThan(0);

		// Verify the mapping is now retrievable from device-mappings endpoint
		const fetchRes = await request(t.app).get(`/api/device-mappings/${deviceId}`);
		expect(fetchRes.status).toBe(200);
		expect(fetchRes.body.mapping).toBeDefined();
		expect(fetchRes.body.mapping.deviceId).toBe(deviceId);
	});

	// ── POST /:deviceId/validate-mappings ───────────────────────────────

	it("POST /:deviceId/validate-mappings validates accessible mappings", async () => {
		const deviceId = seedEpLite(t.readTransport);

		// Validate mappings with entities that exist in the mock transport
		const res = await request(t.app)
			.post(`/api/devices/${deviceId}/validate-mappings`)
			.send({
				mappings: {
					presenceEntity: "binary_sensor.ep_lite_occupancy",
					targetCountEntity: "sensor.ep_lite_target_count",
				},
			});

		expect(res.status).toBe(200);
		expect(res.body.valid).toBe(true);
		expect(res.body.errors).toBeDefined();
		expect(res.body.errors.length).toBe(0);
	});

	it("POST /:deviceId/validate-mappings detects invalid entity", async () => {
		const deviceId = seedEpLite(t.readTransport);

		const res = await request(t.app)
			.post(`/api/devices/${deviceId}/validate-mappings`)
			.send({
				mappings: {
					presenceEntity: "binary_sensor.nonexistent_entity",
				},
			});

		expect(res.status).toBe(200);
		expect(res.body.valid).toBe(false);
		expect(res.body.errors.length).toBeGreaterThan(0);
	});

	it("POST /:deviceId/validate-mappings without mappings body returns 400", async () => {
		const deviceId = seedEpLite(t.readTransport);

		const res = await request(t.app)
			.post(`/api/devices/${deviceId}/validate-mappings`)
			.send({});

		expect(res.status).toBe(400);
	});
});
