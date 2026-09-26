import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const publicDirectory = join(projectRoot, "public");

const assetFiles = {
	html: "agent-console.html",
	css: "agent-console.css",
	javascript: "agent-console.js",
} as const;

export type FrontendAsset = keyof typeof assetFiles;

export function readFrontendAsset(asset: FrontendAsset): Promise<string> {
	return readFile(join(publicDirectory, assetFiles[asset]), "utf8");
}
