# Media operations

Process-limited slice with pure domain policies, application ports, JSON infrastructure
and Russian presentation labels. No Electron/IPC/HTTP wiring or network implementation.

Public entrypoints:

- `contracts/index.ts`: records and DTOs.
- `main/index.ts`: `createMediaOperationsFeature` and injectable port types.
- `renderer/index.ts`: Russian labels and status projections; no UI registration.

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
Production tasks deduplicate by key, append state history and retain artifact paths
as references; this feature never opens artifact files.

Verification (all fixtures stay under `test/features/media-operations/.store-*`,
all external ports are fakes):

```powershell
$env:NODE_OPTIONS='--test-isolation=none'
node --import ./scripts/diagnostics/ts-source-loader.mjs --test test/features/media-operations/operations.source.mjs
node ./node_modules/@typescript/native/bin/tsc --noEmit
pnpm exec vitest run test/features/media-operations/operations.test.ts
```
