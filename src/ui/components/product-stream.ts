import { requireElement } from "../dom.js";
import type { CartStore, ProductOffer } from "../stores/cart-store.js";
import { createProductCard } from "./product-card.js";
import { createProductGridSkeleton } from "./skeleton.js";

/** RFC 9457 `application/problem+json` shape the API returns on failure. */
export interface ProblemDetails {
	readonly type?: string;
	readonly title?: string;
	readonly status?: number;
	readonly code?: string;
	readonly detail?: string;
}

/** Port the stream depends on so the UI never imports the HTTP layer directly. */
export interface ProductSearchClient {
	search(
		query: string,
		signal?: AbortSignal,
	): AsyncIterable<readonly ProductOffer[]>;
}

export interface ProductStreamOptions {
	readonly client: ProductSearchClient;
	readonly cartStore: CartStore;
	/** Maps a thrown error to an RFC 9457 problem; defaults to a generic one. */
	readonly toProblem?: (error: unknown) => ProblemDetails;
}

export interface ProductStream {
	readonly element: HTMLElement;
	/** Runs a search, streaming candidate batches into the grid. */
	search(query: string): Promise<void>;
	/** Cancels any in-flight search and clears the grid. */
	reset(): void;
}

/**
 * Search controls + streamable candidate grid. Owns an `AbortController` so a
 * new query cancels the previous stream, and renders loading skeletons while
 * waiting for the first batch and RFC 9457 details on failure.
 */
export function createProductStream(
	options: ProductStreamOptions,
): ProductStream {
	const container = document.createElement("section");
	container.className = "w-full space-y-4";

	container.innerHTML = `
		<form class="flex gap-2" data-role="search-form">
			<input
				type="search"
				name="query"
				placeholder="Search products..."
				class="flex-1 px-4 py-2 bg-gray-800 border border-gray-700 rounded-lg text-gray-100 text-sm focus:outline-none focus:border-emerald-500"
			/>
			<button type="submit" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition">
				Search
			</button>
		</form>
		<div class="product-results"></div>
	`;

	const form = requireElement<HTMLFormElement>(
		container,
		'[data-role="search-form"]',
	);
	const input = requireElement<HTMLInputElement>(form, 'input[name="query"]');
	const results = requireElement<HTMLElement>(container, ".product-results");

	let controller: AbortController | null = null;

	const renderMessage = (problem: ProblemDetails): void => {
		const status = problem.status ?? 500;
		const title = problem.title ?? "request_failed";
		const detail = problem.detail ?? "The search could not be completed.";
		const code = problem.code ?? "unknown";

		results.replaceChildren();
		const box = document.createElement("div");
		box.className =
			"p-4 rounded-lg border border-red-800/70 bg-red-950/50 text-red-200 text-sm";
		box.dataset.role = "problem";
		const heading = document.createElement("p");
		heading.className = "font-semibold";
		heading.textContent = `${status} · ${title}`;
		const body = document.createElement("p");
		body.className = "text-xs mt-1 opacity-90";
		body.textContent = `${detail} (${code})`;
		box.append(heading, body);
		results.append(box);
	};

	const runSearch = async (query: string): Promise<void> => {
		const trimmed = query.trim();
		if (trimmed.length === 0) {
			results.replaceChildren();
			return;
		}

		controller?.abort();
		controller = new AbortController();
		const signal = controller.signal;

		results.replaceChildren(createProductGridSkeleton());
		const grid = document.createElement("div");
		grid.className = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4";
		let received = false;

		try {
			for await (const batch of options.client.search(trimmed, signal)) {
				if (signal.aborted) {
					return;
				}
				if (!received) {
					results.replaceChildren(grid);
					received = true;
				}
				for (const offer of batch) {
					grid.append(createProductCard(offer, options.cartStore));
				}
			}
			if (!received) {
				results.replaceChildren(createEmptyState());
			}
		} catch (error) {
			if (signal.aborted) {
				return;
			}
			renderMessage(
				options.toProblem?.(error) ?? {
					status: 500,
					title: "search_failed",
					code: "SVC-CORE-5000",
					detail: error instanceof Error ? error.message : String(error),
				},
			);
		}
	};

	form.addEventListener("submit", (event) => {
		event.preventDefault();
		void runSearch(input.value);
	});

	return {
		element: container,
		search: runSearch,
		reset(): void {
			controller?.abort();
			controller = null;
			input.value = "";
			results.replaceChildren();
		},
	};
}

function createEmptyState(): HTMLElement {
	const empty = document.createElement("p");
	empty.className = "text-sm text-gray-400 py-6 text-center";
	empty.dataset.role = "empty";
	empty.textContent = "No matching products found.";
	return empty;
}
