// CHB-008 targets of gen-docs: the texts the bridge's MCP server embeds (go:embed cannot reach outside the Go
// module), generated from the same sources as the in-app chat's system prompt, so both transports read one manual.
import { genInstructions, genReference } from '../../packages/dsl/src/docs/generate.ts';
import { EVAL_TOOL_DESCRIPTION } from '../../packages/agent/src/chat/prompt.ts';

const HOW = `
## Using this MCP server

Call \`status\` first: it lists the open frames and the mode the photographer set. Then call \`eval\` with the body
of an async function; omit \`sessionId\`, \`frame\` and \`timeoutMs\` unless you have a reason. The full reference is
the resource chromobench://reference (also in the chromobench-agent prompt).
`;

export function agentFiles(): [string, string][] {
  return [
    ['bridge/internal/mcpserver/generated/instructions.md', genInstructions() + HOW],
    ['bridge/internal/mcpserver/generated/reference.md', genReference()],
    ['bridge/internal/mcpserver/generated/eval-tool.txt', `${EVAL_TOOL_DESCRIPTION}\n`],
  ];
}
