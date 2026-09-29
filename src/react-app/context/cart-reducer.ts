/** Pure cart reducer (no React). Quantities are keyed by offer id and the
 * offer snapshot is cloned + frozen so a later search cannot mutate a line
 * already in the cart (mirrors the legacy `CartStore` behaviour). */

import type { CartItem, CartLine, Offer } from "../types/domain.js";

export type CartState = {
	lines: CartLine[];
	/** Offer snapshots captured when each line was added. */
	offers: Record<string, Offer>;
	isOpen: boolean;
};

export const emptyCart: CartState = { lines: [], offers: {}, isOpen: false };

export type CartAction =
	| { type: "add"; offer: Offer; quantity?: number }
	| { type: "remove"; offerId: string }
	| { type: "setQuantity"; offerId: string; quantity: number }
	| { type: "clear" }
	| { type: "open" }
	| { type: "close" }
	| { type: "toggle" };

function frozenOffer(offer: Offer): Offer {
	return Object.freeze({ ...offer });
}

export function cartReducer(state: CartState, action: CartAction): CartState {
	switch (action.type) {
		case "add": {
			const quantity = action.quantity ?? 1;
			const offers = {
				...state.offers,
				[action.offer.id]: frozenOffer(action.offer),
			};
			const existing = state.lines.find(
				(line) => line.offerId === action.offer.id,
			);
			const lines = existing
				? state.lines.map((line) =>
						line.offerId === action.offer.id
							? { ...line, quantity: line.quantity + quantity }
							: line,
					)
				: [...state.lines, { offerId: action.offer.id, quantity }];
			return { lines, offers, isOpen: true };
		}
		case "remove":
			return {
				...state,
				lines: state.lines.filter((line) => line.offerId !== action.offerId),
			};
		case "setQuantity": {
			if (action.quantity <= 0) {
				return {
					...state,
					lines: state.lines.filter((line) => line.offerId !== action.offerId),
				};
			}
			return {
				...state,
				lines: state.lines.map((line) =>
					line.offerId === action.offerId
						? { ...line, quantity: action.quantity }
						: line,
				),
			};
		}
		case "clear":
			return { lines: [], offers: {}, isOpen: false };
		case "open":
			return { ...state, isOpen: true };
		case "close":
			return { ...state, isOpen: false };
		case "toggle":
			return { ...state, isOpen: !state.isOpen };
	}
}

/** Joins lines with their frozen offer snapshots, dropping orphans. */
export function cartItems(state: CartState): CartItem[] {
	const items: CartItem[] = [];
	for (const line of state.lines) {
		const offer = state.offers[line.offerId];
		if (offer !== undefined) {
			items.push({ line, offer });
		}
	}
	return items;
}

export function cartItemCount(state: CartState): number {
	return state.lines.reduce((total, line) => total + line.quantity, 0);
}

export function cartSubtotalUsd(state: CartState): number {
	return cartItems(state).reduce(
		(total, item) => total + item.offer.price * item.line.quantity,
		0,
	);
}

export function cartTotalUsd(state: CartState): number {
	return cartSubtotalUsd(state);
}
