# Media operations

Cross-process production slice with pure domain policies, application ports, JSON
infrastructure, defensive IPC, preload and a Russian desktop panel.

Public entrypoints:

- `contracts/index.ts`: records, production API DTOs and IPC channel constants.
- `main/index.ts`: factory, artifact verifier, IPC registration and optional Telegram adapter.
- `preload/index.ts`: typed production bridge.
- `renderer/index.ts`: Russian projections and lazily loaded `ProductionPanel`.

Desktop entry: toolbar «…» → «Производство». Startup is wired through
`src/main/composition/composeDesktopRuntimeRecovery.ts` → `composeMediaOperations`;
the existing recovery disposal also unregisters production IPC and stops Telegram.
The frozen main entrypoint and TeamDetailView are unchanged.

`short-video-v1` creates ten ordered stages with the actual catalog role IDs. The
optional `production` factory dependency supplies the catalog, capacity snapshot
and artifact port. Plans are recommendations, never LLM launches; manual artifact
work can continue when providers are UNKNOWN. The desktop capacity adapter reads
the named team's CEO registry and counts its current CEO against the cap of three;
without a team it supplies no available providers. It never probes or calls models.
Selections, deferrals, reasons, verified artifact hashes and stage history persist
in the existing `tasks` array. Legacy tasks remain readable; legacy record commands
cannot advance a production pipeline.

Configure the allow-listed root using the absolute `AGENT_TEAMS_PRODUCTION_ROOT`
path (default: `~/Documents/agent-teams-ai-fork/production`). Artifact paths must be
absolute and below its real path; traversal, symlink escapes and Windows alternate
streams are rejected. MP4 verification uses local `ffprobe` (injectable in tests),
requires square pixels, exact 9:16, audio and 1–180 seconds. No binary is installed.
Files are fingerprinted and rechecked on advance, before approval and at queue entry.
Directories verify the path only, as stated in the UI; they do not certify content.
Discovery under `<root>/<task-key>/render`, `qa/QA_REPORT.md` and
`publish/PUBLISH_PACK.md` only suggests paths; the user must attach explicitly.

QA reports must declare exactly one verdict and an explicit criteria list:

```markdown
VERDICT: PASS_WITH_NOTES

## UNVERIFIED_CRITERIA

- Естественность голоса не проверялась
```

Use `[]` for an explicitly empty list. Russian headings `Вердикт` and
`Непроверенные критерии` are also accepted. PASS with unverified criteria is invalid.
BLOCK persists a blocked QA stage; replacing its report explicitly permits recheck.
This verifies the report protocol, not the truth of human review findings.

The owner stage prepares the immutable, idempotent publication identity and reuses
the existing publication approval model. The final stage attaches the publish pack
and confirms queue entry. Null channel blocks only that final public-publication
step with «нет канала публикации». Changing target/version requires a new task and
new approval. An expired grant returns queue work to owner approval. This UI does
not implement a public platform uploader: no publisher port is configured by desktop
composition. Queue completion means prepared for publication, never uploaded.

Telegram is OFF unless `AGENT_TEAMS_TELEGRAM_ENV_FILE` points to an absolute,
separate env-style file containing exactly `TOKEN=…` and `OWNER_ID=…` (comments
allowed). Never put that file in the repo. Only this main-process loader reads it;
no token crosses IPC or appears in transport errors or adapter serialization.
Node fetch implements messages, multipart video and 20-second getUpdates with a
25-second request bound and a three-second pause. Only exact commands from the
configured owner in that owner's private chat are passed to the existing idempotent
approval command. UI decisions use the same persisted owner authority. Enabling
Telegram does not change repository ownership. Stop/dispose aborts polling.
Only approval decisions are handled; no open-ended chat command execution exists.

This is deliberately desktop-only: canonical path validation and local ffprobe
require main-process access. The shared API abstraction has an explicit unsupported
HTTP implementation and the toolbar entry is hidden outside Electron.

The async factory takes a dedicated storage directory, owner ID, owner chat ID and
optional publisher/Telegram ports. It recovers interrupted publishing as
`outcome_unknown` before returning `{ publications, approvals, records, read }`.
Instantiate once per storage directory at startup: recovery while another instance is
actively publishing conservatively marks that attempt unknown and fences its response.
Creating the feature never sends messages or publishes.

Publication flow: enqueue → submitForQa → recordQa → approvals.request (publication,
exact operationId, concrete actionText, TTL in milliseconds) → approvals.command
(configured owner ID, exact `approve <id>`) → publish. Every publication requires
explicit approval, including the first three distinct videos per niche. No automatic
approval or retry mode exists. QA changes invalidate prior requests and authority.
Target and version are immutable identity components. A null target remains approved
and waiting; selecting a target means a new queue entry, QA and approval.

The JSON repository serializes transactions using `withFileLock` and commits with
`atomicWriteAsync` before calling the publisher. There is at most one port invocation
per persisted attempt. Publisher exceptions, timeout, invalid replies and interrupted
claims are unknown, even if the external operation may have succeeded. `reconcile`
requires an external evidence reference and observation time covering the attempt.
A confirmed absence permits a manual retry with fresh approval; confirmed presence
records the external ID/URL. A `failed_known` port reply must explicitly establish no
publication and supply evidence. Ports must not hide their own publishing retries.
Late results cannot overwrite recovered/reconciled state. Disk corruption fails closed.

Telegram delivery is an explicit persistent outbox (`deliverPending`); failures leave
delivery pending. Delivery may repeat after a crash between send and acknowledgement.
Approval IDs make repeated messages harmless. `sendPreview` uses the same owner chat.
Spending/contract requests are records only; no financial/contract execution port exists.
CRM interactions are records only and cannot send anything.

Ledger amounts are nonnegative integer minor units in one configured currency (USD by
default); currency mixing and unsafe totals are rejected. Platform-confirmed accruals
require a confirmation reference, receipts require evidence. Only received minus expense
contributes to net profit. Audit identities must differ from the recorder. Metrics are
immutable source snapshots, use null for unknown fields, retention is a percentage,
and revenue is in the repository currency; metric revenue never creates receipts.
Production tasks deduplicate by key and append stage history. Recovery never runs
stages, attaches discovered files, retries publishing or implicitly approves work.
Pending approvals expire during startup/read; expired approved authority is displayed
as expired and cannot advance public publication. Telegram polling can replay an
already acknowledged command after restart; terminal approval IDs make it a no-op.

Verification (all fixtures stay under `test/features/media-operations/.store-*`,
all external ports are fakes):

```powershell
$env:NODE_OPTIONS='--test-isolation=none'
node --import ./scripts/diagnostics/ts-source-loader.mjs --test test/features/media-operations/operations.source.mjs
node --import ./scripts/diagnostics/ts-source-loader.mjs --test test/features/media-operations/production.source.mjs
node ./node_modules/@typescript/native/bin/tsc --noEmit
pnpm exec vitest run test/features/media-operations/operations.test.ts
```
