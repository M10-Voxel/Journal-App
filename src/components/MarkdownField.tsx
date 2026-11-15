import { useEffect, useLayoutEffect, useRef } from 'react';
import { createEntryEditor } from './entryEditor';
import type { EntryEditor } from './entryEditor';
import { useFormatting } from './useFormatting';

/**
 * Markdown written and shown like in a board note (live preview: formatting, headings, lists, checkboxes, code, tables),
 * for longer texts outside the board such as an entry's description. Tab indents list items and otherwise moves on to the next field. Without `onChange`
 * it only shows the text (no cursor).
 */
export function MarkdownField({ value, onChange, onCheck, label, placeholder, className, disabled = false }: {
  /** `onCheck`: the text is only shown, but its checkboxes can be ticked (the new text is passed on). */
  value: string; onChange?: (text: string) => void; onCheck?: (text: string) => void; label: string; placeholder?: string; className?: string; disabled?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<EntryEditor | null>(null);
  const change = useRef(onChange);
  change.current = onChange ?? onCheck;
  const fixed = !onChange;
  // The shortcuts and the right-click menu of a board note (formatting, lists, quotes, code, tables).
  const format = useFormatting(editor, { readOnly: fixed || disabled, rich: true });
  useLayoutEffect(() => {
    const instance = createEntryEditor({ parent: host.current!, text: value, readOnly: fixed || disabled, label, rich: true, tab: 'lists', checkboxes: !!onCheck, fixed, placeholder, contentClass: 'markdown-text',
      onChange: text => change.current?.(text), onUpdate: () => {} });
    editor.current = instance;
    return () => { instance.view.destroy(); editor.current = null; };
  }, []);
  useEffect(() => { editor.current?.setText(value); }, [value]);
  useEffect(() => { editor.current?.configure({ readOnly: fixed || disabled, label }); }, [fixed, disabled, label]);
  // A click beside the text (the field's padding) still puts the cursor into it.
  return <div ref={host} className={`markdown-field${fixed ? ' is-fixed' : ''}${className ? ` ${className}` : ''}`}
    onKeyDown={format.onKeyDown} onContextMenu={format.onContextMenu} onBlur={format.onBlur}
    onMouseDown={event => { if (!fixed && event.target === event.currentTarget) { event.preventDefault(); editor.current?.view.focus(); } }}>{format.menu}</div>;
}
