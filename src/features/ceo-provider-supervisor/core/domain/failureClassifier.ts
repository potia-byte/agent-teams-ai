import { isConfirmedSubscriptionQuota } from './policy';

import type { CeoFailure } from './policy';

export type FailureClass =
  | 'QUOTA_CONFIRMED'
  | 'RATE_LIMIT_TRANSIENT'
  | 'NETWORK'
  | 'AUTH_REQUIRED'
  | 'TOOL_ERROR'
  | 'HANG/TIMEOUT'
  | 'UNKNOWN_FAILURE';
export interface ClassifiedFailure {
  kind: FailureClass;
  action: 'switch' | 'wait-and-retry' | 'block' | 'ignore';
}

/** Only the existing narrow terminal subscription rule authorizes a handoff. */
export function classifyFailure(failure: CeoFailure): ClassifiedFailure {
  if (isConfirmedSubscriptionQuota(failure)) return { kind: 'QUOTA_CONFIRMED', action: 'switch' };
  const text = failure.detail.toLowerCase();
  if (
    failure.statusCode === 401 ||
    failure.statusCode === 403 ||
    /\b(?:unauthorized|authentication_required|not logged in|login required|invalid api key)\b/.test(
      text
    )
  )
    return { kind: 'AUTH_REQUIRED', action: 'block' };
  if (
    failure.statusCode === 429 ||
    failure.retryAfterMs !== undefined ||
    /\b(?:429|retry-after|rate_limit_exceeded|too many requests)\b/.test(text)
  )
    return { kind: 'RATE_LIMIT_TRANSIENT', action: 'wait-and-retry' };
  if (/\b(?:etimedout|timeout|timed out|hung|hang)\b/.test(text))
    return { kind: 'HANG/TIMEOUT', action: 'block' };
  if (/\b(?:econnreset|econnrefused|enotfound|eai_again|network error|fetch failed)\b/.test(text))
    return { kind: 'NETWORK', action: 'wait-and-retry' };
  if (/\b(?:tool_error|tool failed|tool error|tool execution failed)\b/.test(text))
    return { kind: 'TOOL_ERROR', action: 'block' };
  // Ignore means no automatic retry/switch, not that an unknown side effect is safe.
  return { kind: 'UNKNOWN_FAILURE', action: 'ignore' };
}
