import CircuitBreaker from "opossum";
import { AIServiceUnavailableError } from "../domain/errors.js";

/** Circuit breaker specialised for single-argument LLM calls. */
export type LLMCircuitBreaker<T> = CircuitBreaker<[string], T>;

const circuitOptions: CircuitBreaker.Options = {
	timeout: 10_000, // 10 seconds timeout
	errorThresholdPercentage: 50, // Open circuit if 50% fail
	resetTimeout: 30_000, // Wait 30s before half-open retry
};

/**
 * Builds an Opossum circuit breaker around an async function. Kept generic over
 * the resolved value and the argument tuple so callers keep narrow typing; no
 * `any` leaks through the public surface.
 */
export function createLLMCircuitBreaker<T, Args extends unknown[]>(
	fn: (...args: Args) => Promise<T>,
): CircuitBreaker<Args, T> {
	const breaker = new CircuitBreaker<Args, T>(fn, circuitOptions);
	breaker.fallback(() => {
		// Surface as a typed 503 so the shared error handler renders a Problem
		// response instead of an opaque 500 when the upstream is tripped.
		throw new AIServiceUnavailableError(
			"LLM Service is temporarily unavailable due to upstream failure or rate limits.",
		);
	});
	return breaker;
}

export { circuitOptions };
