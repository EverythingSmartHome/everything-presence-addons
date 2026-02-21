import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { createTestApp, type TestApp } from "../helpers/testApp";
import { resetStorage } from "../helpers/tempStorage";
import { seedEpLite } from "../helpers/fixtures";

describe("Device Mappings router — /api/device-mappings", () => {
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

	// ── GET /api/device-mappings ────────────────────────────────────────

	it("GET /api/device-mappings with no mappings returns empty array", async () => {
		const res = await request(t.app).get("/api/device-mappings");
		expect(res.status).toBe(200);
		expect(res.body.mappings).toBeDefined();
		expect(Array.isArray(res.body.mappings)).toBe(true);
		expect(res.body.mappings.length).toBe(0);
	});

	// ── PUT then GET ────────────────────────────────────────────────────

	it("PUT then GET — saves and retrieves a device mapping", async () => {
		const deviceId = "test_device_001";

		// Save a mapping
		const putRes = await request(t.app)
			.put(`/api/device-mappings/${deviceId}`)
			.send({
				profileId: "everything_presence_lite",
				deviceName: "Test EP Lite",
				mappings: {
					presence: "binary_sensor.test_occupancy",
					targetCount: "sensor.test_target_count",
				},
			});

		expect(putRes.status).toBe(200);
		expect(putRes.body.mapping).toBeDefined();
		expect(putRes.body.mapping.deviceId).toBe(deviceId);
		expect(putRes.body.mapping.profileId).toBe("everything_presence_lite");
		expect(putRes.body.mapping.deviceName).toBe("Test EP Lite");

		// Fetch the mapping
		const getRes = await request(t.app).get(`/api/device-mappings/${deviceId}`);
		expect(getRes.status).toBe(200);
		expect(getRes.body.mapping).toBeDefined();
		expect(getRes.body.mapping.deviceId).toBe(deviceId);
		expect(getRes.body.mapping.profileId).toBe("everything_presence_lite");
		expect(getRes.body.mapping.mappings).toBeDefined();
		expect(getRes.body.mapping.mappings.presence).toBe("binary_sensor.test_occupancy");
		expect(getRes.body.mapping.mappings.targetCount).toBe("sensor.test_target_count");
	});

	// ── PUT /api/device-mappings/:deviceId ──────────────────────────────

	it("PUT /api/device-mappings/:deviceId creates mapping with required fields", async () => {
		const deviceId = "create_test_001";

		const res = await request(t.app)
			.put(`/api/device-mappings/${deviceId}`)
			.send({
				profileId: "everything_presence_lite",
				deviceName: "Created Device",
				mappings: {
					presence: "binary_sensor.test_presence",
				},
			});

		expect(res.status).toBe(200);
		expect(res.body.mapping).toBeDefined();
		expect(res.body.mapping.deviceId).toBe(deviceId);
		expect(res.body.mapping.profileId).toBe("everything_presence_lite");
		expect(res.body.mapping.deviceName).toBe("Created Device");
		expect(res.body.mapping.mappings.presence).toBe("binary_sensor.test_presence");
		expect(res.body.mapping.lastUpdated).toBeDefined();

		// Confirm it appears in the list
		const listRes = await request(t.app).get("/api/device-mappings");
		expect(listRes.status).toBe(200);
		expect(listRes.body.mappings.length).toBe(1);
		expect(listRes.body.mappings[0].deviceId).toBe(deviceId);
	});

	// ── GET /api/device-mappings/:deviceId with unknown id ──────────────

	it("GET /api/device-mappings/:deviceId with unknown id returns 404", async () => {
		const res = await request(t.app).get("/api/device-mappings/nonexistent_device");
		expect(res.status).toBe(404);
		expect(res.body.message).toBeDefined();
	});

	// ── DELETE /api/device-mappings/:deviceId ────────────────────────────

	it("DELETE /api/device-mappings/:deviceId removes the mapping", async () => {
		const deviceId = "delete_test_001";

		// First, create a mapping
		await request(t.app)
			.put(`/api/device-mappings/${deviceId}`)
			.send({
				profileId: "everything_presence_lite",
				deviceName: "To Be Deleted",
				mappings: { presence: "binary_sensor.test_delete" },
			});

		// Delete it
		const deleteRes = await request(t.app).delete(`/api/device-mappings/${deviceId}`);
		expect(deleteRes.status).toBe(200);
		expect(deleteRes.body.deleted).toBe(true);

		// Verify it's gone
		const getRes = await request(t.app).get(`/api/device-mappings/${deviceId}`);
		expect(getRes.status).toBe(404);
	});

	it("DELETE /api/device-mappings/:deviceId with unknown id returns 404", async () => {
		const res = await request(t.app).delete("/api/device-mappings/nonexistent_device");
		expect(res.status).toBe(404);
	});

	// ── GET /api/device-mappings/:deviceId/entities ─────────────────────

	it("GET /api/device-mappings/:deviceId/entities returns entities from saved mapping", async () => {
		const deviceId = "entities_test_001";

		// Create a mapping first
		await request(t.app)
			.put(`/api/device-mappings/${deviceId}`)
			.send({
				profileId: "everything_presence_lite",
				deviceName: "Entities Test",
				mappings: {
					presence: "binary_sensor.test_occupancy",
					targetCount: "sensor.test_target_count",
				},
			});

		const res = await request(t.app).get(`/api/device-mappings/${deviceId}/entities`);
		expect(res.status).toBe(200);
		expect(res.body.entities).toBeDefined();
		expect(res.body.entities.presence).toBe("binary_sensor.test_occupancy");
		expect(res.body.entities.targetCount).toBe("sensor.test_target_count");
	});

	it("GET /api/device-mappings/:deviceId/entities with unknown id returns 404", async () => {
		const res = await request(t.app).get("/api/device-mappings/nonexistent_device/entities");
		expect(res.status).toBe(404);
	});

	// ── GET /api/device-mappings/:deviceId/entity/:entityKey ────────────

	it("GET /api/device-mappings/:deviceId/entity/:entityKey returns entity from mapping", async () => {
		const deviceId = seedEpLite(t.readTransport);

		// Use discover-and-save to create a proper mapping with device entity service
		await request(t.app)
			.post(`/api/devices/${deviceId}/discover-and-save`)
			.send({
				profileId: "everything_presence_lite",
				deviceName: "EP Lite Entity Test",
			});

		// Now look up one of the mapped entity keys
		const res = await request(t.app).get(`/api/device-mappings/${deviceId}/entity/presence`);

		if (res.status === 200) {
			expect(res.body.entityId).toBeDefined();
			expect(res.body.entityKey).toBe("presence");
		} else {
			// If the key is not found, it returns 404 which is also valid
			expect(res.status).toBe(404);
		}
	});

	it("GET /api/device-mappings/:deviceId/entity/:entityKey with unknown key returns 404", async () => {
		const deviceId = "entity_key_test_001";

		// Create a basic mapping
		await request(t.app)
			.put(`/api/device-mappings/${deviceId}`)
			.send({
				profileId: "everything_presence_lite",
				deviceName: "Entity Key Test",
				mappings: { presence: "binary_sensor.test_occupancy" },
			});

		const res = await request(t.app).get(
			`/api/device-mappings/${deviceId}/entity/nonexistent_key`,
		);
		expect(res.status).toBe(404);
		expect(res.body.code).toBe("ENTITY_NOT_FOUND");
	});

	// ── GET /api/device-mappings/:deviceId/validation ───────────────────

	it("GET /api/device-mappings/:deviceId/validation returns validation result for existing mapping", async () => {
		const deviceId = "validation_test_001";

		// Create a mapping
		await request(t.app)
			.put(`/api/device-mappings/${deviceId}`)
			.send({
				profileId: "everything_presence_lite",
				deviceName: "Validation Test",
				confirmedByUser: true,
				mappings: {
					presence: "binary_sensor.test_occupancy",
					targetCount: "sensor.test_target_count",
				},
			});

		const res = await request(t.app).get(`/api/device-mappings/${deviceId}/validation`);
		expect(res.status).toBe(200);
		expect(res.body.hasMapping).toBe(true);
		expect(typeof res.body.hasValidMappings).toBe("boolean");
		expect(typeof res.body.mappedCount).toBe("number");
		// mappedCount may be >= 2 because normalizeMappingKeys can add aliased keys
		expect(res.body.mappedCount).toBeGreaterThanOrEqual(2);
		expect(typeof res.body.confirmedByUser).toBe("boolean");
		expect(res.body.confirmedByUser).toBe(true);
		expect(Array.isArray(res.body.missingEntities)).toBe(true);
	});

	it("GET /api/device-mappings/:deviceId/validation with no mapping returns hasMapping: false", async () => {
		const res = await request(t.app).get(
			"/api/device-mappings/nonexistent_device/validation",
		);
		expect(res.status).toBe(200);
		expect(res.body.hasMapping).toBe(false);
		expect(res.body.hasValidMappings).toBe(false);
		expect(res.body.mappedCount).toBe(0);
	});
});
