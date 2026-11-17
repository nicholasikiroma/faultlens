import {
  EPISTEMIC_STATUSES,
  HYPOTHESIS_CONFIDENCES,
  REMEDIATION_KINDS,
  type EpistemicStatus,
  type HypothesisConfidence,
  type RemediationKind,
  type RemediationProposal,
  type TrustTier,
} from '#domain';
import type { AgentDiagnosisOutput, AgentHypothesisOutput } from './types.ts';

const SECRET_KEY_RE =
  /^(secret|authorization|signingkey|apikey|accesstoken|refreshtoken|password|passwd|privatekey|clientsecret|cookie|setcookie|xapikey)$|secret$/;

const SECRET_TEXT_REPLACEMENTS: readonly {
  readonly pattern: RegExp;
  readonly replacement: string;
}[] = [
  {
    pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
    replacement: 'Bearer [REDACTED]',
  },
  {
    pattern: /\b(?:sk_live|sk_test|rk_live|rk_test|whsec|ghp|gho|glpat|xoxb|xoxp|flk)_[A-Za-z0-9_-]{8,}/g,
    replacement: '[REDACTED_SECRET]',
  },
  {
    pattern: /([?&](?:token|key|secret|api_key|apikey|access_token|password|sig)=)[^&\s]+/gi,
    replacement: '$1[REDACTED]',
  },
  {
    pattern: /(postgres(?:ql)?:\/\/[^:\s/]+:)[^@\s/]+(@)/gi,
    replacement: '$1[REDACTED]$2',
  },
];

export function scrubSecretsText(text: string): string {
  let clean = text;
  for (const { pattern, replacement } of SECRET_TEXT_REPLACEMENTS) {
    clean = clean.replace(pattern, replacement);
  }
  return clean;
}

export function redactUnknown(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[TRUNCATED_DEPTH]';
  if (typeof value === 'string') return scrubSecretsText(value);
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => redactUnknown(item, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (value === null || typeof value !== 'object') return value;

  const clean: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase().replace(/[_-]/g, '');
    if (SECRET_KEY_RE.test(normalizedKey)) {
      clean[key] = '[REDACTED]';
      continue;
    }
    clean[key] = redactUnknown(child, depth + 1);
  }
  return clean;
}

/**
 * Wraps untrusted payload/exception text in explicit data delimiters so the model
 * treats third-party text strictly as observations rather than instructions.
 */
export function wrapUntrustedText(text: string, trustTier: TrustTier = 'B'): string {
  const safe = scrubSecretsText(text)
    .replace(/<\/?untrusted_observation[^>]*>/gi, '[TAG_STRIPPED]')
    .slice(0, 1_500);
  return `<untrusted_observation trust_tier="${trustTier}">${safe}</untrusted_observation>`;
}

export function capJsonString(value: unknown, maxChars: number): string {
  const serialized = JSON.stringify(value);
  if (serialized.length <= maxChars) return serialized;
  const truncated = serialized.slice(0, Math.max(0, maxChars - 80));
  return JSON.stringify({
    truncated: true,
    originalLength: serialized.length,
    preview: truncated,
  });
}

export function extractJsonObjectText(rawText: string): string | null {
  const trimmed = rawText.trim();
  if (trimmed.length === 0) return null;

  const fencedMatch = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fencedMatch?.[1]?.trim() ?? trimmed;

  const firstBrace = candidate.indexOf('{');
  const lastBrace = candidate.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
    return null;
  }
  return candidate.slice(firstBrace, lastBrace + 1);
}

export function verifyAndNormalizeOutput(
  rawText: string,
  observedEvidenceIds: ReadonlySet<string>,
  maxHypotheses: number,
):
  | { ok: true; value: AgentDiagnosisOutput; downgradedCount: number }
  | { ok: false; reason: string } {
  const jsonText = extractJsonObjectText(rawText);
  if (jsonText === null) {
    return { ok: false, reason: 'Model response did not contain a JSON object' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { ok: false, reason: 'Model response contained invalid JSON' };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'Root JSON value must be an object' };
  }
  const obj = parsed as Record<string, unknown>;

  const knownSummary = asNonEmptyString(obj['knownSummary']);
  const suspectSummary = asNonEmptyString(obj['suspectSummary']);
  const nextSafeCheckSummary = asNonEmptyString(obj['nextSafeCheckSummary']);

  if (!knownSummary || !suspectSummary || !nextSafeCheckSummary) {
    return {
      ok: false,
      reason: 'knownSummary, suspectSummary, and nextSafeCheckSummary must be non-empty strings',
    };
  }

  if (!Array.isArray(obj['hypotheses']) || obj['hypotheses'].length === 0) {
    return { ok: false, reason: 'hypotheses must be a non-empty array' };
  }

  let downgradedCount = 0;
  const hypotheses: AgentHypothesisOutput[] = [];

  for (const rawHyp of obj['hypotheses'].slice(0, maxHypotheses)) {
    if (rawHyp === null || typeof rawHyp !== 'object' || Array.isArray(rawHyp)) {
      return { ok: false, reason: 'Each hypothesis must be an object' };
    }
    const h = rawHyp as Record<string, unknown>;
    const title = asNonEmptyString(h['title']);
    const reasoning = asNonEmptyString(h['reasoning']);
    const suggestedCheck = asNonEmptyString(h['suggestedCheck']);
    if (!title || !reasoning || !suggestedCheck) {
      return {
        ok: false,
        reason: 'Each hypothesis requires non-empty title, reasoning, and suggestedCheck',
      };
    }

    const rawEpistemic = parseEnum(h['epistemicStatus'], EPISTEMIC_STATUSES) ?? 'HYPOTHESIS';
    const confidence: HypothesisConfidence =
      parseEnum(h['confidence'], HYPOTHESIS_CONFIDENCES) ?? 'LOW';

    const rawCited = Array.isArray(h['citedEvidenceIds'])
      ? h['citedEvidenceIds'].filter((item): item is string => typeof item === 'string')
      : [];
    const validCited = [...new Set(rawCited.filter((id) => observedEvidenceIds.has(id)))];
    const droppedInvalidCount = rawCited.length - validCited.length;

    const missingInformation = Array.isArray(h['missingInformation'])
      ? h['missingInformation']
          .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          .map((item) => scrubSecretsText(item.trim()))
      : [];

    let epistemicStatus: EpistemicStatus = rawEpistemic;
    if ((rawEpistemic === 'OBSERVED' || rawEpistemic === 'INFERRED') && validCited.length === 0) {
      epistemicStatus = 'UNVERIFIED';
      downgradedCount += 1;
      missingInformation.push(
        'Claim was downgraded to UNVERIFIED because no valid observed evidence ID was cited.',
      );
    } else if (droppedInvalidCount > 0) {
      downgradedCount += 1;
      missingInformation.push(
        `Stripped ${droppedInvalidCount} unverified or unknown evidence citation(s).`,
      );
    }

    const remediation = normalizeRemediation(h['remediation']);

    hypotheses.push({
      title: scrubSecretsText(title),
      reasoning: scrubSecretsText(reasoning),
      epistemicStatus,
      confidence,
      citedEvidenceIds: validCited,
      missingInformation,
      suggestedCheck: scrubSecretsText(suggestedCheck),
      remediation,
    });
  }

  return {
    ok: true,
    downgradedCount,
    value: {
      knownSummary: scrubSecretsText(knownSummary),
      suspectSummary: scrubSecretsText(suspectSummary),
      nextSafeCheckSummary: scrubSecretsText(nextSafeCheckSummary),
      hypotheses,
    },
  };
}

function normalizeRemediation(raw: unknown): RemediationProposal | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const kind: RemediationKind | null = parseEnum(obj['kind'], REMEDIATION_KINDS);
  const summary = asNonEmptyString(obj['summary']);
  const snippet = asNonEmptyString(obj['snippet']);
  const safetyNote = asNonEmptyString(obj['safetyNote']);
  if (!kind || !summary || !snippet) return null;
  return {
    kind,
    summary: scrubSecretsText(summary),
    snippet: scrubSecretsText(snippet),
    safetyNote: scrubSecretsText(
      safetyNote ?? 'Review before applying to production; WireSleuth never executes changes automatically.',
    ),
  };
}

function asNonEmptyString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseEnum<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  if (typeof value !== 'string') return null;
  return (allowed as readonly string[]).includes(value) ? (value as T) : null;
}
