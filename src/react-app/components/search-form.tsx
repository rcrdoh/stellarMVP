import { type FormEvent, useState } from "react";

/** Catalog search form. Exposes `data-role="search-form"` per the UI contract. */
export function SearchForm({
	onSearch,
	busy,
	initialQuery = "",
}: {
	onSearch(query: string): void;
	busy: boolean;
	initialQuery?: string;
}) {
	const [query, setQuery] = useState(initialQuery);

	function submit(event: FormEvent) {
		event.preventDefault();
		onSearch(query.trim());
	}

	return (
		<form
			data-role="search-form"
			onSubmit={submit}
			className="flex w-full flex-col gap-3 sm:flex-row"
		>
			<label className="sr-only" htmlFor="search-query">
				Search the catalog
			</label>
			<input
				id="search-query"
				type="search"
				value={query}
				onChange={(event) => setQuery(event.target.value)}
				placeholder="What are you looking for? e.g. wireless headphones"
				className="flex-1 rounded-lg border border-stroke bg-navy px-4 py-2.5 text-sm text-ink outline-none placeholder:text-muted focus:border-emerald"
			/>
			<button
				type="submit"
				disabled={busy}
				className="rounded-lg bg-emerald px-5 py-2.5 text-sm font-semibold text-[color:var(--btn-primary-fg)] transition-colors hover:bg-emerald-hover disabled:opacity-50"
			>
				{busy ? "Searching…" : "Search"}
			</button>
		</form>
	);
}
