import type { FastifyInstance, FastifyRequest } from "fastify";
import { ZodError, type ZodType } from "zod";
import {
	type ErrorCodeDefinition,
	errorCodes,
	errorTypeUrl,
} from "../domain/error-codes.js";
import { AppError, PaymentRequiredError } from "../domain/errors.js";

type Problem = Readonly<{
	type: string;
	title: string;
	status: number;
	code: string;
	category: string;
	detail_key: string;
	behavior: ErrorCodeDefinition["behavior"];
	correlation: {
		trace_id: string;
	};
	occurred_at: string;
}>;

type HttpErrorLike = Error & {
	statusCode?: number;
	code?: string;
};

function traceIdFromRequest(request: FastifyRequest): string {
	const header = request.headers["x-trace-id"];
	if (Array.isArray(header)) {
		return header[0] ?? request.id;
	}
	return header ?? request.id;
}

function problemBody(
	errorCode: ErrorCodeDefinition,
	request: FastifyRequest,
): Problem {
	if (errorCode.status === null) {
		throw new Error(
			`Error code ${errorCode.code} does not define HTTP status.`,
		);
	}
	return {
		type: errorTypeUrl(errorCode.code),
		title: errorCode.title,
		status: errorCode.status,
		code: errorCode.code,
		category: errorCode.category,
		detail_key: errorCode.detail_key,
		behavior: errorCode.behavior,
		correlation: {
			trace_id: traceIdFromRequest(request),
		},
		occurred_at: new Date().toISOString(),
	};
}

function classifyHttpError(error: Error): ErrorCodeDefinition | undefined {
	const httpError = error as HttpErrorLike;
	if (httpError.statusCode === 415) {
		return errorCodes.UNSUPPORTED_MEDIA_TYPE;
	}
	if (httpError.statusCode === 429) {
		return errorCodes.RATE_LIMITED;
	}
	if (httpError.statusCode === 503) {
		return errorCodes.AI_SERVICE_UNAVAILABLE;
	}
	if (
		httpError.statusCode === 400 &&
		(httpError.code === "FST_ERR_CTP_INVALID_JSON_BODY" ||
			httpError.message.includes("JSON"))
	) {
		return errorCodes.MALFORMED_REQUEST_BODY;
	}
	return undefined;
}

function sendProblem(
	reply: Parameters<Parameters<FastifyInstance["setErrorHandler"]>[0]>[2],
	errorCode: ErrorCodeDefinition,
	request: FastifyRequest,
) {
	const body = problemBody(errorCode, request);
	const response = reply
		.code(body.status)
		.type("application/problem+json")
		.header("x-error-code", errorCode.code);

	if (errorCode.behavior.retry_after_s !== null) {
		response.header("Retry-After", String(errorCode.behavior.retry_after_s));
	}

	return response.send(body);
}

function isZodSchema(schema: unknown): schema is ZodType {
	return (
		typeof schema === "object" &&
		schema !== null &&
		typeof (schema as { safeParse?: unknown }).safeParse === "function"
	);
}

/**
 * Fastify validator compiler that understands Zod schemas. Non-Zod schemas
 * fall back to the default Ajv compiler so JSON Schema contracts keep working.
 */
export function registerValidatorCompiler(app: FastifyInstance): void {
	const defaultCompiler = app.validatorCompiler;
	app.setValidatorCompiler((route) => {
		const schema: unknown = route.schema;
		if (isZodSchema(schema)) {
			return (data: unknown) => {
				const result = schema.safeParse(data);
				if (result.success) {
					return { value: result.data };
				}
				return { error: result.error };
			};
		}
		if (defaultCompiler === undefined) {
			throw new Error("No validator compiler registered for schema.");
		}
		return defaultCompiler(route);
	});
}

export function registerErrorHandler(app: FastifyInstance): void {
	app.setErrorHandler((error, request, reply) => {
		if (error instanceof PaymentRequiredError) {
			reply.header("X-402-Challenge", error.challengePayload);
			return sendProblem(reply, error.errorCode, request);
		}

		if (error instanceof AppError) {
			return sendProblem(reply, error.errorCode, request);
		}

		if (error instanceof ZodError) {
			return sendProblem(reply, errorCodes.SCHEMA_VALIDATION_FAILED, request);
		}

		const classifiedError =
			error instanceof Error ? classifyHttpError(error) : undefined;
		if (classifiedError) {
			return sendProblem(reply, classifiedError, request);
		}

		app.log.error(error);
		return sendProblem(reply, errorCodes.UNHANDLED_INTERNAL_ERROR, request);
	});
}
