import type { Brand, Category, Product } from '@ecom/contracts';

/** In-memory search that mimics Meilisearch behaviour: prefix on the last word, typos, synonyms, ranking. */

export const MAX_QUERY_LENGTH = 100;

/** Groups of interchangeable words (already normalised and stemmed). */
const SYNONYM_GROUPS: string[][] = [
  ['tee', 'tshirt'],
  ['mobile', 'phone', 'smartphone', 'cellphone'],
  ['laptop', 'notebook', 'ultrabook'],
  ['tv', 'television'],
  ['sofa', 'couch'],
  ['sneaker', 'shoe', 'trainer'],
  ['earbud', 'earphone', 'headphone'],
  ['bag', 'backpack'],
  ['kid', 'child'],
  ['jean', 'denim'],
];

export const POPULAR_SEARCHES = ['smartphone', 'sneakers', 't-shirt', 'laptop', 'headphones', 'yoga mat', 'air fryer', 'watch'];

/** Lower-case words without punctuation or accents; hyphenated words also yield their joined form ("t-shirt" -> "tshirt"). */
export function tokenize(text: string): string[] {
  const words: string[] = [];
  for (const raw of text.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().split(/\s+/)) {
    const parts = raw.split(/[^a-z0-9]+/).filter(Boolean);
    words.push(...parts);
    if (raw.includes('-') && parts.length > 1) words.push(parts.join(''));
  }
  return words;
}

/** Very small stemmer: plural forms only. */
export function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(ch|sh|x|ss)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

const terms = (text: string): string[] => tokenize(text).map(stem);

export function allowedTypos(length: number): number {
  if (length <= 4) return 0;
  return length <= 8 ? 1 : 2;
}

/** Optimal string alignment distance, stopping early once it exceeds `max`. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i < rows; i++) {
    let rowMin = Infinity;
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      rowMin = Math.min(rowMin, d[i][j]);
    }
    if (rowMin > max) return max + 1;
  }
  return d[rows - 1][cols - 1];
}

interface IndexDoc {
  product: Product;
  title: Set<string>;
  brand: Set<string>;
  rest: Set<string>;
}

export interface SearchIndex {
  docs: Map<string, IndexDoc>;
  vocabulary: string[];
}

const indexCache = new WeakMap<Product[], SearchIndex>();

export function buildIndex(products: Product[]): SearchIndex {
  const cached = indexCache.get(products);
  if (cached) return cached;
  const docs = new Map<string, IndexDoc>();
  const vocabulary = new Set<string>();
  for (const product of products) {
    const title = new Set(terms(product.title));
    const brand = new Set(terms(product.brandName));
    const restText = [...product.categoryPath.map((c) => c.name), ...product.tags, ...Object.values(product.attributes).map(String), ...product.variants.flatMap((v) => Object.values(v.options))].join(' ');
    const rest = new Set(terms(restText));
    for (const w of [...title, ...brand, ...rest]) vocabulary.add(w);
    docs.set(product.id, { product, title, brand, rest });
  }
  const index = { docs, vocabulary: [...vocabulary] };
  indexCache.set(products, index);
  return index;
}

/** Query words with their alternatives (synonyms). */
function expand(word: string): string[] {
  const group = SYNONYM_GROUPS.find((g) => g.includes(word));
  return group ? [word, ...group.filter((w) => w !== word)] : [word];
}

/** Best score a query word achieves against one document, or 0 when it does not match. */
function scoreWord(word: string, isLast: boolean, doc: IndexDoc): number {
  let best = 0;
  for (const variant of expand(word)) {
    const synonym = variant !== word;
    const typos = allowedTypos(variant.length);
    for (const [words, bonus] of [[doc.title, 2], [doc.brand, 1], [doc.rest, 0]] as const) {
      for (const w of words) {
        let score = 0;
        if (w === variant) score = synonym ? 2 : 3;
        else if (isLast && variant.length >= 2 && w.startsWith(variant)) score = 2;
        else if (typos > 0 && editDistance(variant, w, typos) <= typos) score = 1;
        if (score > 0) best = Math.max(best, score + bonus);
      }
    }
  }
  return best;
}

export interface SearchMatches {
  products: Product[];
  /** Relevance per product id. */
  scores: Map<string, number>;
  correctedFrom?: string;
  /** The query that was actually used (differs from the input when corrected). */
  usedQuery: string;
}

export function cleanQuery(query: string): string {
  return query.slice(0, MAX_QUERY_LENGTH).trim();
}

function run(index: SearchIndex, candidates: Product[], words: string[]): { products: Product[]; scores: Map<string, number> } {
  const scores = new Map<string, number>();
  const products: Product[] = [];
  for (const product of candidates) {
    const doc = index.docs.get(product.id);
    if (!doc) continue;
    let total = 0;
    let ok = true;
    for (let i = 0; i < words.length; i++) {
      const s = scoreWord(words[i], i === words.length - 1, doc);
      if (s === 0) {
        ok = false;
        break;
      }
      total += s;
    }
    if (ok) {
      scores.set(product.id, total);
      products.push(product);
    }
  }
  return { products, scores };
}

/** Closest known word within a slightly generous typo allowance, used for "did you mean". */
function closestWord(word: string, vocabulary: string[]): string | undefined {
  const max = Math.max(1, allowedTypos(word.length) + 1);
  let best: { w: string; d: number } | undefined;
  for (const w of vocabulary) {
    const d = editDistance(word, w, max);
    if (d <= max && (!best || d < best.d)) best = { w, d };
  }
  return best?.w;
}

/** Searches `candidates` (already narrowed by category, brand, ...) for `query`. */
export function searchProducts(index: SearchIndex, candidates: Product[], rawQuery: string): SearchMatches {
  const query = cleanQuery(rawQuery);
  const words = terms(query).filter((w) => w.length >= 2 || /\d/.test(w));
  if (words.length === 0) return { products: [], scores: new Map(), usedQuery: query };
  const first = run(index, candidates, words);
  if (first.products.length > 0) return { ...first, usedQuery: query };

  // No matches: try correcting each unknown word to its closest vocabulary word.
  const known = new Set(index.vocabulary);
  const fixed = words.map((w) => (known.has(w) ? w : (closestWord(w, index.vocabulary) ?? w)));
  if (fixed.join(' ') !== words.join(' ')) {
    const second = run(index, candidates, fixed);
    if (second.products.length > 0) return { ...second, correctedFrom: query, usedQuery: fixed.join(' ') };
  }
  return { products: [], scores: new Map(), usedQuery: query };
}

/** Category and brand names whose words match the query (prefix on the last word, typos allowed). */
export function matchNames<T extends { name: string }>(items: T[], rawQuery: string, limit: number): T[] {
  const words = terms(cleanQuery(rawQuery));
  if (words.length === 0) return [];
  return items
    .filter((item) => {
      const itemWords = terms(item.name);
      return words.every((q, i) => itemWords.some((w) => w === q || (i === words.length - 1 && q.length >= 2 && w.startsWith(q)) || (allowedTypos(q.length) > 0 && editDistance(q, w, allowedTypos(q.length)) <= allowedTypos(q.length))));
    })
    .slice(0, limit);
}

/** Suggested query strings: popular searches, category and brand names, and a corrected spelling when nothing else fits. */
export function suggestQueries(rawQuery: string, categories: Category[], brands: Brand[], matches: SearchMatches, limit: number): string[] {
  const q = cleanQuery(rawQuery).toLowerCase();
  if (!q) return POPULAR_SEARCHES.slice(0, limit);
  const out: string[] = [];
  const add = (s: string) => {
    const t = s.trim();
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  };
  for (const p of POPULAR_SEARCHES) if (p.startsWith(q) || tokenize(p).some((w) => w.startsWith(q))) add(p);
  for (const c of matchNames(categories, q, 3)) add(c.name);
  for (const b of matchNames(brands, q, 2)) add(b.name);
  // Product titles are shown as product results, so they are not repeated as query suggestions.
  if (out.length === 0 && matches.correctedFrom) add(matches.usedQuery);
  return out.slice(0, limit);
}
