export interface Database {
	isReady(): Promise<boolean>;
}

export class LocalDatabase implements Database {
	async isReady(): Promise<boolean> {
		return true;
	}
}

export class PostgresDatabase implements Database {
	async isReady(): Promise<boolean> {
		// Use Prisma Client here for TypeScript/Postgres persistence when needed.
		throw new Error(
			"Configure Prisma with Postgres before enabling this adapter.",
		);
	}
}
