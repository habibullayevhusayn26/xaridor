"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  canonicalQuery,
  cosineSimilarity,
  hybridRank,
  normalizeText,
  searchVariants,
  toCyrillic,
  toLatin,
  trigramSimilarity
} = require("../search-engine");

const categories = [
  { id: "electronics", name: "Elektronika" },
  { id: "clothing", name: "Kiyim" }
];
const vector = index => Array.from({ length: 4 }, (_, position) => Number(position === index));
const headphones = {
  _id: 1,
  name: "Simsiz quloqchin",
  cat: "electronics",
  tags: ["bluetooth"],
  descr: "Musiqa uchun simsiz audio qurilma",
  sold: 30,
  rating: 4.8,
  stock: 5,
  searchEmbedding: { vector: vector(0) }
};

const headphoneQueries = [
  "naushnik", "navushnik", "nauhsnik", "naushnk", "наушники", "quloqchin",
  "kulokchin", "headphones", "airpods", "simsiz naushnik", "naushnik bluetuz"
];

test("Semantic embedding matches all requested headphone-query variants", () => {
  for (const query of headphoneQueries) {
    const queryVector = vector(0);
    const results = hybridRank([headphones], query, queryVector, { categories });
    assert.equal(results[0]?.product._id, headphones._id, `No headphone result for "${query}"`);
  }
});

const typoCases = [
  ["Smartfon Samsung", "samrtfon"],
  ["iPhone 15", "iphne"],
  ["Krossovka Nike", "krasovka"],
  ["Noutbuk Lenovo", "noutbik"],
  ["Telefon Samsung", "telephon"],
  ["Чехол Samsung", "chexol"],
  ["Quloqchin simsiz", "kulokchin"],
  ["Planshet Apple", "plnashet"],
  ["Soat aqlli", "soatt"],
  ["Kamera Canon", "kamra"],
  ["Kolonka JBL", "kolnka"],
  ["Zaryadlovchi USB", "zaryadlovhci"],
  ["Ryukzak maktab", "ryukzk"],
  ["Klaviatura mexanik", "klaviatrua"],
  ["Sichqoncha kompyuter", "sichqonhca"],
  ["Monitor 24", "monitr"],
  ["Televizor Smart", "televizir"]
];

for (const [name, query] of typoCases) {
  test(`Fuzzy / multilingual match: "${query}" -> "${name}"`, () => {
    const product = { _id: 2, name, cat: "electronics", tags: [], descr: "" };
    const result = hybridRank([product], query, null, { categories });
    assert.equal(result[0]?.product._id, product._id);
  });
}

test("Normalization unifies apostrophes, whitespace, and case", () => {
  assert.equal(normalizeText(" OʻzBEK   G’oya "), normalizeText("o'zbek g'oya"));
  assert.equal(canonicalQuery("Oʻzbek G’oya"), canonicalQuery("o'zbek g'oya"));
});

test("Uzbek Latin and Cyrillic forms are transliterated consistently", () => {
  assert.equal(toCyrillic("O'g'li shahar choy"), "ўғли шаҳар чой");
  assert.equal(toLatin("ўғли шаҳар чой"), "o'g'li shahar choy");
  assert.ok(searchVariants("chexol").some(form => searchVariants("чехол").includes(form)));
});

test("Trigram similarity tolerates transposition and missing characters", () => {
  assert.ok(trigramSimilarity("samrtfon", "smartfon") > 0.5);
  assert.ok(trigramSimilarity("iphne", "iphone") > 0.5);
});

test("Cosine similarity validates dimensions and values", () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.equal(cosineSimilarity([1, 0], [0, 1]), 0);
  assert.equal(cosineSimilarity([1], [1, 0]), -1);
});

test("Hybrid ranking merges fuzzy and semantic matches and rejects unrelated vectors", () => {
  const semanticHeadphones = { ...headphones, searchEmbedding: { vector: vector(0) } };
  const unrelated = {
    _id: 3, name: "Zar o'yini", cat: "clothing", tags: [], descr: "",
    searchEmbedding: { vector: vector(1) }
  };
  const results = hybridRank(
    [semanticHeadphones, unrelated],
    "naushnik",
    vector(0),
    { categories, semanticThreshold: 0.5 }
  );
  assert.deepEqual(results.map(item => item.product._id), [1]);
});

test("Popularity breaks equal relevance ties in sales, rating, then stock order", () => {
  const products = [
    { _id: 1, name: "Watch", sold: 10, rating: 5, stock: 0 },
    { _id: 2, name: "Watch", sold: 10, rating: 4, stock: 2 },
    { _id: 3, name: "Watch", sold: 20, rating: 3, stock: 0 },
    { _id: 4, name: "Watch", sold: 10, rating: 5, stock: 5 }
  ];
  assert.deepEqual(
    hybridRank(products, "watch", null, { categories, fuzzyThreshold: 0.1 })
      .map(item => item.product._id),
    [3, 4, 1, 2]
  );
});

test("Low-similarity products are excluded rather than returned as random results", () => {
  const product = {
    _id: 5, name: "Telefon Samsung", cat: "electronics", tags: [], descr: "",
    searchEmbedding: { vector: vector(0) }
  };
  assert.deepEqual(hybridRank([product], "zar o'yini", vector(1), { categories }), []);
});

test("Fuzzy autocomplete can return a short prefix match", () => {
  const product = { _id: 6, name: "Smartfon Samsung", cat: "electronics", tags: [], descr: "" };
  assert.equal(hybridRank([product], "smart", null, { categories })[0]?.product._id, product._id);
});

test("5,000-product fuzzy ranking stays within the 500 ms interactive budget", () => {
  const products = Array.from({ length: 5000 }, (_, index) => ({
    _id: index + 10,
    name: index === 4999 ? "Smartfon Samsung" : `Mahsulot model-${index}`,
    cat: "electronics",
    tags: [],
    descr: ""
  }));
  const start = performance.now();
  const result = hybridRank(products, "samrtfon", null, { categories });
  const duration = performance.now() - start;
  console.log(`5,000 mahsulot uchun typo qidiruvi: ${duration.toFixed(1)} ms`);
  assert.equal(result[0]?.product._id, 5009);
  assert.ok(duration < 500, `Search took too long: ${duration.toFixed(1)} ms`);
});
