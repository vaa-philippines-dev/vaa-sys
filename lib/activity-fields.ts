// Client-safe: the vocabulary of the activity log. entityType and action
// are free text in the table so later modules can add their own; list them
// here so the Activity Logs page can filter and label them.

export const ENTITY_TYPES = ['Customer', 'Account', 'Contract', 'ContractSection', 'Setting', 'Access', 'Takeover'] as const

export const ACTIVITY_ACTIONS = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'ACTIVATED',
  'REACTIVATED',
  'RESUMED',
  'PAUSED',
  'INACTIVE',
  'CANCELLED',
  'TERMINATED',
  'PENDING',
  'PAUSE_PENDING_REVIEW',
  'TERMINATION_PENDING_REVIEW',
  'PENDING_REVIEW_CONFIRMED',
  'PENDING_REVIEW_CANCELLED',
  'ASSIGN',
  'TRANSFER',
  'TAKEOVER',
  'TAKEOVER_CANCELLED',
  'NOTE',
  'CONTRACT_ASSIGNED',
] as const

export const ACTION_LABELS: Record<string, string> = {
  CREATE: 'Created',
  UPDATE: 'Updated',
  DELETE: 'Deleted',
  ACTIVATED: 'Activated',
  REACTIVATED: 'Reactivated',
  RESUMED: 'Resumed',
  PAUSED: 'Paused',
  INACTIVE: 'Set inactive',
  CANCELLED: 'Cancelled',
  TERMINATED: 'Terminated',
  PENDING: 'Back to Pending',
  PAUSE_PENDING_REVIEW: 'Pause awaiting review',
  TERMINATION_PENDING_REVIEW: 'Termination awaiting review',
  PENDING_REVIEW_CONFIRMED: 'Review confirmed',
  PENDING_REVIEW_CANCELLED: 'Review cancelled (reverted)',
  ASSIGN: 'Assigned',
  TRANSFER: 'Transferred',
  TAKEOVER: 'Takeover assigned',
  TAKEOVER_CANCELLED: 'Takeover cancelled',
  NOTE: 'Note added',
  CONTRACT_ASSIGNED: 'Contract assigned',
}

const TERMINAL = ['TERMINATED', 'CANCELLED']

// Names a customer or account status change (legacy
// _classifyStatusChangeAction), so the log says what happened rather than a
// generic UPDATE.
export function classifyStatusChange(from: string | null, to: string): string {
  if (from === to) return 'UPDATE'
  if (from && TERMINAL.includes(from) && (to === 'ACTIVE' || to === 'PENDING')) return 'REACTIVATED'
  if (from === 'PENDING' && to === 'ACTIVE') return 'ACTIVATED'
  if (from === 'PAUSED' && to === 'ACTIVE') return 'RESUMED'
  if (['PAUSED', 'INACTIVE', 'CANCELLED', 'TERMINATED', 'PENDING'].includes(to)) return to
  return 'UPDATE'
}
