# Company role catalog

Process-limited data feature for sections 3, 5, 17 and 18–19 of
`docs/media-company/MASTER_PROMPT_V2.md`. The 40 logical employees keep the original
01–40 numbering. Department files only group definitions; everyone reports to CEO.

- `contracts`: readonly profiles, provider snapshots, tasks and planning DTOs.
- Root entrypoint: pure validator and activation planner, safe outside main.
- `main`: `loadCompanyRoleCatalog()` and `createCompanyRoleCatalogApi()` load and
  recursively freeze bundled definitions. No disk reads, provider probes or launches.
- `main/infrastructure/data`: six groups of specific Russian profiles plus shared
  restrictions expanded into every profile. Tools are required capabilities, not
  proof of installation or permission to install them.

Only `codex` and `anthropic` subscription executors are catalog candidates. A plan
requires an explicit `configured: true` and `AVAILABLE` snapshot. Missing/UNKNOWN
providers are ineligible. Quota hints bound new activations and total per-provider
concurrency; zero or invalid hints prevent new selection. Priorities descend with
stable input-order ties. Completed, blocked and running tasks do not start roles.

The concurrency cap defaults to **3 total roles including an already running CEO**
for the 16 GB baseline. Callers must supply all current executors; they occupy slots
and are retained even during a provider outage. Duplicate ownership or an active
count above the requested cap throws rather than hiding running work. Zero pauses
new work; all larger requested caps are bounded to 39 so the complete catalog can
never become a launch plan. The runtime's own member/resource limit must also be
included in the supplied cap before eventual integration.

Plans are recommendations from a snapshot. Before any future launch, the runtime
must recheck capacity and acquire an exclusive role lease. These APIs perform no
approval, task execution, fallback handover, IPC/UI registration or persistence.
Review tasks identify their producer roles; the planner rejects self-review while
allowing the same provider to serve different logical employees. All profiles list
owner-gated actions; allowed capabilities contain no publish/finance/contract grant.
Credential-shaped literals are rejected with redacted issue codes; this heuristic
does not replace secret isolation at runtime.

Tests share cases between `node:test` and Vitest:

```powershell
$env:NODE_OPTIONS='--test-isolation=none'
node --import ./scripts/diagnostics/ts-source-loader.mjs --test test/features/company-role-catalog/catalog.source.mjs
```
