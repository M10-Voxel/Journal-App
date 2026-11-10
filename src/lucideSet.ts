/// <reference types="vite/client" />
// The whole Lucide set, by the icons' own names (their file names, e.g. `grid-2x2-plus`); aliases left out. Imported
// only through `loadIcons` (entryIcons.ts), so it comes as one chunk of its own when an icon is first needed.
import type { IconNode } from './entryIcons';

const files = import.meta.glob<IconNode>('../node_modules/lucide/dist/esm/icons/*.mjs', { eager: true, import: 'default' });
export const icons = new Map(Object.entries(files).map(([path, node]) => [path.slice(path.lastIndexOf('/') + 1, -'.mjs'.length), node]));
