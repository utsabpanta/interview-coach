/** Model interface shared by the CLI and the web app. Pure types: no runtime imports. */

/** A structured-output request: the model must reply by filling in this schema. */
export interface ToolSpec {
  name: string;
  description: string;
  schema: Record<string, unknown>;
}

/** The only surface the coach needs from a model. Tests supply a fake. */
export interface LLM {
  text(system: string, user: string, maxTokens?: number): Promise<string>;
  structured<T>(system: string, user: string, tool: ToolSpec, maxTokens?: number): Promise<T>;
}
