/** Console engine metrics (local preview only; no backend endpoint exists). */
export type EngineMetrics = {
	activeAgents: number;
	avgLatencyMs: number;
	opsPerMinute: number;
	successRate: number;
};

/** Spending policy — a LOCAL PREVIEW. The backend exposes no policy endpoint
 * (SDD §10.8 [VERIFY], resolved empty), so these are not persisted or sent. */
export type SpendPolicy = {
	dailyLimitUsd: number;
	perTxLimitUsd: number;
	allowedAssets: string[];
	requireWalletConfirmation: boolean;
};
