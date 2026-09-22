import { NotFoundError } from "../domain/errors.js";
import {
	type CreateItemInput,
	createItem,
	type Item,
} from "../domain/items.js";
import type { ItemStore } from "../integrations/memory-item-store.js";

export class ItemService {
	constructor(private readonly store: ItemStore) {}

	async isReady(): Promise<boolean> {
		return this.store.isReady();
	}

	async create(input: CreateItemInput): Promise<Item> {
		return this.store.save(createItem(input));
	}

	async get(id: string): Promise<Item> {
		const item = await this.store.get(id);
		if (!item) {
			throw new NotFoundError("Item", id);
		}
		return item;
	}
}
