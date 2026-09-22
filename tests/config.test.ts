import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	envSchema,
	flattenTomlSettings,
	loadTomlSettings,
} from "../src/config/env.js";

describe("config file loading", () => {
	test("toml settings are flattened to env keys", () => {
		const values = flattenTomlSettings({
			app: {
				name: "custom-service",
				env: "staging",
				port: 9000,
				database_enabled: true,
				bucket_enabled: true,
				cache_enabled: true,
			},
		});

		const settings = envSchema.parse(values);

		expect(settings.APP_NAME).toBe("custom-service");
		expect(settings.APP_ENV).toBe("staging");
		expect(settings.PORT).toBe(9000);
		expect(settings.DATABASE_ENABLED).toBe(true);
		expect(settings.BUCKET_ENABLED).toBe(true);
		expect(settings.CACHE_ENABLED).toBe(true);
		expect(settings.SERVICE_TOKEN).toBe("");
	});

	test("toml settings load from custom path", () => {
		const dir = mkdtempSync(join(tmpdir(), "bun-config-"));
		const configFile = join(dir, "settings.toml");
		writeFileSync(
			configFile,
			`
[app]
name = "custom-service"
env = "dev"
host = "0.0.0.0"
port = 9001
`,
		);

		const settings = envSchema.parse(loadTomlSettings(configFile));

		expect(settings.APP_NAME).toBe("custom-service");
		expect(settings.APP_ENV).toBe("dev");
		expect(settings.HOST).toBe("0.0.0.0");
		expect(settings.PORT).toBe(9001);
	});

	test("toml profile overrides base values", () => {
		const previousAppEnv = process.env.APP_ENV;
		process.env.APP_ENV = "prod";
		const values = flattenTomlSettings({
			app: {
				name: "custom-service",
				env: "dev",
				database_enabled: false,
			},
			profiles: {
				prod: {
					app: {
						env: "prod",
						database_enabled: true,
						log_level: "warn",
					},
				},
			},
		});

		if (previousAppEnv === undefined) {
			delete process.env.APP_ENV;
		} else {
			process.env.APP_ENV = previousAppEnv;
		}

		const settings = envSchema.parse(values);

		expect(settings.APP_ENV).toBe("prod");
		expect(settings.DATABASE_ENABLED).toBe(true);
		expect(settings.LOG_LEVEL).toBe("warn");
	});
});
