import type { FastifyInstance, FastifyRequest } from "fastify";
import { type Env, env } from "../config/env.js";
import { errorCodes } from "../domain/error-codes.js";
import { AppError } from "../domain/errors.js";
import {
	createPaymentIntentRequestSchema,
	idempotencyKeySchema,
	type PaymentIntent,
	paymentIntentIdSchema,
	submitPaymentTransactionRequestSchema,
} from "../domain/payments.js";
import { toPaymentReceipt } from "../domain/reconciliation.js";
import {
	reconcileBatchRequestSchema,
	reconcilePaymentRequestSchema,
} from "../schemas/payment-confirm.schema.js";
import type { SettlementReconciliationService } from "../services/payment/settlement-reconciliation-service.js";
import type { PaymentIntentService } from "../services/payment-intent-service.js";
import type { PaymentRuntime } from "../services/payment-runtime.js";
import {
	principalFromHeader,
	requirePaymentServiceToken,
} from "./payment-auth.js";

function publicIntent(intent: PaymentIntent) {
	return {
		intentId: intent.intentId,
		quoteId: intent.quoteId,
		orderId: intent.orderId,
		quoteHash: intent.quoteHash,
		status: intent.status,
		networkPassphrase: intent.networkPassphrase,
		payerAddress: intent.payerAddress,
		assetCode: intent.assetCode,
		assetIssuer: intent.assetIssuer,
		assetDecimals: intent.assetDecimals,
		totalAmountAtomic: intent.totalAmountAtomic,
		paymentLeg: intent.paymentLeg,
		unsignedXdr: intent.unsignedXdr,
		transactionHash: intent.transactionHash,
		ledger: intent.ledger,
		expiresAt: intent.expiresAt,
		createdAt: intent.createdAt,
		updatedAt: intent.updatedAt,
	};
}

function runtimeFor(
	request: FastifyRequest,
	runtimeEnv: Env,
	runtime: PaymentRuntime | undefined,
): { service: PaymentIntentService; principalId: string } {
	if (!runtimeEnv.PAYMENTS_ENABLED || runtime === undefined) {
		throw new AppError(errorCodes.SERVICE_UNAVAILABLE);
	}
	requirePaymentServiceToken(request, runtimeEnv);
	return {
		service: runtime.service,
		principalId: principalFromHeader(request),
	};
}

function reconciliationFor(
	runtime: PaymentRuntime | undefined,
): SettlementReconciliationService {
	if (runtime?.reconciliation === undefined) {
		throw new AppError(errorCodes.SERVICE_UNAVAILABLE);
	}
	return runtime.reconciliation;
}

export function registerPaymentRoutes(
	app: FastifyInstance,
	runtimeEnv: Env = env,
	runtime?: PaymentRuntime,
): void {
	app.post("/v1/payment-intents", async (request, reply) => {
		const { service, principalId } = runtimeFor(request, runtimeEnv, runtime);
		const header = request.headers["idempotency-key"];
		const idempotencyKey = Array.isArray(header) ? header[0] : header;
		if (idempotencyKey === undefined) {
			throw new AppError(errorCodes.IDEMPOTENCY_KEY_REQUIRED);
		}
		const input = createPaymentIntentRequestSchema.parse(request.body);
		const result = await service.createIntent({
			quoteId: input.quoteId,
			principalId,
			idempotencyKey: idempotencyKeySchema.parse(idempotencyKey),
		});
		if (result.replayed) reply.header("X-Idempotent-Replay", "true");
		return reply
			.code(result.replayed ? 200 : 201)
			.send(publicIntent(result.intent));
	});

	app.get("/v1/payment-intents/:intentId", async (request, reply) => {
		const { service, principalId } = runtimeFor(request, runtimeEnv, runtime);
		const params = request.params as { intentId: string };
		const intentId = paymentIntentIdSchema.parse(params.intentId);
		return reply.send(
			publicIntent(await service.getIntent(intentId, principalId)),
		);
	});

	app.post(
		"/v1/payment-intents/:intentId/submission",
		async (request, reply) => {
			const { service, principalId } = runtimeFor(request, runtimeEnv, runtime);
			const params = request.params as { intentId: string };
			const input = submitPaymentTransactionRequestSchema.parse(request.body);
			const intent = await service.submitSignedTransaction({
				intentId: paymentIntentIdSchema.parse(params.intentId),
				principalId,
				signedXdr: input.signedXdr,
			});
			const pending =
				intent.status === "submitting" || intent.status === "submitted";
			return reply.code(pending ? 202 : 200).send(publicIntent(intent));
		},
	);

	/**
	 * Confirms a single indeterminate intent against Horizon and returns a
	 * receipt. Ownership is enforced through `getIntent`, so a caller can only
	 * reconcile its own intent (Audit H1).
	 */
	app.post(
		"/v1/payment-intents/:intentId/reconcile",
		async (request, reply) => {
			const { service, principalId } = runtimeFor(request, runtimeEnv, runtime);
			const reconciliation = reconciliationFor(runtime);
			const params = request.params as { intentId: string };
			const intentId = paymentIntentIdSchema.parse(params.intentId);
			reconcilePaymentRequestSchema.parse(request.body ?? {});
			// Ownership check first: throws PAYMENT_INTENT_NOT_FOUND for others.
			await service.getIntent(intentId, principalId);
			await reconciliation.reconcileIntent(intentId);
			const refreshed = await service.getIntent(intentId, principalId);
			return reply.code(200).send(toPaymentReceipt(refreshed));
		},
	);

	/**
	 * Operator-triggered batch sweep over indeterminate intents. Bounded by
	 * `limit` so the route cannot drive an unbounded Horizon fan-out.
	 */
	app.post("/v1/payment-intents/reconcile", async (request, reply) => {
		runtimeFor(request, runtimeEnv, runtime);
		const reconciliation = reconciliationFor(runtime);
		const input = reconcileBatchRequestSchema.parse(request.body ?? {});
		const report = await reconciliation.reconcileBatch(input.limit);
		return reply.code(200).send(report);
	});
}
