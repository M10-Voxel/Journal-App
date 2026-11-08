import { check } from '@tauri-apps/plugin-updater';
import { invoke } from '@tauri-apps/api/core';

export interface UpdateNotice { version: string }
let startup: Promise<UpdateNotice | null> | undefined;

/** One background check per main-window startup. No polling, downloads or installer bytes retained. */
export function startupUpdate(): Promise<UpdateNotice | null> {
  return startup ??= invoke<boolean>('startup_update_check').then(allowed => allowed ? check({ timeout: 20_000 }) : null).then(async update => {
    if (!update) return null;
    try { return { version: update.version }; }
    finally { await update.close().catch(() => {}); }
  }).catch(() => null); // Being offline must not interrupt opening the journal.
}
