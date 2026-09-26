import { randomUUID } from "node:crypto";
import {
	type MerchantOffer,
	type MerchantSearchResult,
	merchantOfferSchema,
	type ProductSearchRequest,
} from "../domain/agents/contracts.js";
import {
	type UcpProduct,
	type UcpProfile,
	ucpCatalogResponseSchema,
	ucpProfileSchema,
} from "../domain/catalog.js";
import type { MerchantSearchAgent } from "../services/agents/ports/shopping-agent.js";

export type UcpCatalogOptions = Readonly<{
	merchantUrl: string;
	merchantId: string;
	agentProfileUrl: string;
	timeoutMs?: number;
	maxProducts?: number;
	fetcher?: UcpFetcher;
}>;

export type UcpFetcher = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;

type UcpService = Readonly<{
	endpoint: string;
	version: string;
}>;

type UcpSearchResponse = Readonly<{
	products: UcpProduct[];
	nextCursor?: string;
}>;

function normalizeBaseUrl(value: string): string {
	return new URL(value).toString().replace(/\/$/, "");
}

function getDescription(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (typeof value === "object" && value !== null && "plain" in value) {
		const plain = (value as { plain?: unknown }).plain;
		return typeof plain === "string" ? plain : undefined;
	}
	return undefined;
}

function getAvailability(value: unknown): MerchantOffer["availability"] {
	if (typeof value === "boolean") return value ? "in_stock" : "out_of_stock";
	if (typeof value !== "object" || value === null) return "unknown";
	const availability = value as Record<string, unknown>;
	if (availability.available === true) return "in_stock";
	if (availability.available === false) return "out_of_stock";
	if (typeof availability.quantity === "number") {
		return availability.quantity > 0 ? "limited" : "out_of_stock";
	}
	if (availability.status === "in_stock") return "in_stock";
	if (availability.status === "out_of_stock") return "out_of_stock";
	return "unknown";
}

function getPrice(product: UcpProduct) {
	const variant = product.variants[0];
	const price = variant?.price ?? product.price_range?.min;
	if (price === undefined) {
		throw new Error(`UCP product ${product.id} has no price`);
	}
	const currency = price.currency.toUpperCase();
	if (!/^[A-Z]{3}$/.test(currency)) {
		throw new Error(`UCP product ${product.id} has unsupported currency`);
	}
	return { amount: price.amount, currency };
}

export function normalizeUcpProduct(
	product: UcpProduct,
	options: { merchantId: string; sourceUrl: string; fetchedAt?: string },
): MerchantOffer {
	const variant = product.variants[0];
	const price = getPrice(product);
	const fetchedAt = options.fetchedAt ?? new Date().toISOString();
	const offerId = `${options.merchantId}:${product.id}:${variant?.id ?? product.id}`;
	const offer = {
		offerId,
		productId: product.id,
		merchantId: options.merchantId,
		title: product.title,
		description:
			getDescription(variant?.description) ??
			getDescription(product.description),
		priceMinor: price.amount,
		currency: price.currency,
		availability: getAvailability(variant?.availability),
		totalCostMinor: price.amount,
		url: product.url ?? options.sourceUrl,
		fetchedAt,
		source: "ucp" as const,
	};
	return merchantOfferSchema.parse(offer);
}

export class UcpCatalogClient implements MerchantSearchAgent {
	private readonly merchantUrl: string;
	private readonly merchantId: string;
	private readonly agentProfileUrl: string;
	private readonly timeoutMs: number;
	private readonly maxProducts: number;
	private readonly fetcher: UcpFetcher;
	private profilePromise: Promise<UcpProfile> | undefined;
	private servicePromise: Promise<UcpService> | undefined;

	constructor(options: UcpCatalogOptions) {
		this.merchantUrl = normalizeBaseUrl(options.merchantUrl);
		this.merchantId = options.merchantId;
		this.agentProfileUrl = options.agentProfileUrl;
		this.timeoutMs = options.timeoutMs ?? 10_000;
		this.maxProducts = options.maxProducts ?? 50;
		this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
		if (this.agentProfileUrl.length === 0) {
			throw new Error("UCP_AGENT_PROFILE_URL is required");
		}
		const profileUrl = new URL(this.agentProfileUrl);
		if (!profileUrl.pathname.replace(/\/$/, "").endsWith("/.well-known/ucp")) {
			throw new Error(
				"UCP_AGENT_PROFILE_URL must point to the /.well-known/ucp profile",
			);
		}
	}

	async discover(): Promise<UcpProfile> {
		this.profilePromise ??= this.fetchJson(
			`${this.merchantUrl}/.well-known/ucp`,
			ucpProfileSchema,
		);
		return this.profilePromise;
	}

	async search(request: ProductSearchRequest): Promise<MerchantSearchResult> {
		const response = await this.searchProducts(request.query, request.limit);
		const offers = response.products.map((product) =>
			normalizeUcpProduct(product, {
				merchantId: this.merchantId,
				sourceUrl: this.merchantUrl,
			}),
		);
		return { offers: offers.slice(0, request.limit) };
	}

	async searchProducts(
		query: string,
		limit = this.maxProducts,
	): Promise<UcpSearchResponse> {
		const service = await this.catalogService();
		const products: UcpProduct[] = [];
		let cursor: string | undefined;
		const boundedLimit = Math.min(limit, this.maxProducts);

		while (products.length < boundedLimit) {
			const body = {
				...(query.trim().length === 0 ? {} : { query: query.trim() }),
				pagination: {
					limit: Math.min(boundedLimit - products.length, 20),
					...(cursor ? { cursor } : {}),
				},
			};
			const response = await this.postJson(
				`${service.endpoint}/catalog/search`,
				body,
				ucpCatalogResponseSchema,
			);
			products.push(...response.products);
			const nextCursor =
				response.pagination?.next ??
				response.pagination?.next_cursor ??
				response.pagination?.cursor ??
				undefined;
			if (
				!nextCursor ||
				response.products.length === 0 ||
				response.pagination?.has_next_page === false
			)
				break;
			cursor = nextCursor;
		}

		return { products: products.slice(0, boundedLimit) };
	}

	private async catalogService(): Promise<UcpService> {
		this.servicePromise ??= this.resolveCatalogService();
		return this.servicePromise;
	}

	private async resolveCatalogService(): Promise<UcpService> {
		const profile = await this.discover();
		const services = profile.ucp.services["dev.ucp.shopping"] ?? [];
		const service = services.find(
			(candidate) => candidate.transport === "rest",
		);
		if (service === undefined) {
			throw new Error(
				"UCP merchant does not advertise a REST shopping service",
			);
		}
		const capabilities = profile.ucp.capabilities;
		if (capabilities["dev.ucp.shopping.catalog.search"] === undefined) {
			throw new Error("UCP merchant does not advertise catalog search");
		}
		const endpoint = new URL(service.endpoint);
		const merchant = new URL(this.merchantUrl);
		if (endpoint.origin !== merchant.origin) {
			throw new Error("UCP service endpoint must share the merchant origin");
		}
		return {
			endpoint: endpoint.toString().replace(/\/$/, ""),
			version: service.version,
		};
	}

	private async fetchJson<T>(
		url: string,
		schema: { parse(value: unknown): T },
	): Promise<T> {
		const response = await this.fetcher(url, {
			method: "GET",
			headers: { Accept: "application/json" },
			signal: AbortSignal.timeout(this.timeoutMs),
		});
		return this.parseResponse(response, schema);
	}

	private async postJson<T>(
		url: string,
		body: unknown,
		schema: { parse(value: unknown): T },
	): Promise<T> {
		const response = await this.fetcher(url, {
			method: "POST",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/json",
				"Request-Id": randomUUID(),
				"UCP-Agent": `profile="${this.agentProfileUrl}"`,
			},
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(this.timeoutMs),
		});
		return this.parseResponse(response, schema);
	}

	private async parseResponse<T>(
		response: Response,
		schema: { parse(value: unknown): T },
	): Promise<T> {
		const text = await response.text();
		let body: unknown;
		try {
			body = text.length === 0 ? null : JSON.parse(text);
		} catch {
			throw new Error("UCP merchant returned invalid JSON");
		}
		if (!response.ok) {
			throw new Error(`UCP merchant returned HTTP ${response.status}`);
		}
		return schema.parse(body);
	}
}
