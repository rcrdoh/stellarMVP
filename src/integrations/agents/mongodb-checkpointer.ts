import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { MongoDBSaver } from "@langchain/langgraph-checkpoint-mongodb";
import { MongoClient } from "mongodb";

export type MongoAgentCheckpointer = {
	checkpointer: BaseCheckpointSaver;
	close(): Promise<void>;
};

export async function createMongoAgentCheckpointer(options: {
	uri: string;
	databaseName: string;
}): Promise<MongoAgentCheckpointer> {
	const client = new MongoClient(options.uri);
	try {
		await client.connect();
		const checkpointer = new MongoDBSaver({
			client,
			dbName: options.databaseName,
		});
		const setupErrors = await checkpointer.setup();
		if (setupErrors.length > 0) {
			throw new AggregateError(setupErrors, "MongoDB checkpoint setup failed");
		}
		return { checkpointer, close: () => client.close() };
	} catch (error) {
		await client.close();
		throw error;
	}
}
