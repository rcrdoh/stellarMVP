export interface Cache {
	isReady(): Promise<boolean>;
}

export class LocalCache implements Cache {
	async isReady(): Promise<boolean> {
		return true;
	}
}

export class RedisCache implements Cache {
	async isReady(): Promise<boolean> {
		// Connect Redis client here when this service needs distributed cache.
		throw new Error("Configure a Redis client before enabling this adapter.");
	}
}
