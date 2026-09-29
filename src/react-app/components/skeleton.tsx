/** Loading placeholders for the product grid (no layout shift). */
export function ProductSkeleton() {
	return (
		<div
			data-role="skeleton"
			className="animate-pulse rounded-xl border border-stroke bg-panel p-5"
		>
			<div className="h-4 w-3/4 rounded bg-elevated" />
			<div className="mt-3 h-3 w-full rounded bg-elevated" />
			<div className="mt-2 h-3 w-5/6 rounded bg-elevated" />
			<div className="mt-6 h-8 w-24 rounded bg-elevated" />
		</div>
	);
}

export function ProductGridSkeleton({ count = 3 }: { count?: number }) {
	const keys = Array.from({ length: count }, (_, index) => `skeleton-${index}`);
	return (
		<div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
			{keys.map((key) => (
				<ProductSkeleton key={key} />
			))}
		</div>
	);
}
