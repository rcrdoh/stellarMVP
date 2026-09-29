/** Deterministic in-browser clients for the manual/localhost demo.
 *
 * WHY THIS EXISTS (SDD §4 blocker B1): `POST /v1/payment-intents` accepts only
 * `{ quoteId }`, and no HTTP endpoint creates quotes — they come from the agent
 * shopping graph which needs the full runtime (Redis/DB/LLM keys). Without that
 * runtime the cart → checkout flow has no `quoteId`, so it cannot complete
 * against the real API. These mocks let the UI run end-to-end locally.
 *
 * They are ONLY selected when the runtime is not wired (see `isMockMode` in
 * `main.tsx`); production always uses `createHttpClients`. */

import type { Offer } from "../types/domain.js";
import type {
	PaymentIntent,
	PaymentIntentStatus,
	PaymentReceipt,
} from "../types/payment.js";
import type { CatalogClient, PaymentClient } from "./api.js";
import { explorerUrl, usdcToStroops } from "./format.js";

const CATALOG: Offer[] = [
	{
		id: "off-headphones-01",
		title: "Aurora Wireless Headphones",
		merchant: "mrc-audio-hub",
		description: "Active noise cancellation, 40h battery, USB-C.",
		category: "electronics",
		price: 129.9,
		currency: "USD",
		inStock: true,
		matchScore: 0.98,
		url: "https://example.com/products/aurora-headphones",
	},
	{
		id: "off-keyboard-02",
		title: "LowProfile Mechanical Keyboard",
		merchant: "mrc-keyforge",
		description: "75% layout, hot-swappable, silent linears.",
		category: "electronics",
		price: 89.5,
		currency: "USD",
		inStock: true,
		matchScore: 0.91,
		url: "https://example.com/products/lowprofile-keyboard",
	},
	{
		id: "off-deskmat-03",
		title: "Merino Desk Mat",
		merchant: "mrc-workspace",
		description: "Non-slip, stain-resistant, 90x40cm.",
		category: "home-office",
		price: 45,
		currency: "USD",
		inStock: true,
		matchScore: 0.84,
		url: "https://example.com/products/merino-desk-mat",
	},
	{
		id: "off-lamp-04",
		title: "Halo Monitor Light Bar",
		merchant: "mrc-workspace",
		description: "Flicker-free, auto-dimming, USB powered.",
		category: "home-office",
		price: 62.25,
		currency: "USD",
		inStock: false,
		matchScore: 0.77,
		url: "https://example.com/products/halo-light-bar",
	},
	{
		id: "off-mug-05",
		title: "Ceramic Self-Heating Mug",
		merchant: "mrc-kitchen-lab",
		description: "Keeps coffee at 55°C, 12h battery, wireless pad.",
		category: "kitchen",
		price: 79,
		currency: "USD",
		inStock: true,
		matchScore: 0.72,
		url: "https://example.com/products/self-heating-mug",
	},
	{
		id: "off-backpack-06",
		title: "Transit Laptop Backpack 22L",
		merchant: "mrc-carry-on",
		description: "Water-resistant, TSA sleeve, cable organizer.",
		category: "accessories",
		price: 118,
		currency: "USD",
		inStock: true,
		matchScore: 0.68,
		url: "https://example.com/products/transit-backpack",
	},
];

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createMockCatalogClient(): CatalogClient {
	return {
		async search(request) {
			await delay(420);
			const query = (request.queryText ?? "").trim().toLowerCase();
			return CATALOG.filter((offer) => {
				if (request.category && offer.category !== request.category) {
					return false;
				}
				if (request.maxPrice !== undefined && offer.price > request.maxPrice) {
					return false;
				}
				if (query.length === 0) {
					return true;
				}
				return `${offer.title} ${offer.description} ${offer.merchant}`
					.toLowerCase()
					.includes(query);
			}).slice(0, request.limit ?? 12);
		},
	};
}

const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
const TESTNET_USDC_ISSUER =
	"GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";
const MOCK_PAYER = "GA7FYRB5VREZKOBIIKHG5AVTPFGWUBPOBTW6M7PG7NQFXBMCEIYF5XAY";
const MOCK_AMOUNT_USD = 129.9;

/** State machine that mirrors the backend's `awaiting_signature → submitted →
 * confirmed` progression so the UI stepper can be exercised locally. */
export function createMockPaymentClient(): PaymentClient {
	const intents = new Map<string, PaymentIntent>();

	function materialize(intentId: string): PaymentIntent {
		const intent = intents.get(intentId);
		if (!intent) {
			throw new Error(`Unknown payment intent ${intentId}`);
		}
		return intent;
	}

	function setStatus(intentId: string, status: PaymentIntentStatus): void {
		const intent = materialize(intentId);
		intent.status = status;
		intent.updatedAt = new Date().toISOString();
	}

	return {
		async createIntent(quoteId) {
			await delay(360);
			if (quoteId.trim().length === 0) {
				throw new Error("quoteId is required to create a payment intent");
			}
			const intentId = crypto.randomUUID();
			const now = new Date().toISOString();
			const intent: PaymentIntent = {
				intentId,
				quoteId,
				orderId: `order-${intentId.slice(0, 8)}`,
				principalId: "principal-demo",
				quoteHash: `hash-${quoteId.slice(0, 12)}`,
				idempotencyKey: crypto.randomUUID(),
				requestFingerprint: `fp-${intentId.slice(0, 12)}`,
				status: "awaiting_signature",
				networkPassphrase: NETWORK_PASSPHRASE,
				payerAddress: MOCK_PAYER,
				assetCode: "USDC",
				assetIssuer: TESTNET_USDC_ISSUER,
				assetDecimals: 7,
				totalAmountAtomic: usdcToStroops(MOCK_AMOUNT_USD),
				unsignedXdr: `AAAA_MOCK_UNSIGNED_XDR_${intentId}`,
				expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
				createdAt: now,
				updatedAt: now,
			};
			intents.set(intentId, intent);
			return { ...intent };
		},

		async submitIntent(intentId, signedXdr) {
			await delay(600);
			if (signedXdr.trim().length === 0) {
				throw new Error("signedXdr is required to submit a payment intent");
			}
			setStatus(intentId, "submitting");
			await delay(400);
			const hash = `mocktx${intentId.replace(/-/g, "").slice(0, 20)}`;
			const intent = materialize(intentId);
			intent.transactionHash = hash;
			intent.ledger = 1893421;
			setStatus(intentId, "confirmed");
			return { ...intent };
		},

		async reconcile(intentId) {
			await delay(300);
			const intent = materialize(intentId);
			const hash = intent.transactionHash ?? "mocktx-pending";
			const receipt: PaymentReceipt = {
				intentId,
				orderId: intent.orderId,
				status: intent.status === "confirmed" ? "paid" : "submitted",
				transactionHash: hash,
				ledger: intent.ledger,
				amountAtomic: intent.totalAmountAtomic,
				assetCode: intent.assetCode,
				payerAddress: intent.payerAddress,
				networkPassphrase: intent.networkPassphrase,
				confirmedAt:
					intent.status === "confirmed" ? new Date().toISOString() : undefined,
				updatedAt: new Date().toISOString(),
				stellarExpertUrl:
					intent.status === "confirmed"
						? explorerUrl("testnet", hash)
						: undefined,
			};
			return receipt;
		},
	};
}
