import { env } from "./config/env.js";
import { buildServer } from "./http/server.js";

const app = await buildServer();

await app.listen({ host: env.HOST, port: env.PORT });
