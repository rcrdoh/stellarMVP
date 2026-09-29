import type { ProblemDetails } from "../types/problem.js";

/** RFC 9457 problem banner. The backend has **no** `detail` field (the human
 * string is `title`), so we render `status · title` plus `code`/`detail_key`. */
export function ProblemBanner({ problem }: { problem: ProblemDetails }) {
	return (
		<div
			data-role="problem"
			role="alert"
			className="rounded-lg border border-red stroke bg-red-container p-4 text-sm"
		>
			<p className="font-semibold text-red-text">
				{problem.status} · {problem.title}
			</p>
			<p className="mt-1 font-mono text-xs text-muted">
				{problem.code} · {problem.category}
			</p>
			{problem.detail_key !== undefined && (
				<p className="mt-1 font-mono text-xs text-muted">
					{problem.detail_key}
				</p>
			)}
			{problem.behavior?.user_action !== undefined && (
				<p className="mt-1 text-xs text-muted">
					{problem.behavior.user_action}
				</p>
			)}
		</div>
	);
}
