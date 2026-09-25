import type { AgentBudget } from "../../domain/agents/contracts.js";

export type BudgetCounter =
	| "steps"
	| "toolCalls"
	| "llmCalls"
	| "retries"
	| "retrievedChunks"
	| "inputTokens"
	| "outputTokens";

export class BudgetExceededError extends Error {
	constructor(readonly counter: BudgetCounter | "wallTime") {
		super(`Agent budget exceeded: ${counter}`);
		this.name = "BudgetExceededError";
	}
}

export class BudgetTracker {
	private readonly startedAt: number;
	private readonly usage: Record<BudgetCounter, number> = {
		steps: 0,
		toolCalls: 0,
		llmCalls: 0,
		retries: 0,
		retrievedChunks: 0,
		inputTokens: 0,
		outputTokens: 0,
	};

	constructor(
		private readonly budget: AgentBudget,
		private readonly now: () => number = Date.now,
	) {
		this.startedAt = now();
	}

	consume(counter: BudgetCounter, amount = 1): void {
		if (!Number.isFinite(amount) || amount < 0) {
			throw new RangeError("Budget usage must be a finite non-negative number");
		}
		this.assertWallTime();
		this.usage[counter] += amount;
		const maximum = this.maximum(counter);
		if (maximum > 0 && this.usage[counter] > maximum) {
			throw new BudgetExceededError(counter);
		}
	}

	assertWallTime(): void {
		if (this.now() - this.startedAt > this.budget.maxWallTimeMs) {
			throw new BudgetExceededError("wallTime");
		}
	}

	private maximum(counter: BudgetCounter): number {
		const limits: Record<BudgetCounter, number> = {
			steps: this.budget.maxSteps,
			toolCalls: this.budget.maxToolCalls,
			llmCalls: this.budget.maxLlmCalls,
			retries: this.budget.maxRetriesPerNode,
			retrievedChunks: this.budget.maxRetrievedChunks,
			inputTokens: this.budget.maxInputTokens,
			outputTokens: this.budget.maxOutputTokens,
		};
		return limits[counter];
	}
}
