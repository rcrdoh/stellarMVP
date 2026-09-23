/** Minimal Bun runtime APIs used by production code. */
declare const Bun: {
	TOML: {
		parse(input: string): unknown;
	};
	file(path: URL | string): {
		json(): Promise<unknown>;
	};
};
