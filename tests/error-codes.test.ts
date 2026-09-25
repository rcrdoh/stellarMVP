import { describe, expect, test } from "bun:test";
import {
	defineErrorCode,
	errorCodes,
	errorRegistry,
} from "../src/domain/error-codes.js";

const categoriesByRange = new Map([
	[1, "VALIDATION"],
	[2, "AUTHN_AUTHZ"],
	[3, "DECISION_DENY"],
	[4, "STATE_CONFLICT"],
	[5, "DEPENDENCY"],
	[6, "INDETERMINATE"],
	[9, "INTERNAL"],
] as const);

function categoryForCode(code: string) {
	const range = Number(code.slice(-4, -3));
	const category = categoriesByRange.get(range as 1 | 2 | 3 | 4 | 5 | 6 | 9);
	if (!category) {
		throw new Error(`No category for code ${code}`);
	}
	return category;
}

describe("error code registry", () => {
	test("registered codes are unique", () => {
		const codes = Object.values(errorRegistry).map(
			(definition) => definition.code,
		);
		expect(new Set(codes).size).toBe(codes.length);
	});

	test("codes use SVC format", () => {
		for (const definition of Object.values(errorRegistry)) {
			expect(definition.code).toMatch(/^SVC-[A-Z]{3,12}-[0-9]{4}$/);
		}
	});

	test("range determines category", () => {
		for (const definition of Object.values(errorRegistry)) {
			expect(definition.category).toBe(categoryForCode(definition.code));
		}
	});

	test("emittable catalog declares reserved domains", () => {
		const nonEmittableCodes = Object.values(errorCodes)
			.filter((definition) => !definition.emittable)
			.map((definition) => definition.code);

		expect(nonEmittableCodes).toEqual(["SVC-CORE-9002"]);
		const domains = new Set(
			Object.values(errorRegistry).map(
				(definition) => definition.code.split("-")[1],
			),
		);
		expect(domains).toEqual(new Set(["CORE", "PAYMENT"]));
	});

	test("behavior is complete and agent hints are closed", () => {
		const hints = new Set([
			"NONE",
			"FIX_AND_RETRY",
			"RETRY_WITH_BACKOFF",
			"REQUEST_HUMAN_APPROVAL",
			"REQUEST_STEP_UP",
			"WAIT_FOR_SETTLEMENT",
			"ABORT_AND_REPORT",
		]);

		for (const definition of Object.values(errorRegistry)) {
			expect(definition.behavior).toContainKeys([
				"retryable",
				"financial_effect",
				"human_action",
				"agent_hint",
				"retry_after_s",
			]);
			expect(hints.has(definition.behavior.agent_hint)).toBe(true);
		}
	});

	test("custom definitions enforce contract shape", () => {
		expect(() =>
			defineErrorCode({
				code: "RESOURCE_LIMIT_EXCEEDED" as "SVC-CORE-1001",
				title: "resource_limit_exceeded",
				status: 409,
				category: "STATE_CONFLICT",
				detail_key: "core.resource_limit_exceeded",
				behavior: {
					retryable: "never",
					financial_effect: "none",
					human_action: "none",
					agent_hint: "NONE",
					retry_after_s: null,
				},
				emittable: true,
			}),
		).toThrow("SVC-<DOMAIN>-<NNNN>");
	});
});
