import { describe, expect, test } from "bun:test";

// Vercel importa el entrypoint y sirve la instancia exportada como Function. La
// variable VERCEL evita que el modulo abra un puerto durante la prueba.
process.env.VERCEL = "1";
const entrypoint = await import("../../src/index.js");

describe("Vercel entrypoint contract", () => {
	test("exports a Fastify instance as the default handler", async () => {
		const app = entrypoint.default;

		expect(app).toBeDefined();
		expect(app.hasRoute).toBeFunction();
		expect(app.ready).toBeFunction();
		expect(app.inject).toBeFunction();

		await app.ready();
		expect(app.hasRoute({ method: "GET", url: "/v1/health/live" })).toBe(true);
		expect(app.hasRoute({ method: "GET", url: "/api/hello_api" })).toBe(true);
	});

	test("exported app routes requests without binding a port", async () => {
		const app = entrypoint.default;
		await app.ready();

		const live = await app.inject({
			method: "GET",
			url: "/v1/health/live",
		});

		expect(live.statusCode).toBe(200);
		expect(live.json()).toMatchObject({ status: "ok" });
	});
});
