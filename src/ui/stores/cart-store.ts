/**
 * Candidate product shown to the shopper. It is a UI-level snapshot: once a
 * card is added to the cart the store freezes a copy so later search streams
 * cannot mutate an already-selected offer.
 */
export interface ProductOffer {
	readonly id: string;
	readonly title: string;
	readonly price: number;
	readonly currency: string;
	readonly merchant: string;
	readonly score: number;
}

export interface CartSnapshot {
	readonly items: readonly ProductOffer[];
	readonly isOpen: boolean;
	readonly subtotal: number;
}

/**
 * Framework-agnostic observable cart. Extends the native `EventTarget` so the
 * DOM layer can subscribe with `addEventListener("cart-updated", ...)` without
 * pulling in a state library or framework runtime.
 */
export class CartStore extends EventTarget {
	#items: ProductOffer[] = [];
	#isOpen = false;

	get items(): readonly ProductOffer[] {
		return this.#items;
	}

	get isOpen(): boolean {
		return this.#isOpen;
	}

	get size(): number {
		return this.#items.length;
	}

	get subtotal(): number {
		return this.#items.reduce((total, item) => total + item.price, 0);
	}

	add(item: ProductOffer): void {
		this.#items = [...this.#items, Object.freeze({ ...item })];
		this.#isOpen = true;
		this.#notify();
	}

	remove(id: string): void {
		this.#items = this.#items.filter((item) => item.id !== id);
		this.#notify();
	}

	clear(): void {
		this.#items = [];
		this.#notify();
	}

	open(): void {
		if (this.#isOpen) {
			return;
		}
		this.#isOpen = true;
		this.#notify();
	}

	close(): void {
		if (!this.#isOpen) {
			return;
		}
		this.#isOpen = false;
		this.#notify();
	}

	toggle(): void {
		this.#isOpen = !this.#isOpen;
		this.#notify();
	}

	snapshot(): CartSnapshot {
		return {
			items: this.#items,
			isOpen: this.#isOpen,
			subtotal: this.subtotal,
		};
	}

	#notify(): void {
		this.dispatchEvent(
			new CustomEvent<CartSnapshot>("cart-updated", {
				detail: this.snapshot(),
			}),
		);
	}
}
