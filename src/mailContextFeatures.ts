/** Shared by the offline trainer and inference: no keyword allow/deny list. */
export interface MailSentenceContext { text: string; subject: string; previous?: string }
export function mailContextFeatures(context: MailSentenceContext): Map<string, number> {
  const features = new Map<string, number>();
  const add = (key: string, value: number) => features.set(key, (features.get(key) ?? 0) + value);
  function encode(text: string, prefix: string, scale: number) {
    const words = text.normalize('NFKC').toLowerCase().replace(/ß/g, 'ss').replace(/\d+/g, '#').match(/[\p{L}]+|#/gu) ?? [];
    for (let i = 0; i < words.length; i++) {
      add(`${prefix}w:${words[i]}`, scale);
      if (i) add(`${prefix}b:${words[i - 1]} ${words[i]}`, scale);
      if (i > 1) add(`${prefix}t:${words[i - 2]} ${words[i - 1]} ${words[i]}`, scale);
      if (prefix === '' && words[i].length >= 4) {
        const padded = `^${words[i]}$`;
        for (let j = 0; j + 4 <= padded.length; j++) add(`c:${padded.slice(j, j + 4)}`, .35 * scale);
      }
    }
  }
  encode(context.text.slice(0, 2400), '', 1);
  encode(context.subject.slice(0, 300), 's:', .35);
  // Nearby prose helps fragments, but cannot outweigh the actual sentence.
  encode((context.previous ?? '').slice(-400), 'p:', .12);
  const norm = Math.sqrt([...features.values()].reduce((sum, value) => sum + value * value, 0)) || 1;
  return new Map([...features].map(([key, value]) => [key, value / norm]));
}
