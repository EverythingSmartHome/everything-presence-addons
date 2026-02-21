import http from "http";
import path from "path";
import type { AddressInfo } from "net";
import type express from "express";
import { createServer } from "../../server";
import { createLiveWebSocketServer } from "../../routes/liveWs";
import { DeviceProfileLoader } from "../../domain/deviceProfiles";
import { MockReadTransport } from "./mockReadTransport";
import { MockWriteClient } from "./mockWriteClient";
import type { AppConfig, FirmwareConfig, HaConfig } from "../../config";
import type { TransportStatus } from "../../server";

export interface TestApp {
	app: express.Express;
	server: http.Server;
	readTransport: MockReadTransport;
	writeClient: MockWriteClient;
	profileLoader: DeviceProfileLoader;
	baseUrl: string;
	close: () => Promise<void>;
}

/**
 * Spin up an isolated Express + WebSocket test server with mock HA transports.
 *
 * Listens on a random port (port 0) so tests can run in parallel.
 */
export async function createTestApp(): Promise<TestApp> {
	const readTransport = new MockReadTransport();
	const writeClient = new MockWriteClient();

	const profileDir = path.resolve(
		__dirname,
		"../../../../config/device-profiles",
	);
	const profileLoader = new DeviceProfileLoader(profileDir);

	const haConfig: HaConfig = {
		mode: "standalone",
		baseUrl: "http://localhost:8123/api",
		token: "test-token",
	};

	const firmwareConfig: FirmwareConfig = {
		lanPort: 0,
		cacheDir: process.env.DATA_DIR ?? "/tmp/ep-test-fw",
		maxVersionsPerDevice: 3,
	};

	const config: AppConfig = {
		port: 0,
		ha: haConfig,
		frontendDist: null,
		firmware: firmwareConfig,
	};

	const transportStatus: TransportStatus = {
		readTransport: "websocket",
		writeTransport: "rest",
		wsAvailable: true,
		restAvailable: true,
	};

	const app = createServer(config, {
		readTransport,
		writeClient,
		profileLoader,
		transportStatus,
	});

	const server = http.createServer(app);

	createLiveWebSocketServer(server, readTransport, profileLoader);

	// Listen on random port
	await new Promise<void>((resolve) => {
		server.listen(0, "127.0.0.1", () => resolve());
	});

	const addr = server.address() as AddressInfo;
	const baseUrl = `http://127.0.0.1:${addr.port}`;

	const close = (): Promise<void> =>
		new Promise((resolve, reject) => {
			readTransport.unsubscribeAll();
			server.close((err) => (err ? reject(err) : resolve()));
		});

	return { app, server, readTransport, writeClient, profileLoader, baseUrl, close };
}
