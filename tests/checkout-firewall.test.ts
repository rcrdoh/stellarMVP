import { describe, expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { agentCheckoutRequestSchema } from "../src/domain/agent.js";
import type { ServiceTokenScope } from "../src/domain/checkout/types.js";
import { errorCodes } from "../src/domain/error-codes.js";
import {
	InsufficientScopeError,
	PaymentRequiredError,
	SpendCapExceededError,
} from "../src/domain/errors.js";
import { buildServer } from "../src/http/server.js";
import { MemoryItemStore } from "../src/integrations/memory-item-store.js";
import { MemoryServiceTokenStore } from "../src/integrations/memory-service-token-store.js";
import type { OrderRecord } from "../src/integrations/postgres.js";
import type { RedisLike } from "../src/integrations/redis.js";
import type { StellarPaymentGateway } from "../src/integrations/stellar.js";
import { AGENT_SCOPES } from "../src/services/agent-auth.js";
import { PaymentAgentService } from "../src/services/agents/payment-agent.js";

const AGENT_TOKEN = "checkout-agent-secret";

function authEntries(scopes: string): Record<string, Record<string, string>> {
	const hash = createHash("sha256").update(AGENT_TOKEN).digest("hex");
	return { [`agent:token:${hash}`]: { scopes, max_daily_spend: "1000" } };
}

/**
 * In-memory Redis double backing `AgentAuthService`. The velocity ledger is a
 * real accumulation over string keys so the daily-spend guard is exercised for
 * real rather than stubbed away.
 */
function inMemoryRedis(
	entries: Record<string, Record<string, string>>,
): RedisLike {
	const strings = new Map<string, string>();
	return {
		async hget(key: string, field: string) {
			return entries[key]?.[field] ?? null;
		},
		async get(key: string) {
			return strings.get(key) ?? null;
		},
		async set(key: string, value: string) {
			strings.set(key, value);
			return "OK";
		},
		async incrbyfloat(key: string, by: number) {
			const next = Number.parseFloat(strings.get(key) ?? "0") + by;
			strings.set(key, next.toString());
			return next;
		},
		async expire() {
			return 1;
		},
		async ping() {
			return "PONG";
		},
		async quit() {
			return "OK";
		},
		defineCommand() {},
		rateLimit(...args: unknown[]) {
			const result = [1, 60_000, 0];
			const callback = args.at(-1);
			if (typeof callback === "function") {
				(callback as (err: Error | null, value: number[]) => void)(
					null,
					result,
				);
				return;
			}
			return Promise.resolve(result);
		},
	} as unknown as RedisLike;
}

function ordersRepository() {
	const orders: OrderRecord[] = [];
	return {
		orders,
		async createOrder(input: {
			id: string;
			itemId: string;
			agentTokenHash: string;
			amount: string;
			currency: string;
			status: OrderRecord["status"];
			stellarTransactionHash: string | null;
			idempotencyKey: string | null;
		}): Promise<OrderRecord> {
			const now = new Date().toISOString();
			const record: OrderRecord = {
				id: input.id,
				item_id: input.itemId,
				agent_token_hash: input.agentTokenHash,
				amount: input.amount,
				currency: input.currency,
				status: input.status,
				stellar_transaction_hash: input.stellarTransactionHash,
				idempotency_key: input.idempotencyKey,
				created_at: now,
				updated_at: now,
			};
			orders.push(record);
			return record;
		},
		async markStatus() {},
		async findById() {
			return null;
		},
	};
}

const settlementHash = "ab".repeat(32);

function stellarGateway(): StellarPaymentGateway {
	return {
		async processPayment() {
			return { hash: settlementHash, ledger: 12, successful: true };
		},
	};
}

const validBody = {
	itemId: randomUUID(),
	amount: "19.99",
	currency: "USDC",
	destination: "G".concat("A".repeat(55)),
	idempotencyKey: randomUUID(),
};

function tokenWith(
	scopes: ServiceTokenScope[],
	maxSpendAtomic: number | null = null,
) {
	const store = new MemoryServiceTokenStore();
	store.register(AGENT_TOKEN, { scopes, maxSpendAtomic });
	return store;
}

function buildCheckoutServer(
	scopes = AGENT_SCOPES.CHECKOUT,
	tokens = tokenWith(["checkout:execute"]),
) {
	return buildServer({
		agent: {
			redis: inMemoryRedis(authEntries(scopes)),
			orders: ordersRepository(),
			stellar: stellarGateway(),
			embeddings: {} as never,
			vectors: {} as never,
			serviceTokens: tokens,
		},
	});
}

describe("MemoryServiceTokenStore (Module 8)", () => {
	test("reserves spend atomically and reports the running total", async () => {
		const store = new MemoryServiceTokenStore();
		store.register(AGENT_TOKEN, {
			scopes: ["checkout:execute"],
			maxSpendAtomic: 5000,
		});

		const first = await store.reserveSpend(AGENT_TOKEN, 1999);
		expect(first.spentAtomic).toBe(1999);
		const second = await store.reserveSpend(AGENT_TOKEN, 1000);
		expect(second.spentAtomic).toBe(2999);
	});

	test("rejects a reservation that would overflow the cap without mutating the ledger", async () => {
		const store = new MemoryServiceTokenStore();
		store.register(AGENT_TOKEN, {
			scopes: ["checkout:execute"],
			maxSpendAtomic: 2000,
		});
		await store.reserveSpend(AGENT_TOKEN, 1500);

		await expect(store.reserveSpend(AGENT_TOKEN, 1000)).rejects.toBeInstanceOf(
			SpendCapExceededError,
		);
		const metadata = await store.findByToken(AGENT_TOKEN);
		expect(metadata?.spentAtomic).toBe(1500);
	});

	test("treats a null cap as unlimited", async () => {
		const store = new MemoryServiceTokenStore();
		store.register(AGENT_TOKEN, {
			scopes: ["checkout:execute"],
			maxSpendAtomic: null,
		});
		const metadata = await store.reserveSpend(AGENT_TOKEN, 10_000_000);
		expect(metadata.spentAtomic).toBe(10_000_000);
	});

	test("rejects an unknown token via the store contract", async () => {
		const store = new MemoryServiceTokenStore();
		await expect(store.reserveSpend("ghost", 1)).rejects.toBeInstanceOf(
			SpendCapExceededError,
		);
	});
});

describe("PaymentAgentService (Module 8 firewall)", () => {
	test("returns a base64 x402 challenge for an unknown service token", async () => {
		const agent = new PaymentAgentService({
			tokens: new MemoryServiceTokenStore(),
		});
		const error = await agent
			.authorize({ token: "ghost", amountAtomic: 1999 })
			.catch((thrown: unknown) => thrown);

		expect(error).toBeInstanceOf(PaymentRequiredError);
		const challenge = (error as PaymentRequiredError).challengePayload;
		expect(typeof challenge).toBe("string");
		const decoded = JSON.parse(
			Buffer.from(challenge, "base64").toString("utf8"),
		);
		expect(decoded).toMatchObject({
			scheme: "exact",
			asset: "USDC",
			amount: "19.99",
			reason: "service_token_unknown",
		});
	});

	test("rejects a token missing the checkout scope", async () => {
		const store = tokenWith(["catalog:read"]);
		const agent = new PaymentAgentService({ tokens: store });
		await expect(
			agent.authorize({ token: AGENT_TOKEN, amountAtomic: 1999 }),
		).rejects.toBeInstanceOf(InsufficientScopeError);
	});

	test("rejects an amount over the lifetime spend cap", async () => {
		const store = tokenWith(["checkout:execute"], 1000);
		const agent = new PaymentAgentService({ tokens: store });
		await expect(
			agent.authorize({ token: AGENT_TOKEN, amountAtomic: 1999 }),
		).rejects.toBeInstanceOf(SpendCapExceededError);
	});

	test("authorizes and reserves a scoped amount under the cap", async () => {
		const store = tokenWith(["checkout:execute"], 5000);
		const agent = new PaymentAgentService({ tokens: store });
		await agent.authorize({ token: AGENT_TOKEN, amountAtomic: 1999 });
		const metadata = await store.findByToken(AGENT_TOKEN);
		expect(metadata?.spentAtomic).toBe(1999);
	});
});

describe("agentCheckoutRequestSchema sanitization (Audit H2)", () => {
	test("accepts a well-formed atomic checkout payload", () => {
		expect(agentCheckoutRequestSchema.safeParse(validBody).success).toBe(true);
	});

	test("rejects a non-UUID itemId and a non-numeric amount", () => {
		expect(
			agentCheckoutRequestSchema.safeParse({ ...validBody, itemId: "item-1" })
				.success,
		).toBe(false);
		expect(
			agentCheckoutRequestSchema.safeParse({ ...validBody, amount: "19.99x" })
				.success,
		).toBe(false);
	});

	test("rejects unknown fields (strict schema)", () => {
		expect(
			agentCheckoutRequestSchema.safeParse({ ...validBody, extra: "nope" })
				.success,
		).toBe(false);
	});
});

describe("POST /v1/agent/checkout (Module 8 firewall integration)", () => {
	test("requires an agent token (401)", async () => {
		const app = await buildCheckoutServer();
		const response = await app.inject({
			method: "POST",
			url: "/v1/agent/checkout",
			payload: validBody,
		});
		expect(response.statusCode).toBe(401);
		await app.close();
	});

	test("returns 402 with an X-402-Challenge for an unknown service token", async () => {
		const app = await buildCheckoutServer(
			AGENT_SCOPES.CHECKOUT,
			new MemoryServiceTokenStore(),
		);
		const response = await app.inject({
			method: "POST",
			url: "/v1/agent/checkout",
			headers: {
				authorization: `Bearer ${AGENT_TOKEN}`,
				"x-402-payment-token": "payment-receipt",
			},
			payload: validBody,
		});
		expect(response.statusCode).toBe(402);
		expect(response.headers["x-402-challenge"]).toBeString();
		expect(response.json().code).toBe(errorCodes.PAYMENT_REQUIRED.code);
		await app.close();
	});

	test("returns 403 when the token lacks the checkout scope", async () => {
		const app = await buildCheckoutServer(
			AGENT_SCOPES.CHECKOUT,
			tokenWith(["catalog:read"]),
		);
		const response = await app.inject({
			method: "POST",
			url: "/v1/agent/checkout",
			headers: {
				authorization: `Bearer ${AGENT_TOKEN}`,
				"x-402-payment-token": "payment-receipt",
			},
			payload: validBody,
		});
		expect(response.statusCode).toBe(403);
		expect(response.json().code).toBe(errorCodes.INSUFFICIENT_SCOPE.code);
		await app.close();
	});

	test("returns 403 when the amount exceeds the lifetime spend cap", async () => {
		const app = await buildCheckoutServer(
			AGENT_SCOPES.CHECKOUT,
			tokenWith(["checkout:execute"], 500),
		);
		const response = await app.inject({
			method: "POST",
			url: "/v1/agent/checkout",
			headers: {
				authorization: `Bearer ${AGENT_TOKEN}`,
				"x-402-payment-token": "payment-receipt",
			},
			payload: validBody,
		});
		expect(response.statusCode).toBe(403);
		expect(response.json().code).toBe(errorCodes.SPEND_CAP_EXCEEDED.code);
		await app.close();
	});

	test("settles a scoped, in-cap checkout (201) and records the order", async () => {
		const tokens = tokenWith(["checkout:execute"], 5000);
		const orders = ordersRepository();
		const itemStore = new MemoryItemStore();
		await itemStore.save({
			id: validBody.itemId,
			name: "Checkout Widget",
			metadata: {},
			created_at: new Date().toISOString(),
		});
		const app = await buildServer({
			itemStore,
			agent: {
				redis: inMemoryRedis(authEntries(AGENT_SCOPES.CHECKOUT)),
				orders,
				stellar: stellarGateway(),
				embeddings: {} as never,
				vectors: {} as never,
				serviceTokens: tokens,
			},
		});
		const response = await app.inject({
			method: "POST",
			url: "/v1/agent/checkout",
			headers: {
				authorization: `Bearer ${AGENT_TOKEN}`,
				"x-402-payment-token": "payment-receipt",
			},
			payload: validBody,
		});

		expect(response.statusCode).toBe(201);
		const order = response.json();
		expect(order.status).toBe("paid");
		expect(order.transactionHash).toBe(settlementHash);
		expect(orders.orders).toHaveLength(1);
		expect((await tokens.findByToken(AGENT_TOKEN))?.spentAtomic).toBe(1999);
		expect(await itemStore.getStatus(validBody.itemId)).toBe("purchased");
		await app.close();
	});

	test("rejects an invalid payload before the firewall runs (422)", async () => {
		const app = await buildCheckoutServer();
		const response = await app.inject({
			method: "POST",
			url: "/v1/agent/checkout",
			headers: { authorization: `Bearer ${AGENT_TOKEN}` },
			payload: { ...validBody, amount: "-19.99" },
		});
		expect(response.statusCode).toBe(422);
		await app.close();
	});
});
