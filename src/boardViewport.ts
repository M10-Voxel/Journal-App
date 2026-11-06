export type BoardSize = { width: number; height: number };
export type BoardView = { scale: number; pan: { x: number; y: number } };

/** Keep the same world point in the centre; fit against a stable reference to avoid resize drift. */
export function resizeBoardView(view: BoardView, previous: BoardSize, next: BoardSize, reference: BoardSize & { scale: number }): BoardView {
  const scale = reference.scale * Math.min(next.width / reference.width, next.height / reference.height);
  const centre = { x: (previous.width / 2 - view.pan.x) / view.scale, y: (previous.height / 2 - view.pan.y) / view.scale };
  return { scale, pan: { x: next.width / 2 - centre.x * scale, y: next.height / 2 - centre.y * scale } };
}
