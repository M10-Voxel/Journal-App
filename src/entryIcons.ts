// Icons for entries, like the icons of a Notion page: a large set of flat line icons (Lucide, ISC licence), drawn with
// `currentColor` so the calendar colours them in the entry's tag. An entry stores the icon's name in kebab case
// as Lucide names it (`stethoscope`, `graduation-cap`, `grid-2x2-plus`); the set is loaded only once something needs it
// (its own chunk, see lucideSet.ts).

/** One icon: SVG elements with their attributes, on a 24 × 24 grid. */
export type IconNode = readonly (readonly [string, Record<string, string | number>])[];

export const validIconName = (value: unknown): value is string => typeof value === 'string' && /^[a-z0-9-]{1,64}$/.test(value);

let library: Map<string, IconNode> | null = null;
let loading: Promise<Map<string, IconNode>> | null = null;
const listeners = new Set<() => void>();
/** The icons by name; loaded on first use. */
export function loadIcons(): Promise<Map<string, IconNode>> {
  if (library) return Promise.resolve(library);
  loading ??= import('./lucideSet').then(module => {
    library = module.icons;
    for (const listener of [...listeners]) listener();
    return library;
  });
  return loading;
}
export const iconsNow = () => library;
export function onIconsLoaded(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }

/** What a picker offers first, before anything is searched: everyday things, roughly by topic. */
export const commonIcons = [
  'calendar', 'clock', 'bell', 'star', 'heart', 'flag', 'target', 'circle-check', 'circle-exclamation-point', 'bookmark', 'pin', 'lightbulb',
  'briefcase', 'laptop', 'presentation', 'file-text', 'notebook-pen', 'pen-line', 'clipboard-list', 'mail', 'phone', 'message-circle', 'video', 'users',
  'graduation-cap', 'school', 'book-open', 'library', 'brain', 'calculator', 'microscope', 'languages', 'code', 'terminal', 'git-branch', 'bug',
  'house', 'bed', 'bath', 'sofa', 'shirt', 'washing-machine', 'key', 'wrench', 'hammer', 'paintbrush', 'scissors', 'trash',
  'utensils', 'coffee', 'pizza', 'apple', 'cooking-pot', 'wine', 'beer', 'cake', 'ice-cream-cone', 'salad', 'sandwich', 'egg',
  'shopping-cart', 'shopping-bag', 'store', 'gift', 'package', 'truck', 'wallet', 'credit-card', 'piggy-bank', 'banknote', 'receipt', 'landmark',
  'dumbbell', 'bike', 'footprints', 'trophy', 'medal', 'volleyball', 'waves-horizontal', 'mountain', 'tent', 'tree-pine', 'flower-2', 'leaf',
  'stethoscope', 'pill', 'syringe', 'hospital', 'heart-pulse', 'activity', 'face-slightly-smiling', 'baby', 'dog', 'cat', 'paw-print', 'hand-heart',
  'plane', 'car', 'train-front', 'bus', 'ship', 'map-pin', 'map', 'compass', 'luggage', 'hotel', 'fuel', 'parking-meter',
  'keyboard-music', 'headphones', 'film', 'tv', 'gamepad-2', 'camera', 'palette', 'guitar', 'mic', 'ticket', 'party-popper', 'sparkles',
  'sun', 'moon', 'cloud-rain', 'snowflake', 'umbrella', 'flame', 'zap', 'droplets', 'church', 'cross', 'sprout', 'recycle',
] as const;

/** German words for searching (the names are English): a word finds every icon listed for it. */
const germanWords: Record<string, string[]> = {
  termin: ['calendar', 'calendar-days', 'clock'], kalender: ['calendar', 'calendar-days'], uhr: ['clock', 'alarm-clock', 'watch'], zeit: ['clock', 'hourglass', 'timer'],
  erinnerung: ['bell', 'alarm-clock'], wichtig: ['star', 'circle-exclamation-point', 'flag'], ziel: ['target', 'flag', 'trophy'], idee: ['lightbulb', 'sparkles'],
  arbeit: ['briefcase', 'laptop', 'building'], büro: ['briefcase', 'building', 'printer'], besprechung: ['users', 'presentation', 'video'], meeting: ['users', 'presentation', 'video'],
  telefon: ['phone', 'smartphone'], anruf: ['phone', 'phone-call'], email: ['mail'], mail: ['mail', 'inbox'], brief: ['mail', 'mailbox'], nachricht: ['message-circle', 'message-square'],
  uni: ['graduation-cap', 'school', 'book-open'], schule: ['school', 'graduation-cap', 'backpack'], lernen: ['book-open', 'brain', 'graduation-cap'], buch: ['book', 'book-open', 'library'],
  prüfung: ['file-check', 'clipboard-check', 'graduation-cap'], hausaufgabe: ['notebook-pen', 'pencil'], notiz: ['notebook-pen', 'sticky-note', 'file-text'], schreiben: ['pen-line', 'pencil', 'notebook-pen'],
  programmieren: ['code', 'terminal', 'laptop'], computer: ['laptop', 'monitor', 'computer'],
  haus: ['house', 'house'], zuhause: ['house', 'sofa'], schlafen: ['bed', 'moon'], putzen: ['spray-can', 'trash', 'washing-machine'], wäsche: ['washing-machine', 'shirt'], kleidung: ['shirt'],
  reparatur: ['wrench', 'hammer', 'drill'], werkzeug: ['wrench', 'hammer'], garten: ['sprout', 'flower-2', 'shovel'], müll: ['trash', 'recycle'],
  essen: ['utensils', 'pizza', 'salad', 'cooking-pot'], kochen: ['cooking-pot', 'chef-hat', 'utensils'], frühstück: ['coffee', 'egg', 'croissant'], kaffee: ['coffee'], trinken: ['wine', 'beer', 'cup-soda'],
  geburtstag: ['cake', 'gift', 'party-popper'], party: ['party-popper', 'wine', 'headphones'], feier: ['party-popper', 'cake'], geschenk: ['gift'],
  einkaufen: ['shopping-cart', 'shopping-bag', 'store'], einkauf: ['shopping-cart', 'shopping-basket'], paket: ['package', 'truck'], lieferung: ['truck', 'package'],
  geld: ['wallet', 'banknote', 'coins'], bezahlen: ['credit-card', 'receipt', 'wallet'], rechnung: ['receipt', 'file-text'], bank: ['landmark', 'piggy-bank'], sparen: ['piggy-bank'],
  sport: ['dumbbell', 'bike', 'trophy', 'volleyball'], training: ['dumbbell', 'activity'], laufen: ['footprints'], joggen: ['footprints'], fahrrad: ['bike'], radfahren: ['bike'], schwimmen: ['waves-horizontal'], wandern: ['mountain', 'footprints', 'tent'],
  arzt: ['stethoscope', 'hospital'], zahnarzt: ['stethoscope'], krankenhaus: ['hospital'], medizin: ['pill', 'syringe'], tabletten: ['pill'], gesundheit: ['heart-pulse', 'activity'], impfung: ['syringe'],
  familie: ['users', 'house', 'heart'], freunde: ['users', 'face-slightly-smiling'], kind: ['baby'], baby: ['baby'], hund: ['dog', 'paw-print'], katze: ['cat', 'paw-print'], haustier: ['paw-print', 'dog', 'cat'], liebe: ['heart', 'hand-heart'],
  reise: ['plane', 'luggage', 'map'], urlaub: ['plane', 'sun', 'luggage', 'tree-palm'], flug: ['plane'], auto: ['car'], zug: ['train-front'], bahn: ['train-front'], bus: ['bus'], schiff: ['ship'], tanken: ['fuel'], parken: ['parking-meter'], ort: ['map-pin'], hotel: ['hotel', 'bed'],
  musik: ['keyboard-music', 'headphones', 'guitar', 'piano'], film: ['film', 'clapperboard'], kino: ['film', 'popcorn', 'ticket'], fernsehen: ['tv'], spielen: ['gamepad-2', 'dice-5'], foto: ['camera', 'image'], malen: ['palette', 'paintbrush'], konzert: ['guitar', 'ticket', 'mic'],
  wetter: ['sun', 'cloud', 'cloud-rain'], sonne: ['sun'], regen: ['cloud-rain', 'umbrella'], schnee: ['snowflake'], nacht: ['moon'], kirche: ['church'], natur: ['tree-pine', 'leaf', 'mountain'], pflanze: ['sprout', 'leaf'],
};

/** Icons for a search: German words and the icons' own names, the best fits first (at most `limit`). */
export function searchIcons(names: Iterable<string>, query: string, limit = 160): string[] {
  const all = [...names];
  const wanted = query.trim().toLowerCase().replace(/\s+/g, '-');
  if (!wanted) return commonIcons.filter(name => all.includes(name));
  const known = new Set(all), found = new Map<string, number>();
  const add = (name: string, rank: number) => { if (known.has(name) && (found.get(name) ?? 99) > rank) found.set(name, rank); };
  for (const [word, icons] of Object.entries(germanWords)) {
    const rank = word === wanted ? 0 : word.startsWith(wanted) ? 1 : wanted.length > 2 && word.includes(wanted) ? 3 : -1;
    // The first icon listed for a word is its best fit.
    if (rank >= 0) icons.forEach((name, index) => add(name, rank + index / 100));
  }
  for (const name of all) {
    if (name === wanted) add(name, 0);
    else if (name.startsWith(wanted) || name.split('-').some(part => part.startsWith(wanted))) add(name, 2);
    else if (name.includes(wanted)) add(name, 4);
  }
  return [...found].sort((a, b) => a[1] - b[1] || a[0].length - b[0].length || a[0].localeCompare(b[0])).slice(0, limit).map(([name]) => name);
}
