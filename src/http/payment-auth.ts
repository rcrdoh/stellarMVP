import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { Env } from "../config/env.js";
import { errorCodes } from "../domain/error-codes.js";
import { AppError } from "../domain/errors.js";
import { principalIdSchema } from "../domain/payments.js";

function tokenFromHeader(request: FastifyRequest): string | undefined {
	const header = request.headers.authorization;
	if (header === undefined || !header.startsWith("Bearer ")) return undefined;
	return header.slice("Bearer ".length);
}

function tokensMatch(actual: string, expected: string): boolean {
	const left = Buffer.from(actual);
	const right = Buffer.from(expected);
	return left.length === right.length && timingSafeEqual(left, right);
}

export function requirePaymentServiceToken(
	request: FastifyRequest,
	runtimeEnv: Env,
): void {
	if (runtimeEnv.SERVICE_TOKEN.trim().length === 0) {
		throw new AppError(errorCodes.SERVICE_UNAVAILABLE);
	}
	const token = tokenFromHeader(request);
	if (token === undefined) throw new AppError(errorCodes.CREDENTIALS_MISSING);
	if (!tokensMatch(token, runtimeEnv.SERVICE_TOKEN)) {
		throw new AppError(errorCodes.CREDENTIALS_INVALID_OR_EXPIRED);
	}
}

export function principalFromHeader(request: FastifyRequest): string {
	const value = request.headers["x-principal-id"];
	const principalId = Array.isArray(value) ? value[0] : value;
	if (principalId === undefined || principalId.trim().length === 0) {
		throw new AppError(errorCodes.CREDENTIALS_MISSING);
	}
	return principalIdSchema.parse(principalId);
}
