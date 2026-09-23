import apiReference from "@scalar/fastify-api-reference";
import Fastify from "fastify";
import { type Env, env } from "../config/env.js";
import { LocalBucket, type ObjectBucket } from "../integrations/bucket.js";
import { type Cache, LocalCache } from "../integrations/cache.js";
import { type Database, LocalDatabase } from "../integrations/database.js";
import { MemoryItemStore } from "../integrations/memory-item-store.js";
import { ItemService } from "../services/item-service.js";
import { registerErrorHandler } from "./error-handler.js";
import { registerRoutes } from "./routes.js";

export type AppIntegrations = Readonly<{
	database: Database;
	bucket: ObjectBucket;
	cache: Cache;
}>;

type BuildServerOptions = Readonly<{
	env?: Env;
	fastifyFactory?: typeof Fastify;
	integrations?: AppIntegrations;
}>;

export async function buildServer(options: BuildServerOptions = {}) {
	const runtimeEnv = options.env ?? env;
	const integrations = options.integrations ?? {
		database: new LocalDatabase(),
		bucket: new LocalBucket(),
		cache: new LocalCache(),
	};
	const createFastify = options.fastifyFactory ?? Fastify;
	const app = createFastify({
		logger: {
			level: runtimeEnv.LOG_LEVEL,
		},
	});

	registerErrorHandler(app);
	registerRoutes(
		app,
		new ItemService(new MemoryItemStore()),
		runtimeEnv,
		integrations,
	);
	await app.register(apiReference, {
		routePrefix: "/docs",
		configuration: {
			url: "/openapi.json",
		},
	});
	return app;
}
