// Tool names must satisfy OpenAI function-name constraints. The action id is
// the contract; the wire name is only a projection.

export function toToolName(action: string): string {
  return action.replace(/[^A-Za-z0-9_-]/g, "_");
}
