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
import type { PaymentService } from "../services/payment-service.js";
import {
	paymentPrincipalFromHeader,
	requireConfiguredServiceToken,
} from "./auth.js";

export type PaymentRuntime = Readonly<{
	service: PaymentService;
	isReady(): Promise<boolean>;
	close?(): Promise<void>;
}>;

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
		paymentLegs: intent.paymentLegs,
		...(intent.memo !== undefined ? { memo: intent.memo } : {}),
		expiresAt: intent.expiresAt,
		unsignedXdr: intent.unsignedXdr,
		transactionHash: intent.transactionHash,
		ledger: intent.ledger,
		createdAt: intent.createdAt,
		updatedAt: intent.updatedAt,
	};
}

function requirePaymentRuntime(
	request: FastifyRequest,
	runtimeEnv: Env,
	payments: PaymentRuntime | undefined,
): { service: PaymentService; principalId: string } {
	if (!runtimeEnv.PAYMENTS_ENABLED || payments === undefined) {
		throw new AppError(errorCodes.SERVICE_UNAVAILABLE);
	}
	requireConfiguredServiceToken(request, runtimeEnv);
	return {
		service: payments.service,
		principalId: paymentPrincipalFromHeader(request),
	};
}

export function registerPaymentRoutes(
	app: FastifyInstance,
	runtimeEnv: Env = env,
	payments?: PaymentRuntime,
): void {
	app.post("/v1/payment-intents", async (request, reply) => {
		const { service, principalId } = requirePaymentRuntime(
			request,
			runtimeEnv,
			payments,
		);
		const idempotencyKeyHeader = request.headers["idempotency-key"];
		const idempotencyKey = Array.isArray(idempotencyKeyHeader)
			? idempotencyKeyHeader[0]
			: idempotencyKeyHeader;
		if (idempotencyKey === undefined) {
			throw new AppError(errorCodes.IDEMPOTENCY_KEY_REQUIRED);
		}
		const validatedIdempotencyKey = idempotencyKeySchema.parse(idempotencyKey);
		const input = createPaymentIntentRequestSchema.parse(request.body);
		const result = await service.createIntent({
			quoteId: input.quoteId,
			principalId,
			idempotencyKey: validatedIdempotencyKey,
		});
		if (result.replayed) {
			reply.header("X-Idempotent-Replay", "true");
		}
		return reply
			.code(result.replayed ? 200 : 201)
			.send(publicIntent(result.intent));
	});

	app.get("/v1/payment-intents/:intentId", async (request, reply) => {
		const { service, principalId } = requirePaymentRuntime(
			request,
			runtimeEnv,
			payments,
		);
		const params = request.params as { intentId: string };
		const intentId = paymentIntentIdSchema.parse(params.intentId);
		return reply.send(
			publicIntent(await service.getIntent(intentId, principalId)),
		);
	});

	app.post(
		"/v1/payment-intents/:intentId/submission",
		async (request, reply) => {
			const { service, principalId } = requirePaymentRuntime(
				request,
				runtimeEnv,
				payments,
			);
			const params = request.params as { intentId: string };
			const intentId = paymentIntentIdSchema.parse(params.intentId);
			const input = submitPaymentTransactionRequestSchema.parse(request.body);
			const intent = await service.submitSignedTransaction(
				intentId,
				principalId,
				input.signedXdr,
			);
			const pending =
				intent.status === "submitting" || intent.status === "submitted";
			return reply.code(pending ? 202 : 200).send(publicIntent(intent));
		},
	);
}
