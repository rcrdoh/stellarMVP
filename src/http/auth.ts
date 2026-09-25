import { Buffer } from "node:buffer";
import { timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { Env } from "../config/env.js";
import { errorCodes } from "../domain/error-codes.js";
import { AppError } from "../domain/errors.js";

function serviceTokenFromHeader(request: FastifyRequest): string | undefined {
	const header = request.headers.authorization;
	if (header === undefined || !header.startsWith("Bearer ")) {
		return undefined;
	}
	return header.slice("Bearer ".length);
}

function tokensMatch(actual: string, expected: string): boolean {
	const actualBuffer = Buffer.from(actual);
	const expectedBuffer = Buffer.from(expected);
	return (
		actualBuffer.length === expectedBuffer.length &&
		timingSafeEqual(actualBuffer, expectedBuffer)
	);
}

export function requireOptionalServiceToken(
	request: FastifyRequest,
	runtimeEnv: Env,
): void {
	if (runtimeEnv.SERVICE_TOKEN.length === 0) {
		return;
	}
	requireConfiguredServiceToken(request, runtimeEnv);
}

export function requireConfiguredServiceToken(
	request: FastifyRequest,
	runtimeEnv: Env,
): void {
	if (runtimeEnv.SERVICE_TOKEN.trim().length === 0) {
		throw new AppError(errorCodes.SERVICE_UNAVAILABLE);
	}
	const token = serviceTokenFromHeader(request);
	if (token === undefined) {
		throw new AppError(errorCodes.CREDENTIALS_MISSING);
	}
	if (!tokensMatch(token, runtimeEnv.SERVICE_TOKEN)) {
		throw new AppError(errorCodes.CREDENTIALS_INVALID_OR_EXPIRED);
	}
}

export function paymentPrincipalFromHeader(request: FastifyRequest): string {
	const header = request.headers["x-principal-id"];
	const principalId = Array.isArray(header) ? header[0] : header;
	if (principalId === undefined || principalId.trim().length === 0) {
		throw new AppError(errorCodes.CREDENTIALS_MISSING);
	}
	return principalId;
}
