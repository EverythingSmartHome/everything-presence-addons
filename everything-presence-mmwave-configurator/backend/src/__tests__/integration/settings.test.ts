import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { createTestApp, type TestApp } from "../helpers/testApp";
import { resetStorage } from "../helpers/tempStorage";

describe("Settings API (/api/settings)", () => {
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

	// 1. GET /api/settings — returns defaults
	it("GET /api/settings returns default settings", async () => {
		const res = await request(t.app).get("/api/settings");

		expect(res.status).toBe(200);
		expect(res.body.settings).toBeDefined();
		expect(res.body.settings.wizardCompleted).toBe(false);
		expect(res.body.settings.wizardStep).toBe("device");
		expect(res.body.settings.outlineDone).toBe(false);
		expect(res.body.settings.placementDone).toBe(false);
		expect(res.body.settings.zonesReady).toBe(false);
		expect(res.body.settings.defaultRoomId).toBeNull();
	});

	// 2. PUT /api/settings — set wizardCompleted=true, verify persistence
	it("PUT /api/settings sets wizardCompleted and persists", async () => {
		const putRes = await request(t.app)
			.put("/api/settings")
			.send({ wizardCompleted: true });

		expect(putRes.status).toBe(200);
		expect(putRes.body.settings.wizardCompleted).toBe(true);

		// Verify persistence via GET
		const getRes = await request(t.app).get("/api/settings");
		expect(getRes.body.settings.wizardCompleted).toBe(true);
	});

	// 3. PUT then GET — set multiple fields, GET returns all of them
	it("PUT multiple fields then GET returns all of them", async () => {
		await request(t.app)
			.put("/api/settings")
			.send({
				wizardCompleted: true,
				outlineDone: true,
				placementDone: true,
				zonesReady: true,
				wizardStep: "zones",
			});

		const res = await request(t.app).get("/api/settings");

		expect(res.status).toBe(200);
		expect(res.body.settings.wizardCompleted).toBe(true);
		expect(res.body.settings.outlineDone).toBe(true);
		expect(res.body.settings.placementDone).toBe(true);
		expect(res.body.settings.zonesReady).toBe(true);
		expect(res.body.settings.wizardStep).toBe("zones");
	});

	// 4. PUT wizardStep — string field persisted
	it("PUT /api/settings persists wizardStep string", async () => {
		const putRes = await request(t.app)
			.put("/api/settings")
			.send({ wizardStep: "placement" });

		expect(putRes.status).toBe(200);
		expect(putRes.body.settings.wizardStep).toBe("placement");

		// Verify persistence
		const getRes = await request(t.app).get("/api/settings");
		expect(getRes.body.settings.wizardStep).toBe("placement");
	});

	// 5. PUT defaultRoomId — set string, verify; set null, verify cleared
	it("PUT /api/settings sets and clears defaultRoomId", async () => {
		// Set a string value
		const setRes = await request(t.app)
			.put("/api/settings")
			.send({ defaultRoomId: "room-abc-123" });

		expect(setRes.status).toBe(200);
		expect(setRes.body.settings.defaultRoomId).toBe("room-abc-123");

		// Verify it persists
		const getRes1 = await request(t.app).get("/api/settings");
		expect(getRes1.body.settings.defaultRoomId).toBe("room-abc-123");

		// Clear it with null
		const clearRes = await request(t.app)
			.put("/api/settings")
			.send({ defaultRoomId: null });

		expect(clearRes.status).toBe(200);
		expect(clearRes.body.settings.defaultRoomId).toBeNull();

		// Verify cleared value persists
		const getRes2 = await request(t.app).get("/api/settings");
		expect(getRes2.body.settings.defaultRoomId).toBeNull();
	});

	// 6. PUT ignores unknown fields — extra fields are NOT persisted
	it("PUT /api/settings ignores unknown fields", async () => {
		const putRes = await request(t.app)
			.put("/api/settings")
			.send({
				wizardCompleted: true,
				unknownField: "should be ignored",
				anotherRandom: 42,
			});

		expect(putRes.status).toBe(200);
		expect(putRes.body.settings.wizardCompleted).toBe(true);
		expect(putRes.body.settings).not.toHaveProperty("unknownField");
		expect(putRes.body.settings).not.toHaveProperty("anotherRandom");

		// Verify via GET as well
		const getRes = await request(t.app).get("/api/settings");
		expect(getRes.body.settings).not.toHaveProperty("unknownField");
		expect(getRes.body.settings).not.toHaveProperty("anotherRandom");
	});

	// 7. Multiple PUTs merge — first PUT sets wizardCompleted, second sets outlineDone, GET shows both
	it("Multiple PUTs merge settings", async () => {
		// First PUT
		await request(t.app)
			.put("/api/settings")
			.send({ wizardCompleted: true });

		// Second PUT with different field
		await request(t.app)
			.put("/api/settings")
			.send({ outlineDone: true });

		// GET should show both fields
		const res = await request(t.app).get("/api/settings");

		expect(res.status).toBe(200);
		expect(res.body.settings.wizardCompleted).toBe(true);
		expect(res.body.settings.outlineDone).toBe(true);
		// Other defaults should still be present
		expect(res.body.settings.placementDone).toBe(false);
		expect(res.body.settings.zonesReady).toBe(false);
	});
});
