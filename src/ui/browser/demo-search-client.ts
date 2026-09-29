import type {
	ProblemDetails,
	ProductSearchClient,
} from "../components/product-stream.js";
import type { ProductOffer } from "../stores/cart-store.js";

/**
 * Catalog returned by the demo client. It keeps the browser shell runnable with
 * no backend, credentials, or LLM providers, so `bun run ui:dev` works out of
 * the box. Replace it by injecting a real `ProductSearchClient` at the
 * composition root when the agentic search endpoint is available.
 */
const DEMO_CATALOG: readonly ProductOffer[] = [
	{
		id: "coffee-1kg",
		title: "Cafe tostado 1 kg",
		price: 42.5,
		currency: "USDC",
		merchant: "tostaduria.local",
		score: 0.94,
	},
	{
		id: "yerba-500g",
		title: "Yerba mate 500 g",
		price: 12,
		currency: "USDC",
		merchant: "herbolario.local",
		score: 0.88,
	},
	{
		id: "keyboard-60",
		title: "Teclado mecanico 60%",
		price: 89,
		currency: "USDC",
		merchant: "peripherals.dev",
		score: 0.81,
	},
	{
		id: "monitor-27",
		title: "Monitor 27 pulgadas 144 Hz",
		price: 259,
		currency: "USDC",
		merchant: "displays.shop",
		score: 0.76,
	},
];

/**
 * In-memory `ProductSearchClient`. Matches the query against title and merchant
 * and streams a single batch, mirroring the shape of the agentic search stream
 * without requiring the vector catalog to be running.
 */
export function createDemoSearchClient(): ProductSearchClient {
	return {
		async *search(query: string): AsyncIterable<readonly ProductOffer[]> {
			const needle = query.trim().toLowerCase();
			const matches = DEMO_CATALOG.filter(
				(offer) =>
					needle.length === 0 ||
					offer.title.toLowerCase().includes(needle) ||
					offer.merchant.toLowerCase().includes(needle),
			);
			yield matches;
		},
	};
}

/**
 * Maps a thrown error to an RFC 9457 problem so the stream can render the same
 * error panel the API uses. Kept here so the UI layer stays transport-agnostic.
 */
export function toProblem(error: unknown): ProblemDetails {
	return {
		status: 500,
		title: "search_failed",
		code: "SVC-CORE-5000",
		detail: error instanceof Error ? error.message : String(error),
	};
}
