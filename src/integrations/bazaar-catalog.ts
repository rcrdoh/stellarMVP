import {
	type MerchantOffer,
	type MerchantSearchResult,
	merchantOfferSchema,
	type ProductSearchRequest,
} from "../domain/agents/contracts.js";
import { type BazaarResource, bazaarCatalogSchema } from "../domain/catalog.js";
import type { MerchantSearchAgent } from "../services/agents/ports/shopping-agent.js";

export type BazaarCatalogOptions = Readonly<{
	merchantUrl: string;
	catalogUrl?: string;
	merchantId: string;
	timeoutMs?: number;
	maxProducts?: number;
	fetcher?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}>;

function normalizeBaseUrl(value: string): string {
	return new URL(value).toString().replace(/\/$/, "");
}

function toSearchText(resource: BazaarResource): string {
	return [
		resource.name,
		resource.summary ?? "",
		resource.category ?? "",
		...(resource.tags ?? []),
	].join(" ");
}

export function normalizeBazaarResource(
	resource: BazaarResource,
	options: { merchantId: string; merchantUrl: string; fetchedAt?: string },
): MerchantOffer {
	const fetchedAt = options.fetchedAt ?? new Date().toISOString();
	if (resource.priceUsdc === undefined) {
		throw new Error(`Bazaar resource ${resource.name} has no USD price`);
	}
	const priceMinor = Math.round(resource.priceUsdc * 100);
	const paymentTerms = (resource.accepts ?? []).map((term) => ({
		scheme: term.scheme,
		network: term.network,
		amount: term.amount,
		payTo: term.payTo,
		...(term.asset === undefined ? {} : { asset: term.asset }),
		...(term.maxTimeoutSeconds === undefined
			? {}
			: { maxTimeoutSeconds: term.maxTimeoutSeconds }),
		...(term.extra === undefined ? {} : { extra: term.extra }),
		resource: term.resource ?? resource.url,
	}));
	return merchantOfferSchema.parse({
		offerId: `${options.merchantId}:${resource.name}`,
		productId: resource.name,
		merchantId: options.merchantId,
		title: resource.name,
		description: resource.summary,
		priceMinor,
		currency: "USD",
		availability: "in_stock",
		totalCostMinor: priceMinor,
		url: resource.url || options.merchantUrl,
		fetchedAt,
		source: "catalog",
		...(paymentTerms.length === 0 ? {} : { paymentTerms }),
	});
}

export class BazaarCatalogClient implements MerchantSearchAgent {
	private readonly merchantUrl: string;
	private readonly catalogUrl: string;
	private readonly merchantId: string;
	private readonly timeoutMs: number;
	private readonly maxProducts: number;
	private readonly fetcher: NonNullable<BazaarCatalogOptions["fetcher"]>;
	private catalogPromise:
		| Promise<ReturnType<typeof bazaarCatalogSchema.parse>>
		| undefined;

	constructor(options: BazaarCatalogOptions) {
		this.merchantUrl = normalizeBaseUrl(options.merchantUrl);
		this.catalogUrl = options.catalogUrl ?? `${this.merchantUrl}/bazaar.json`;
		this.merchantId = options.merchantId;
		this.timeoutMs = options.timeoutMs ?? 10_000;
		this.maxProducts = options.maxProducts ?? 50;
		this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init));
	}

	async search(request: ProductSearchRequest): Promise<MerchantSearchResult> {
		const catalog = await this.loadCatalog();
		const query = request.query.trim().toLowerCase();
		const resources = catalog.resources
			.filter((resource) =>
				query.length === 0
					? true
					: toSearchText(resource).toLowerCase().includes(query),
			)
			.slice(0, Math.min(request.limit, this.maxProducts));
		return {
			offers: resources.map((resource) =>
				normalizeBazaarResource(resource, {
					merchantId: this.merchantId,
					merchantUrl: this.merchantUrl,
				}),
			),
		};
	}

	private async loadCatalog() {
		this.catalogPromise ??= this.fetchCatalog();
		return this.catalogPromise;
	}

	private async fetchCatalog() {
		const response = await this.fetcher(this.catalogUrl, {
			method: "GET",
			headers: { Accept: "application/json" },
			signal: AbortSignal.timeout(this.timeoutMs),
		});
		const text = await response.text();
		if (!response.ok) {
			throw new Error(`Bazaar catalog returned HTTP ${response.status}`);
		}
		let body: unknown;
		try {
			body = JSON.parse(text);
		} catch {
			throw new Error("Bazaar catalog returned invalid JSON");
		}
		return bazaarCatalogSchema.parse(body);
	}
}
