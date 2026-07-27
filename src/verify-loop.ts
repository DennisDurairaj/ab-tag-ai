import type { AudioMetadata, BookIdentity, ResolvedMetadata, ProviderName } from "./types.js";
import type { Verifier, VerificationResult } from "./verifier.js";
import type { ResolveMetadataResult } from "./providers/metadata-resolver.js";

export interface VerifyWithRetryOptions {
  identity: BookIdentity;
  existingMetadata: AudioMetadata;
  fetcher: (skipProviders: ProviderName[]) => Promise<ResolveMetadataResult>;
  verifier: Verifier;
}

export type VerifyWithRetryResult =
  | { trusted: true; metadata: ResolvedMetadata; verdict: VerificationResult }
  | { trusted: false; metadata: ResolvedMetadata | null; verdict: VerificationResult | null };

export async function verifyWithRetry(options: VerifyWithRetryOptions): Promise<VerifyWithRetryResult> {
  const { identity, existingMetadata, fetcher, verifier } = options;
  let skipProviders: ProviderName[] = [];
  let lastVerdict: VerificationResult | null = null;
  let lastMetadata: ResolvedMetadata | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    const candidateResult = await fetcher(skipProviders);
    if (!candidateResult.metadata) break;

    skipProviders = [...skipProviders, candidateResult.source as ProviderName];
    lastMetadata = candidateResult.metadata;

    const verdict = await verifier({ identity, existingMetadata, candidate: candidateResult.metadata });
    lastVerdict = verdict;

    if (verdict.verdict === "trust") {
      return { trusted: true, metadata: lastMetadata, verdict };
    }
    if (verdict.verdict === "flag") {
      return { trusted: false, metadata: lastMetadata, verdict };
    }
  }

  return { trusted: false, metadata: lastMetadata, verdict: lastVerdict };
}
