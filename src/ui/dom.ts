/**
 * Resolves a required descendant of a template node. Component templates own
 * these selectors, so a miss is a programming error rather than user input;
 * throwing here keeps components free of `!` non-null assertions while still
 * returning a narrowed type to the caller.
 */
export function requireElement<T extends Element>(
	root: ParentNode,
	selector: string,
): T {
	const element = root.querySelector<T>(selector);
	if (element === null) {
		throw new Error(`Expected element not found: ${selector}`);
	}
	return element;
}
