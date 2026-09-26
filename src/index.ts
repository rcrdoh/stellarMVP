import process from "node:process";
import Fastify from "fastify";
import { env } from "./config/env.js";
import { buildServer } from "./http/server.js";
import { createAgentRuntime } from "./integrations/agent-runtime.js";
import { createPaymentRuntime } from "./integrations/payment-runtime.js";

const agentRuntime = env.AGENT_COMMERCE_ENABLED
	? await createAgentRuntime(env)
	: undefined;
const paymentRuntime = env.PAYMENTS_ENABLED
	? await createPaymentRuntime(env)
	: undefined;

const app = await buildServer({
	fastifyFactory: Fastify,
	...(agentRuntime === undefined
		? {}
		: {
				agent: agentRuntime.integrations,
				closeClient: agentRuntime.close,
			}),
	...(paymentRuntime === undefined ? {} : { payments: paymentRuntime }),
});

// Vercel imports this module and serves the exported Fastify instance as a
// Function; binding a port is only meaningful for local processes
// (`bun run dev` / `bun run start`) and Docker.
if (!process.env.VERCEL) {
	await app.listen({ host: env.HOST, port: env.PORT });
}

export default app;
