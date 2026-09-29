import {
	createContext,
	type ReactNode,
	useContext,
	useMemo,
	useReducer,
} from "react";
import type { CartItem } from "../types/domain.js";
import {
	type CartAction,
	type CartState,
	cartItemCount,
	cartItems,
	cartReducer,
	cartSubtotalUsd,
	cartTotalUsd,
	emptyCart,
} from "./cart-reducer.js";

type CartContextValue = {
	state: CartState;
	items: CartItem[];
	itemCount: number;
	subtotalUsd: number;
	totalUsd: number;
	dispatch(action: CartAction): void;
};

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({
	children,
	initial = emptyCart,
}: {
	children: ReactNode;
	initial?: CartState;
}) {
	const [state, dispatch] = useReducer(cartReducer, initial);
	const value = useMemo<CartContextValue>(
		() => ({
			state,
			items: cartItems(state),
			itemCount: cartItemCount(state),
			subtotalUsd: cartSubtotalUsd(state),
			totalUsd: cartTotalUsd(state),
			dispatch,
		}),
		[state],
	);
	return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
	const value = useContext(CartContext);
	if (value === null) {
		throw new Error("useCart must be used inside <CartProvider>");
	}
	return value;
}
