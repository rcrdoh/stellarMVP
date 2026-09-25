import { NotFoundError } from "../domain/errors.js";
import type { Item } from "../domain/items.js";

export type ItemStatus = "available" | "purchased";

export interface ItemStore {
	isReady(): Promise<boolean>;
	save(item: Item): Promise<Item>;
	get(id: string): Promise<Item | undefined>;
	getStatus(id: string): Promise<ItemStatus | undefined>;
	updateStatus(id: string, status: ItemStatus): Promise<void>;
}

export class MemoryItemStore implements ItemStore {
	readonly #items = new Map<string, Item>();
	readonly #statuses = new Map<string, ItemStatus>();

	async isReady(): Promise<boolean> {
		return true;
	}

	async save(item: Item): Promise<Item> {
		this.#items.set(item.id, item);
		this.#statuses.set(item.id, "available");
		return item;
	}

	async get(id: string): Promise<Item | undefined> {
		return this.#items.get(id);
	}

	async getStatus(id: string): Promise<ItemStatus | undefined> {
		return this.#statuses.get(id);
	}

	async updateStatus(id: string, status: ItemStatus): Promise<void> {
		if (!this.#items.has(id)) {
			throw new NotFoundError("Item", id);
		}
		this.#statuses.set(id, status);
	}
}
