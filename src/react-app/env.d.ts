/** Build-time `process.env` keys injected by `scripts/serve-react-app.ts`
 * (Bun `define`) and the frontend build. Only the browser-safe, non-secret
 * overrides are declared here. */

declare namespace NodeJS {
	interface ProcessEnv {
		NODE_ENV?: string;
		REACT_MOCK_MODE?: string;
		REACT_AGENT_TOKEN?: string;
		REACT_SERVICE_TOKEN?: string;
		REACT_PRINCIPAL_ID?: string;
	}
}

declare const process: {
	env: NodeJS.ProcessEnv;
};

declare module "*.css";
declare module "@fontsource/*";
