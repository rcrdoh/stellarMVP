import { z } from "zod";
import type { ShoppingDecisionProvider } from "../../services/agents/ports/shopping-agent.js";

const answerSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("choice"),
		choice: z.string(),
		confidence: z.number().min(0).max(1),
		probabilities: z.record(z.string(), z.number().min(0).max(1)),
	}),
	z.object({ type: z.literal("noul"), noul: z.number().min(0).max(1) }),
]);

const systemOneResponseSchema = z.object({
	model: z.string().min(1),
	answers: z.record(z.string(), answerSchema),
	usage: z.object({
		input_tokens: z.number().int().nonnegative(),
		output_tokens: z.number().int().nonnegative(),
	}),
});

const routeChoices = ["llm", "rag", "clarify", "reject"] as const;
const domainChoices = ["in_domain", "out_of_domain", "ambiguous"] as const;
const riskChoices = ["low", "medium", "high", "critical"] as const;

export type TypesafeJevConfig = {
	apiKey: string;
	baseUrl: string;
	model: string;
	timeoutMs?: number;
	fetchImpl?: typeof fetch;
};

export class TypesafeJevDecisionProvider implements ShoppingDecisionProvider {
	private readonly fetchImpl: typeof fetch;

	constructor(private readonly config: TypesafeJevConfig) {
		this.fetchImpl = config.fetchImpl ?? fetch;
	}

	async assess(input: { message: string }) {
		if (!this.config.apiKey) throw new Error("Jev API is not configured");
		const response = await this.fetchImpl(
			`${this.config.baseUrl.replace(/\/$/, "")}/v1/systemone`,
			{
				method: "POST",
				headers: {
					authorization: `Bearer ${this.config.apiKey}`,
					"content-type": "application/json",
				},
				signal: AbortSignal.timeout(this.config.timeoutMs ?? 8_000),
				body: JSON.stringify({
					model: this.config.model,
					state: { user_message: input.message },
					questions: {
						domain: {
							type: "choice",
							instructions:
								"Classify whether the request concerns finding or buying products.",
							criteria: {
								in_domain: "Product discovery or shopping assistance.",
								out_of_domain:
									"Clearly unrelated to shopping or product discovery.",
								ambiguous:
									"The request is unclear or cannot be classified safely.",
							},
						},
						route: {
							type: "choice",
							instructions:
								"Choose whether to search merchants, answer without search, clarify, or reject.",
							criteria: {
								rag: "Current merchant offers are needed to answer the request.",
								llm: "A general shopping explanation can be answered without current offers.",
								clarify:
									"Required shopping constraints are unclear or missing.",
								reject: "The request is unsafe or should not be handled.",
							},
						},
						risk: {
							type: "choice",
							instructions:
								"Rate the risk of responding to this shopping request.",
							criteria: Object.fromEntries(
								riskChoices.map((choice) => [choice, choice]),
							),
						},
						evidence_sufficient: {
							type: "noul",
							instructions:
								"Is the current request sufficiently clear to search or answer without guessing user constraints?",
							criteria: {
								true: "The request provides enough detail for its selected route.",
								false: "A material product constraint or intent is unclear.",
							},
						},
						requires_escalation: {
							type: "noul",
							instructions:
								"Does responding require human review before any purchase or financial action?",
							criteria: {
								true: "A human must review before continuing.",
								false:
									"Only read-only discovery or a non-transactional answer is needed.",
							},
						},
					},
				}),
			},
		);
		if (!response.ok) {
			throw new Error(`Jev API returned HTTP ${response.status}`);
		}
		const payload = systemOneResponseSchema.parse(await response.json());
		const domain = payload.answers.domain;
		const route = payload.answers.route;
		const risk = payload.answers.risk;
		const evidence = payload.answers.evidence_sufficient;
		const escalation = payload.answers.requires_escalation;
		if (
			domain?.type !== "choice" ||
			!domainChoices.includes(
				domain.choice as (typeof domainChoices)[number],
			) ||
			route?.type !== "choice" ||
			!routeChoices.includes(route.choice as (typeof routeChoices)[number]) ||
			risk?.type !== "choice" ||
			!riskChoices.includes(risk.choice as (typeof riskChoices)[number]) ||
			evidence?.type !== "noul" ||
			escalation?.type !== "noul"
		) {
			throw new Error(
				"Jev API response did not match the shopping decision contract",
			);
		}
		return {
			provider: "typesafe-jev",
			domain: domain.choice as (typeof domainChoices)[number],
			routeHint: route.choice as (typeof routeChoices)[number],
			allowedRoutes: [route.choice as (typeof routeChoices)[number]],
			domainConfidence: domain.confidence,
			routeConfidence: route.confidence,
			riskLevel: risk.choice as (typeof riskChoices)[number],
			evidenceSufficient: evidence.noul >= 0.5,
			requiresEscalation: escalation.noul >= 0.5,
			modelVersion: payload.model,
		};
	}
}
