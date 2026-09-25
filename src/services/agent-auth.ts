import { createHash } from "node:crypto";
import { errorCodes } from "../domain/error-codes.js";
import { AppError, InsufficientScopeError } from "../domain/errors.js";
import type { RedisLike } from "../integrations/redis.js";

export const AGENT_SCOPES = {
	SEARCH: "agent:search",
	CHECKOUT: "agent:checkout",
} as const;

export type AgentScope = (typeof AGENT_SCOPES)[keyof typeof AGENT_SCOPES];

const SPEND_WINDOW_SECONDS = 86_400;

export function hashToken(token: string): string {
	return createHash("sha256").update(token).digest("hex");
}

export function tokenKey(hash: string): string {
	return `agent:token:${hash}`;
}

export function spendKey(hash: string, day: string): string {
	return `agent:spend:${hash}:${day}`;
}

export function currentSpendDay(now: Date = new Date()): string {
	return now.toISOString().slice(0, 10);
}

export type AgentTokenRecord = Readonly<{
	scopes: string[];
	maxDailySpend: number | null;
}>;

export class AgentAuthService {
	constructor(
		private readonly redis: RedisLike,
		private readonly now: () => Date = () => new Date(),
	) {}

	async verifyAgentScope(token: string, requiredScope: string): Promise<void> {
		const hash = hashToken(token);
		const scopesRaw = await this.redis.hget(tokenKey(hash), "scopes");
		const scopes = (scopesRaw ?? "")
			.split(",")
			.map((scope) => scope.trim())
			.filter((scope) => scope.length > 0);
		if (!scopes.includes(requiredScope)) {
			throw new InsufficientScopeError(requiredScope);
		}
	}

	async checkVelocityAndAuthorize(
		token: string,
		txAmount: number,
	): Promise<void> {
		if (!Number.isFinite(txAmount) || txAmount < 0) {
			throw new AppError(errorCodes.INVALID_MONEY_AMOUNT_OR_CURRENCY);
		}
		const hash = hashToken(token);
		const maxRaw = await this.redis.hget(tokenKey(hash), "max_daily_spend");
		const day = currentSpendDay(this.now());
		const spendRaw = await this.redis.get(spendKey(hash, day));
		const current = spendRaw === null ? 0 : Number.parseFloat(spendRaw);
		if (!Number.isFinite(current)) {
			throw new AppError(errorCodes.UNHANDLED_INTERNAL_ERROR);
		}
		const maxDailySpend =
			maxRaw === null || maxRaw === "" ? null : Number.parseFloat(maxRaw);
		if (maxDailySpend !== null && current + txAmount > maxDailySpend) {
			throw new AppError(errorCodes.RATE_LIMITED);
		}
		const key = spendKey(hash, day);
		await this.redis.incrbyfloat(key, txAmount);
		await this.redis.expire(key, SPEND_WINDOW_SECONDS);
	}
}
