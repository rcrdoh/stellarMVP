import { createHash, randomUUID } from "node:crypto";
import { Networks } from "@stellar/stellar-sdk";
import type { Env } from "../config/env.js";
import {
	type ApprovedPaymentQuote,
	approvedPaymentQuoteSchema,
	stellarAmountToAtomic,
} from "../domain/payments.js";
import {
	type PaymentIntentRuntime,
	PaymentIntentService,
} from "../services/payment-intent-service.js";
import type { PaymentRuntime } from "../services/payment-runtime.js";
import { createPostgresPool } from "./postgres.js";
import { PostgresPaymentRepository } from "./postgres-payment-repository.js";
import { StellarIntentGateway } from "./stellar/stellar-intent-gateway.js";

export async function createPaymentRuntime(
	runtimeEnv: Env,
): Promise<PaymentRuntime> {
	if (!runtimeEnv.DATABASE_URL) throw new Error("DATABASE_URL is required");
	if (runtimeEnv.STELLAR_NETWORK !== "testnet") {
		throw new Error("Wallet payments require Stellar Testnet.");
	}
	if (!runtimeEnv.STELLAR_USDC_ISSUER) {
		throw new Error("STELLAR_USDC_ISSUER is required");
	}
	const amountAtomic = stellarAmountToAtomic(
		runtimeEnv.STELLAR_PAYMENT_AMOUNT_USDC,
	);
	if (amountAtomic === undefined) {
		throw new Error(
			"STELLAR_PAYMENT_AMOUNT_USDC must be a positive USDC amount",
		);
	}
	const pool = createPostgresPool(runtimeEnv.DATABASE_URL);
	const repository = new PostgresPaymentRepository(pool);
	await repository.migrate();
	const gateway = new StellarIntentGateway(
		runtimeEnv.STELLAR_HORIZON_URL,
		runtimeEnv.STELLAR_USDC_ISSUER,
		Networks.TESTNET,
		runtimeEnv.STELLAR_MAX_FEE_PER_OPERATION_STROOPS,
	);
	const service = new PaymentIntentService({
		quotes: repository,
		intents: repository,
		stellar: gateway,
		networkPassphrase: Networks.TESTNET,
		usdcIssuer: runtimeEnv.STELLAR_USDC_ISSUER,
	} satisfies PaymentIntentRuntime);
	const createQuote = async (input: {
		principalId: string;
		payerAddress: string;
	}): Promise<ApprovedPaymentQuote> => {
		const now = new Date();
		const quoteId = `quote-${randomUUID()}`;
		const orderId = randomUUID();
		const sessionId = randomUUID();
		const unsignedQuote = {
			quoteId,
			orderId,
			sessionId,
			principalId: input.principalId,
			status: "approved" as const,
			networkPassphrase: Networks.TESTNET,
			payerAddress: input.payerAddress,
			assetCode: "USDC" as const,
			assetIssuer: runtimeEnv.STELLAR_USDC_ISSUER,
			assetDecimals: 7 as const,
			paymentLeg: {
				purpose: "merchant" as const,
				payTo: runtimeEnv.STELLAR_PAYMENT_PAY_TO,
				amountAtomic,
			},
			expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString(),
		};
		const quote = approvedPaymentQuoteSchema.parse({
			...unsignedQuote,
			quoteHash: createHash("sha256")
				.update(JSON.stringify(unsignedQuote))
				.digest("hex"),
		});
		await repository.saveApprovedQuote({
			...quote,
			approvedAt: now.toISOString(),
		});
		return quote;
	};
	return {
		service,
		createQuote,
		isReady: () => repository.isReady(),
		close: () => pool.end(),
	};
}
