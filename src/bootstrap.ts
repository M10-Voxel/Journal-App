import { invoke } from '@tauri-apps/api/core';
import { restoreVaultPreferences } from './vaultPreferences';

/** Restore vault-local state before modules read timers, filters or notebook selections. */
async function start() {
  try {
    const status = '__TAURI_INTERNALS__' in window
      ? await invoke<{ path: string; legacy: boolean; preferences: Record<string, string> | null; error: string | null }>('vault_status')
      : null;
    // Browser UI fixtures and the web preview do not provide a native vault.
    if (status?.path) {
      const previous = localStorage.getItem('journal.activeVault');
      if (previous !== status.path && !(previous === null && status.legacy)) restoreVaultPreferences(localStorage, status.preferences);
      localStorage.setItem('journal.activeVault', status.path);
      if (status.error) localStorage.setItem('journal.vaultError', status.error); else localStorage.removeItem('journal.vaultError');
    }
    await import('./main');
  } catch (reason) {
    const root = document.getElementById('root')!;
    root.style.cssText = 'padding:32px;color:#ddd;font:16px system-ui;white-space:pre-wrap';
    root.textContent = `Journal konnte nicht gestartet werden.\n${String(reason)}`;
  }
}

void start();
