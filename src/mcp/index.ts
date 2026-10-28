/** Public embedding entry point for trusted MCP hosts. This is Node-only. */
export { createPtfServer } from "../mcp-server.js";
export type { PtfServerOptions } from "../mcp-server.js";
export { validateOpaqueEmailAction } from "./registered-actions.js";
export type { RegisteredAction } from "./registered-actions.js";
