/** Three-way merge primitives for synchronization. This module performs no storage or network writes. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface Conflict { path: string; base: Json | undefined; local: Json | undefined; remote: Json | undefined }
export interface MergeResult { value: Json | undefined; conflicts: Conflict[] }

function equal(a: Json | undefined, b: Json | undefined): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => equal(v, b[i]));
  if (Array.isArray(a) || Array.isArray(b)) return false;
  const ak = Object.keys(a).sort(), bk = Object.keys(b).sort();
  return ak.length === bk.length && ak.every((key, i) => key === bk[i] && equal(a[key], b[key]));
}

/** Merge independent object fields; concurrent edits to the same field or deletion versus edit are conflicts.
 * Arrays are deliberately atomic: e.g. recurrence and planning order must not be silently rearranged. */
export function mergeThreeWay(base: Json | undefined, local: Json | undefined, remote: Json | undefined): MergeResult {
  const conflicts: Conflict[] = [];
  function merge(b: Json | undefined, l: Json | undefined, r: Json | undefined, path: string): Json | undefined {
    if (equal(l, r)) return l;
    if (equal(l, b)) return r;
    if (equal(r, b)) return l;
    const object = (value: Json | undefined): value is { [key: string]: Json } => value !== undefined && value !== null && typeof value === 'object' && !Array.isArray(value);
    if (object(b) && object(l) && object(r)) {
      const result: { [key: string]: Json } = {};
      for (const key of new Set([...Object.keys(b), ...Object.keys(l), ...Object.keys(r)])) {
        const value = merge(b[key], l[key], r[key], `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`);
        if (value !== undefined) Object.defineProperty(result,key,{value,writable:true,enumerable:true,configurable:true});
      }
      return result;
    }
    conflicts.push({ path, base: b, local: l, remote: r });
    return l;
  }
  return { value: merge(base, local, remote, ''), conflicts };
}
