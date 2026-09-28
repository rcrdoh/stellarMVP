import { Buffer } from "node:buffer";
import type { FastifyReply } from "fastify";
import {
	type X402ChallengePayload,
	X402ChallengePayloadSchema,
} from "../../domain/checkout/types.js";

/** Base64-encode a validated x402 challenge for transport on a header/body. */
export function encodeX402Challenge(payload: X402ChallengePayload): string {
	const parsed = X402ChallengePayloadSchema.parse(payload);
	return Buffer.from(JSON.stringify(parsed), "utf8").toString("base64");
}

/**
 * Attach the `X-402-Challenge` header to a reply without sending a body. The
 * caller (usually the shared error handler) owns the RFC 9457 problem payload,
 * so this helper stays side-effect free and only guarantees the negotiation
 * header is present exactly once.
 */
export function replyWithX402Challenge(
	reply: FastifyReply,
	payload: X402ChallengePayload,
): string {
	const challenge = encodeX402Challenge(payload);
	reply.header("X-402-Challenge", challenge);
	return challenge;
}
