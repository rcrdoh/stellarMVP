import { describe, expect, test } from "bun:test";
import { loadSpec, validateSpec } from "../../scripts/validate-openapi.js";
import { buildServer } from "../../src/http/server.js";

describe("OpenAPI contract", () => {
	test("spec passes project rules", async () => {
		expect(validateSpec(await loadSpec())).toEqual([]);
	});

	test("shopping route is declared with its discriminated union schemas", async () => {
		const spec = await loadSpec();
		expect(spec.paths?.["/v1/agent/shopping"]?.post?.operationId).toBe(
			"agentShopping",
		);
		const schemas = spec.components?.schemas ?? {};
		expect(schemas.ShoppingConversationTurn).toBeDefined();
		expect(schemas.ShoppingState).toBeDefined();
		expect(schemas.ShoppingResumeEvent).toBeDefined();
	});

	test("chat route is declared with its discovery intent schemas", async () => {
		const spec = await loadSpec();
		expect(spec.paths?.["/v1/agent/chat"]?.post?.operationId).toBe("agentChat");
		expect(spec.paths?.["/v1/agent/chat"]?.post?.security).toEqual([
			{ agentToken: [] },
		]);
		const responses = spec.paths?.["/v1/agent/chat"]?.post?.responses as
			| Record<string, unknown>
			| undefined;
		expect(responses?.["429"]).toBeDefined();
		expect(responses?.["503"]).toBeDefined();
		const schemas = spec.components?.schemas ?? {};
		expect(schemas.AgentChatRequest).toBeDefined();
		expect(schemas.AgentChatResponse).toBeDefined();
		expect(schemas.DiscoveryShoppingIntent).toBeDefined();
	});

	test("catalog search route is declared with its request/response schemas", async () => {
		const spec = await loadSpec();
		expect(spec.paths?.["/v1/agent/catalog/search"]?.post?.operationId).toBe(
			"agentCatalogSearch",
		);
		const schemas = spec.components?.schemas ?? {};
		expect(schemas.CatalogSearchRequest).toBeDefined();
		expect(schemas.CatalogSearchResponse).toBeDefined();
		expect(schemas.MerchantProduct).toBeDefined();
	});

	test("server exposes canonical spec", async () => {
		const app = await buildServer();
		const response = await app.inject({
			method: "GET",
			url: "/openapi.json",
		});

		expect(response.statusCode).toBe(200);
		expect(response.json().info.title).toBe("Stellar MVP API");
	});

	test("docs endpoint serves Scalar API reference", async () => {
		const app = await buildServer();
		const response = await app.inject({
			method: "GET",
			url: "/docs/",
		});

		expect(response.statusCode).toBe(200);
		expect(response.headers["content-type"]).toContain("text/html");
		expect(response.body).toContain("openapi.json");
	});

	test("root redirects to the interactive API documentation", async () => {
		const spec = await loadSpec();
		const app = await buildServer();
		const response = await app.inject({
			method: "GET",
			url: "/",
		});

		expect(spec.paths?.["/"]?.get?.operationId).toBe("redirectRootToDocs");
		expect(response.statusCode).toBe(302);
		expect(response.headers.location).toBe("/docs");
	});

	test("health endpoint is present in spec and implementation", async () => {
		const spec = await loadSpec();
		const app = await buildServer();
		const response = await app.inject({
			method: "GET",
			url: "/v1/health/live",
		});

		expect(spec.paths?.["/v1/health/live"]?.get?.operationId).toBe(
			"getLiveHealth",
		);
		expect(response.statusCode).toBe(200);
		expect(response.json()).toMatchObject({ status: "ok" });
	});

	test("Stellar status endpoint is present in spec and implementation", async () => {
		const spec = await loadSpec();
		const app = await buildServer();
		const response = await app.inject({
			method: "GET",
			url: "/api/hello_api",
		});

		expect(spec.paths?.["/api/hello_api"]?.get?.operationId).toBe(
			"getStellarNetworkStatus",
		);
		expect(response.statusCode).toBe(200);
		expect(
			(response.json() as { stellarNetworkConfigured: boolean })
				.stellarNetworkConfigured,
		).toBe(false);
	});

	test("error endpoint follows problem contract", async () => {
		const app = await buildServer();
		const response = await app.inject({
			method: "GET",
			url: "/v1/items/missing",
		});

		expect(response.statusCode).toBe(409);
		expect(response.headers["content-type"]).toContain(
			"application/problem+json",
		);
		expect(response.headers["x-error-code"]).toBe(response.json().code);
		expect(response.json()).toMatchObject({
			type: "https://example.com/errors/SVC-CORE-4003",
			title: "resource_state_conflict",
			status: 409,
			code: "SVC-CORE-4003",
			category: "STATE_CONFLICT",
			detail_key: "core.resource_state_conflict",
			correlation: {
				trace_id: expect.any(String),
			},
		});
		expect(response.json().error).toBeUndefined();
	});

	test("validation errors use problem contract", async () => {
		const app = await buildServer();
		const response = await app.inject({
			method: "POST",
			url: "/v1/items",
			payload: {},
		});

		expect(response.statusCode).toBe(422);
		expect(response.headers["x-error-code"]).toBe("SVC-CORE-1002");
		expect(response.json()).toMatchObject({
			type: "https://example.com/errors/SVC-CORE-1002",
			title: "schema_validation_failed",
			status: 422,
			code: "SVC-CORE-1002",
			category: "VALIDATION",
			detail_key: "core.schema_validation_failed",
			behavior: {
				retryable: "never",
				financial_effect: "none",
				human_action: "none",
				agent_hint: "FIX_AND_RETRY",
				retry_after_s: null,
			},
		});
	});

	test("items routes declare service token security", async () => {
		const spec = await loadSpec();

		expect(spec.components?.securitySchemes?.serviceToken).toEqual({
			type: "http",
			scheme: "bearer",
			description:
				"Optional service-to-service token. Required on protected routes when SERVICE_TOKEN is configured.",
		});
		expect(spec.paths?.["/v1/items"]?.post?.security).toEqual([
			{ serviceToken: [] },
		]);
		expect(spec.paths?.["/v1/items/{itemId}"]?.get?.security).toEqual([
			{ serviceToken: [] },
		]);
		expect(spec.paths?.["/v1/health/live"]?.get?.security).toBeUndefined();
	});
});
