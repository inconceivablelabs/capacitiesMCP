// Dates embedded in object titles ("Weekly Sync - 2025-05-15", "Retro (May 19, 2026)",
// "Prep 3/18/26"). Used to order enumerated candidates before the fetch cap truncates them.

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
};

// Alternation is longest-first and followed by (?![a-z]) so "Mayor 3, 2025" or "Marching" never match.
const MONTH_NAMES =
  "january|february|march|april|may|june|july|august|september|october|november|december|sept|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec";

// Each pattern yields a [year, month, day] extractor; digit-adjacency guards stop
// "12025-05-150" or "13/18/2026" fragments from matching inside longer digit runs.
const PATTERNS: { re: RegExp; read: (m: RegExpExecArray) => [number, number, number] }[] = [
  { re: /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g, read: m => [+m[1], +m[2], +m[3]] },
  {
    re: new RegExp(`(?<![a-z])(${MONTH_NAMES})(?![a-z])\\.?\\s+(\\d{1,2}),\\s*(\\d{4})(?!\\d)`, "gi"),
    read: m => [+m[3], MONTHS[m[1].toLowerCase()], +m[2]],
  },
  {
    re: /(?<!\d)(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})(?!\d)/g,
    read: m => [m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1], +m[2]],
  },
];

function validUtc(y: number, mo: number, d: number): number | null {
  const ms = Date.UTC(y, mo - 1, d);
  const dt = new Date(ms);
  // Date.UTC rolls over (Feb 30 -> Mar 2), so round-trip to reject non-dates.
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? ms : null;
}

/** UTC ms of the leftmost valid date in the title, or null. */
export function parseTitleDate(title: string | null | undefined): number | null {
  if (!title) return null;
  let best: { index: number; ms: number } | null = null;
  for (const { re, read } of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(title)) !== null) {
      const [y, mo, d] = read(m);
      const ms = validUtc(y, mo, d);
      if (ms !== null) {
        if (best === null || m.index < best.index) best = { index: m.index, ms };
        break; // later matches of this shape are further right
      }
    }
  }
  return best === null ? null : best.ms;
}

/** New array: dated titles first (by date in `direction`), then undated; ties keep input order. */
export function orderEnumerated<T extends { title: string }>(cands: readonly T[], direction: "asc" | "desc"): T[] {
  const sign = direction === "desc" ? -1 : 1;
  const keyed = cands.map(c => ({ c, t: parseTitleDate(c.title) }));
  // Relies on Array.prototype.sort stability (ES2019+) for ties and undated order.
  keyed.sort((a, b) => {
    if (a.t === null || b.t === null) return a.t === b.t ? 0 : a.t === null ? 1 : -1;
    return a.t === b.t ? 0 : (a.t < b.t ? -1 : 1) * sign;
  });
  return keyed.map(k => k.c);
}
