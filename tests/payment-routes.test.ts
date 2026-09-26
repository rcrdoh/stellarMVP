import { describe, expect, test } from "bun:test";
import { env } from "../src/config/env.js";
import { buildServer } from "../src/http/server.js";
import type { PaymentIntentService } from "../src/services/payment-intent-service.js";

function runtime(): {
	service: PaymentIntentService;
	isReady: () => Promise<boolean>;
} {
	return {
		service: {
			createIntent: async () => {
				throw new Error("not used");
			},
			getIntent: async () => {
				throw new Error("not used");
			},
			submitSignedTransaction: async () => {
				throw new Error("not used");
			},
		} as unknown as PaymentIntentService,
		isReady: async () => true,
	};
}

describe("wallet payment routes", () => {
	test("fail closed when payments are disabled", async () => {
		const app = await buildServer();
		const response = await app.inject({
			method: "POST",
			url: "/v1/payment-intents",
			payload: { quoteId: "quote-1" },
		});
		expect(response.statusCode).toBe(503);
	});

	test("require service token and trusted principal", async () => {
		const app = await buildServer({
			env: {
				...env,
				PAYMENTS_ENABLED: true,
				SERVICE_TOKEN: "service-secret",
			},
			payments: runtime(),
		});
		const response = await app.inject({
			method: "POST",
			url: "/v1/payment-intents",
			payload: { quoteId: "quote-1" },
			headers: { authorization: "Bearer service-secret" },
		});
		expect(response.statusCode).toBe(401);
	});
});
