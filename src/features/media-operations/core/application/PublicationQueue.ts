import {
  assertMayPublish,
  createPublication,
  findPublication,
  operationIdFor,
  qaAllowsPublication,
  transition,
} from '../domain/publication';
import { publicationResult, qaVerdict, text, timestamp } from '../domain/validation';

import { supersedeApprovals } from './OwnerApprovals';
import { replacePublication } from './publicationState';

import type {
  PublicationInput,
  PublicationRecord,
  PublicationResult,
  QaVerdict,
} from '../../contracts';
import type { MediaOperationsDependencies, PublisherOutcome } from './ports';

export class PublicationQueue {
  constructor(private readonly deps: MediaOperationsDependencies) {}

  async enqueue(input: PublicationInput): Promise<PublicationRecord> {
    const operationId = operationIdFor(input);
    return this.deps.repository.transact((state) => {
      const existing = state.publications.find((item) => item.operationId === operationId);
      if (existing) return existing;
      if (
        state.publications.some(
          (item) => item.videoId === input.videoId && item.nicheId !== input.nicheId
        )
      )
        throw new Error('Video niche cannot change');
      const record = createPublication(state, input, this.deps.now());
      state.publications.push(record);
      return record;
    });
  }

  async submitForQa(operationId: string): Promise<PublicationRecord> {
    return this.deps.repository.transact((state) => {
      const record = findPublication(state, operationId);
      if (record.state !== 'draft') throw new Error('Only drafts can be submitted');
      return replacePublication(
        state,
        transition(record, 'awaiting_qa', this.deps.now(), 'QA requested')
      );
    });
  }

  async recordQa(operationId: string, input: QaVerdict): Promise<PublicationRecord> {
    const verdict = qaVerdict.parse(input);
    return this.deps.repository.transact((state) => {
      const record = findPublication(state, operationId);
      if (!['awaiting_qa', 'awaiting_owner_approval', 'approved'].includes(record.state))
        throw new Error('QA cannot change in this state');
      supersedeApprovals(state, operationId);
      record.qaVerdict = verdict;
      return replacePublication(
        state,
        transition(
          record,
          qaAllowsPublication(record) ? 'awaiting_owner_approval' : 'awaiting_qa',
          this.deps.now(),
          `QA: ${verdict.verdict}`
        )
      );
    });
  }

  async cancel(operationId: string): Promise<PublicationRecord> {
    return this.deps.repository.transact((state) => {
      const record = findPublication(state, operationId);
      if (['publishing', 'published', 'outcome_unknown', 'cancelled'].includes(record.state))
        throw new Error('Publication cannot be cancelled in this state');
      supersedeApprovals(state, operationId);
      return replacePublication(
        state,
        transition(record, 'cancelled', this.deps.now(), 'Cancelled')
      );
    });
  }

  async retry(operationId: string): Promise<PublicationRecord> {
    return this.deps.repository.transact((state) => {
      const record = findPublication(state, operationId);
      if (record.state !== 'failed_known')
        throw new Error('Retry requires a known failure or reconciliation');
      supersedeApprovals(state, operationId);
      return replacePublication(
        state,
        transition(
          record,
          qaAllowsPublication(record) ? 'awaiting_owner_approval' : 'awaiting_qa',
          this.deps.now(),
          'Retry requested; fresh approval required'
        )
      );
    });
  }

  /** Called by the exported factory before exposing the feature. Never retries. */
  async recoverPublishing(): Promise<number> {
    return this.deps.repository.transact((state) => {
      let count = 0;
      for (const record of state.publications) {
        if (record.state !== 'publishing') continue;
        replacePublication(
          state,
          transition(
            record,
            'outcome_unknown',
            this.deps.now(),
            'Interrupted publishing; reconcile before retry'
          )
        );
        count++;
      }
      return count;
    });
  }

  async reconcile(
    operationId: string,
    evidence: {
      evidenceRef: string;
      observedAt: number;
      outcome: { status: 'published'; result: PublicationResult } | { status: 'not_published' };
    }
  ): Promise<PublicationRecord> {
    const reference = text.parse(evidence.evidenceRef);
    timestamp.parse(evidence.observedAt);
    if (!['published', 'not_published'].includes(evidence.outcome.status))
      throw new Error('Invalid reconciliation');
    const result =
      evidence.outcome.status === 'published'
        ? publicationResult.parse(evidence.outcome.result)
        : null;
    return this.deps.repository.transact((state) => {
      const record = findPublication(state, operationId);
      if (record.state !== 'outcome_unknown')
        throw new Error('Only unknown outcomes can be reconciled');
      const at = timestamp.parse(this.deps.now());
      const startedAt = record.history.filter((item) => item.state === 'publishing').at(-1)!.at;
      if (evidence.observedAt < startedAt || evidence.observedAt > at)
        throw new Error('Evidence does not cover this attempt');
      supersedeApprovals(state, operationId);
      record.result = result;
      return replacePublication(
        state,
        transition(
          record,
          result ? 'published' : 'failed_known',
          at,
          `Reconciled ${evidence.outcome.status}; observed at ${evidence.observedAt}`,
          reference
        )
      );
    });
  }

  async publish(operationId: string): Promise<PublicationRecord> {
    const publisher = this.deps.publisher;
    if (!publisher) throw new Error('Publisher port is not configured');
    const claimed = await this.deps.repository.transact((state) => {
      const record = findPublication(state, operationId);
      assertMayPublish(state, record, this.deps.now());
      // A target is immutable and is part of the id. Selecting one requires a new operation/approval.
      if (record.channelId === null) return record;
      return replacePublication(
        state,
        transition(
          { ...record, attempts: record.attempts + 1 },
          'publishing',
          this.deps.now(),
          'Publisher attempt claimed'
        )
      );
    });
    if (claimed.state !== 'publishing') return claimed;
    let outcome: PublisherOutcome | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      outcome = await Promise.race([
        publisher.publish(structuredClone(claimed)),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('Publisher timeout')),
            this.deps.publicationTimeoutMs ?? 30_000
          );
        }),
      ]);
      if (outcome.status === 'published') {
        const result = publicationResult.parse({
          externalId: outcome.externalId,
          url: outcome.url,
          at: this.deps.now(),
        });
        outcome = { status: 'published', externalId: result.externalId, url: result.url };
      } else if (outcome.status === 'failed_known') {
        outcome = {
          status: 'failed_known',
          reason: text.parse(outcome.reason),
          evidenceRef: text.parse(outcome.evidenceRef),
        };
      } else throw new Error('Invalid publisher outcome');
    } catch {
      // Even an exception that looks like a known HTTP failure is ambiguous without explicit evidence.
      outcome = null;
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
    return this.deps.repository.transact((state) => {
      const record = findPublication(state, operationId);
      // Recovery/reconciliation may have fenced this call while the publisher was still resolving.
      if (record.state !== 'publishing' || record.attempts !== claimed.attempts) return record;
      const at = this.deps.now();
      if (outcome?.status === 'published') {
        record.result = { externalId: outcome.externalId, url: outcome.url, at };
        return replacePublication(
          state,
          transition(record, 'published', at, 'Publisher confirmed')
        );
      }
      return replacePublication(
        state,
        transition(
          record,
          outcome?.status === 'failed_known' ? 'failed_known' : 'outcome_unknown',
          at,
          outcome?.status === 'failed_known'
            ? outcome.reason
            : 'Unknown publisher outcome; reconciliation required',
          outcome?.status === 'failed_known' ? outcome.evidenceRef : null
        )
      );
    });
  }
}
