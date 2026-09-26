const specPath = new URL("../specs/openapi.json", import.meta.url);

type OpenApiSpec = {
	openapi?: string;
	paths?: Record<string, Record<string, Operation>>;
	components?: {
		schemas?: Record<string, unknown>;
		securitySchemes?: Record<string, unknown>;
	};
};

type Operation = {
	operationId?: string;
	responses?: Record<string, ResponseObject>;
	security?: Array<Record<string, string[]>>;
};

type ResponseObject = {
	$ref?: string;
	content?: {
		"application/json"?: {
			schema?: {
				$ref?: string;
			};
		};
		"application/problem+json"?: {
			schema?: {
				$ref?: string;
			};
		};
	};
};

export async function loadSpec(): Promise<OpenApiSpec> {
	return (await Bun.file(specPath).json()) as OpenApiSpec;
}

export function validateSpec(spec: OpenApiSpec): string[] {
	const errors: string[] = [];
	if (spec.openapi !== "3.1.0") {
		errors.push("openapi must be 3.1.0");
	}

	if (!spec.paths || Object.keys(spec.paths).length === 0) {
		errors.push("paths must be a non-empty object");
		return errors;
	}

	if (!spec.components?.schemas?.Problem) {
		errors.push("components.schemas.Problem is required");
	}

	const methods = new Set([
		"get",
		"post",
		"put",
		"patch",
		"delete",
		"options",
		"head",
	]);
	for (const [path, pathItem] of Object.entries(spec.paths)) {
		for (const [method, operation] of Object.entries(pathItem)) {
			if (!methods.has(method)) {
				continue;
			}
			const location = `${method.toUpperCase()} ${path}`;
			if (!operation.operationId) {
				errors.push(`${location} must define operationId`);
			}
			if (
				!operation.responses ||
				Object.keys(operation.responses).length === 0
			) {
				errors.push(`${location} must define responses`);
				continue;
			}
			for (const [statusCode, response] of Object.entries(
				operation.responses,
			)) {
				if (/^[45]/.test(statusCode)) {
					const ref =
						response.content?.["application/problem+json"]?.schema?.$ref;
					if (
						ref !== "#/components/schemas/Problem" &&
						response.$ref !== "#/components/responses/ProblemResponse"
					) {
						errors.push(
							`${location} response ${statusCode} must use Problem as application/problem+json`,
						);
					}
				}
			}
		}
	}

	return errors;
}

if (import.meta.main) {
	const errors = validateSpec(await loadSpec());
	if (errors.length > 0) {
		for (const error of errors) {
			console.error(`spec error: ${error}`);
		}
		process.exit(1);
	}
	console.log(`OpenAPI spec OK: ${specPath.pathname}`);
}
