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
