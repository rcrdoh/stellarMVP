import { describe, expect, test } from "bun:test";
import { env } from "../src/config/env.js";
import { buildServer } from "../src/http/server.js";

describe("items routes", () => {
	test("creates and gets an item", async () => {
		const app = await buildServer();
		const created = await app.inject({
			method: "POST",
			url: "/v1/items",
			payload: { name: "demo" },
		});
		const item = created.json();

		const response = await app.inject({
			method: "GET",
			url: `/v1/items/${item.id}`,
		});

		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({
			id: item.id,
			name: "demo",
			created_at: item.created_at,
		});
	});

	test("missing item uses error contract", async () => {
		const app = await buildServer();
		const response = await app.inject({
			method: "GET",
			url: "/v1/items/missing",
			headers: {
				"x-trace-id": "trace-test-1",
			},
		});

		expect(response.statusCode).toBe(409);
		expect(response.headers["content-type"]).toContain(
			"application/problem+json",
		);
		expect(response.headers["x-error-code"]).toBe("SVC-CORE-4003");
		expect(response.json()).toMatchObject({
			type: "https://example.com/errors/SVC-CORE-4003",
			title: "resource_state_conflict",
			status: 409,
			code: "SVC-CORE-4003",
			category: "STATE_CONFLICT",
			detail_key: "core.resource_state_conflict",
			behavior: {
				retryable: "conditional",
				financial_effect: "none",
				human_action: "none",
				agent_hint: "NONE",
				retry_after_s: null,
			},
			correlation: {
				trace_id: "trace-test-1",
			},
		});
		expect(response.json().occurred_at).toBeString();
	});

	test("service token missing uses auth problem", async () => {
		const app = await buildServer({
			env: {
				...env,
				SERVICE_TOKEN: "test-token",
			},
		});

		const response = await app.inject({
			method: "GET",
			url: "/v1/items/missing",
		});

		expect(response.statusCode).toBe(401);
		expect(response.headers["x-error-code"]).toBe("SVC-CORE-2001");
		expect(response.json()).toMatchObject({
			title: "credentials_missing",
			code: "SVC-CORE-2001",
		});
	});

	test("service token invalid uses auth problem", async () => {
		const app = await buildServer({
			env: {
				...env,
				SERVICE_TOKEN: "test-token",
			},
		});

		const response = await app.inject({
			method: "GET",
			url: "/v1/items/missing",
			headers: {
				authorization: "Bearer wrong",
			},
		});

		expect(response.statusCode).toBe(401);
		expect(response.headers["x-error-code"]).toBe("SVC-CORE-2002");
		expect(response.json()).toMatchObject({
			title: "credentials_invalid_or_expired",
			code: "SVC-CORE-2002",
		});
	});

	test("service token valid allows items", async () => {
		const app = await buildServer({
			env: {
				...env,
				SERVICE_TOKEN: "test-token",
			},
		});

		const response = await app.inject({
			method: "POST",
			url: "/v1/items",
			payload: { name: "demo" },
			headers: {
				authorization: "Bearer test-token",
			},
		});

		expect(response.statusCode).toBe(201);
		expect(response.json()).toMatchObject({ name: "demo" });
	});
});
