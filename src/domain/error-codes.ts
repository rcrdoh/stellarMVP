export type ErrorCategory =
	| "VALIDATION"
	| "AUTHN_AUTHZ"
	| "DECISION_DENY"
	| "STATE_CONFLICT"
	| "DEPENDENCY"
	| "INDETERMINATE"
	| "INTERNAL";

export type Retryable =
	| "never"
	| "safe_if_idempotent"
	| "conditional"
	| "after_reconcile";

export type FinancialEffect = "none" | "unknown" | "possible_partial";

export type HumanAction = "none" | "approve" | "step_up" | "contact_support";

export type AgentHint =
	| "NONE"
	| "FIX_AND_RETRY"
	| "RETRY_WITH_BACKOFF"
	| "REQUEST_HUMAN_APPROVAL"
	| "REQUEST_STEP_UP"
	| "WAIT_FOR_SETTLEMENT"
	| "ABORT_AND_REPORT";

export type ErrorBehavior = Readonly<{
	retryable: Retryable;
	financial_effect: FinancialEffect;
	human_action: HumanAction;
	agent_hint: AgentHint;
	retry_after_s: number | null;
}>;

export type ErrorCodeDefinition = Readonly<{
	code: `SVC-${string}-${string}`;
	title: string;
	status: number | null;
	category: ErrorCategory;
	detail_key: string;
	behavior: ErrorBehavior;
	emittable: boolean;
	deprecated_at?: string;
}>;

const errorCodePattern = /^SVC-[A-Z]{3,4}-[0-9]{4}$/;

const typeBaseUrl = "https://example.com/errors";

export function errorTypeUrl(code: ErrorCodeDefinition["code"]): string {
	return `${typeBaseUrl}/${code}`;
}

export function defineErrorCode(
	definition: ErrorCodeDefinition,
): ErrorCodeDefinition {
	if (!errorCodePattern.test(definition.code)) {
		throw new Error("Error codes must use SVC-<DOMAIN>-<NNNN>.");
	}
	if (
		definition.status !== null &&
		(definition.status < 400 || definition.status > 599)
	) {
		throw new Error("HTTP error status must be a 4xx or 5xx status.");
	}
	assertRangeCategory(definition);
	if (definition.behavior.retry_after_s !== null) {
		if (
			!Number.isInteger(definition.behavior.retry_after_s) ||
			definition.behavior.retry_after_s < 0
		) {
			throw new Error("retry_after_s must be a non-negative integer or null.");
		}
	}
	return definition;
}

function assertRangeCategory(definition: ErrorCodeDefinition): void {
	const number = Number(definition.code.slice(-4));
	const expectedCategory =
		number >= 1000 && number <= 1999
			? "VALIDATION"
			: number >= 2000 && number <= 2999
				? "AUTHN_AUTHZ"
				: number >= 3000 && number <= 3999
					? "DECISION_DENY"
					: number >= 4000 && number <= 4999
						? "STATE_CONFLICT"
						: number >= 5000 && number <= 5999
							? "DEPENDENCY"
							: number >= 6000 && number <= 6999
								? "INDETERMINATE"
								: number >= 9000 && number <= 9999
									? "INTERNAL"
									: undefined;

	if (!expectedCategory) {
		throw new Error("Error code number must be in a reserved category range.");
	}
	if (definition.category !== expectedCategory) {
		throw new Error(
			`Error code ${definition.code} must use category ${expectedCategory}.`,
		);
	}
}

function behavior(
	retryable: Retryable,
	financial_effect: FinancialEffect,
	human_action: HumanAction,
	agent_hint: AgentHint,
	retry_after_s: number | null = null,
): ErrorBehavior {
	return {
		retryable,
		financial_effect,
		human_action,
		agent_hint,
		retry_after_s,
	};
}

export const errorCodes = {
	MALFORMED_REQUEST_BODY: defineErrorCode({
		code: "SVC-CORE-1001",
		title: "malformed_request_body",
		status: 400,
		category: "VALIDATION",
		detail_key: "core.malformed_request_body",
		behavior: behavior("never", "none", "none", "FIX_AND_RETRY"),
		emittable: true,
	}),
	SCHEMA_VALIDATION_FAILED: defineErrorCode({
		code: "SVC-CORE-1002",
		title: "schema_validation_failed",
		status: 422,
		category: "VALIDATION",
		detail_key: "core.schema_validation_failed",
		behavior: behavior("never", "none", "none", "FIX_AND_RETRY"),
		emittable: true,
	}),
	UNSUPPORTED_MEDIA_TYPE: defineErrorCode({
		code: "SVC-CORE-1003",
		title: "unsupported_media_type",
		status: 415,
		category: "VALIDATION",
		detail_key: "core.unsupported_media_type",
		behavior: behavior("never", "none", "none", "FIX_AND_RETRY"),
		emittable: true,
	}),
	IDEMPOTENCY_KEY_REQUIRED: defineErrorCode({
		code: "SVC-CORE-1004",
		title: "idempotency_key_required",
		status: 400,
		category: "VALIDATION",
		detail_key: "core.idempotency_key_required",
		behavior: behavior("never", "none", "none", "FIX_AND_RETRY"),
		emittable: true,
	}),
	INVALID_MONEY_AMOUNT_OR_CURRENCY: defineErrorCode({
		code: "SVC-CORE-1005",
		title: "invalid_money_amount_or_currency",
		status: 422,
		category: "VALIDATION",
		detail_key: "core.invalid_money_amount_or_currency",
		behavior: behavior("never", "none", "none", "FIX_AND_RETRY"),
		emittable: true,
	}),
	UNKNOWN_CANONICAL_FIELD: defineErrorCode({
		code: "SVC-CORE-1006",
		title: "unknown_canonical_field",
		status: 422,
		category: "VALIDATION",
		detail_key: "core.unknown_canonical_field",
		behavior: behavior("never", "none", "none", "FIX_AND_RETRY"),
		emittable: true,
	}),
	CREDENTIALS_MISSING: defineErrorCode({
		code: "SVC-CORE-2001",
		title: "credentials_missing",
		status: 401,
		category: "AUTHN_AUTHZ",
		detail_key: "core.credentials_missing",
		behavior: behavior("never", "none", "none", "NONE"),
		emittable: true,
	}),
	CREDENTIALS_INVALID_OR_EXPIRED: defineErrorCode({
		code: "SVC-CORE-2002",
		title: "credentials_invalid_or_expired",
		status: 401,
		category: "AUTHN_AUTHZ",
		detail_key: "core.credentials_invalid_or_expired",
		behavior: behavior("never", "none", "none", "NONE"),
		emittable: true,
	}),
	INSUFFICIENT_SCOPE: defineErrorCode({
		code: "SVC-CORE-2003",
		title: "insufficient_scope",
		status: 403,
		category: "AUTHN_AUTHZ",
		detail_key: "core.insufficient_scope",
		behavior: behavior("never", "none", "contact_support", "NONE"),
		emittable: true,
	}),
	MTLS_REQUIRED: defineErrorCode({
		code: "SVC-CORE-2004",
		title: "mtls_required",
		status: 401,
		category: "AUTHN_AUTHZ",
		detail_key: "core.mtls_required",
		behavior: behavior("never", "none", "contact_support", "NONE"),
		emittable: true,
	}),
	IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD: defineErrorCode({
		code: "SVC-CORE-4001",
		title: "idempotency_key_reused_with_different_payload",
		status: 409,
		category: "STATE_CONFLICT",
		detail_key: "core.idempotency_key_reused_with_different_payload",
		behavior: behavior("never", "none", "none", "NONE"),
		emittable: true,
	}),
	IDEMPOTENT_REQUEST_IN_PROGRESS: defineErrorCode({
		code: "SVC-CORE-4002",
		title: "idempotent_request_in_progress",
		status: 409,
		category: "STATE_CONFLICT",
		detail_key: "core.idempotent_request_in_progress",
		behavior: behavior(
			"safe_if_idempotent",
			"none",
			"none",
			"RETRY_WITH_BACKOFF",
		),
		emittable: true,
	}),
	RESOURCE_STATE_CONFLICT: defineErrorCode({
		code: "SVC-CORE-4003",
		title: "resource_state_conflict",
		status: 409,
		category: "STATE_CONFLICT",
		detail_key: "core.resource_state_conflict",
		behavior: behavior("conditional", "none", "none", "NONE"),
		emittable: true,
	}),
	OPTIMISTIC_LOCK_FAILED: defineErrorCode({
		code: "SVC-CORE-4004",
		title: "optimistic_lock_failed",
		status: 409,
		category: "STATE_CONFLICT",
		detail_key: "core.optimistic_lock_failed",
		behavior: behavior(
			"safe_if_idempotent",
			"none",
			"none",
			"RETRY_WITH_BACKOFF",
		),
		emittable: true,
	}),
	DEPENDENCY_UNAVAILABLE: defineErrorCode({
		code: "SVC-CORE-5001",
		title: "dependency_unavailable",
		status: 502,
		category: "DEPENDENCY",
		detail_key: "core.dependency_unavailable",
		behavior: behavior(
			"safe_if_idempotent",
			"none",
			"none",
			"RETRY_WITH_BACKOFF",
		),
		emittable: true,
	}),
	DEPENDENCY_TIMEOUT: defineErrorCode({
		code: "SVC-CORE-5002",
		title: "dependency_timeout",
		status: 504,
		category: "DEPENDENCY",
		detail_key: "core.dependency_timeout",
		behavior: behavior(
			"safe_if_idempotent",
			"unknown",
			"none",
			"ABORT_AND_REPORT",
		),
		emittable: true,
	}),
	RATE_LIMITED: defineErrorCode({
		code: "SVC-CORE-5003",
		title: "rate_limited",
		status: 429,
		category: "DEPENDENCY",
		detail_key: "core.rate_limited",
		behavior: behavior(
			"safe_if_idempotent",
			"none",
			"none",
			"RETRY_WITH_BACKOFF",
			60,
		),
		emittable: true,
	}),
	OUTCOME_INDETERMINATE: defineErrorCode({
		code: "SVC-CORE-6001",
		title: "outcome_indeterminate",
		status: 409,
		category: "INDETERMINATE",
		detail_key: "core.outcome_indeterminate",
		behavior: behavior(
			"after_reconcile",
			"unknown",
			"none",
			"WAIT_FOR_SETTLEMENT",
		),
		emittable: true,
	}),
	UNHANDLED_INTERNAL_ERROR: defineErrorCode({
		code: "SVC-CORE-9001",
		title: "unhandled_internal_error",
		status: 500,
		category: "INTERNAL",
		detail_key: "core.unhandled_internal_error",
		behavior: behavior(
			"never",
			"unknown",
			"contact_support",
			"ABORT_AND_REPORT",
		),
		emittable: true,
	}),
	INVALID_CONFIGURATION_AT_STARTUP: defineErrorCode({
		code: "SVC-CORE-9002",
		title: "invalid_configuration_at_startup",
		status: null,
		category: "INTERNAL",
		detail_key: "core.invalid_configuration_at_startup",
		behavior: behavior("never", "none", "contact_support", "ABORT_AND_REPORT"),
		emittable: false,
	}),
} satisfies Record<string, ErrorCodeDefinition>;

export const errorRegistry = {
	...errorCodes,
} satisfies Record<string, ErrorCodeDefinition>;

export type ErrorCode = keyof typeof errorCodes;
