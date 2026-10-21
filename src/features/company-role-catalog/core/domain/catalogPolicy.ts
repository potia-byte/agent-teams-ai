export const ROLE_IDS = [
  'ceo',
  'niche-researcher',
  'trend-analyst',
  'competitor-analyst',
  'audience-researcher',
  'topic-researcher',
  'scriptwriter',
  'hook-specialist',
  'literary-editor',
  'fact-checker',
  'genre-scriptwriter',
  'footage-researcher',
  'archive-researcher',
  'licensing-specialist',
  'visual-editor',
  'visual-art-director',
  'ai-generation-specialist',
  'motion-designer',
  'vfx-3d-specialist',
  'video-editor',
  'render-engineer',
  'voice-tts-specialist',
  'music-sound-designer',
  'audio-engineer',
  'subtitle-specialist',
  'publication-seo-specialist',
  'publication-manager',
  'channel-safety-specialist',
  'monetization-strategist',
  'sales-manager',
  'crm-specialist',
  'financial-accountant',
  'financial-auditor',
  'technical-architect',
  'developer',
  'integration-engineer',
  'devops-engineer',
  'security-engineer',
  'independent-qa',
  'agent-improvement-engineer',
] as const;

export type CompanyRoleId = (typeof ROLE_IDS)[number];
export const CATALOG_PROVIDERS = ['codex', 'anthropic'] as const;
export const DEFAULT_CONCURRENCY_CAP = 3;
/** Catalog size must never become a request to launch every employee. */
export const MAX_CONCURRENCY_CAP = ROLE_IDS.length - 1;

export const OWNER_APPROVAL_ACTIONS = [
  'publish-content',
  'sensitive-content',
  'spend-money',
  'financial-transaction',
  'sign-contract',
  'send-commercial-message',
  'change-channel-access',
  'install-dependency',
  'expand-permissions',
  'deploy-production',
] as const;

export const CATALOG_CAPABILITIES = [
  'read-assigned-artifacts',
  'write-own-drafts',
  'read-public-sources',
  'read-redacted-metrics',
  'read-redacted-ledger',
  'read-redacted-crm',
  'run-local-media-tools',
  'edit-sandbox-code',
  'run-sandbox-tests',
  'write-review-findings',
  'block-release',
] as const;

export const INDEPENDENT_ROLE_IDS = [
  'literary-editor',
  'fact-checker',
  'licensing-specialist',
  'visual-editor',
  'financial-auditor',
  'independent-qa',
] as const;
