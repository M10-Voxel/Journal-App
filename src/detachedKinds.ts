/** What can leave the journal as a window of its own: windows whose data every window keeps in step (DetachedPanel.tsx).
 *  Kept apart so the entry (main.tsx) can tell a detached window by its label without loading the panel's code. */
export type DetachedKind = 'calendar' | 'notebook' | 'board';
export const detachable: readonly DetachedKind[] = ['calendar', 'notebook', 'board'];
