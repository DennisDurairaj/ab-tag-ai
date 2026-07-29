import { tagged, detail } from "./logger.js";

const DEFAULT_MAX_ITERATIONS = 5;

export interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCallResult<TValue = unknown> {
  outcome: "terminal" | "continue";
  value?: TValue;
  content?: string;
}

export interface AgentResult<TValue = unknown> {
  status: "ok" | "error";
  value?: TValue;
  reason?: string;
}

export interface RunAgentOptions<TValue = unknown> {
  systemPrompt: string;
  initialMessage: string;
  tools: OpenAITool[];
  handleToolCall: (name: string, args: Record<string, unknown>) => Promise<ToolCallResult<TValue>>;
  model: string;
  apiKey: string;
  apiBaseUrl?: string;
  fetchFn?: typeof fetch;
  logLabel: string;
  maxIterations?: number;
}

interface ChatMessage {
  role: string;
  content?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
}

export async function runAgent<TValue = unknown>(
  options: RunAgentOptions<TValue>,
): Promise<AgentResult<TValue>> {
  const {
    systemPrompt,
    initialMessage,
    tools,
    handleToolCall,
    model,
    apiKey,
    apiBaseUrl = "https://api.openai.com/v1",
    fetchFn = fetch,
    logLabel,
    maxIterations = DEFAULT_MAX_ITERATIONS,
  } = options;

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: initialMessage },
  ];
  let lastContent = "";

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    tagged(logLabel, `Round ${iteration + 1}/${maxIterations}`, "cyan");

    let response: Response | undefined;
    let retryDelay = 1000;
    for (let retry = 0; retry < 3; retry++) {
      if (retry > 0) {
        tagged("Req", `Retry ${retry}/3 after ${retryDelay}ms`, "yellow");
        await new Promise((r) => setTimeout(r, retryDelay));
        retryDelay *= 2;
      }
      try {
        response = await fetchFn(`${apiBaseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ model, messages, tools, tool_choice: "auto" }),
        });
        if (response.status !== 429) break;
      } catch (e) {
        tagged("Req", `Fetch failed: ${(e as Error)?.message?.slice(0, 80) || e}`, "red");
        response = undefined;
      }
    }

    if (!response || !response.ok) {
      return { status: "error", reason: `LLM API error: ${response?.status || "unknown"}` };
    }

    const data = await response.json() as {
      choices?: Array<{
        message?: ChatMessage;
      }>;
    };

    const message = data.choices?.[0]?.message;
    if (!message) {
      return { status: "error", reason: "LLM returned empty response" };
    }

    if (message.content) {
      lastContent = message.content;
      detail(`[${logLabel}] ${message.content.slice(0, 200)}`);
    }

    messages.push(message);

    const toolCalls = message.tool_calls;
    if (!toolCalls || toolCalls.length === 0) {
      return {
        status: "error",
        reason: lastContent || "LLM finished without calling any tools",
      };
    }

    for (const toolCall of toolCalls) {
      const { name, arguments: argsStr } = toolCall.function;
      detail(`[Tool call] ${name}(${argsStr.slice(0, 200)})`);

      let args: Record<string, unknown>;
      try {
        args = JSON.parse(argsStr);
      } catch {
        messages.push({ role: "tool", tool_call_id: toolCall.id, content: "Error: invalid arguments" });
        continue;
      }

      try {
        const result = await handleToolCall(name, args);
        if (result.outcome === "terminal") {
          return { status: "ok", value: result.value };
        }
        detail(`[Tool result] ${(result.content || "").slice(0, 300)}`);
        messages.push({ role: "tool", tool_call_id: toolCall.id, content: result.content || "" });
      } catch (e) {
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: `Error: ${(e as Error)?.message || "tool handler failed"}`,
        });
      }
    }
  }

  const prefix = lastContent ? `${lastContent.slice(0, 200)} — ` : "";
  return {
    status: "error",
    reason: `${prefix}Exceeded max iterations (${maxIterations}) without terminal tool call`,
  };
}
