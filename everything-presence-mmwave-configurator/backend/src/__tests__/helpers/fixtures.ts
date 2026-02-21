import type { MockReadTransport } from "./mockReadTransport";

const MANUFACTURER = "Everything Smart Technology";

function makeState(entityId: string, state: string, attrs: Record<string, unknown> = {}) {
	const now = new Date().toISOString();
	return {
		entity_id: entityId,
		state,
		attributes: attrs,
		last_changed: now,
		last_updated: now,
	};
}

/**
 * Seed an Everything Presence Lite device with realistic entities and state.
 */
export function seedEpLite(transport: MockReadTransport): string {
	const deviceId = "ep_lite_001";
	const prefix = "ep_lite";

	transport.addDevice({
		id: deviceId,
		name: "Everything Presence Lite",
		name_by_user: null,
		manufacturer: MANUFACTURER,
		model: "Everything Presence Lite",
		sw_version: "2.2.0",
		hw_version: "1.0",
		serial_number: "EP-LITE-001",
		area_id: null,
		disabled_by: null,
		config_entries: ["config_entry_lite"],
		identifiers: [["esphome", "ep_lite_001"]],
	});

	// Core entities
	const entities = [
		{ entity_id: `binary_sensor.${prefix}_occupancy`, platform: "esphome" },
		{ entity_id: `sensor.${prefix}_target_count`, platform: "esphome" },
		{ entity_id: `number.${prefix}_zone_1_begin_x`, platform: "esphome" },
		{ entity_id: `number.${prefix}_zone_1_end_x`, platform: "esphome" },
		{ entity_id: `number.${prefix}_zone_1_begin_y`, platform: "esphome" },
		{ entity_id: `number.${prefix}_zone_1_end_y`, platform: "esphome" },
		{ entity_id: `sensor.${prefix}_target_1_x`, platform: "esphome" },
		{ entity_id: `sensor.${prefix}_target_1_y`, platform: "esphome" },
		{ entity_id: `number.${prefix}_max_distance`, platform: "esphome" },
	];

	for (const e of entities) {
		transport.addEntity({
			entity_id: e.entity_id,
			name: null,
			platform: e.platform,
			device_id: deviceId,
			disabled_by: null,
			hidden_by: null,
		});
	}

	// Initial states
	transport.setState(`binary_sensor.${prefix}_occupancy`, makeState(`binary_sensor.${prefix}_occupancy`, "off"));
	transport.setState(`sensor.${prefix}_target_count`, makeState(`sensor.${prefix}_target_count`, "0"));
	transport.setState(`number.${prefix}_zone_1_begin_x`, makeState(`number.${prefix}_zone_1_begin_x`, "0", { min: -4000, max: 4000 }));
	transport.setState(`number.${prefix}_zone_1_end_x`, makeState(`number.${prefix}_zone_1_end_x`, "1000", { min: -4000, max: 4000 }));
	transport.setState(`number.${prefix}_zone_1_begin_y`, makeState(`number.${prefix}_zone_1_begin_y`, "0", { min: 0, max: 8000 }));
	transport.setState(`number.${prefix}_zone_1_end_y`, makeState(`number.${prefix}_zone_1_end_y`, "1000", { min: 0, max: 8000 }));
	transport.setState(`sensor.${prefix}_target_1_x`, makeState(`sensor.${prefix}_target_1_x`, "500"));
	transport.setState(`sensor.${prefix}_target_1_y`, makeState(`sensor.${prefix}_target_1_y`, "500"));
	transport.setState(`number.${prefix}_max_distance`, makeState(`number.${prefix}_max_distance`, "6000", { min: 0, max: 8000 }));

	return deviceId;
}

/**
 * Seed an Everything Presence One device with realistic entities and state.
 */
export function seedEpOne(transport: MockReadTransport): string {
	const deviceId = "ep_one_001";
	const prefix = "ep_one";

	transport.addDevice({
		id: deviceId,
		name: "Everything Presence One",
		name_by_user: null,
		manufacturer: MANUFACTURER,
		model: "Everything Presence One",
		sw_version: "1.4.0",
		hw_version: "1.0",
		serial_number: "EP-ONE-001",
		area_id: null,
		disabled_by: null,
		config_entries: ["config_entry_one"],
		identifiers: [["esphome", "ep_one_001"]],
	});

	const entities = [
		{ entity_id: `binary_sensor.${prefix}_occupancy`, platform: "esphome" },
		{ entity_id: `sensor.${prefix}_target_count`, platform: "esphome" },
		{ entity_id: `sensor.${prefix}_illuminance`, platform: "esphome" },
		{ entity_id: `sensor.${prefix}_temperature`, platform: "esphome" },
		{ entity_id: `sensor.${prefix}_humidity`, platform: "esphome" },
	];

	for (const e of entities) {
		transport.addEntity({
			entity_id: e.entity_id,
			name: null,
			platform: e.platform,
			device_id: deviceId,
			disabled_by: null,
			hidden_by: null,
		});
	}

	transport.setState(`binary_sensor.${prefix}_occupancy`, makeState(`binary_sensor.${prefix}_occupancy`, "off"));
	transport.setState(`sensor.${prefix}_target_count`, makeState(`sensor.${prefix}_target_count`, "0"));
	transport.setState(`sensor.${prefix}_illuminance`, makeState(`sensor.${prefix}_illuminance`, "150", { unit_of_measurement: "lx" }));
	transport.setState(`sensor.${prefix}_temperature`, makeState(`sensor.${prefix}_temperature`, "22.5", { unit_of_measurement: "°C" }));
	transport.setState(`sensor.${prefix}_humidity`, makeState(`sensor.${prefix}_humidity`, "45", { unit_of_measurement: "%" }));

	return deviceId;
}

/**
 * Seed an Everything Presence Pro device with realistic entities and state.
 */
export function seedEpPro(transport: MockReadTransport): string {
	const deviceId = "ep_pro_001";
	const prefix = "ep_pro";

	transport.addDevice({
		id: deviceId,
		name: "Everything Presence Pro",
		name_by_user: null,
		manufacturer: MANUFACTURER,
		model: "Everything Presence Pro",
		sw_version: "3.0.0",
		hw_version: "2.0",
		serial_number: "EP-PRO-001",
		area_id: null,
		disabled_by: null,
		config_entries: ["config_entry_pro"],
		identifiers: [["esphome", "ep_pro_001"]],
	});

	const entities = [
		{ entity_id: `binary_sensor.${prefix}_occupancy`, platform: "esphome" },
		{ entity_id: `sensor.${prefix}_target_count`, platform: "esphome" },
		{ entity_id: `number.${prefix}_zone_1_begin_x`, platform: "esphome" },
		{ entity_id: `number.${prefix}_zone_1_end_x`, platform: "esphome" },
		{ entity_id: `number.${prefix}_zone_1_begin_y`, platform: "esphome" },
		{ entity_id: `number.${prefix}_zone_1_end_y`, platform: "esphome" },
		{ entity_id: `number.${prefix}_zone_2_begin_x`, platform: "esphome" },
		{ entity_id: `number.${prefix}_zone_2_end_x`, platform: "esphome" },
		{ entity_id: `number.${prefix}_zone_2_begin_y`, platform: "esphome" },
		{ entity_id: `number.${prefix}_zone_2_end_y`, platform: "esphome" },
		{ entity_id: `sensor.${prefix}_target_1_x`, platform: "esphome" },
		{ entity_id: `sensor.${prefix}_target_1_y`, platform: "esphome" },
		{ entity_id: `sensor.${prefix}_target_1_speed`, platform: "esphome" },
		{ entity_id: `sensor.${prefix}_target_2_x`, platform: "esphome" },
		{ entity_id: `sensor.${prefix}_target_2_y`, platform: "esphome" },
		{ entity_id: `sensor.${prefix}_target_2_speed`, platform: "esphome" },
		{ entity_id: `sensor.${prefix}_target_3_x`, platform: "esphome" },
		{ entity_id: `sensor.${prefix}_target_3_y`, platform: "esphome" },
		{ entity_id: `sensor.${prefix}_target_3_speed`, platform: "esphome" },
		{ entity_id: `number.${prefix}_max_distance`, platform: "esphome" },
		{ entity_id: `select.${prefix}_install_angle`, platform: "esphome" },
	];

	for (const e of entities) {
		transport.addEntity({
			entity_id: e.entity_id,
			name: null,
			platform: e.platform,
			device_id: deviceId,
			disabled_by: null,
			hidden_by: null,
		});
	}

	// Initial states
	transport.setState(`binary_sensor.${prefix}_occupancy`, makeState(`binary_sensor.${prefix}_occupancy`, "off"));
	transport.setState(`sensor.${prefix}_target_count`, makeState(`sensor.${prefix}_target_count`, "0"));
	transport.setState(`number.${prefix}_zone_1_begin_x`, makeState(`number.${prefix}_zone_1_begin_x`, "0", { min: -4000, max: 4000 }));
	transport.setState(`number.${prefix}_zone_1_end_x`, makeState(`number.${prefix}_zone_1_end_x`, "2000", { min: -4000, max: 4000 }));
	transport.setState(`number.${prefix}_zone_1_begin_y`, makeState(`number.${prefix}_zone_1_begin_y`, "0", { min: 0, max: 8000 }));
	transport.setState(`number.${prefix}_zone_1_end_y`, makeState(`number.${prefix}_zone_1_end_y`, "2000", { min: 0, max: 8000 }));
	transport.setState(`number.${prefix}_zone_2_begin_x`, makeState(`number.${prefix}_zone_2_begin_x`, "-1000", { min: -4000, max: 4000 }));
	transport.setState(`number.${prefix}_zone_2_end_x`, makeState(`number.${prefix}_zone_2_end_x`, "1000", { min: -4000, max: 4000 }));
	transport.setState(`number.${prefix}_zone_2_begin_y`, makeState(`number.${prefix}_zone_2_begin_y`, "2000", { min: 0, max: 8000 }));
	transport.setState(`number.${prefix}_zone_2_end_y`, makeState(`number.${prefix}_zone_2_end_y`, "4000", { min: 0, max: 8000 }));
	transport.setState(`sensor.${prefix}_target_1_x`, makeState(`sensor.${prefix}_target_1_x`, "500"));
	transport.setState(`sensor.${prefix}_target_1_y`, makeState(`sensor.${prefix}_target_1_y`, "800"));
	transport.setState(`sensor.${prefix}_target_1_speed`, makeState(`sensor.${prefix}_target_1_speed`, "0"));
	transport.setState(`sensor.${prefix}_target_2_x`, makeState(`sensor.${prefix}_target_2_x`, "0"));
	transport.setState(`sensor.${prefix}_target_2_y`, makeState(`sensor.${prefix}_target_2_y`, "0"));
	transport.setState(`sensor.${prefix}_target_2_speed`, makeState(`sensor.${prefix}_target_2_speed`, "0"));
	transport.setState(`sensor.${prefix}_target_3_x`, makeState(`sensor.${prefix}_target_3_x`, "0"));
	transport.setState(`sensor.${prefix}_target_3_y`, makeState(`sensor.${prefix}_target_3_y`, "0"));
	transport.setState(`sensor.${prefix}_target_3_speed`, makeState(`sensor.${prefix}_target_3_speed`, "0"));
	transport.setState(`number.${prefix}_max_distance`, makeState(`number.${prefix}_max_distance`, "8000", { min: 0, max: 8000 }));
	transport.setState(`select.${prefix}_install_angle`, makeState(`select.${prefix}_install_angle`, "0°", { options: ["0°", "15°", "30°", "45°"] }));

	return deviceId;
}
