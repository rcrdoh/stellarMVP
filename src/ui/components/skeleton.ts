/**
 * Placeholder card rendered while a product search is in flight. Pure DOM, no
 * framework: safe to call from any module that has a `document`.
 */
export function createProductCardSkeleton(): HTMLElement {
	const skeleton = document.createElement("div");
	skeleton.className =
		"bg-gray-800/40 border border-gray-800 rounded-xl p-4 flex flex-col justify-between animate-pulse h-48";
	skeleton.setAttribute("role", "status");
	skeleton.setAttribute("aria-label", "Loading product");
	skeleton.innerHTML = `
		<div class="space-y-3">
			<div class="h-5 bg-gray-700/60 rounded w-3/4"></div>
			<div class="h-3 bg-gray-700/40 rounded w-1/2"></div>
		</div>
		<div class="flex justify-between items-center pt-3 border-t border-gray-800">
			<div class="h-6 bg-gray-700/60 rounded w-1/4"></div>
			<div class="h-8 bg-gray-700/60 rounded w-1/3"></div>
		</div>
	`;
	return skeleton;
}

/** Renders `count` skeletons for a candidate grid. */
export function createProductGridSkeleton(count = 3): HTMLElement {
	const grid = document.createElement("div");
	grid.className = "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4";
	for (let i = 0; i < Math.max(0, Math.floor(count)); i += 1) {
		grid.append(createProductCardSkeleton());
	}
	return grid;
}
