import { financeReport } from '../domain/finance';
import { assertTaskTransition } from '../domain/journalPolicy';
import {
  contact,
  leadStatus,
  ledgerEntry,
  metricSnapshot,
  productionTask,
  taskState,
  text,
  timestamp,
} from '../domain/validation';

import type {
  Contact,
  FinanceReport,
  LeadStatus,
  LedgerEntry,
  MetricSnapshot,
  ProductionTask,
  ProductionTaskState,
} from '../../contracts';
import type { MediaOperationsDependencies } from './ports';

export class OperationsRecords {
  constructor(private readonly deps: MediaOperationsDependencies) {}

  async addContact(input: Pick<Contact, 'id' | 'name' | 'source'>): Promise<Contact> {
    const value = contact.parse({
      ...input,
      status: 'new',
      dealProbability: null,
      probabilitySource: 'manual',
      followUpDueAt: null,
      interactions: [],
    });
    return this.deps.repository.transact((state) => {
      if (state.contacts.some((item) => item.id === value.id))
        throw new Error('Contact already exists');
      state.contacts.push(value);
      return value;
    });
  }

  async updateLead(
    id: string,
    input: {
      status: LeadStatus;
      dealProbability: number | null;
      followUpDueAt: number | null;
    }
  ): Promise<Contact> {
    return this.deps.repository.transact((state) => {
      const record = state.contacts.find((item) => item.id === id);
      if (!record) throw new Error('Contact not found');
      const value = contact.parse({
        ...record,
        status: leadStatus.parse(input.status),
        dealProbability: input.dealProbability,
        followUpDueAt: input.followUpDueAt,
      });
      state.contacts[state.contacts.indexOf(record)] = value;
      return value;
    });
  }

  async logInteraction(id: string, interaction: Contact['interactions'][number]): Promise<Contact> {
    return this.deps.repository.transact((state) => {
      const record = state.contacts.find((item) => item.id === id);
      if (!record) throw new Error('Contact not found');
      const value = contact.parse({
        ...record,
        interactions: [...record.interactions, interaction],
      });
      state.contacts[state.contacts.indexOf(record)] = value;
      return value;
    });
  }

  async followUpsDue(at: number): Promise<Contact[]> {
    timestamp.parse(at);
    return (await this.deps.repository.read()).contacts.filter(
      (item) =>
        item.followUpDueAt !== null &&
        item.followUpDueAt <= at &&
        !['won', 'lost'].includes(item.status)
    );
  }

  async recordLedger(
    input: Omit<LedgerEntry, 'audited' | 'auditedBy' | 'auditedAt'>
  ): Promise<LedgerEntry> {
    const value = ledgerEntry.parse({ ...input, audited: false, auditedBy: null, auditedAt: null });
    return this.deps.repository.transact((state) => {
      if (state.ledger.some((item) => item.id === value.id))
        throw new Error('Ledger entry already exists');
      // No implicit currency conversion or execution of recorded expenses.
      financeReport([...state.ledger, value], state.currency);
      state.ledger.push(value);
      return value;
    });
  }

  async auditLedger(id: string, auditedBy: string): Promise<LedgerEntry> {
    return this.deps.repository.transact((state) => {
      const record = state.ledger.find((item) => item.id === id);
      if (!record) throw new Error('Ledger entry not found');
      if (record.audited) throw new Error('Entry already audited');
      const value = ledgerEntry.parse({
        ...record,
        audited: true,
        auditedBy: text.parse(auditedBy),
        auditedAt: this.deps.now(),
      });
      state.ledger[state.ledger.indexOf(record)] = value;
      return value;
    });
  }

  async reportFinance(): Promise<FinanceReport> {
    const state = await this.deps.repository.read();
    return financeReport(state.ledger, state.currency);
  }

  async recordMetrics(input: MetricSnapshot): Promise<MetricSnapshot> {
    const value = metricSnapshot.parse(input);
    return this.deps.repository.transact((state) => {
      if (state.metrics.some((item) => item.id === value.id))
        throw new Error('Metric snapshot already exists');
      state.metrics.push(value);
      return value;
    });
  }

  async enqueueTask(
    input: Pick<ProductionTask, 'key' | 'videoId' | 'stage'>
  ): Promise<ProductionTask> {
    return this.deps.repository.transact((state) => {
      const key = text.parse(input.key);
      const existing = state.tasks.find((item) => item.key === key);
      if (existing) return existing;
      const value = productionTask.parse({
        ...input,
        state: 'planned',
        artifacts: [],
        history: [{ state: 'planned', at: this.deps.now(), detail: 'Task created' }],
      });
      state.tasks.push(value);
      return value;
    });
  }

  async advanceTask(
    key: string,
    next: ProductionTaskState,
    detail: string,
    artifacts: string[] = []
  ): Promise<ProductionTask> {
    taskState.parse(next);
    text.parse(detail);
    return this.deps.repository.transact((state) => {
      const record = state.tasks.find((item) => item.key === key);
      if (!record) throw new Error('Task not found');
      if (record.pipeline) throw new Error('Use the production stage API for pipeline tasks');
      assertTaskTransition(record.state, next);
      const value = productionTask.parse({
        ...record,
        state: next,
        artifacts: [...new Set([...record.artifacts, ...artifacts])],
        history: [...record.history, { state: next, at: this.deps.now(), detail }],
      });
      state.tasks[state.tasks.indexOf(record)] = value;
      return value;
    });
  }
}
