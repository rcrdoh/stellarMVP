import CircuitBreaker from "opossum";
import { AIServiceUnavailableError } from "../domain/errors.js";

export type CircuitBreakerOptions = {
	timeout?: number;
	errorThresholdPercentage?: number;
	resetTimeout?: number;
};

/**
 * Wraps an outbound dependency call in a time-bounded circuit breaker.
 * When the circuit opens or the call times out, the breaker rejects with an
 * AppError mapped to SVC-CORE-5005 instead of leaking a provider error.
 */
export function withCircuitBreaker<TArgs extends unknown[], TResult>(
	operation: (...args: TArgs) => Promise<TResult>,
	options: CircuitBreakerOptions = {},
): CircuitBreaker<TArgs, TResult> {
	const breaker = new CircuitBreaker<TArgs, TResult>(operation, {
		timeout: options.timeout ?? 10_000,
		errorThresholdPercentage: options.errorThresholdPercentage ?? 50,
		resetTimeout: options.resetTimeout ?? 30_000,
	});
	breaker.fallback(() => {
		throw new AIServiceUnavailableError();
	});
	return breaker as CircuitBreaker<TArgs, TResult>;
}
