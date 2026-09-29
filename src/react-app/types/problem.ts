/** RFC 9457 problem + error-category types (backend `Problem` schema).
 * Note: the backend has no `detail` field; the human string is `title`. */
export type ErrorCategory =
	| "VALIDATION"
	| "AUTHN_AUTHZ"
	| "DECISION_DENY"
	| "STATE_CONFLICT"
	| "DEPENDENCY"
	| "INDETERMINATE"
	| "INTERNAL";

export type ProblemDetails = {
	type: string;
	title: string;
	status: number;
	code: string;
	category: ErrorCategory;
	detail_key?: string | undefined;
	behavior?:
		| {
				retryable?: boolean | undefined;
				retry_after_ms?: number | undefined;
				user_action?: string | undefined;
		  }
		| undefined;
	correlation?: Record<string, unknown> | undefined;
	occurred_at?: string | undefined;
};
