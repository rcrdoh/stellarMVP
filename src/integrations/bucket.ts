export interface ObjectBucket {
	isReady(): Promise<boolean>;
}

export class LocalBucket implements ObjectBucket {
	async isReady(): Promise<boolean> {
		return true;
	}
}

export class ObjectStorageBucket implements ObjectBucket {
	async isReady(): Promise<boolean> {
		// Connect S3, GCS, MinIO, or another bucket client here when needed.
		throw new Error(
			"Configure an object storage client before enabling this adapter.",
		);
	}
}
