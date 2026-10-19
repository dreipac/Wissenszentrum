/** Kleinschreibung ohne Akzente und Umlautpunkte, damit „uber“ auch „Über“ findet. */
export const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Suchbegriffe: durch Leerzeichen getrennt, alle müssen vorkommen. */
export const tokens = (query: string) => fold(query).split(/\s+/).filter(Boolean);

/**
 * Wie gut passt ein Eintrag? 0 = gar nicht. Alle Begriffe müssen im Titel oder im Zusatztext stehen; Treffer am
 * Wortanfang des Titels zählen am meisten, dann Treffer im Titel, dann im Zusatztext.
 */
export function score(title: string, extra: string, terms: string[]): number {
  if (terms.length === 0) return 1;
  const t = fold(title);
  const e = fold(extra);
  let total = 0;
  for (const term of terms) {
    const at = t.indexOf(term);
    if (at === 0) total += 100;
    else if (at > 0 && /[\s\-_/.:(]/.test(t[at - 1])) total += 80;
    else if (at > 0) total += 50;
    else if (e.includes(term)) total += 20;
    else return 0;
  }
  // Kürzere Titel zuerst, wenn sonst gleich
  return total - Math.min(t.length, 60) / 100;
}

/** Zerlegt einen Text in Teile mit und ohne Treffer (für die Hervorhebung). */
export function highlight(text: string, terms: string[]): { text: string; hit: boolean }[] {
  if (terms.length === 0 || !text) return [{ text, hit: false }];
  // fold() ändert die Länge nur bei seltenen Zeichen nicht; sicherheitshalber nur nutzen, wenn die Länge gleich bleibt
  const folded = fold(text);
  if (folded.length !== text.length) return [{ text, hit: false }];
  const marks = new Array<boolean>(text.length).fill(false);
  for (const term of terms) {
    let from = 0;
    for (;;) {
      const at = folded.indexOf(term, from);
      if (at < 0) break;
      for (let i = at; i < at + term.length; i++) marks[i] = true;
      from = at + term.length;
    }
  }
  const parts: { text: string; hit: boolean }[] = [];
  for (let i = 0; i < text.length; i++) {
    const last = parts[parts.length - 1];
    if (last && last.hit === marks[i]) last.text += text[i];
    else parts.push({ text: text[i], hit: marks[i] });
  }
  return parts;
}

/** Textauszug rund um den ersten Treffer (für Seiten- und Notizentext). */
export function snippet(text: string, terms: string[], length = 90): string {
  const flat = text.split(/\s+/).join(" ").trim();
  if (flat.length <= length) return flat;
  const folded = fold(flat);
  const at = terms.length && folded.length === flat.length ? Math.min(...terms.map((t) => (folded.indexOf(t) < 0 ? Infinity : folded.indexOf(t)))) : 0;
  if (!Number.isFinite(at) || at < length - 20) return `${flat.slice(0, length)}${flat.length > length ? " …" : ""}`;
  const start = Math.max(0, at - 24);
  return `… ${flat.slice(start, start + length)}${start + length < flat.length ? " …" : ""}`;
}
