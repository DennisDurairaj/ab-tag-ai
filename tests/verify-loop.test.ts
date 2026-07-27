import { describe, it, expect, vi } from "vitest";
import { verifyWithRetry } from "../src/verify-loop.js";
import type { ResolvedMetadata, ProviderName } from "../src/types.js";
import type { ResolveMetadataResult } from "../src/providers/metadata-resolver.js";

const CANDIDATE_1: ResolvedMetadata = {
  title: "The Hobbit",
  author: "J.R.R. Tolkien",
  asin: "B000002IX7",
};

const CANDIDATE_2: ResolvedMetadata = {
  title: "The Hobbit",
  author: "Tolkien",
  asin: "0544003411",
};

const IDENTITY = { title: "The Hobbit", author: "Tolkien" };

function mkResult(metadata: ResolvedMetadata | null, source: string): ResolveMetadataResult {
  return { metadata, source } as ResolveMetadataResult;
}

describe("verifyWithRetry", () => {
  it("trusts on first candidate and stops", async () => {
    const fetcher = vi.fn(async (_skip: ProviderName[]) => mkResult(CANDIDATE_1, "audnexus"));
    const verifier = vi.fn(async () => ({ verdict: "trust" as const, reason: "exact match" }));

    const result = await verifyWithRetry({
      identity: IDENTITY,
      existingMetadata: {},
      fetcher,
      verifier,
    });

    expect(result.trusted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith([]);
    expect(verifier).toHaveBeenCalledTimes(1);
  });

  it("retries then trusts on second candidate", async () => {
    let fetchCall = 0;
    const fetcher = vi.fn(async (skip: ProviderName[]) => {
      fetchCall++;
      if (fetchCall === 1) return mkResult(CANDIDATE_1, "audnexus");
      expect(skip).toEqual(["audnexus"]);
      return mkResult(CANDIDATE_2, "open-library");
    });

    let verifyCall = 0;
    const verifier = vi.fn(async () => {
      verifyCall++;
      if (verifyCall === 1) return { verdict: "retry" as const, reason: "wrong edition" };
      return { verdict: "trust" as const, reason: "match" };
    });

    const result = await verifyWithRetry({
      identity: IDENTITY,
      existingMetadata: {},
      fetcher,
      verifier,
    });

    expect(result.trusted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(verifier).toHaveBeenCalledTimes(2);
  });

  it("flags on first candidate and stops without retrying", async () => {
    const fetcher = vi.fn(async (_skip: ProviderName[]) => mkResult(CANDIDATE_1, "audnexus"));
    const verifier = vi.fn(async () => ({ verdict: "flag" as const, reason: "Polish translation" }));

    const result = await verifyWithRetry({
      identity: IDENTITY,
      existingMetadata: {},
      fetcher,
      verifier,
    });

    expect(result.trusted).toBe(false);
    expect(result.verdict?.reason).toBe("Polish translation");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(verifier).toHaveBeenCalledTimes(1);
  });

  it("retries then flags on second candidate", async () => {
    let fetchCall = 0;
    const fetcher = vi.fn(async (_skip: ProviderName[]) => {
      fetchCall++;
      if (fetchCall === 1) return mkResult(CANDIDATE_1, "audnexus");
      return mkResult(CANDIDATE_2, "open-library");
    });

    let verifyCall = 0;
    const verifier = vi.fn(async () => {
      verifyCall++;
      if (verifyCall === 1) return { verdict: "retry" as const, reason: "wrong" };
      return { verdict: "flag" as const, reason: "also wrong" };
    });

    const result = await verifyWithRetry({
      identity: IDENTITY,
      existingMetadata: {},
      fetcher,
      verifier,
    });

    expect(result.trusted).toBe(false);
    expect(result.verdict?.reason).toBe("also wrong");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(verifier).toHaveBeenCalledTimes(2);
  });

  it("returns null verdict when all providers fail to return candidates", async () => {
    const fetcher = vi.fn(async (_skip: ProviderName[]) => mkResult(null, "none"));
    const verifier = vi.fn();

    const result = await verifyWithRetry({
      identity: IDENTITY,
      existingMetadata: {},
      fetcher,
      verifier,
    });

    expect(result.trusted).toBe(false);
    expect(result.verdict).toBeNull();
    expect(result.metadata).toBeNull();
    expect(verifier).not.toHaveBeenCalled();
  });

  it("stops after max 1 retry even if LLM keeps requesting retry", async () => {
    let fetchCall = 0;
    const fetcher = vi.fn(async (_skip: ProviderName[]) => {
      fetchCall++;
      if (fetchCall === 1) return mkResult(CANDIDATE_1, "audnexus");
      return mkResult(CANDIDATE_2, "open-library");
    });

    const verifier = vi.fn(async () => ({ verdict: "retry" as const, reason: "keep trying" }));

    const result = await verifyWithRetry({
      identity: IDENTITY,
      existingMetadata: {},
      fetcher,
      verifier,
    });

    expect(result.trusted).toBe(false);
    expect(result.verdict?.reason).toBe("keep trying");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(verifier).toHaveBeenCalledTimes(2);
  });
});
