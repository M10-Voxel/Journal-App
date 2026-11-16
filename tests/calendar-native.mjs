import { spawnSync } from 'node:child_process';
import { mockIPC } from '@tauri-apps/api/mocks';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const binary = fileURLToPath(new URL('../src-tauri/target/debug/calendar-probe.exe', import.meta.url));
if (!existsSync(binary)) throw new Error('Run cargo build --manifest-path src-tauri/Cargo.toml --bin calendar-probe before npm test.');
globalThis.window ??= globalThis;
mockIPC((cmd, args) => {
  const result = spawnSync(binary, [], { input: JSON.stringify({cmd,...args})+'\n', encoding:'utf8', windowsHide:true });
  if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr);
  const response = JSON.parse(result.stdout);
  if (response.error) throw new Error(response.error);
  return response.value;
});
