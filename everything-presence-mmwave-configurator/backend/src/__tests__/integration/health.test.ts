import fs from "fs";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { createTestApp, type TestApp } from "../helpers/testApp";
import { resetStorage } from "../helpers/tempStorage";
import { seedEpLite } from "../helpers/fixtures";

describe("Health & infrastructure", () => {
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

	it("GET /api/health returns { status: ok }", async () => {
		const res = await request(t.app).get("/api/health");
		expect(res.status).toBe(200);
		expect(res.body).toEqual({ status: "ok" });
	});

	it("storage writes to DATA_DIR temp directory", async () => {
		const room = {
			name: "Test Room",
			shell: { points: [{ x: 0, y: 0 }, { x: 3000, y: 0 }, { x: 3000, y: 3000 }, { x: 0, y: 3000 }] },
		};

		const res = await request(t.app).post("/api/rooms").send(room);
		expect(res.status).toBe(200);
		expect(res.body.room).toBeDefined();
		expect(res.body.room.id).toBeDefined();

		// Verify the rooms.json file was written in DATA_DIR
		const roomsFile = `${process.env.DATA_DIR}/rooms.json`;
		expect(fs.existsSync(roomsFile)).toBe(true);

		const contents = JSON.parse(fs.readFileSync(roomsFile, "utf-8"));
		expect(Array.isArray(contents)).toBe(true);
		expect(contents.length).toBe(1);
		expect(contents[0].name).toBe("Test Room");
	});

	it("mock transport injection works (seed device, GET /api/devices returns it)", async () => {
		seedEpLite(t.readTransport);

		const res = await request(t.app).get("/api/devices");
		expect(res.status).toBe(200);
		expect(res.body.devices).toBeDefined();
		expect(Array.isArray(res.body.devices)).toBe(true);

		const lite = res.body.devices.find(
			(d: { id: string }) => d.id === "ep_lite_001",
		);
		expect(lite).toBeDefined();
		expect(lite.manufacturer).toBe("Everything Smart Technology");
	});

	it("profile loader finds device profiles", async () => {
		const res = await request(t.app).get("/api/devices/profiles");
		expect(res.status).toBe(200);
		expect(res.body.profiles).toBeDefined();
		expect(Array.isArray(res.body.profiles)).toBe(true);
		expect(res.body.profiles.length).toBeGreaterThan(0);
	});
});
