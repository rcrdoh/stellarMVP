import { join } from "node:path";

/**
 * Local dev server for the Module 4 UI shell. Bundles `src/ui/browser/entry.ts`
 * for the browser with `Bun.build`, serves the static `index.html` shell and
 * proxies `/v1/*` to the backend so a single origin serves both the page and the
 * API. Run with `bun run ui:dev`.
 */

const uiRoot = new URL("../src/ui/", import.meta.url).pathname;
const indexHtml = Bun.file(join(uiRoot, "index.html"));

const port = Number(process.env.UI_PORT ?? "3001");
const backend = process.env.UI_API_TARGET ?? "http://127.0.0.1:3000";

const build = await Bun.build({
	entrypoints: [join(uiRoot, "browser/entry.ts")],
	target: "browser",
	format: "esm",
	minify: false,
	sourcemap: "inline",
});

if (!build.success) {
	for (const message of build.logs) {
		console.error(message);
	}
	process.exit(1);
}

const bundle = build.outputs[0];
if (bundle === undefined) {
	console.error("Bun.build produced no output for the UI entry");
	process.exit(1);
}
const bundleBody = await bundle.text();

const server = Bun.serve({
	hostname: process.env.UI_HOST ?? "127.0.0.1",
	port,
	async fetch(request) {
		const url = new URL(request.url);

		if (url.pathname === "/" || url.pathname === "/index.html") {
			return new Response(indexHtml, {
				headers: { "content-type": "text/html; charset=utf-8" },
			});
		}

		if (url.pathname === "/entry.js") {
			return new Response(bundleBody, {
				headers: { "content-type": "text/javascript; charset=utf-8" },
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

console.log(`UI shell on http://${server.hostname}:${server.port}`);
console.log(`Proxying /v1/* -> ${backend}`);
