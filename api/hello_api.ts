import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.status(200).json({
    message: "Env check",   
    anthropicKeyLoaded: Boolean(process.env.ANTHROPIC_API_KEY),
    stellarNetworkConfigured: Boolean(process.env.STELLAR_NETWORK),
  });
}