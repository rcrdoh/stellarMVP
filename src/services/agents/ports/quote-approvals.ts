import type { QuoteApproval } from "../../../domain/agents/contracts.js";

export interface QuoteApprovalStore {
	save(approval: QuoteApproval): Promise<void>;
	get(approvalId: string): Promise<QuoteApproval | null>;
	consume(approvalId: string, consumedAt: string): Promise<boolean>;
	decide(
		approvalId: string,
		decision: "approved" | "rejected",
	): Promise<boolean>;
}
