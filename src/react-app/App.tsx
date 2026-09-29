import { CartDrawer } from "./components/cart-drawer.js";
import { CheckoutProgress } from "./components/checkout-progress.js";
import { Header } from "./components/header.js";
import { CartProvider, useCart } from "./context/cart-context.js";
import {
	type ClientBundle,
	ClientProvider,
	useClients,
	useWalletState,
} from "./context/client-context.js";
import { useCheckoutController } from "./context/use-checkout.js";
import { CatalogView } from "./views/catalog-view.js";

/** Shell wiring the header, catalog, cart and checkout.
 *
 * Blocker B1: in mock mode the checkout synthesizes a local quote id; against a
 * real backend the approved `quoteId` must be supplied by the agent flow. The
 * input below is how a real integrator pastes that approved quote. */
function AppShell() {
	const clients = useClients();
	const wallet = useWalletState(clients.wallet);
	const cart = useCart();
	const checkout = useCheckoutController(clients);

	const checkoutBusy =
		checkout.phase !== "idle" &&
		checkout.phase !== "paid" &&
		checkout.phase !== "failed";

	async function handleCheckout() {
		// B1: mock mode synthesizes the quote id; a real backend needs an
		// approved quote id (empty here → server-side resolution expected).
		await checkout.start("");
	}

	return (
		<div className="flex min-h-full flex-col bg-canvas">
			<Header
				wallet={wallet}
				itemCount={cart.itemCount}
				onToggleCart={() => cart.dispatch({ type: "toggle" })}
				mockMode={clients.mockMode}
			/>

			<main className="flex-1">
				<CatalogView />
				<div className="mx-auto w-full max-w-6xl px-4 pb-12">
					<CheckoutProgress state={checkout} />
				</div>
			</main>

			<CartDrawer
				onCheckout={() => void handleCheckout()}
				checkoutBusy={checkoutBusy}
			/>
		</div>
	);
}

export function App({ clients }: { clients: ClientBundle }) {
	return (
		<ClientProvider value={clients}>
			<CartProvider>
				<AppShell />
			</CartProvider>
		</ClientProvider>
	);
}
