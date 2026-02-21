import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { createTestApp, type TestApp } from "../helpers/testApp";
import { resetStorage } from "../helpers/tempStorage";

describe("Rooms API (/api/rooms)", () => {
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

	// 1. POST /api/rooms — creates a room, returns it with auto-generated id
	it("POST /api/rooms creates a room with auto-generated id", async () => {
		const res = await request(t.app)
			.post("/api/rooms")
			.send({ name: "Living Room" });

		expect(res.status).toBe(200);
		expect(res.body.room).toBeDefined();
		expect(res.body.room.name).toBe("Living Room");
		expect(res.body.room.id).toBeDefined();
		expect(typeof res.body.room.id).toBe("string");
		expect(res.body.room.id.length).toBeGreaterThan(0);
	});

	// 2. GET /api/rooms — list rooms (create 2, verify both returned)
	it("GET /api/rooms lists all rooms", async () => {
		await request(t.app).post("/api/rooms").send({ name: "Room A" });
		await request(t.app).post("/api/rooms").send({ name: "Room B" });

		const res = await request(t.app).get("/api/rooms");

		expect(res.status).toBe(200);
		expect(res.body.rooms).toBeDefined();
		expect(Array.isArray(res.body.rooms)).toBe(true);
		expect(res.body.rooms.length).toBe(2);

		const names = res.body.rooms.map((r: { name: string }) => r.name);
		expect(names).toContain("Room A");
		expect(names).toContain("Room B");
	});

	// 3. GET /api/rooms/:id — get existing room by id
	it("GET /api/rooms/:id returns the room", async () => {
		const createRes = await request(t.app)
			.post("/api/rooms")
			.send({ name: "Bedroom" });
		const roomId = createRes.body.room.id;

		const res = await request(t.app).get(`/api/rooms/${roomId}`);

		expect(res.status).toBe(200);
		expect(res.body.room).toBeDefined();
		expect(res.body.room.id).toBe(roomId);
		expect(res.body.room.name).toBe("Bedroom");
	});

	// 4. GET /api/rooms/:id with invalid id — returns 404
	it("GET /api/rooms/:id returns 404 for nonexistent id", async () => {
		const res = await request(t.app).get("/api/rooms/nonexistent-id");

		expect(res.status).toBe(404);
		expect(res.body.message).toBe("Room not found");
	});

	// 5. PUT /api/rooms/:id — updates room name, verify merged result
	it("PUT /api/rooms/:id updates the room name", async () => {
		const createRes = await request(t.app)
			.post("/api/rooms")
			.send({ name: "Old Name", units: "metric" });
		const roomId = createRes.body.room.id;

		const res = await request(t.app)
			.put(`/api/rooms/${roomId}`)
			.send({ name: "New Name" });

		expect(res.status).toBe(200);
		expect(res.body.room.id).toBe(roomId);
		expect(res.body.room.name).toBe("New Name");
		// units should be preserved from original
		expect(res.body.room.units).toBe("metric");
	});

	// 6. PUT /api/rooms/:id with invalid id — returns 404
	it("PUT /api/rooms/:id returns 404 for nonexistent id", async () => {
		const res = await request(t.app)
			.put("/api/rooms/nonexistent-id")
			.send({ name: "Updated" });

		expect(res.status).toBe(404);
		expect(res.body.message).toBe("Room not found");
	});

	// 7. DELETE /api/rooms/:id — deletes, verify GET returns 404 after
	it("DELETE /api/rooms/:id removes the room", async () => {
		const createRes = await request(t.app)
			.post("/api/rooms")
			.send({ name: "To Delete" });
		const roomId = createRes.body.room.id;

		const deleteRes = await request(t.app).delete(`/api/rooms/${roomId}`);
		expect(deleteRes.status).toBe(200);
		expect(deleteRes.body.ok).toBe(true);

		// Verify the room is gone
		const getRes = await request(t.app).get(`/api/rooms/${roomId}`);
		expect(getRes.status).toBe(404);
	});

	// 8. DELETE /api/rooms/:id with invalid id — returns 404
	it("DELETE /api/rooms/:id returns 404 for nonexistent id", async () => {
		const res = await request(t.app).delete("/api/rooms/nonexistent-id");

		expect(res.status).toBe(404);
		expect(res.body.message).toBe("Room not found");
	});

	// 9. POST with zones — create room with zones array, verify zones stored
	it("POST /api/rooms with zones stores them", async () => {
		const zones = [
			{ x: 0, y: 0, width: 1000, height: 1000 },
			{ x: 1000, y: 0, width: 500, height: 500, type: "exclusion" },
		];

		const res = await request(t.app)
			.post("/api/rooms")
			.send({ name: "Zoned Room", zones });

		expect(res.status).toBe(200);
		expect(res.body.room.zones).toBeDefined();
		expect(res.body.room.zones.length).toBe(2);
		expect(res.body.room.zones[0].x).toBe(0);
		expect(res.body.room.zones[0].width).toBe(1000);
		expect(res.body.room.zones[0].height).toBe(1000);
		expect(res.body.room.zones[1].type).toBe("exclusion");
		expect(res.body.room.zones[1].x).toBe(1000);
	});

	// 10. GET /:id/zones — returns zones for room
	it("GET /api/rooms/:id/zones returns zones", async () => {
		const zones = [
			{ x: 100, y: 200, width: 300, height: 400 },
		];
		const createRes = await request(t.app)
			.post("/api/rooms")
			.send({ name: "Zone Room", zones });
		const roomId = createRes.body.room.id;

		const res = await request(t.app).get(`/api/rooms/${roomId}/zones`);

		expect(res.status).toBe(200);
		expect(res.body.zones).toBeDefined();
		expect(res.body.zones.length).toBe(1);
		expect(res.body.zones[0].x).toBe(100);
		expect(res.body.zones[0].y).toBe(200);
		expect(res.body.zones[0].width).toBe(300);
		expect(res.body.zones[0].height).toBe(400);
	});

	// 11. PUT /:id/zones — updates zones on existing room
	it("PUT /api/rooms/:id/zones updates zones", async () => {
		const createRes = await request(t.app)
			.post("/api/rooms")
			.send({ name: "Update Zones Room", zones: [{ x: 0, y: 0, width: 100, height: 100 }] });
		const roomId = createRes.body.room.id;

		const newZones = [
			{ x: 500, y: 500, width: 200, height: 200 },
			{ x: 800, y: 800, width: 300, height: 300 },
		];

		const res = await request(t.app)
			.put(`/api/rooms/${roomId}/zones`)
			.send({ zones: newZones });

		expect(res.status).toBe(200);
		expect(res.body.room.zones.length).toBe(2);
		expect(res.body.room.zones[0].x).toBe(500);
		expect(res.body.room.zones[1].x).toBe(800);

		// Verify persistence via GET
		const getRes = await request(t.app).get(`/api/rooms/${roomId}/zones`);
		expect(getRes.body.zones.length).toBe(2);
	});

	// 12. PUT /:id/zones with invalid id — returns 404
	it("PUT /api/rooms/:id/zones returns 404 for nonexistent id", async () => {
		const res = await request(t.app)
			.put("/api/rooms/nonexistent-id/zones")
			.send({ zones: [{ x: 0, y: 0, width: 100, height: 100 }] });

		expect(res.status).toBe(404);
		expect(res.body.message).toBe("Room not found");
	});

	// 13. POST with devicePlacement — verify x, y, rotationDeg persisted
	it("POST /api/rooms with devicePlacement persists placement", async () => {
		const res = await request(t.app)
			.post("/api/rooms")
			.send({
				name: "Placement Room",
				devicePlacement: { x: 1500, y: 2000, rotationDeg: 90 },
			});

		expect(res.status).toBe(200);
		expect(res.body.room.devicePlacement).toBeDefined();
		expect(res.body.room.devicePlacement.x).toBe(1500);
		expect(res.body.room.devicePlacement.y).toBe(2000);
		expect(res.body.room.devicePlacement.rotationDeg).toBe(90);

		// Verify persistence via GET
		const getRes = await request(t.app).get(`/api/rooms/${res.body.room.id}`);
		expect(getRes.body.room.devicePlacement.x).toBe(1500);
		expect(getRes.body.room.devicePlacement.y).toBe(2000);
		expect(getRes.body.room.devicePlacement.rotationDeg).toBe(90);
	});

	// 14. POST with roomShell — verify shell points persisted
	it("POST /api/rooms with roomShell persists shell points", async () => {
		const shell = {
			points: [
				{ x: 0, y: 0 },
				{ x: 3000, y: 0 },
				{ x: 3000, y: 4000 },
				{ x: 0, y: 4000 },
			],
		};

		const res = await request(t.app)
			.post("/api/rooms")
			.send({ name: "Shell Room", roomShell: shell });

		expect(res.status).toBe(200);
		expect(res.body.room.roomShell).toBeDefined();
		expect(res.body.room.roomShell.points).toBeDefined();
		expect(res.body.room.roomShell.points.length).toBe(4);
		expect(res.body.room.roomShell.points[0]).toEqual({ x: 0, y: 0 });
		expect(res.body.room.roomShell.points[1]).toEqual({ x: 3000, y: 0 });
		expect(res.body.room.roomShell.points[2]).toEqual({ x: 3000, y: 4000 });
		expect(res.body.room.roomShell.points[3]).toEqual({ x: 0, y: 4000 });

		// Verify persistence via GET
		const getRes = await request(t.app).get(`/api/rooms/${res.body.room.id}`);
		expect(getRes.body.room.roomShell.points.length).toBe(4);
	});

	// 15. POST with defaults — no name -> "Untitled room", empty zones -> []
	it("POST /api/rooms with no name defaults to 'Untitled room' and empty zones", async () => {
		const res = await request(t.app)
			.post("/api/rooms")
			.send({});

		expect(res.status).toBe(200);
		expect(res.body.room.name).toBe("Untitled room");
		expect(res.body.room.zones).toEqual([]);
		expect(res.body.room.units).toBe("metric");
	});
});
