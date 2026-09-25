import { ChatOpenAI } from "@langchain/openai";

export function createGroqChatModel(options: {
	apiKey: string;
	model: string;
}): ChatOpenAI {
	if (!options.apiKey) throw new Error("Groq API is not configured");
	return new ChatOpenAI({
		apiKey: options.apiKey,
		model: options.model,
		temperature: 0.2,
		maxRetries: 2,
		timeout: 20_000,
		configuration: { baseURL: "https://api.groq.com/openai/v1" },
	});
}
