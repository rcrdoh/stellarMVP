import { Redis } from "ioredis";

export type RedisClient = Redis;

let client: Redis | null = null;

export function getRedisClient(url = process.env.REDIS_URL): Redis {
	if (client) return client;
	client = new Redis(url ?? "redis://127.0.0.1:6379", {
		lazyConnect: true,
		maxRetriesPerRequest: 1,
	});
	return client;
}

export type RedisLike = Pick<
	Redis,
	"hget" | "get" | "set" | "incrbyfloat" | "expire" | "ping" | "quit"
>;

export async function isRedisReady(redis: RedisLike): Promise<boolean> {
	try {
		await redis.ping();
		return true;
	} catch {
		return false;
	}
}

export async function closeRedis(): Promise<void> {
	if (!client) return;
	const current = client;
	client = null;
	await current.quit().catch(() => undefined);
}
