import { useCallback, useState } from 'react';
import type { KeyboardEvent, MouseEvent, RefObject } from 'react';
import { Edit, Style, TextColor, colorAt, hasStyle, setColor, textColors, toggleStyle } from '../markdown';
import type { EntryEditor } from './entryEditor';
import { FormatMenu } from './FormatMenu';
import { insertBlock, tableAt, tableEdit } from './noteBlocks';
import type { BlockKind } from './noteBlocks';

const styleKeys: Record<string, Style> = { KeyB: 'bold', KeyI: 'italic', KeyE: 'code' };
const shiftStyleKeys: Record<string, Style> = { KeyX: 'strike', KeyH: 'highlight' };
// Notes: Ctrl+Shift+7 / 8 / 9 numbered, bullets, checklist; Ctrl+Alt+1–3 headings, Ctrl+Alt+Q quote, Ctrl+Alt+C code, Ctrl+Alt+T table.
const noteKeys: Record<string, BlockKind> = { Digit7: 'numbers', Digit8: 'bullets', Digit9: 'tasks' };
const noteAltKeys: Record<string, BlockKind> = { Digit1: 'h1', Digit2: 'h2', Digit3: 'h3', KeyQ: 'quote', KeyC: 'code', KeyT: 'table' };

/**
 * The formatting of an editor: shortcuts (Ctrl+B/I/E, Ctrl+Shift+X/H, Alt+0–8 colours, and with `rich` the blocks), and the
 * right-click menu (also Shift+F10, the menu key, Ctrl+.). Put `onKeyDown`, `onContextMenu` and `onBlur` on the element
 * around the editor and `menu` inside it.
 */
export function useFormatting(editor: RefObject<EntryEditor | null>, { readOnly, rich }: { readOnly: boolean; rich: boolean }) {
  const [menu, setMenu] = useState<{ x: number; y: number; byKey?: boolean } | null>(null);
  // Formatting is an ordinary editor transaction, so Ctrl+Z undoes it like typing.
  function apply(edit: Edit) {
    const view = editor.current?.view;
    if (!view || readOnly) return;
    view.dispatch({ changes: { from: edit.from, to: edit.to, insert: edit.insert }, selection: { anchor: edit.selection[0], head: edit.selection[1] }, userEvent: 'input.format' });
    view.focus();
  }
  const selection = () => { const state = editor.current!.view.state; return [state.doc.toString(), state.selection.main.from, state.selection.main.to] as const; };
  const style = (name: Style) => { const [text, start, end] = selection(); apply(toggleStyle(text, start, end, name)); };
  const color = (name: TextColor | null) => { const [text, start, end] = selection(); apply(setColor(text, start, end, name)); };
  const closeMenu = useCallback(() => setMenu(null), []);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (readOnly || event.metaKey || !editor.current) return;
    const ctrl = event.ctrlKey && !event.altKey;
    if (ctrl && !event.shiftKey && event.code in styleKeys) style(styleKeys[event.code]);
    else if (ctrl && event.shiftKey && event.code in shiftStyleKeys) style(shiftStyleKeys[event.code]);
    else if (event.altKey && !event.ctrlKey && !event.shiftKey && /^Digit[0-8]$/.test(event.code)) {
      const index = Number(event.code.slice(5));
      color(index === 0 ? null : textColors[index - 1].name);
    } else if (event.key === 'ContextMenu' || (event.shiftKey && !event.ctrlKey && !event.altKey && event.key === 'F10') || (ctrl && event.key === '.')) {
      // The format menu from the keyboard (Shift+F10, the menu key, Ctrl+.): at the cursor, its buttons reachable by arrows.
      const view = editor.current.view, at = view.coordsAtPos(view.state.selection.main.head);
      if (!rich && view.state.selection.main.empty) return;
      setMenu({ x: at?.left ?? 0, y: at?.bottom ?? 0, byKey: true });
    } else if (rich && ctrl && event.shiftKey && noteKeys[event.code]) insertBlock(editor.current.view, noteKeys[event.code]);
    else if (rich && event.ctrlKey && event.altKey && !event.shiftKey && noteAltKeys[event.code]) insertBlock(editor.current.view, noteAltKeys[event.code]);
    else return;
    event.preventDefault();
    event.stopPropagation();
  };

  const onContextMenu = (event: MouseEvent<HTMLElement>) => {
    // Only selected text (or a rich note) gets the format menu; otherwise no menu opens.
    const state = editor.current?.view.state;
    if (readOnly || !state || (state.selection.main.empty && !rich)) return;
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY });
  };
  const onBlur = (event: { relatedTarget: EventTarget | null }) => { if (!(event.relatedTarget as Element | null)?.closest('.format-menu')) closeMenu(); };
  const [text, start, end] = menu && editor.current ? selection() : ['', 0, 0];
  const element = menu && <FormatMenu x={menu.x} y={menu.y} byKey={menu.byKey} onReturn={() => editor.current?.view.focus()} color={colorAt(text, start, end)}
      active={{ bold: hasStyle(text, start, end, 'bold'), italic: hasStyle(text, start, end, 'italic'), strike: hasStyle(text, start, end, 'strike'), highlight: hasStyle(text, start, end, 'highlight'), code: hasStyle(text, start, end, 'code') }}
      onStyle={style} onColor={color} onClose={closeMenu}
      blocks={rich && editor.current ? { table: tableAt(editor.current.view.state) !== null, onBlock: (kind: BlockKind) => { insertBlock(editor.current!.view, kind); closeMenu(); },
        onTable: action => { const view = editor.current!.view, at = tableAt(view.state); if (at) tableEdit(view, at.block.from, action, at.column, action === 'add-row' ? at.line + 1 : at.line); closeMenu(); } } : undefined} />;
  return { onKeyDown, onContextMenu, onBlur, closeMenu, menu: element };
}
