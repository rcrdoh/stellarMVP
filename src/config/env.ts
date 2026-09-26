import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { z } from "zod";

declare const Bun: {
	TOML: {
		parse(input: string): unknown;
	};
};

export const envSchema = z
	.object({
		APP_NAME: z.string().min(1).default("stellarmvp"),
		APP_ENV: z.enum(["dev", "staging", "prod"]).default("dev"),
		CONFIG_FILE: z.string().default("config/settings.toml"),
		HOST: z.string().default("127.0.0.1"),
		PORT: z.coerce.number().int().positive().default(3000),
		LOG_LEVEL: z
			.enum(["fatal", "error", "warn", "info", "debug", "trace"])
			.default("info"),
		DATABASE_ENABLED: z.coerce.boolean().default(false),
		BUCKET_ENABLED: z.coerce.boolean().default(false),
		CACHE_ENABLED: z.coerce.boolean().default(false),
		AGENT_COMMERCE_ENABLED: z.coerce.boolean().default(false),
		PAYMENTS_ENABLED: z.coerce.boolean().default(false),
		DATABASE_URL: z.string().default(""),
		REDIS_URL: z.string().default(""),
		QDRANT_URL: z.string().default(""),
		QDRANT_API_KEY: z.string().default(""),
		QDRANT_COLLECTION: z.string().min(1).default("items"),
		OPENAI_API_KEY: z.string().default(""),
		OPENAI_EMBEDDINGS_MODEL: z
			.string()
			.min(1)
			.default("text-embedding-3-small"),
		SERVICE_TOKEN: z.string().default(""),
		STELLAR_NETWORK: z.string().default(""),
		STELLAR_HORIZON_URL: z
			.string()
			.default("https://horizon-testnet.stellar.org"),
		STELLAR_SOURCE_SECRET: z.string().default(""),
		STELLAR_USDC_ISSUER: z.string().default(""),
		STELLAR_MAX_FEE_PER_OPERATION_STROOPS: z.coerce
			.number()
			.int()
			.min(100)
			.max(100_000)
			.default(100_000),
		JEV_API_KEY: z.string().default(""),
		JEV_BASE_URL: z.string().url().default("https://api.typesafe.ai"),
		JEV_MODEL: z.string().min(1).default("jev-latest"),
		GROQ_API_KEY: z.string().default(""),
		GROQ_MODEL: z.string().min(1).default("openai/gpt-oss-20b"),
		SHOPPING_DOMAIN_CONFIDENCE_THRESHOLD: z.coerce
			.number()
			.min(0)
			.max(1)
			.default(0.85),
		SHOPPING_ROUTE_CONFIDENCE_THRESHOLD: z.coerce
			.number()
			.min(0)
			.max(1)
			.default(0.85),
	})
	.superRefine((settings, context) => {
		if (!settings.PAYMENTS_ENABLED) return;
		if (settings.SERVICE_TOKEN.trim().length === 0) {
			context.addIssue({
				code: "custom",
				path: ["SERVICE_TOKEN"],
				message: "SERVICE_TOKEN is required when PAYMENTS_ENABLED is true.",
			});
		}
		if (!settings.DATABASE_URL.trim()) {
			context.addIssue({
				code: "custom",
				path: ["DATABASE_URL"],
				message: "DATABASE_URL is required when PAYMENTS_ENABLED is true.",
			});
		}
		if (settings.STELLAR_NETWORK !== "testnet") {
			context.addIssue({
				code: "custom",
				path: ["STELLAR_NETWORK"],
				message: "Wallet payments require STELLAR_NETWORK=testnet.",
			});
		}
		if (!/^G[A-Z2-7]{55}$/.test(settings.STELLAR_USDC_ISSUER)) {
			context.addIssue({
				code: "custom",
				path: ["STELLAR_USDC_ISSUER"],
				message: "STELLAR_USDC_ISSUER must be a Stellar account.",
			});
		}
		if (!settings.STELLAR_HORIZON_URL.startsWith("https://")) {
			context.addIssue({
				code: "custom",
				path: ["STELLAR_HORIZON_URL"],
				message: "STELLAR_HORIZON_URL must use HTTPS for payments.",
			});
		}
	});

export type Env = z.infer<typeof envSchema>;

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

type TomlSettings = {
	app?: {
		name?: unknown;
		env?: unknown;
		host?: unknown;
		port?: unknown;
		log_level?: unknown;
		database_enabled?: unknown;
		bucket_enabled?: unknown;
		cache_enabled?: unknown;
		payments_enabled?: unknown;
	};
	profiles?: Record<string, TomlSettings>;
};

const profileEnvs = new Set(["dev", "staging", "prod"]);

export function resolveConfigFile(
	configFile = process.env.CONFIG_FILE,
): string {
	const path = configFile ?? "config/settings.toml";
	return path.startsWith("/") ? path : resolve(rootDir, path);
}

export function flattenTomlSettings(
	settings: TomlSettings,
): Record<string, unknown> {
	const app = settings.app ?? {};
	const selectedProfile =
		typeof process.env.APP_ENV === "string" &&
		profileEnvs.has(process.env.APP_ENV)
			? process.env.APP_ENV
			: typeof app.env === "string" && profileEnvs.has(app.env)
				? app.env
				: undefined;
	const profileApp =
		selectedProfile !== undefined
			? (settings.profiles?.[selectedProfile]?.app ?? {})
			: {};

	return {
		...(app.name !== undefined ? { APP_NAME: app.name } : {}),
		...(app.env !== undefined ? { APP_ENV: app.env } : {}),
		...(app.host !== undefined ? { HOST: app.host } : {}),
		...(app.port !== undefined ? { PORT: app.port } : {}),
		...(app.log_level !== undefined ? { LOG_LEVEL: app.log_level } : {}),
		...(app.database_enabled !== undefined
			? { DATABASE_ENABLED: app.database_enabled }
			: {}),
		...(app.bucket_enabled !== undefined
			? { BUCKET_ENABLED: app.bucket_enabled }
			: {}),
		...(app.cache_enabled !== undefined
			? { CACHE_ENABLED: app.cache_enabled }
			: {}),
		...(app.payments_enabled !== undefined
			? { PAYMENTS_ENABLED: app.payments_enabled }
			: {}),
		...(profileApp.name !== undefined ? { APP_NAME: profileApp.name } : {}),
		...(profileApp.env !== undefined ? { APP_ENV: profileApp.env } : {}),
		...(profileApp.host !== undefined ? { HOST: profileApp.host } : {}),
		...(profileApp.port !== undefined ? { PORT: profileApp.port } : {}),
		...(profileApp.log_level !== undefined
			? { LOG_LEVEL: profileApp.log_level }
			: {}),
		...(profileApp.database_enabled !== undefined
			? { DATABASE_ENABLED: profileApp.database_enabled }
			: {}),
		...(profileApp.bucket_enabled !== undefined
			? { BUCKET_ENABLED: profileApp.bucket_enabled }
			: {}),
		...(profileApp.cache_enabled !== undefined
			? { CACHE_ENABLED: profileApp.cache_enabled }
			: {}),
		...(profileApp.payments_enabled !== undefined
			? { PAYMENTS_ENABLED: profileApp.payments_enabled }
			: {}),
	};
}

export function loadTomlSettings(
	configFile = resolveConfigFile(),
): Record<string, unknown> {
	if (!existsSync(configFile)) {
		return {};
	}
	const parsed = Bun.TOML.parse(
		readFileSync(configFile, "utf8"),
	) as TomlSettings;
	return flattenTomlSettings(parsed);
}

export function loadEnv(): Env {
	return envSchema.parse({
		...loadTomlSettings(),
		...process.env,
	});
}

export const env = loadEnv();
