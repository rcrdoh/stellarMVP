/**
 * Single-container entrypoint for Render.
 *
 * Runs the Fastify API and the React SPA server (which also proxies `/v1/*`)
 * inside the same container so a single Render web service serves both.
 *
 * Layout:
 * - API  binds `API_PORT` (default 3000) on 127.0.0.1, internal only.
 * - Web  binds `HOST`/`PORT` (Render injects PORT) and proxies `/v1/*` to the
 *   API via `UI_API_TARGET` (default http://127.0.0.1:3000).
 *
 * Render's health check hits the web server on `$PORT`; once the API answers
 * `/v1/health/live` the web server starts, so the probe also covers the API.
 *
 * Env:
 * - `API_PORT` (default 3000): internal API port. `PORT` stays reserved for the
 *   public web server.
 * - `API_HOST` (default 127.0.0.1): internal API host.
 * - `API_READY_TIMEOUT_MS` (default 60000): how long to wait for API health.
 */

const apiPort = Number(process.env.API_PORT ?? "3000");
const apiHost = process.env.API_HOST ?? "127.0.0.1";
const apiReadyTimeoutMs = Number(process.env.API_READY_TIMEOUT_MS ?? "60000");
const apiHealthUrl = `http://${apiHost}:${apiPort}/v1/health/live`;

const children: Bun.Subprocess[] = [];
let shuttingDown = false;

function spawnProcess(
	cmd: string[],
	env: Record<string, string>,
): Bun.Subprocess {
	const child = Bun.spawn({
		cmd,
		env: { ...process.env, ...env },
		stdout: "inherit",
		stderr: "inherit",
	});
	children.push(child);
	return child;
}

function shutdown(code: number): void {
	if (shuttingDown) return;
	shuttingDown = true;
	for (const child of children) {
		try {
			child.kill("SIGTERM");
		} catch {
			// already gone
		}
	}
	process.exit(code);
}

for (const signal of ["SIGTERM", "SIGINT"] as const) {
	process.on(signal, () => shutdown(0));
}

async function waitForApi(): Promise<void> {
	const deadline = Date.now() + apiReadyTimeoutMs;
	while (Date.now() < deadline) {
		if (shuttingDown) return;
		try {
			const response = await fetch(apiHealthUrl);
			if (response.ok) return;
		} catch {
			// not up yet
		}
		await Bun.sleep(500);
	}
	console.error(
		`[start-all] API did not become healthy at ${apiHealthUrl} within ${apiReadyTimeoutMs}ms; starting web server anyway`,
	);
}

// Internal API: keep `PORT` for the public web server.
const api = spawnProcess(["bun", "run", "start"], {
	HOST: apiHost,
	PORT: String(apiPort),
});

api.exited.then((code) => {
	if (!shuttingDown) {
		console.error(`[start-all] API process exited with code ${code}`);
		shutdown(code ?? 1);
	}
});

await waitForApi();

const web = spawnProcess(["bun", "run", "start:web"], {
	UI_API_TARGET: process.env.UI_API_TARGET ?? `http://${apiHost}:${apiPort}`,
});

web.exited.then((code) => {
	if (!shuttingDown) {
		console.error(`[start-all] web process exited with code ${code}`);
		shutdown(code ?? 1);
	}
});

await Promise.all([api.exited, web.exited]);

export {};
