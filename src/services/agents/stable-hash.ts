import { createHash } from "node:crypto";

function normalize(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(normalize);
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, nested]) => [key, normalize(nested)]),
		);
	}
	return value;
}

export function stableHash(value: unknown): string {
	const serialized = JSON.stringify(normalize(value));
	if (serialized === undefined) {
		throw new TypeError("Value cannot be serialized for a stable hash");
	}
	return createHash("sha256").update(serialized).digest("base64url");
}
