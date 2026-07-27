import { describe, it, expect, afterEach } from "vitest";
import { createLlmVerifier } from "../src/verifier.js";
import type { VerificationEvidence } from "../src/verifier.js";

function createMockFetch(response: { status: number; body: unknown }) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const mockFn = async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(response.body), { status: response.status });
  };
  return { mockFn, calls };
}

const EVIDENCE: VerificationEvidence = {
  identity: { title: "The Hobbit", author: "Tolkien" },
  existingMetadata: {},
  candidate: {
    title: "The Hobbit",
    author: "J.R.R. Tolkien",
    asin: "B000002IX7",
  },
};

describe("createLlmVerifier", () => {
  it("returns trust verdict when LLM confirms match", async () => {
    const { mockFn } = createMockFetch({
      status: 200,
      body: {
        choices: [{
          message: { content: JSON.stringify({ verdict: "trust", reason: "Titles match exactly" }) },
        }],
      },
    });

    const verifier = createLlmVerifier({ model: "gpt-4o-mini", apiKey: "test-key", fetchFn: mockFn });
    const result = await verifier(EVIDENCE);

    expect(result.verdict).toBe("trust");
    expect(result.reason).toBe("Titles match exactly");
  });

  it("returns flag verdict when LLM detects mismatch", async () => {
    const { mockFn } = createMockFetch({
      status: 200,
      body: {
        choices: [{
          message: { content: JSON.stringify({ verdict: "flag", reason: "Candidate is a Polish translation" }) },
        }],
      },
    });

    const verifier = createLlmVerifier({ model: "gpt-4o-mini", apiKey: "test-key", fetchFn: mockFn });
    const result = await verifier(EVIDENCE);

    expect(result.verdict).toBe("flag");
    expect(result.reason).toBe("Candidate is a Polish translation");
  });

  it("returns retry verdict with retryHint", async () => {
    const { mockFn } = createMockFetch({
      status: 200,
      body: {
        choices: [{
          message: { content: JSON.stringify({ verdict: "retry", reason: "Audnexus result is wrong edition", retryHint: "Try Open Library" }) },
        }],
      },
    });

    const verifier = createLlmVerifier({ model: "gpt-4o-mini", apiKey: "test-key", fetchFn: mockFn });
    const result = await verifier(EVIDENCE);

    expect(result.verdict).toBe("retry");
    expect(result.reason).toBe("Audnexus result is wrong edition");
    expect(result.retryHint).toBe("Try Open Library");
  });

  it("sends the model name in the API request", async () => {
    const { mockFn, calls } = createMockFetch({
      status: 200,
      body: { choices: [{ message: { content: JSON.stringify({ verdict: "trust", reason: "ok" }) } }] },
    });

    const verifier = createLlmVerifier({ model: "claude-3-haiku", apiKey: "test-key", fetchFn: mockFn });
    await verifier(EVIDENCE);

    const body = JSON.parse(calls[0].init?.body as string);
    expect(body.model).toBe("claude-3-haiku");
  });

  it("sends the API key as a Bearer token", async () => {
    const { mockFn, calls } = createMockFetch({
      status: 200,
      body: { choices: [{ message: { content: JSON.stringify({ verdict: "trust", reason: "ok" }) } }] },
    });

    const verifier = createLlmVerifier({ model: "gpt-4o-mini", apiKey: "secret-key", fetchFn: mockFn });
    await verifier(EVIDENCE);

    const headers = calls[0].init?.headers as Record<string, string>;
    const authHeader = headers["authorization"] || headers["Authorization"];
    expect(authHeader).toBe("Bearer secret-key");
  });

  it("includes identity and candidate in the prompt", async () => {
    const { mockFn, calls } = createMockFetch({
      status: 200,
      body: { choices: [{ message: { content: JSON.stringify({ verdict: "trust", reason: "ok" }) } }] },
    });

    const verifier = createLlmVerifier({ model: "gpt-4o-mini", apiKey: "test-key", fetchFn: mockFn });
    await verifier(EVIDENCE);

    const body = JSON.parse(calls[0].init?.body as string);
    const promptContent = JSON.stringify(body.messages);
    expect(promptContent).toContain("The Hobbit");
    expect(promptContent).toContain("Tolkien");
    expect(promptContent).toContain("B000002IX7");
  });

  it("returns flag verdict on LLM API error", async () => {
    const { mockFn } = createMockFetch({
      status: 500,
      body: { error: "Server Error" },
    });

    const verifier = createLlmVerifier({ model: "gpt-4o-mini", apiKey: "test-key", fetchFn: mockFn });
    const result = await verifier(EVIDENCE);

    expect(result.verdict).toBe("flag");
    expect(result.reason).toContain("LLM API error");
  });

  it("returns flag verdict when LLM returns invalid JSON", async () => {
    const { mockFn } = createMockFetch({
      status: 200,
      body: { choices: [{ message: { content: "not valid json" } }] },
    });

    const verifier = createLlmVerifier({ model: "gpt-4o-mini", apiKey: "test-key", fetchFn: mockFn });
    const result = await verifier(EVIDENCE);

    expect(result.verdict).toBe("flag");
    expect(result.reason).toContain("parse");
  });

  it("reads API key from LLM_API_KEY env var when not provided", async () => {
    const originalEnv = process.env.LLM_API_KEY;
    process.env.LLM_API_KEY = "env-llm-key";

    const { mockFn, calls } = createMockFetch({
      status: 200,
      body: { choices: [{ message: { content: JSON.stringify({ verdict: "trust", reason: "ok" }) } }] },
    });

    const verifier = createLlmVerifier({ model: "gpt-4o-mini", fetchFn: mockFn });
    await verifier(EVIDENCE);

    const headers = calls[0].init?.headers as Record<string, string>;
    const authHeader = headers["authorization"] || headers["Authorization"];
    expect(authHeader).toBe("Bearer env-llm-key");

    if (originalEnv === undefined) {
      delete process.env.LLM_API_KEY;
    } else {
      process.env.LLM_API_KEY = originalEnv;
    }
  });
});
