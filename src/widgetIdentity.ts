export const widgetIdFromLabel = (label: string): string | null => /^widget-[a-z0-9-]{1,64}$/.test(label) ? label.slice(7) : null;
export const isDesktopWidgetLabel = (label: string) => widgetIdFromLabel(label) !== null;
