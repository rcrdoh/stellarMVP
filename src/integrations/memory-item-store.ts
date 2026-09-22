import type { Item } from "../domain/items.js";

export interface ItemStore {
	isReady(): Promise<boolean>;
	save(item: Item): Promise<Item>;
	get(id: string): Promise<Item | undefined>;
}

export class MemoryItemStore implements ItemStore {
	readonly #items = new Map<string, Item>();

	async isReady(): Promise<boolean> {
		return true;
	}

	async save(item: Item): Promise<Item> {
		this.#items.set(item.id, item);
		return item;
	}

	async get(id: string): Promise<Item | undefined> {
		return this.#items.get(id);
	}
}
