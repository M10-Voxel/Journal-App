import type { Tag } from './tags.ts';
import type { Language } from './i18n.ts';

export type MailTagKind = 'delivery' | 'payment' | 'appointment';
export const mailTagDefinitions: Record<MailTagKind, { id: string; de: string; en: string; color: string }> = {
  delivery: { id: 'f4c8191a-2d70-4b01-9d00-000000000001', de: 'Lieferung', en: 'Delivery', color: '#e6a85c' },
  payment: { id: 'f4c8191a-2d70-4b01-9d00-000000000002', de: 'Bezahlung', en: 'Payment', color: '#76d982' },
  appointment: { id: 'f4c8191a-2d70-4b01-9d00-000000000003', de: 'Termine', en: 'Appointments', color: '#569eff' },
};

export function classifyMailTag(subject: string, sender: string, content: string, structuredDelivery = false): MailTagKind {
  // Only the address, not a display name or a domain mentioned in the body, supplies a sender signal.
  const address = (sender.match(/<\s*([^<>\s]+@[^<>\s]+)\s*>/)?.[1] ?? sender.trim()).toLowerCase();
  const domain = address.match(/^[^@\s]+@([a-z0-9.-]+)$/)?.[1] ?? '';
  const belongsTo = (domains: string[]) => domains.some(base => domain === base || domain.endsWith(`.${base}`));
  const paymentSender = belongsTo(['paypal.com', 'paypal.de', 'klarna.com', 'klarna.de', 'stripe.com', 'mollie.com', 'adyen.com', 'wise.com', 'revolut.com', 'payone.com', 'worldline.com']);
  const deliverySender = belongsTo(['dhl.com', 'dhl.de', 'dpdhl.com', 'ups.com', 'dpd.de', 'dpd.com', 'dpd.fr', 'dpdgroup.com', 'myhermes.de', 'hermesworld.com', 'gls-group.com', 'gls-germany.com', 'fedex.com', 'deutschepost.de']);
  const payment = /(?:zahlung|bezahlt|bezahlen|bezahlung|zahlungs|rechnung|rechnungs|gutschrift|erstattung|abbuchung|lastschrift|überweisung|rückzahlung|fällig|fälligkeit|payment|paid|invoice|refund|billing|charge|amount due|direct debit|paypal|klarna)/iu;
  const delivery = /(?:\bdhl\b|\bups\b|\bdpd\b|\bgls\b|\bhermes\b|\bfedex\b|lieferung|liefertermin|sendungsverfolgung|sendungsnummer|paket|versand|zustellung|zugestellt|\bdelivery\b|\bshipment\b|\bparcel\b|\btracking\b|\bshipped\b)/iu;
  const amount = /(?:€|\$|£)\s*\d|\d[\d.,\s]*\s*(?:€|\$|£|\b(?:eur|euro|usd|gbp)\b)/iu;
  const text = `${subject}\n${content}`;
  // A payment together with an amount is stronger than a passing shipping reference.
  if (payment.test(text) && amount.test(text)) return 'payment';
  if (paymentSender && payment.test(text)) return 'payment';
  if (deliverySender && (delivery.test(text) || structuredDelivery)) return 'delivery';
  if (payment.test(subject) && !delivery.test(subject)) return 'payment';
  if (delivery.test(subject) && !payment.test(subject)) return 'delivery';
  if (structuredDelivery) return 'delivery';
  if (paymentSender) return 'payment';
  if (deliverySender) return 'delivery';
  if (payment.test(text)) return 'payment';
  if (delivery.test(text)) return 'delivery';
  if (amount.test(text)) return 'payment';
  return 'appointment';
}

/** The mail tags in `language`: existing ones (still named by default) are renamed; missing ones are added only with
 *  `create` (when an import needs them), so a journal without mail stays free of them. */
export function ensureMailTags(tags: readonly Tag[], language: Language, create = true): Tag[] {
  const result = tags.map(tag => ({ ...tag }));
  for (const definition of Object.values(mailTagDefinitions)) {
    const own = result.find(tag => tag.id === definition.id);
    const wanted = definition[language];
    if (own) {
      if ([definition.de, definition.en].includes(own.name) && !result.some(tag => tag.id !== own.id && tag.name.toLowerCase() === wanted.toLowerCase())) own.name = wanted;
    } else if (create && !result.some(tag => [definition.de, definition.en].some(name => name.toLowerCase() === tag.name.toLowerCase()))) {
      result.push({ id: definition.id, name: wanted, color: definition.color });
    }
  }
  return result;
}

export function mailTagId(tags: readonly Tag[], kind: MailTagKind): string | null {
  const definition = mailTagDefinitions[kind];
  return (tags.find(tag => tag.id === definition.id) ?? tags.find(tag => [definition.de, definition.en].some(name => name.toLowerCase() === tag.name.toLowerCase())))?.id ?? null;
}
