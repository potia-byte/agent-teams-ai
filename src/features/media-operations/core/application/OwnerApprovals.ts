import { findPublication, qaAllowsPublication, transition } from '../domain/publication';
import { requestId, text, timestamp } from '../domain/validation';

import { replacePublication } from './publicationState';

import type { ApprovalRequest, MediaOperationsState } from '../../contracts';
import type { MediaOperationsDependencies } from './ports';

/** Invalidates pending decisions as well as previously granted authority. */
export function supersedeApprovals(state: MediaOperationsState, operationId: string): void {
  for (const request of state.approvals) {
    if (request.operationId === operationId && ['pending', 'approved'].includes(request.status))
      request.status = 'superseded';
  }
  findPublication(state, operationId).approval = null;
}

export class OwnerApprovals {
  constructor(private readonly deps: MediaOperationsDependencies) {}

  async request(input: {
    type: ApprovalRequest['type'];
    operationId?: string;
    actionText: string;
    ttl: number;
  }): Promise<ApprovalRequest> {
    const actionText = text.parse(input.actionText);
    const ttl = timestamp.positive().parse(input.ttl);
    const id = requestId.parse(this.deps.nextId());
    return this.deps.repository.transact((state) => {
      if (!['publication', 'spending', 'contract'].includes(input.type))
        throw new Error('Invalid approval type');
      if (state.ownerId !== this.deps.ownerId) throw new Error('Owner mismatch');
      if (state.approvals.some((item) => item.id === id)) throw new Error('Approval id collision');
      const at = timestamp.parse(this.deps.now());
      const expiresAt = timestamp.parse(at + ttl);
      if (input.type === 'publication') {
        const record = findPublication(state, text.parse(input.operationId));
        if (
          !['awaiting_owner_approval', 'approved'].includes(record.state) ||
          !qaAllowsPublication(record)
        )
          throw new Error('Publication must pass QA before requesting approval');
        supersedeApprovals(state, record.operationId);
        replacePublication(
          state,
          transition(record, 'awaiting_owner_approval', at, 'Owner decision requested')
        );
      } else if (input.operationId !== undefined)
        throw new Error('Financial requests cannot authorize publication');
      const request: ApprovalRequest = {
        id,
        type: input.type,
        operationId: input.operationId ?? null,
        actionText,
        createdAt: at,
        ttl,
        expiresAt,
        status: 'pending',
        decidedAt: null,
        delivery: 'pending',
      };
      state.approvals.push(request);
      return request;
    });
  }

  async command(senderId: string, command: string): Promise<ApprovalRequest | null> {
    // Deliberately no trim, case folding, substring matching or natural-language inference.
    if (senderId !== this.deps.ownerId || typeof command !== 'string') return null;
    const match = /^(approve|reject) ([a-zA-Z0-9_-]{1,128})$/.exec(command);
    if (!match || match[0] !== command) return null;
    return this.deps.repository.transact((state) => {
      if (state.ownerId !== senderId) throw new Error('Owner mismatch');
      const request = state.approvals.find((item) => item.id === match[2]);
      if (!request || request.status !== 'pending') return null;
      const at = timestamp.parse(this.deps.now());
      if (at < request.createdAt) throw new Error('Clock precedes approval request');
      if (at >= request.expiresAt) {
        request.status = 'expired';
        return request;
      }
      request.status = match[1] === 'approve' ? 'approved' : 'rejected';
      request.decidedAt = at;
      if (request.type === 'publication') {
        const record = findPublication(state, request.operationId!);
        if (record.state !== 'awaiting_owner_approval' || !qaAllowsPublication(record))
          throw new Error('Publication no longer awaits this decision');
        if (request.status === 'approved')
          record.approval = {
            id: request.id,
            operationId: record.operationId,
            ttl: request.ttl,
            scopeText: request.actionText,
            expiresAt: request.expiresAt,
            decidedAt: at,
          };
        replacePublication(
          state,
          transition(
            record,
            request.status === 'approved' ? 'approved' : 'cancelled',
            at,
            `Owner ${request.status}`
          )
        );
      }
      // Spending and contracts are records only. There is no execution port.
      return request;
    });
  }

  /** Explicit, replayable outbox drain. Failure leaves the request pending for delivery. */
  async deliverPending(): Promise<void> {
    const telegram = this.deps.telegram;
    if (!telegram) throw new Error('Telegram port is not configured');
    const requests = (await this.deps.repository.read()).approvals;
    for (const request of requests) {
      if (request.delivery !== 'pending' || request.status !== 'pending') continue;
      if (request.expiresAt <= this.deps.now()) {
        await this.deps.repository.transact((state) => {
          const current = state.approvals.find((item) => item.id === request.id)!;
          if (current.status === 'pending') current.status = 'expired';
        });
        continue;
      }
      await telegram.sendMessage(
        this.deps.ownerChatId,
        `Согласование ${request.id}\n${request.actionText}\n` +
          (request.operationId
            ? `Операция: ${request.operationId}\n`
            : 'Только запись решения, без исполнения\n') +
          `До: ${new Date(request.expiresAt).toISOString()}\n` +
          `approve ${request.id}\nreject ${request.id}`
      );
      await this.deps.repository.transact((state) => {
        state.approvals.find((item) => item.id === request.id)!.delivery = 'sent';
      });
    }
  }

  async sendPreview(id: string, artifactPath: string): Promise<void> {
    const request = (await this.deps.repository.read()).approvals.find((item) => item.id === id);
    if (
      !request ||
      request.type !== 'publication' ||
      request.status !== 'pending' ||
      request.expiresAt <= this.deps.now()
    )
      throw new Error('No pending publication approval');
    if (!this.deps.telegram) throw new Error('Telegram port is not configured');
    await this.deps.telegram.sendVideo(
      this.deps.ownerChatId,
      text.parse(artifactPath),
      `${request.actionText}\nОперация: ${request.operationId}`
    );
  }
}
