import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { createTestApp, type TestApp } from "../helpers/testApp";
import { resetStorage } from "../helpers/tempStorage";

describe("Zone Backups API (/api/zone-backups)", () => {
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

	// Helper: import a single backup and return the response body
	const importBackup = (backup: Record<string, unknown>) =>
		request(t.app)
			.post("/api/zone-backups/import")
			.send({ backups: [backup] });

	const sampleBackup = (overrides: Record<string, unknown> = {}) => ({
		deviceId: "ep_lite_001",
		profileId: "ep-lite",
		zones: [
			{
				id: "zone-1",
				type: "regular",
				x: 0,
				y: 0,
				width: 1000,
				height: 1000,
			},
		],
		...overrides,
	});

	// 1. GET /api/zone-backups with no backups — returns empty array
	it("GET /api/zone-backups returns empty array when no backups exist", async () => {
		const res = await request(t.app).get("/api/zone-backups");

		expect(res.status).toBe(200);
		expect(res.body.backups).toBeDefined();
		expect(Array.isArray(res.body.backups)).toBe(true);
		expect(res.body.backups.length).toBe(0);
	});

	// 2. POST /api/zone-backups/import — import a backup, verify imported count
	it("POST /api/zone-backups/import imports a backup", async () => {
		const res = await importBackup(sampleBackup());

		expect(res.status).toBe(200);
		expect(res.body.imported).toBe(1);
		expect(res.body.backups).toBeDefined();
		expect(Array.isArray(res.body.backups)).toBe(true);
		expect(res.body.backups.length).toBe(1);
		expect(res.body.backups[0].deviceId).toBe("ep_lite_001");
		expect(res.body.backups[0].profileId).toBe("ep-lite");
		expect(res.body.backups[0].source).toBe("import");
		expect(res.body.backups[0].id).toBeDefined();
		expect(res.body.backups[0].zones).toBeDefined();
		expect(res.body.backups[0].zones.length).toBe(1);
	});

	// 3. GET /api/zone-backups after import — verify imported backup appears
	it("GET /api/zone-backups returns imported backups", async () => {
		await importBackup(sampleBackup());

		const res = await request(t.app).get("/api/zone-backups");

		expect(res.status).toBe(200);
		expect(res.body.backups.length).toBe(1);
		expect(res.body.backups[0].deviceId).toBe("ep_lite_001");
		expect(res.body.backups[0].profileId).toBe("ep-lite");
	});

	// 4. GET /api/zone-backups/:backupId — get specific backup by id
	it("GET /api/zone-backups/:backupId returns the specific backup", async () => {
		const importRes = await importBackup(sampleBackup());
		const backupId = importRes.body.backups[0].id;

		const res = await request(t.app).get(`/api/zone-backups/${backupId}`);

		expect(res.status).toBe(200);
		expect(res.body.backup).toBeDefined();
		expect(res.body.backup.id).toBe(backupId);
		expect(res.body.backup.deviceId).toBe("ep_lite_001");
		expect(res.body.backup.zones.length).toBe(1);
	});

	// 5. GET /api/zone-backups/:backupId with unknown id — returns 404
	it("GET /api/zone-backups/:backupId returns 404 for unknown id", async () => {
		const res = await request(t.app).get(
			"/api/zone-backups/nonexistent-backup-id",
		);

		expect(res.status).toBe(404);
		expect(res.body.message).toBe("Backup not found");
	});

	// 6. DELETE /api/zone-backups/:backupId — delete existing, verify 404 on re-fetch
	it("DELETE /api/zone-backups/:backupId deletes the backup", async () => {
		const importRes = await importBackup(sampleBackup());
		const backupId = importRes.body.backups[0].id;

		const deleteRes = await request(t.app).delete(
			`/api/zone-backups/${backupId}`,
		);
		expect(deleteRes.status).toBe(200);
		expect(deleteRes.body.deleted).toBe(true);

		// Verify it's gone
		const getRes = await request(t.app).get(
			`/api/zone-backups/${backupId}`,
		);
		expect(getRes.status).toBe(404);
	});

	// 7. DELETE /api/zone-backups/:backupId with unknown id — returns 404
	it("DELETE /api/zone-backups/:backupId returns 404 for unknown id", async () => {
		const res = await request(t.app).delete(
			"/api/zone-backups/nonexistent-backup-id",
		);

		expect(res.status).toBe(404);
		expect(res.body.message).toBe("Backup not found");
	});

	// 8. POST /api/zone-backups/import with invalid data — missing required fields → 400
	it("POST /api/zone-backups/import returns 400 for invalid data", async () => {
		// Missing deviceId, profileId, and zones
		const res = await request(t.app)
			.post("/api/zone-backups/import")
			.send({ backups: [{ something: "irrelevant" }] });

		expect(res.status).toBe(400);
		expect(res.body.message).toBe(
			"No valid backups found in import payload",
		);
	});

	// 9. GET /api/zone-backups?deviceId=X — filter by device
	it("GET /api/zone-backups?deviceId filters by device", async () => {
		// Import two backups for different devices
		await importBackup(sampleBackup({ deviceId: "device_a" }));
		await importBackup(sampleBackup({ deviceId: "device_b" }));

		// Verify unfiltered returns both
		const allRes = await request(t.app).get("/api/zone-backups");
		expect(allRes.body.backups.length).toBe(2);

		// Filter by device_a
		const filteredRes = await request(t.app).get(
			"/api/zone-backups?deviceId=device_a",
		);
		expect(filteredRes.status).toBe(200);
		expect(filteredRes.body.backups.length).toBe(1);
		expect(filteredRes.body.backups[0].deviceId).toBe("device_a");

		// Filter by device_b
		const filteredRes2 = await request(t.app).get(
			"/api/zone-backups?deviceId=device_b",
		);
		expect(filteredRes2.status).toBe(200);
		expect(filteredRes2.body.backups.length).toBe(1);
		expect(filteredRes2.body.backups[0].deviceId).toBe("device_b");

		// Filter by nonexistent device returns empty
		const noMatch = await request(t.app).get(
			"/api/zone-backups?deviceId=nonexistent",
		);
		expect(noMatch.status).toBe(200);
		expect(noMatch.body.backups.length).toBe(0);
	});
});
