import type { AudioMetadata, BookIdentity, ResolvedMetadata } from "./types.js";

export interface VerificationEvidence {
  identity: BookIdentity;
  existingMetadata: AudioMetadata;
  candidate: ResolvedMetadata;
}

export interface VerificationResult {
  verdict: "trust" | "flag" | "retry";
  reason: string;
  retryHint?: string;
}

export type Verifier = (evidence: VerificationEvidence) => Promise<VerificationResult>;

export interface LlmVerifierOptions {
  model: string;
  apiKey?: string;
  apiBaseUrl?: string;
  fetchFn?: typeof fetch;
}

const DEFAULT_API_BASE_URL = "https://api.openai.com/v1";

function buildPrompt(evidence: VerificationEvidence): string {
  const { identity, existingMetadata, candidate } = evidence;
  const lines: string[] = [
    "You are verifying audiobook metadata. Given the inferred identity from the file system and a provider candidate, determine if they match.",
    "",
    `Inferred title: ${identity.title}`,
    `Inferred author: ${identity.author}`,
    "",
    `Existing tag title: ${existingMetadata.title || "none"}`,
    `Existing tag artist: ${existingMetadata.artist || "none"}`,
    "",
    `Candidate title: ${candidate.title}`,
    `Candidate author: ${candidate.author}`,
    `Candidate ASIN: ${candidate.asin}`,
    `Candidate series: ${candidate.series || "none"}`,
    `Candidate series part: ${candidate.seriesPart || "none"}`,
    "",
    'Respond with a JSON object: {"verdict": "trust" | "flag" | "retry", "reason": "short explanation", "retryHint": "optional, only for retry"}.',
    "trust = the candidate matches the inferred book. flag = the candidate does not match, flag for manual review. retry = try a different provider.",
  ];
  return lines.join("\n");
}

export function createLlmVerifier(options: LlmVerifierOptions): Verifier {
  const { model, apiBaseUrl = DEFAULT_API_BASE_URL, fetchFn = fetch } = options;
  const apiKey = options.apiKey || process.env.LLM_API_KEY;

  return async (evidence: VerificationEvidence): Promise<VerificationResult> => {
    if (!apiKey) {
      return { verdict: "flag", reason: "LLM API key not configured" };
    }

    try {
      const response = await fetchFn(`${apiBaseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "You are an audiobook metadata verifier. Respond only with JSON." },
            { role: "user", content: buildPrompt(evidence) },
          ],
          response_format: { type: "json_object" },
        }),
      });

      if (!response.ok) {
        return { verdict: "flag", reason: `LLM API error: ${response.status}` };
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      const content = data.choices?.[0]?.message?.content;
      if (!content) {
        return { verdict: "flag", reason: "LLM returned empty response" };
      }

      try {
        const parsed = JSON.parse(content) as VerificationResult;
        if (parsed.verdict !== "trust" && parsed.verdict !== "flag" && parsed.verdict !== "retry") {
          return { verdict: "flag", reason: `LLM returned invalid verdict: ${parsed.verdict}` };
        }
        return {
          verdict: parsed.verdict,
          reason: parsed.reason || "No reason provided",
          retryHint: parsed.retryHint,
        };
      } catch {
        return { verdict: "flag", reason: "LLM response could not be parsed as JSON" };
      }
    } catch {
      return { verdict: "flag", reason: "LLM request failed" };
    }
  };
}
