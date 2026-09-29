import { describe, expect, test } from "bun:test";
import {
	type CartState,
	cartItemCount,
	cartItems,
	cartReducer,
	cartSubtotalUsd,
	emptyCart,
} from "../src/react-app/context/cart-reducer.js";
import type { Offer } from "../src/react-app/types/domain.js";

function offer(id: string, price: number): Offer {
	return {
		id,
		title: `Offer ${id}`,
		merchant: `merchant-${id}`,
		description: `Description ${id}`,
		category: "demo",
		price,
		currency: "USDC",
		inStock: true,
		matchScore: 1,
		url: `https://example.test/${id}`,
		image: undefined,
	};
}

describe("react cart reducer", () => {
	test("adds a new line, freezes the offer snapshot and opens the cart", () => {
		const source = offer("a", 10);
		const state = cartReducer(emptyCart, { type: "add", offer: source });

		expect(state.lines).toEqual([{ offerId: "a", quantity: 1 }]);
		expect(state.isOpen).toBe(true);
		expect(Object.isFrozen(state.offers.a)).toBe(true);
		// Mutating the original search result must not affect the snapshot.
		source.price = 999;
		expect(state.offers.a?.price).toBe(10);
	});

	test("increments quantity when the same offer is added again", () => {
		const once = cartReducer(emptyCart, {
			type: "add",
			offer: offer("a", 10),
			quantity: 2,
		});
		const twice = cartReducer(once, {
			type: "add",
			offer: offer("a", 10),
			quantity: 3,
		});

		expect(twice.lines).toEqual([{ offerId: "a", quantity: 5 }]);
		expect(cartItemCount(twice)).toBe(5);
	});

	test("setQuantity to zero or below removes the line", () => {
		const added = cartReducer(emptyCart, {
			type: "add",
			offer: offer("a", 10),
		});
		const removed = cartReducer(added, {
			type: "setQuantity",
			offerId: "a",
			quantity: 0,
		});

		expect(removed.lines).toEqual([]);
	});

	test("computes subtotal and total from line quantities", () => {
		let state: CartState = cartReducer(emptyCart, {
			type: "add",
			offer: offer("a", 10),
			quantity: 2,
		});
		state = cartReducer(state, {
			type: "add",
			offer: offer("b", 5),
			quantity: 3,
		});

		expect(cartSubtotalUsd(state)).toBe(35);
	});

	test("drops orphan lines that have no offer snapshot", () => {
		const orphaned: CartState = {
			lines: [{ offerId: "missing", quantity: 1 }],
			offers: {},
			isOpen: false,
		};

		expect(cartItems(orphaned)).toEqual([]);
		expect(cartSubtotalUsd(orphaned)).toBe(0);
	});

	test("clear resets lines, offers and open state", () => {
		const added = cartReducer(emptyCart, {
			type: "add",
			offer: offer("a", 10),
		});
		const cleared = cartReducer(added, { type: "clear" });

		expect(cleared).toEqual(emptyCart);
	});

	test("toggle flips the open state", () => {
		expect(cartReducer(emptyCart, { type: "toggle" }).isOpen).toBe(true);
		expect(cartReducer(emptyCart, { type: "close" }).isOpen).toBe(false);
	});
});
