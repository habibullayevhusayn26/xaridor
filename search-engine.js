"use strict";

const APOSTROPHES = /['\u2018\u2019\u02BB\u02BC\u0060\u00B4]/g;
const LATIN_TO_CYRILLIC = [
  ["shch", "щ"], ["yo", "ё"], ["yu", "ю"], ["ya", "я"], ["ye", "е"],
  ["zh", "ж"], ["kh", "х"], ["ts", "ц"], ["ch", "ч"], ["sh", "ш"],
  ["o'", "ў"], ["g'", "ғ"], ["ng", "нг"]
];
const LATIN_LETTERS = {
  a: "а", b: "б", c: "ц", d: "д", e: "е", f: "ф", g: "г", h: "ҳ",
  i: "и", j: "ж", k: "к", l: "л", m: "м", n: "н", o: "о", p: "п",
  q: "қ", r: "р", s: "с", t: "т", u: "у", v: "в", w: "в", x: "х",
  y: "й", z: "з"
};
const CYRILLIC_TO_LATIN = {
  а: "a", б: "b", в: "v", г: "g", ғ: "g'", д: "d", е: "e", ё: "yo",
  ж: "zh", з: "z", и: "i", й: "y", к: "k", қ: "q", л: "l", м: "m",
  н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "kh", ҳ: "h", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ы: "y",
  э: "e", ю: "yu", я: "ya", ў: "o'", ъ: "", ь: ""
};
const LATIN_SCRIPT = /\p{Script=Latin}/u;
const CYRILLIC_SCRIPT = /\p{Script=Cyrillic}/u;
const trigramCache = new Map();
const MAX_TRIGRAM_CACHE_SIZE = 20000;

function cleanInput(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLocaleLowerCase("uz-UZ")
    .replace(APOSTROPHES, "'")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

function toCyrillic(value) {
  let text = cleanInput(value).replace(/o'/g, "ў").replace(/g'/g, "ғ");
  for (const [latin, cyrillic] of LATIN_TO_CYRILLIC) {
    if (latin === "o'" || latin === "g'") continue;
    text = text.replace(new RegExp(latin, "g"), cyrillic);
  }
  return [...text].map(character => LATIN_LETTERS[character] || character).join("")
    .replace(/ы/g, "и")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function toLatin(value) {
  return [...cleanInput(value)].map(character => CYRILLIC_TO_LATIN[character] ?? character).join("")
    .replace(/[^a-z0-9']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value) {
  return cleanInput(value)
    .replace(/o'/g, "ў").replace(/g'/g, "ғ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function searchVariants(value) {
  const clean = normalizeText(value);
  const forms = [clean];
  if (LATIN_SCRIPT.test(clean)) forms.push(toCyrillic(clean));
  if (CYRILLIC_SCRIPT.test(clean)) forms.push(normalizeText(toLatin(clean)));
  return [...new Set(forms.filter(Boolean))];
}

function canonicalQuery(value) {
  return searchVariants(value).sort().join("|").slice(0, 300);
}

function productSearchText(product, categories = []) {
  const categoryName = categories.find(category => category.id === product.cat)?.name || product.cat || "";
  const tags = Array.isArray(product.tags)
    ? product.tags.join(", ")
    : String(product.tags || "");
  const name = product.name || "";
  const description = product.descr || product.desc || "";
  const searchable = [name, categoryName, tags, description].filter(Boolean).join(". ");
  const variants = [...new Set([toCyrillic(searchable), toLatin(searchable)].filter(Boolean))];
  return [searchable, ...variants].join(". ").slice(0, 8000);
}

function makeTrigrams(value) {
  const normalized = normalizeText(value);
  const cached = trigramCache.get(normalized);
  if (cached) return cached;
  const padded = `  ${normalized}  `;
  if (padded.length < 3) return new Set();
  const result = new Set();
  for (let index = 0; index <= padded.length - 3; index++)
    result.add(padded.slice(index, index + 3));
  trigramCache.set(normalized, result);
  if (trigramCache.size > MAX_TRIGRAM_CACHE_SIZE)
    trigramCache.delete(trigramCache.keys().next().value);
  return result;
}

function trigramSimilarity(left, right) {
  const a = makeTrigrams(left), b = makeTrigrams(right);
  if (!a.size || !b.size) return normalizeText(left) === normalizeText(right) ? 1 : 0;
  let intersection = 0;
  for (const gram of a) if (b.has(gram)) intersection++;
  return (2 * intersection) / (a.size + b.size);
}

function fieldTokens(value) {
  return normalizeText(value).split(" ").filter(Boolean);
}

function prepareFuzzyQuery(query) {
  const variants = searchVariants(query);
  return {
    tokens: [...new Set(variants.flatMap(form => fieldTokens(form)))],
    variants
  };
}

function fuzzyScorePrepared(product, queryFeatures, categories) {
  const { tokens: queryTokens, variants: queryVariants } = queryFeatures;
  if (!queryTokens.length) return 0;
  const category = categories.find(item => item.id === product.cat)?.name || product.cat || "";
  const fields = [
    { value: product.name || "", weight: 1 },
    { value: category, weight: 0.9 },
    { value: Array.isArray(product.tags) ? product.tags.join(" ") : product.tags || "", weight: 0.95 },
    { value: product.descr || product.desc || "", weight: 0.55 }
  ].map(field => {
    const tokens = fieldTokens(field.value);
    return { weight: field.weight, tokens, normalized: tokens.join(" ") };
  });
  let weightedScore = 0;
  let totalWeight = 0;
  for (const queryToken of queryTokens) {
    let best = 0;
    for (const field of fields) {
      for (const token of field.tokens) {
        const score = queryToken === token
          ? 1
          : queryToken.length < 3 || token.length < 3
            ? Number(token.startsWith(queryToken) || queryToken.startsWith(token)) * 0.8
            : trigramSimilarity(queryToken, token);
        best = Math.max(best, score * field.weight);
      }
    }
    weightedScore += best;
    totalWeight++;
  }
  const phrase = queryVariants.some(form => fields.some(field => field.normalized.includes(form)));
  return Math.min(1, (weightedScore / totalWeight) * (phrase ? 1.05 : 1));
}

function fuzzyScore(product, query, categories = []) {
  return fuzzyScorePrepared(product, prepareFuzzyQuery(query), categories);
}

function fuzzyRank(products, query, categories = [], fuzzyThreshold = 0.12) {
  const queryFeatures = prepareFuzzyQuery(query);
  return products.map(product => ({
    product,
    score: fuzzyScorePrepared(product, queryFeatures, categories)
  })).filter(item => item.score >= fuzzyThreshold)
    .sort((left, right) => right.score - left.score || comparePopularity(left, right));
}

function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length || !left.length)
    return -1;
  let dot = 0, leftMagnitude = 0, rightMagnitude = 0;
  for (let index = 0; index < left.length; index++) {
    const a = Number(left[index]), b = Number(right[index]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return -1;
    dot += a * b;
    leftMagnitude += a * a;
    rightMagnitude += b * b;
  }
  if (!leftMagnitude || !rightMagnitude) return -1;
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

function comparePopularity(left, right) {
  return (Number(right.product.sold) || 0) - (Number(left.product.sold) || 0) ||
    (Number(right.product.rating) || 0) - (Number(left.product.rating) || 0) ||
    Number(right.product.stock > 0) - Number(left.product.stock > 0);
}

function hybridRank(products, query, queryVector, {
  categories = [],
  fuzzyThreshold = 0.12,
  semanticThreshold = 0.25,
  rrfConstant = 60,
  categoryHint = null,
  fuzzyResults = null
} = {}) {
  const fuzzy = fuzzyResults || fuzzyRank(products, query, categories, fuzzyThreshold);
  const semantic = products.map(product => ({
    product,
    score: cosineSimilarity(queryVector, product.searchEmbedding?.vector)
  })).filter(item => item.score >= semanticThreshold)
    .sort((left, right) => right.score - left.score || comparePopularity(left, right));

  const ranked = new Map();
  const addRanked = (list, source) => list.forEach((item, index) => {
    const key = String(item.product._id ?? item.product.id);
    const entry = ranked.get(key) || { product: item.product, fuzzyScore: 0, semanticScore: -1, rrfScore: 0 };
    if (source === "fuzzy") entry.fuzzyScore = item.score;
    else entry.semanticScore = item.score;
    entry.rrfScore += 1 / (rrfConstant + index + 1);
    if (categoryHint && item.product.cat === categoryHint)
      entry.rrfScore += 0.0005;
    ranked.set(key, entry);
  });
  addRanked(fuzzy, "fuzzy");
  addRanked(semantic, "semantic");

  return [...ranked.values()].sort((left, right) =>
    right.rrfScore - left.rrfScore ||
    Math.max(right.fuzzyScore, right.semanticScore) - Math.max(left.fuzzyScore, left.semanticScore) ||
    comparePopularity(left, right)
  );
}

module.exports = {
  canonicalQuery,
  cleanInput,
  cosineSimilarity,
  fuzzyRank,
  fuzzyScore,
  hybridRank,
  normalizeText,
  productSearchText,
  searchVariants,
  toCyrillic,
  toLatin,
  trigramSimilarity
};
