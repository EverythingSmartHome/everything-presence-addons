import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import { createTestApp, type TestApp } from "../helpers/testApp";
import { resetStorage } from "../helpers/tempStorage";
import { seedEpLite, seedEpPro } from "../helpers/fixtures";

describe("Live REST API — /api/live", () => {
	let t: TestApp;
	let liteProfileId: string;
	let proProfileId: string;

	beforeAll(async () => {
		t = await createTestApp();

		// Fetch actual profile IDs from the profile loader
		const profilesRes = await request(t.app).get("/api/devices/profiles");
		const profiles = profilesRes.body.profiles as Array<{
			id: string;
			label: string;
		}>;
		const liteProfile = profiles.find((p) =>
			p.label.toLowerCase().includes("lite"),
		);
		const proProfile = profiles.find((p) =>
			p.label.toLowerCase().includes("pro"),
		);
		liteProfileId = liteProfile!.id;
		proProfileId = proProfile!.id;
	});

	afterAll(async () => {
		await t.close();
	});

	beforeEach(() => {
		resetStorage();
		t.readTransport.reset();
		t.writeClient.reset();
	});

	// ── GET /api/live/:deviceId/state ──────────────────────────────

	it("GET /api/live/:deviceId/state returns state with correct profile", async () => {
		const deviceId = seedEpLite(t.readTransport);

		const res = await request(t.app)
			.get(`/api/live/${deviceId}/state`)
			.query({ profileId: liteProfileId, entityNamePrefix: "ep_lite" });

		expect(res.status).toBe(200);
		expect(res.body.state).toBeDefined();
		expect(res.body.state.deviceId).toBe(deviceId);
		expect(res.body.state.profileId).toBe(liteProfileId);
		expect(res.body.state.timestamp).toBeTypeOf("number");
	});

	it("GET /api/live/:deviceId/state with unknown profile returns 404", async () => {
		const deviceId = seedEpLite(t.readTransport);

		const res = await request(t.app)
			.get(`/api/live/${deviceId}/state`)
			.query({ profileId: "nonexistent_profile_xyz" });

		expect(res.status).toBe(404);
		expect(res.body.error).toBeDefined();
	});

	// ── POST /api/live/:deviceId/entity ────────────────────────────

	it("POST /api/live/:deviceId/entity with number entity calls number.set_value", async () => {
		const deviceId = seedEpLite(t.readTransport);

		const res = await request(t.app)
			.post(`/api/live/${deviceId}/entity`)
			.send({ entityId: "number.ep_lite_zone_1_begin_x", value: 500 });

		expect(res.status).toBe(200);
		expect(res.body).toEqual({ success: true });

		const calls = t.writeClient.getCallsForService("number", "set_value");
		expect(calls.length).toBe(1);
		expect(calls[0].data).toEqual({
			entity_id: "number.ep_lite_zone_1_begin_x",
			value: 500,
		});
	});

	it("POST /api/live/:deviceId/entity with select entity calls select.select_option", async () => {
		const deviceId = seedEpPro(t.readTransport);

		const res = await request(t.app)
			.post(`/api/live/${deviceId}/entity`)
			.send({ entityId: "select.ep_pro_install_angle", value: "30\u00b0" });

		expect(res.status).toBe(200);
		expect(res.body).toEqual({ success: true });

		const calls = t.writeClient.getCallsForService("select", "select_option");
		expect(calls.length).toBe(1);
		expect(calls[0].data).toEqual({
			entity_id: "select.ep_pro_install_angle",
			option: "30\u00b0",
		});
	});

	it("POST /api/live/:deviceId/entity with switch entity calls switch.turn_on/turn_off", async () => {
		const deviceId = seedEpLite(t.readTransport);

		// Add a switch entity state
		const now = new Date().toISOString();
		t.readTransport.setState("switch.ep_lite_test_switch", {
			entity_id: "switch.ep_lite_test_switch",
			state: "off",
			attributes: {},
			last_changed: now,
			last_updated: now,
		});

		// Turn on
		const resOn = await request(t.app)
			.post(`/api/live/${deviceId}/entity`)
			.send({ entityId: "switch.ep_lite_test_switch", value: true });

		expect(resOn.status).toBe(200);
		expect(resOn.body).toEqual({ success: true });

		const turnOnCalls = t.writeClient.getCallsForService("switch", "turn_on");
		expect(turnOnCalls.length).toBe(1);
		expect(turnOnCalls[0].data).toEqual({
			entity_id: "switch.ep_lite_test_switch",
		});

		// Turn off
		const resOff = await request(t.app)
			.post(`/api/live/${deviceId}/entity`)
			.send({ entityId: "switch.ep_lite_test_switch", value: false });

		expect(resOff.status).toBe(200);

		const turnOffCalls = t.writeClient.getCallsForService(
			"switch",
			"turn_off",
		);
		expect(turnOffCalls.length).toBe(1);
		expect(turnOffCalls[0].data).toEqual({
			entity_id: "switch.ep_lite_test_switch",
		});
	});

	it("POST /api/live/:deviceId/entity with missing fields returns 400", async () => {
		const deviceId = seedEpLite(t.readTransport);

		// Missing value
		const res1 = await request(t.app)
			.post(`/api/live/${deviceId}/entity`)
			.send({ entityId: "number.ep_lite_zone_1_begin_x" });

		expect(res1.status).toBe(400);
		expect(res1.body.error).toBeDefined();

		// Missing entityId
		const res2 = await request(t.app)
			.post(`/api/live/${deviceId}/entity`)
			.send({ value: 500 });

		expect(res2.status).toBe(400);
		expect(res2.body.error).toBeDefined();

		// Empty body
		const res3 = await request(t.app)
			.post(`/api/live/${deviceId}/entity`)
			.send({});

		expect(res3.status).toBe(400);
		expect(res3.body.error).toBeDefined();
	});

	// ── GET /api/live/ha/states/:entityId ──────────────────────────

	it("GET /api/live/ha/states/:entityId returns entity state", async () => {
		seedEpLite(t.readTransport);

		const res = await request(t.app).get(
			"/api/live/ha/states/binary_sensor.ep_lite_occupancy",
		);

		expect(res.status).toBe(200);
		expect(res.body.entity_id).toBe("binary_sensor.ep_lite_occupancy");
		expect(res.body.state).toBe("off");
		expect(res.body.attributes).toBeDefined();
	});

	it("GET /api/live/ha/states/:entityId with unknown entity returns 404", async () => {
		// No devices seeded, so no entities exist
		const res = await request(t.app).get(
			"/api/live/ha/states/sensor.nonexistent_entity",
		);

		expect(res.status).toBe(404);
		expect(res.body.error).toBeDefined();
	});
});
