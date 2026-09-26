import { Networks } from "@stellar/stellar-sdk";
import type { Env } from "../config/env.js";
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
	return {
		service,
		isReady: () => repository.isReady(),
		close: () => pool.end(),
	};
}
