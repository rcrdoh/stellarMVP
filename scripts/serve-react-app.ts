import { join } from "node:path";

/**
 * Server for the React ACP x402 frontend.
 *
 * Mirrors `scripts/serve-ui.ts` but bundles the React entry (`src/react-app`)
 * with `Bun.build` + `bun-plugin-tailwind`, serves the SPA shell, and proxies
 * `/v1/*` to the backend so one origin serves both the page and the API.
 *
 * Runs locally (`bun run react:dev`) and in production via `bun run start:web`,
 * which the single-container supervisor `scripts/start-all.ts` (`bun run
 * start:all`, the former `Dockerfile.web` role) launches next to the API.
 *
 * Env:
 * - `HOST` (default 127.0.0.1) / `PORT`: used in production (Render injects
 *   `PORT` and expects the service to bind `0.0.0.0`).
 * - `REACT_UI_HOST` / `REACT_UI_PORT` (defaults 127.0.0.1 / 5173): local dev
 *   overrides, take precedence when set.
 * - `UI_API_TARGET` (default http://127.0.0.1:3000): backend behind `/v1/*`.
 * - `REACT_MOCK_MODE` (`1` forces the mock clients, default when no backend).
 */

const appRoot = new URL("../src/react-app/", import.meta.url).pathname;
const indexHtml = Bun.file(join(appRoot, "index.html"));

const isProduction =
	process.env.NODE_ENV === "production" || process.env.APP_ENV === "prod";

const host =
	process.env.REACT_UI_HOST ??
	process.env.HOST ??
	(isProduction ? "0.0.0.0" : "127.0.0.1");
const port = Number(
	process.env.REACT_UI_PORT ??
		process.env.PORT ??
		(isProduction ? "3000" : "5173"),
);
const backend = process.env.UI_API_TARGET ?? "http://127.0.0.1:3000";

const tailwind = (await import("bun-plugin-tailwind")).default;

async function bundle(): Promise<{ js: string; css: string }> {
	const build = await Bun.build({
		entrypoints: [join(appRoot, "main.tsx"), join(appRoot, "styles/index.css")],
		target: "browser",
		format: "esm",
		minify: isProduction,
		sourcemap: isProduction ? "none" : "inline",
		plugins: [tailwind],
		define: {
			"process.env.NODE_ENV": JSON.stringify(
				isProduction ? "production" : "development",
			),
			"process.env.REACT_MOCK_MODE": JSON.stringify(
				process.env.REACT_MOCK_MODE ?? "",
			),
			"process.env.REACT_AGENT_TOKEN": JSON.stringify(
				process.env.REACT_AGENT_TOKEN ?? "",
			),
			"process.env.REACT_SERVICE_TOKEN": JSON.stringify(
				process.env.REACT_SERVICE_TOKEN ?? "",
			),
			"process.env.REACT_PRINCIPAL_ID": JSON.stringify(
				process.env.REACT_PRINCIPAL_ID ?? "",
			),
		},
	});
	if (!build.success) {
		for (const message of build.logs) {
			console.error(message);
		}
		process.exit(1);
	}
	const jsOutput = build.outputs.find(
		(output) =>
			output.type.startsWith("text/javascript") &&
			output.path.endsWith("main.js"),
	);
	if (jsOutput === undefined) {
		console.error("Bun.build produced no JS output for the React entry");
		process.exit(1);
	}
	const cssOutput = build.outputs.find(
		(output) =>
			output.type.startsWith("text/css") && output.path.endsWith("main.css"),
	);
	return {
		js: await jsOutput.text(),
		css: cssOutput ? await cssOutput.text() : "",
	};
}

const output = await bundle();

const server = Bun.serve({
	hostname: host,
	port,
	async fetch(request) {
		const url = new URL(request.url);

		if (url.pathname === "/" || url.pathname === "/index.html") {
			return new Response(indexHtml, {
				headers: { "content-type": "text/html; charset=utf-8" },
			});
		}

		if (url.pathname === "/main.js") {
			return new Response(output.js, {
				headers: { "content-type": "text/javascript; charset=utf-8" },
			});
		}

		if (url.pathname === "/styles.css") {
			return new Response(output.css, {
				headers: { "content-type": "text/css; charset=utf-8" },
			});
		}

		if (url.pathname.startsWith("/v1/")) {
			const target = new URL(url.pathname + url.search, backend);
			return fetch(target, {
				method: request.method,
				headers: request.headers,
				body: request.body,
			});
		}

		return new Response("Not found", { status: 404 });
	},
});

console.log(`React ACP frontend on http://${server.hostname}:${server.port}`);
console.log(`Proxying /v1/* -> ${backend}`);
