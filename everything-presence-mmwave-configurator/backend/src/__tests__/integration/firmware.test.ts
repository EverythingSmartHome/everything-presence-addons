import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { createTestApp, type TestApp } from "../helpers/testApp";
import { resetStorage } from "../helpers/tempStorage";

describe("Firmware API (/api/firmware)", () => {
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

	// ── Settings ────────────────────────────────────────────────────────

	// 1. GET /api/firmware/settings — returns settings with defaults
	it("GET /api/firmware/settings returns settings with defaults", async () => {
		const res = await request(t.app).get("/api/firmware/settings");

		expect(res.status).toBe(200);
		expect(res.body.settings).toBeDefined();
		expect(res.body.autoDetectedIp).toBeDefined();
		expect(typeof res.body.autoDetectedIp).toBe("string");
		expect(res.body.lanPort).toBeDefined();
		expect(typeof res.body.lanPort).toBe("number");
		expect(res.body.firmwareServerUrl).toBeDefined();
		expect(typeof res.body.firmwareServerUrl).toBe("string");
		expect(res.body.defaultIndexUrls).toBeDefined();
		expect(typeof res.body.defaultIndexUrls).toBe("object");
	});

	// 2. PUT /api/firmware/settings — set lanIpOverride, verify persistence
	it("PUT /api/firmware/settings sets lanIpOverride", async () => {
		const putRes = await request(t.app)
			.put("/api/firmware/settings")
			.send({ lanIpOverride: "192.168.1.100" });

		expect(putRes.status).toBe(200);
		expect(putRes.body.settings.lanIpOverride).toBe("192.168.1.100");

		// Verify persistence
		const getRes = await request(t.app).get("/api/firmware/settings");
		expect(getRes.status).toBe(200);
		expect(getRes.body.settings.lanIpOverride).toBe("192.168.1.100");
	});

	// 3. PUT /api/firmware/settings with cacheKeepCount — set to 5, verify returned
	it("PUT /api/firmware/settings sets cacheKeepCount", async () => {
		const putRes = await request(t.app)
			.put("/api/firmware/settings")
			.send({ cacheKeepCount: 5 });

		expect(putRes.status).toBe(200);
		expect(putRes.body.settings.cacheKeepCount).toBe(5);

		// Verify persistence
		const getRes = await request(t.app).get("/api/firmware/settings");
		expect(getRes.status).toBe(200);
		expect(getRes.body.settings.cacheKeepCount).toBe(5);
	});

	// 4. PUT /api/firmware/settings clear lanIpOverride — set to null, verify cleared
	it("PUT /api/firmware/settings clears lanIpOverride with null", async () => {
		// First set it
		await request(t.app)
			.put("/api/firmware/settings")
			.send({ lanIpOverride: "10.0.0.1" });

		// Then clear it
		const clearRes = await request(t.app)
			.put("/api/firmware/settings")
			.send({ lanIpOverride: null });

		expect(clearRes.status).toBe(200);
		expect(clearRes.body.settings.lanIpOverride).toBeUndefined();

		// Verify persistence
		const getRes = await request(t.app).get("/api/firmware/settings");
		expect(getRes.status).toBe(200);
		expect(getRes.body.settings.lanIpOverride).toBeUndefined();
	});

	// ── Migration state ─────────────────────────────────────────────────

	// 5. GET /api/firmware/migration/active — no active migration
	it("GET /api/firmware/migration/active returns null when no migration", async () => {
		const res = await request(t.app).get("/api/firmware/migration/active");

		expect(res.status).toBe(200);
		expect(res.body.state).toBeNull();
	});

	// 6. PUT /api/firmware/migration/:deviceId — create migration state
	it("PUT /api/firmware/migration/:deviceId creates migration state", async () => {
		const res = await request(t.app)
			.put("/api/firmware/migration/test_device_001")
			.send({ phase: "backing_up" });

		expect(res.status).toBe(200);
		expect(res.body.state).toBeDefined();
		expect(res.body.state.deviceId).toBe("test_device_001");
		expect(res.body.state.phase).toBe("backing_up");
		expect(res.body.state.startedAt).toBeDefined();
		expect(res.body.state.updatedAt).toBeDefined();
	});

	// 7. GET /api/firmware/migration/:deviceId — verify state persisted
	it("GET /api/firmware/migration/:deviceId returns persisted state", async () => {
		await request(t.app)
			.put("/api/firmware/migration/test_device_001")
			.send({ phase: "backing_up" });

		const res = await request(t.app).get(
			"/api/firmware/migration/test_device_001",
		);

		expect(res.status).toBe(200);
		expect(res.body.state).toBeDefined();
		expect(res.body.state.deviceId).toBe("test_device_001");
		expect(res.body.state.phase).toBe("backing_up");
	});

	// 8. PUT /api/firmware/migration/:deviceId update phase — verify merged
	it("PUT /api/firmware/migration/:deviceId updates phase and merges fields", async () => {
		// Create initial state
		await request(t.app)
			.put("/api/firmware/migration/test_device_001")
			.send({ phase: "backing_up" });

		// Update to new phase with additional fields
		const res = await request(t.app)
			.put("/api/firmware/migration/test_device_001")
			.send({ phase: "installing", preparedVersion: "3.1.0" });

		expect(res.status).toBe(200);
		expect(res.body.state.phase).toBe("installing");
		expect(res.body.state.preparedVersion).toBe("3.1.0");
		expect(res.body.state.deviceId).toBe("test_device_001");

		// Verify via GET
		const getRes = await request(t.app).get(
			"/api/firmware/migration/test_device_001",
		);
		expect(getRes.body.state.phase).toBe("installing");
		expect(getRes.body.state.preparedVersion).toBe("3.1.0");
	});

	// 9. DELETE /api/firmware/migration/:deviceId — clear, verify GET returns null
	it("DELETE /api/firmware/migration/:deviceId clears migration state", async () => {
		// Create state first
		await request(t.app)
			.put("/api/firmware/migration/test_device_001")
			.send({ phase: "backing_up" });

		// Delete it
		const deleteRes = await request(t.app).delete(
			"/api/firmware/migration/test_device_001",
		);
		expect(deleteRes.status).toBe(200);
		expect(deleteRes.body.ok).toBe(true);

		// Verify it's cleared
		const getRes = await request(t.app).get(
			"/api/firmware/migration/test_device_001",
		);
		expect(getRes.status).toBe(200);
		expect(getRes.body.state).toBeNull();
	});

	// 10. PUT /api/firmware/migration/:deviceId without phase — returns 400
	it("PUT /api/firmware/migration/:deviceId returns 400 without phase", async () => {
		const res = await request(t.app)
			.put("/api/firmware/migration/test_device_001")
			.send({});

		expect(res.status).toBe(400);
		expect(res.body.error).toBe("phase is required");
	});
});
