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
				agent: {
					...agentRuntime.integrations,
					shoppingConversation: agentRuntime.getShoppingConversation,
				},
				closeClient: agentRuntime.close,
			}),
	...(paymentRuntime === undefined ? {} : { payments: paymentRuntime }),
});

// Local processes (`bun run dev` / `bun run start`) and the Docker image bind
// the port; the exported instance stays available for tests.
await app.listen({ host: env.HOST, port: env.PORT });

export default app;
