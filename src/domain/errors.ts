import type { ErrorCodeDefinition } from "./error-codes.js";
import { errorCodes } from "./error-codes.js";

export class AppError extends Error {
	readonly errorCode: ErrorCodeDefinition;

	constructor(errorCode: ErrorCodeDefinition) {
		if (!errorCode.emittable || errorCode.status === null) {
			throw new Error(`Error code ${errorCode.code} is not HTTP-emittable.`);
		}
		super(errorCode.title);
		this.name = "AppError";
		this.errorCode = errorCode;
	}
}

export class NotFoundError extends AppError {
	constructor(_resource: string, _id: string) {
		super(errorCodes.RESOURCE_STATE_CONFLICT);
	}
}

export class PaymentRequiredError extends AppError {
	readonly challengePayload: string;

	constructor(challengePayload: string, _message = "Payment Required") {
		super(errorCodes.PAYMENT_REQUIRED);
		this.name = "PaymentRequiredError";
		this.challengePayload = challengePayload;
	}
}

export class PaymentFailedError extends AppError {
	constructor(_message = "Payment Failed") {
		super(errorCodes.PAYMENT_FAILED);
		this.name = "PaymentFailedError";
	}
}

export class InsufficientScopeError extends AppError {
	constructor(_requiredScope: string) {
		super(errorCodes.INSUFFICIENT_SCOPE);
		this.name = "InsufficientScopeError";
	}
}

export class AIServiceUnavailableError extends AppError {
	constructor(_message = "AI Service unavailable") {
		super(errorCodes.AI_SERVICE_UNAVAILABLE);
		this.name = "AIServiceUnavailableError";
	}
}

export class WalletNotConnectedError extends AppError {
	constructor(_message = "Wallet not connected") {
		super(errorCodes.WALLET_NOT_CONNECTED);
		this.name = "WalletNotConnectedError";
	}
}

export class WalletNotAvailableError extends AppError {
	constructor(_message = "Wallet provider unavailable") {
		super(errorCodes.WALLET_NOT_AVAILABLE);
		this.name = "WalletNotAvailableError";
	}
}

export class WalletConnectionRejectedError extends AppError {
	constructor(_message = "Wallet connection rejected") {
		super(errorCodes.WALLET_CONNECTION_REJECTED);
		this.name = "WalletConnectionRejectedError";
	}
}

export class WalletProviderUnavailableError extends AppError {
	constructor(_message = "Wallet provider did not respond") {
		super(errorCodes.WALLET_PROVIDER_UNAVAILABLE);
		this.name = "WalletProviderUnavailableError";
	}
}
