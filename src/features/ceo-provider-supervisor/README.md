# CEO Provider Supervisor

`core/domain` owns the provider catalog/selection, narrow quota classification,
probe budget/backoff and task recovery rules. `core/application/CeoSupervisor.ts`
coordinates handoff and exposes a task queue and an explicit probe tick.
The main composition entrypoint is `main/index.ts`; existing IPC/preload and
renderer contracts remain read/command only.

Registry health, probe budgets and task records share the existing per-context,
per-team `JsonCeoRepository` file and cross-process file lock. Additive v1 fields
are defaulted only when absent; invalid persisted data fails closed. OpenCode
is catalogued as research-only and cannot be selected, even if marked AVAILABLE.

Composition optionally accepts `availabilityProbe` and `taskExecutor` ports.
No timer or LLM call is installed by default. Call `probeAvailability` explicitly;
each attempt is durably budgeted before the port runs. Probe implementations must
be cheap and have their own execution timeout (for example a bounded CLI version
or auth-status command). Installation/auth status alone must return UNKNOWN with
`explicitCapacity: false`; it cannot clear a rate limit. AVAILABLE requires
explicit capacity evidence. Trusted passive `observeProbe` remains compatible
with the existing app input, and represents explicit health evidence. Neither
probe path launches a session or interrupts an active reserve owner.

The main-only `taskQueue` exposes `enqueue`, `read` and `dispatchNext`. Each
dispatch saves `running` before invoking the injected executor and holds the
repository lock through completion. Its executor must use stable idempotency
keys for external effects and resolve only after completion. An unsuccessful or
interrupted attempt is blocked for reconciliation, never automatically retried.
On the first queue access in a supervisor instance, persisted running tasks are
blocked; pending/done records and checkpoints are preserved. Supervisor read,
command and failure entrypoints also perform this recovery. No executor means
work stays queued. `non_llm` work can dispatch while LLM providers are unavailable.
Blocked tasks deliberately have no automatic unblock/replay API.

Tests: `test/features/ceo-provider-supervisor/supervisor.source.mjs` (Node source
loader) and `supervisor.test.ts` (Vitest) register the same domain/application and
file-store cases. All provider checks and task effects in tests are fakes.
