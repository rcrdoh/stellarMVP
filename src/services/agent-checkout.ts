import { randomUUID } from "node:crypto";
import type { AgentCheckoutRequest, Order } from "../domain/agent.js";
import { toOrder } from "../domain/agent.js";
import { PaymentRequiredError } from "../domain/errors.js";
import type { OrdersRepository } from "../integrations/postgres.js";
import type { StellarPaymentGateway } from "../integrations/stellar.js";
import {
	AGENT_SCOPES,
	type AgentAuthService,
	hashToken,
} from "./agent-auth.js";

export type AgentCheckoutDependencies = Readonly<{
	auth: AgentAuthService;
	orders: OrdersRepository;
	stellar: StellarPaymentGateway;
	markItemPurchased: (itemId: string) => Promise<void>;
	newOrderId?: () => string;
	now?: () => Date;
}>;

const DEFAULT_CHALLENGE =
	'stellar;asset="USDC";network="testnet";scheme="exact"';

export class AgentCheckoutService {
	private readonly newOrderId: () => string;
	private readonly now: () => Date;

	constructor(private readonly deps: AgentCheckoutDependencies) {
		this.newOrderId = deps.newOrderId ?? (() => randomUUID());
		this.now = deps.now ?? (() => new Date());
	}

	async checkout(input: {
		token: string;
		paymentToken: string | undefined;
		request: AgentCheckoutRequest;
	}): Promise<Order> {
		await this.deps.auth.verifyAgentScope(input.token, AGENT_SCOPES.CHECKOUT);

		if (input.paymentToken === undefined || input.paymentToken.length === 0) {
			throw new PaymentRequiredError(
				this.challenge(input.request, "payment_token_missing"),
				"Valid X-402-Payment-Token required.",
			);
		}

		const amount = Number.parseFloat(input.request.amount);
		await this.deps.auth.checkVelocityAndAuthorize(input.token, amount);

		const settlement = await this.deps.stellar.processPayment({
			paymentToken: input.paymentToken,
			amount: input.request.amount,
			currency: input.request.currency,
			destination: input.request.destination,
			idempotencyKey: input.request.idempotencyKey ?? this.newOrderId(),
		});

		const record = await this.deps.orders.createOrder({
			id: this.newOrderId(),
			itemId: input.request.itemId,
			agentTokenHash: hashToken(input.token),
			amount: input.request.amount,
			currency: input.request.currency,
			status: "paid",
			stellarTransactionHash: settlement.hash,
			idempotencyKey: input.request.idempotencyKey ?? null,
		});

		// The item is only flagged as purchased after the on-chain settlement
		// resolved successfully, so a failed payment never fulfills an order.
		await this.deps.markItemPurchased(input.request.itemId);

		return toOrder({
			id: record.id,
			itemId: record.item_id,
			amount: record.amount,
			currency: record.currency,
			status: record.status,
			transactionHash: record.stellar_transaction_hash,
			createdAt: new Date(record.created_at).toISOString(),
		});
	}

	private challenge(request: AgentCheckoutRequest, reason: string): string {
		return `${DEFAULT_CHALLENGE};amount="${request.amount}";currency="${request.currency}";reason="${reason}"`;
	}
}
