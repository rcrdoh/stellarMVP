import type { Horizon } from "@stellar/stellar-sdk";
import { PaymentFailedError } from "../domain/errors.js";

export type StellarSettlement = Readonly<{
	hash: string;
	ledger: number;
	successful: boolean;
}>;

export type StellarPaymentRequest = Readonly<{
	paymentToken: string;
	amount: string;
	currency: string;
	destination: string;
	idempotencyKey: string;
}>;

export type StellarServer = Pick<
	Horizon.Server,
	"submitTransaction" | "loadAccount"
>;

export interface StellarPaymentGateway {
	processPayment(request: StellarPaymentRequest): Promise<StellarSettlement>;
}

export class StellarSettlementError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "StellarSettlementError";
	}
}

function isSuccessful(
	response: Horizon.HorizonApi.SubmitTransactionResponse,
): boolean {
	return response.successful === true;
}

/**
 * Gateway that awaits explicit on-chain confirmation from Horizon before
 * resolving. A failed or unconfirmed submission never resolves successfully:
 * it throws a PaymentFailedError mapped to SVC-PAYMENT-4022.
 */
export class StellarPaymentService implements StellarPaymentGateway {
	constructor(
		private readonly server: StellarServer,
		private readonly submit: (
			server: StellarServer,
			request: StellarPaymentRequest,
		) => Promise<Horizon.HorizonApi.SubmitTransactionResponse>,
		private readonly timeoutMs = 30_000,
	) {}

	async processPayment(
		request: StellarPaymentRequest,
	): Promise<StellarSettlement> {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<never>((_resolve, reject) => {
			timer = setTimeout(
				() =>
					reject(new StellarSettlementError("Horizon submission timed out")),
				this.timeoutMs,
			);
		});
		try {
			const response = await Promise.race([
				this.submit(this.server, request),
				timeout,
			]);
			if (!isSuccessful(response)) {
				throw new StellarSettlementError("Transaction not successful on-chain");
			}
			return {
				hash: response.hash,
				ledger: response.ledger,
				successful: true,
			};
		} catch {
			throw new PaymentFailedError("On-chain Stellar settlement failed.");
		} finally {
			if (timer !== undefined) clearTimeout(timer);
		}
	}
}
