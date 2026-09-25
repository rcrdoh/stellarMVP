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
		PAYMENTS_ENABLED: z.coerce.boolean().default(false),
		MONGODB_URI: z.string().default(""),
		MONGODB_DATABASE: z.string().min(1).default("stellarmvp"),
		SERVICE_TOKEN: z.string().default(""),
		STELLAR_NETWORK: z.string().default(""),
		STELLAR_USDC_ISSUER: z.string().default(""),
		STELLAR_HORIZON_URL: z
			.string()
			.default("https://horizon-testnet.stellar.org"),
		STELLAR_MAX_FEE_PER_OPERATION_STROOPS: z.coerce
			.number()
			.int()
			.min(100)
			.max(100_000)
			.default(100_000),
	})
	.superRefine((settings, context) => {
		if (!settings.PAYMENTS_ENABLED) {
			return;
		}
		if (settings.SERVICE_TOKEN.trim().length === 0) {
			context.addIssue({
				code: "custom",
				message: "SERVICE_TOKEN is required when PAYMENTS_ENABLED is true.",
				path: ["SERVICE_TOKEN"],
			});
		}
		if (!/^mongodb(?:\+srv)?:\/\//.test(settings.MONGODB_URI)) {
			context.addIssue({
				code: "custom",
				message: "A MongoDB URI is required when PAYMENTS_ENABLED is true.",
				path: ["MONGODB_URI"],
			});
		}
		if (settings.STELLAR_NETWORK !== "testnet") {
			context.addIssue({
				code: "custom",
				message: "The payment pilot supports STELLAR_NETWORK=testnet only.",
				path: ["STELLAR_NETWORK"],
			});
		}
		if (!/^G[A-Z2-7]{55}$/.test(settings.STELLAR_USDC_ISSUER)) {
			context.addIssue({
				code: "custom",
				message: "STELLAR_USDC_ISSUER must be a Stellar account on Testnet.",
				path: ["STELLAR_USDC_ISSUER"],
			});
		}
		if (!settings.STELLAR_HORIZON_URL.startsWith("https://")) {
			context.addIssue({
				code: "custom",
				message:
					"STELLAR_HORIZON_URL must use HTTPS when payments are enabled.",
				path: ["STELLAR_HORIZON_URL"],
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
