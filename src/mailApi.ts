import { invoke } from '@tauri-apps/api/core';
import type { MailAccount, MailCandidate, MailPending } from './mail';
import type { ModelAnalysis } from './mailMl';
export interface MailModelStatus { installed: boolean; enabled: boolean; installing: boolean; downloaded: number; total: number; error: string }
export interface MailLearningStatus { accepted: number; rejected: number; ready: boolean }
export const mailApi = {
  learningStatus: () => invoke<MailLearningStatus>('mail_learning_status'),
  resetLearning: () => invoke<void>('mail_learning_reset'),
  exportLearning: () => invoke<boolean>('mail_learning_export'),
  importLearning: () => invoke<boolean>('mail_learning_import'),
  modelStatus: () => invoke<MailModelStatus>('mail_ml_status'),
  installModel: (fromFolder = false) => invoke<void>('mail_ml_install', { fromFolder }),
  enableModel: (value: boolean) => invoke<void>('mail_ml_enabled', { value }),
  analyze: (text: string) => invoke<ModelAnalysis>('mail_ml_analyze', { text }),
  accounts: () => invoke<MailAccount[]>('mail_accounts'),
  save: (account: MailAccount, password: string, clientSecret: string, authorize = false) => invoke<MailAccount>('mail_save', { account, password: password || null, clientSecret: clientSecret || null, authorize }),
  sync: (id: string) => invoke<void>('mail_sync', { id }),
  remove: (id: string) => invoke<void>('mail_remove', { id }),
  cancel: () => invoke<void>('mail_cancel'),
  enabled: (id: string, enabled: boolean) => invoke<void>('mail_enabled', { id, enabled }),
  autoImport: (id: string, enabled: boolean) => invoke<void>('mail_auto_import', { id, enabled }),
  notices: () => invoke<string[]>('mail_notices'),
  help: (provider: string) => invoke<void>('mail_help', { provider }),
  pending: () => invoke<MailPending[]>('mail_pending'),
  stage: (accountId: string, messageKey: string, candidates: MailCandidate[], notice: string) => invoke<void>('mail_stage', { accountId, messageKey, candidates, notice }),
  candidates: () => invoke<MailCandidate[]>('mail_candidates'),
  resolve: (ids: string[], accepted: boolean, manual = true) => invoke<void>('mail_resolve', { ids, accepted, manual }),
};
