/** HTTP clients for the ACP x402 backend.
 *
 * Contract is taken from `specs/openapi.json` (backend wins over the SDD):
 * - `POST /v1/agent/catalog/search` → single JSON `{ results, count, fallback }`.
 *   (Not streamed; no phase events.)
 * - `POST /v1/payment-intents` → body `{ quoteId }` ONLY. The backend derives
 *   amounts from an approved quote; there is no HTTP endpoint to create quotes.
 * - `POST /v1/payment-intents/{intentId}/submission` → body `{ signedXdr }`.
 * - `POST /v1/payment-intents/{intentId}/reconcile` → optional `{ transactionHash }`.
 *
 * Auth: `/v1/agent/*` needs a bearer agent token; payment routes need a bearer
 * service token plus `x-principal-id` (and `Idempotency-Key` on create). A
 * browser cannot safely hold those, so the app talks to `ApiClient` and the
 * deployment supplies an accessor (see `AuthProvider`). */

import type { Offer } from "../types/domain.js";
import type { PaymentIntent, PaymentReceipt } from "../types/payment.js";
import type { ProblemDetails } from "../types/problem.js";

export class ApiError extends Error {
	readonly problem: ProblemDetails;
	constructor(problem: ProblemDetails) {
		super(problem.title);
		this.name = "ApiError";
		this.problem = problem;
	}
}

export type CatalogSearchRequest = {
	queryText?: string | undefined;
	category?: string | undefined;
	maxPrice?: number | undefined;
	minScore?: number | undefined;
	limit?: number | undefined;
};

export type CatalogClient = {
	search(request: CatalogSearchRequest): Promise<Offer[]>;
};

export type PaymentClient = {
	createIntent(quoteId: string): Promise<PaymentIntent>;
	submitIntent(intentId: string, signedXdr: string): Promise<PaymentIntent>;
	reconcile(
		intentId: string,
		transactionHash?: string,
	): Promise<PaymentReceipt>;
};

const DEFAULT_MIN_SCORE = 0.6;
const DEFAULT_LIMIT = 12;

type MerchantProduct = {
	id: string;
	merchantId: string;
	title: string;
	description: string;
	price: number;
	currency?: string;
	category?: string;
	inStock?: boolean;
	url?: string;
	image?: string;
	score?: number;
};

type CatalogSearchResponse = {
	results: MerchantProduct[];
	count: number;
	fallback?: boolean;
};

/** Maps a `MerchantProduct` to the UI `Offer`. */
export function toOffer(product: MerchantProduct): Offer {
	return {
		id: product.id,
		title: product.title,
		merchant: product.merchantId,
		description: product.description,
		category: product.category ?? "general",
		price: product.price,
		currency: product.currency ?? "USD",
		inStock: product.inStock ?? true,
		matchScore: product.score ?? 0,
		url: product.url ?? "",
		image: product.image,
	};
}

async function readProblem(response: Response): Promise<ProblemDetails> {
	try {
		const body = (await response.json()) as Partial<ProblemDetails>;
		return {
			type: body.type ?? "about:blank",
			title: body.title ?? response.statusText,
			status: body.status ?? response.status,
			code: body.code ?? `HTTP-${response.status}`,
			category: body.category ?? "INTERNAL",
			detail_key: body.detail_key,
			behavior: body.behavior,
			correlation: body.correlation,
			occurred_at: body.occurred_at,
		};
	} catch {
		return {
			type: "about:blank",
			title: response.statusText || "Request failed",
			status: response.status,
			code: `HTTP-${response.status}`,
			category: "INTERNAL",
		};
	}
}

export type HttpClientsOptions = {
	baseUrl?: string | undefined;
	/** Bearer token for `/v1/agent/*` (scope `agent:search`). */
	agentToken?: string | undefined;
	/** Bearer service token for `/v1/payment-intents*`. */
	serviceToken?: string | undefined;
	/** Principal bound to payment intents (`x-principal-id`). */
	principalId?: string | undefined;
	fetchImpl?: typeof fetch | undefined;
};

/** Real HTTP implementation. Header/body shapes follow the OpenAPI spec. */
export function createHttpClients(options: HttpClientsOptions = {}): {
	catalog: CatalogClient;
	payments: PaymentClient;
} {
	const baseUrl = options.baseUrl ?? "";
	const fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);

	async function json<T>(path: string, init: RequestInit): Promise<T> {
		const response = await fetchImpl(`${baseUrl}${path}`, init);
		if (!response.ok) {
			throw new ApiError(await readProblem(response));
		}
		return (await response.json()) as T;
	}

	const catalog: CatalogClient = {
		async search(request) {
			const payload: CatalogSearchRequest = {
				queryText: request.queryText,
				category: request.category,
				maxPrice: request.maxPrice,
				minScore: request.minScore ?? DEFAULT_MIN_SCORE,
				limit: request.limit ?? DEFAULT_LIMIT,
			};
			const body = await json<CatalogSearchResponse>(
				"/v1/agent/catalog/search",
				{
					method: "POST",
					headers: {
						"content-type": "application/json",
						...(options.agentToken
							? { authorization: `Bearer ${options.agentToken}` }
							: {}),
					},
					body: JSON.stringify(payload),
				},
			);
			return (body.results ?? []).map(toOffer);
		},
	};

	function paymentHeaders(
		extra?: Record<string, string>,
	): Record<string, string> {
		return {
			"content-type": "application/json",
			...(options.serviceToken
				? { authorization: `Bearer ${options.serviceToken}` }
				: {}),
			...(options.principalId ? { "x-principal-id": options.principalId } : {}),
			...extra,
		};
	}

	const payments: PaymentClient = {
		async createIntent(quoteId) {
			return json<PaymentIntent>("/v1/payment-intents", {
				method: "POST",
				headers: paymentHeaders({
					"idempotency-key": crypto.randomUUID(),
				}),
				body: JSON.stringify({ quoteId }),
			});
		},
		async submitIntent(intentId, signedXdr) {
			return json<PaymentIntent>(
				`/v1/payment-intents/${encodeURIComponent(intentId)}/submission`,
				{
					method: "POST",
					headers: paymentHeaders(),
					body: JSON.stringify({ signedXdr }),
				},
			);
		},
		async reconcile(intentId, transactionHash) {
			return json<PaymentReceipt>(
				`/v1/payment-intents/${encodeURIComponent(intentId)}/reconcile`,
				{
					method: "POST",
					headers: paymentHeaders(),
					body: JSON.stringify(transactionHash ? { transactionHash } : {}),
				},
			);
		},
	};

	return { catalog, payments };
}
