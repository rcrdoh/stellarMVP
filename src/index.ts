import Fastify from "fastify";
import { env } from "./config/env.js";
import { buildServer } from "./http/server.js";

const app = await buildServer({ fastifyFactory: Fastify });

await app.listen({ host: env.HOST, port: env.PORT });
