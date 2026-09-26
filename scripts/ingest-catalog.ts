import { OpenAIEmbeddings } from "@langchain/openai";
import { QdrantClient } from "@qdrant/js-client-rest";
import { env } from "../src/config/env.js";
import { BazaarCatalogClient } from "../src/integrations/bazaar-catalog.js";
import { OpenAIAdapter } from "../src/integrations/openai.js";
import { QdrantIndexAdapter } from "../src/integrations/qdrant.js";
import { UcpCatalogClient } from "../src/integrations/ucp-catalog.js";
import { CatalogIngestionService } from "../src/services/catalog-ingestion.js";

if (env.EMBEDDINGS_API_KEY.length === 0) {
	throw new Error("EMBEDDINGS_API_KEY is required for catalog ingestion");
}
if (env.QDRANT_URL.length === 0) {
	throw new Error("QDRANT_URL is required for catalog ingestion");
}
if (env.CATALOG_ADAPTER === "ucp" && env.UCP_AGENT_PROFILE_URL.length === 0) {
	throw new Error("UCP_AGENT_PROFILE_URL is required when CATALOG_ADAPTER=ucp");
}

const catalog =
	env.CATALOG_ADAPTER === "ucp"
		? new UcpCatalogClient({
				merchantUrl: env.CATALOG_MERCHANT_URL,
				merchantId: env.CATALOG_MERCHANT_ID,
				agentProfileUrl: env.UCP_AGENT_PROFILE_URL,
				timeoutMs: env.CATALOG_REQUEST_TIMEOUT_MS,
				maxProducts: env.CATALOG_MAX_PRODUCTS,
			})
		: new BazaarCatalogClient({
				merchantUrl: env.CATALOG_MERCHANT_URL,
				merchantId: env.CATALOG_MERCHANT_ID,
				...(env.CATALOG_SOURCE_URL.length === 0
					? {}
					: { catalogUrl: env.CATALOG_SOURCE_URL }),
				timeoutMs: env.CATALOG_REQUEST_TIMEOUT_MS,
				maxProducts: env.CATALOG_MAX_PRODUCTS,
			});
const embeddings = new OpenAIAdapter(
	{ invoke: async () => ({ content: "" }) },
	new OpenAIEmbeddings({
		apiKey: env.EMBEDDINGS_API_KEY,
		model: env.EMBEDDINGS_MODEL,
		...(env.EMBEDDINGS_API_BASE_URL.length === 0
			? {}
			: { configuration: { baseURL: env.EMBEDDINGS_API_BASE_URL } }),
	}),
);
const qdrant = new QdrantClient({
	url: env.QDRANT_URL,
	...(env.QDRANT_API_KEY.length === 0 ? {} : { apiKey: env.QDRANT_API_KEY }),
});
const ingestion = new CatalogIngestionService(
	catalog,
	embeddings,
	new QdrantIndexAdapter(qdrant),
	{
		merchantId: env.CATALOG_MERCHANT_ID,
		collection: env.QDRANT_COLLECTION,
		query: env.CATALOG_QUERY,
		limit: env.CATALOG_MAX_PRODUCTS,
	},
);

console.log(await ingestion.run());
