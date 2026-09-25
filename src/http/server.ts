import apiReference from "@scalar/fastify-api-reference";
import { Networks } from "@stellar/stellar-sdk";
import Fastify from "fastify";
import { MongoClient } from "mongodb";
import { type Env, env } from "../config/env.js";
import { LocalBucket, type ObjectBucket } from "../integrations/bucket.js";
import { type Cache, LocalCache } from "../integrations/cache.js";
import { type Database, LocalDatabase } from "../integrations/database.js";
import { MemoryItemStore } from "../integrations/memory-item-store.js";
import { MongoPaymentStore } from "../integrations/mongodb/payment-store.js";
import { StellarPaymentGateway } from "../integrations/stellar/stellar-payment-gateway.js";
import { ItemService } from "../services/item-service.js";
import { PaymentService } from "../services/payment-service.js";
import { registerErrorHandler } from "./error-handler.js";
import {
	type PaymentRuntime,
	registerPaymentRoutes,
} from "./payment-routes.js";
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
	payments?: PaymentRuntime;
}>;

async function createMongoPaymentRuntime(
	runtimeEnv: Env,
): Promise<PaymentRuntime> {
	const client = new MongoClient(runtimeEnv.MONGODB_URI);
	try {
		await client.connect();
		const store = new MongoPaymentStore(client.db(runtimeEnv.MONGODB_DATABASE));
		await store.ensureIndexes();
		const service = new PaymentService({
			quotes: store,
			intents: store,
			stellar: new StellarPaymentGateway(
				runtimeEnv.STELLAR_HORIZON_URL,
				runtimeEnv.STELLAR_USDC_ISSUER,
				Networks.TESTNET,
				runtimeEnv.STELLAR_MAX_FEE_PER_OPERATION_STROOPS,
			),
			networkPassphrase: Networks.TESTNET,
			usdcIssuer: runtimeEnv.STELLAR_USDC_ISSUER,
		});
		return {
			service,
			isReady: () => store.isReady(),
			close: () => client.close(),
		};
	} catch (error) {
		await client.close();
		throw error;
	}
}

export async function buildServer(options: BuildServerOptions = {}) {
	const runtimeEnv = options.env ?? env;
	const integrations = options.integrations ?? {
		database: new LocalDatabase(),
		bucket: new LocalBucket(),
		cache: new LocalCache(),
	};
	const payments =
		options.payments ??
		(runtimeEnv.PAYMENTS_ENABLED
			? await createMongoPaymentRuntime(runtimeEnv)
			: undefined);
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
		payments,
	);
	registerPaymentRoutes(app, runtimeEnv, payments);
	if (payments?.close) {
		app.addHook("onClose", async () => payments.close?.());
	}
	await app.register(apiReference, {
		routePrefix: "/docs",
		configuration: {
			url: "/openapi.json",
		},
	});
	return app;
}
