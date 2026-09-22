import { describe, expect, test } from "bun:test";
import { env } from "../src/config/env.js";
import { buildServer } from "../src/http/server.js";

describe("health routes", () => {
	test("live returns ok", async () => {
		const app = await buildServer();
		const response = await app.inject({
			method: "GET",
			url: "/v1/health/live",
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({ status: "ok" });
	});

	test("Stellar status reports configuration without exposing the network", async () => {
		const app = await buildServer({
			env: {
				...env,
				STELLAR_NETWORK: "testnet",
			},
		});
		const response = await app.inject({
			method: "GET",
			url: "/api/hello_api",
		});

		expect(response.statusCode).toBe(200);
		expect(
			(response.json() as { stellarNetworkConfigured: boolean })
				.stellarNetworkConfigured,
		).toBe(true);
		expect(response.body).not.toContain("testnet");
	});

	test("ready reports optional integrations as disabled by default", async () => {
		const app = await buildServer();
		const response = await app.inject({
			method: "GET",
			url: "/v1/health/ready",
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			status: "ok",
			details: {
				storeReady: true,
				database: "disabled",
				bucket: "disabled",
				cache: "disabled",
			},
		});
	});

	test("ready counts enabled optional integrations", async () => {
		const app = await buildServer({
			env: {
				...env,
				DATABASE_ENABLED: true,
				BUCKET_ENABLED: true,
				CACHE_ENABLED: true,
			},
		});
		const response = await app.inject({
			method: "GET",
			url: "/v1/health/ready",
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			status: "ok",
			details: {
				storeReady: true,
				database: "ready",
				bucket: "ready",
				cache: "ready",
			},
		});
	});
});
