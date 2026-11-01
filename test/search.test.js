"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const XaridorSearch = require("../public/search.js");

const products = [
  { id: 1, name: "Smartfon Samsung", desc: "Android telefon", sold: 80, rating: 4.7, stock: 12 },
  { id: 2, name: "Чехол Samsung", desc: "Telefon g'ilofi", sold: 12, rating: 4.4, stock: 8 },
  { id: 3, name: "G'ilof iPhone", desc: "Phone case", sold: 20, rating: 4.8, stock: 4 },
  { id: 4, name: "Кроссовка Nike", desc: "Sport oyoq kiyim", sold: 34, rating: 4.6, stock: 2 },
  { id: 5, name: "Noutbuk Lenovo", desc: "Laptop", sold: 60, rating: 4.9, stock: 3 },
  { id: 6, name: "iPhone 15", desc: "Smartfon", sold: 90, rating: 4.8, stock: 0 },
  { id: 7, name: "Samsung Galaxy S24", desc: "Telefon", sold: 30, rating: 4.5, stock: 6 },
  { id: 8, name: "Model", desc: "Tajriba", sold: 2, rating: 4.1, stock: 0 },
  { id: 9, name: "Model Plus", desc: "Tajriba", sold: 100, rating: 4.9, stock: 10 },
  { id: 10, name: "Soat", desc: "Watch", sold: 5, rating: 4.0, stock: 0 },
  { id: 11, name: "Sport krossovka", desc: "Oyoq kiyim", sold: 10, rating: 4.3, stock: 7 }
];
const index = XaridorSearch.createIndex(products);
const ids = query => XaridorSearch.search(index, query).map(product => product.id);

const matchingCases = [
  ["Smartfon lotincha", "smartfon", 1],
  ["Smartfon kirillcha", "смартфон", 1],
  ["Telefon sinonimi", "telefon", 1],
  ["Smartphone typo transposition", "samrtfon", 1],
  ["iPhone typo", "iphne", 6],
  ["Qisqa prefix", "ip", 6],
  ["Bir harfli prefix", "s", 1],
  ["Chexol lotin transliteratsiyasi", "chexol", 2],
  ["Chexol kirill yozuvi", "чехол", 2],
  ["G'ilof sinonimi", "g'ilof", 2],
  ["Case sinonimi", "case", 2],
  ["Ruscha krossovka", "кроссовка", 4],
  ["Krasovka typo", "krasovka", 4],
  ["Krossovka sinonimi", "sport oyoq kiyim", 4],
  ["Noutbuk lotincha", "noutbuk", 5],
  ["Noutbuk ruscha", "ноутбук", 5],
  ["Laptop sinonimi", "laptop", 5],
  ["Aralash lotin va kirill", "smartfon samsung", 1],
  ["Aralash chexol va Samsung", "чехол samsung", 2],
  ["O'zbek apostrof belgisi", "gʻilof", 2],
  ["Aralash uzbek Cyrillic/lating", "ғилоф iphone", 3]
];

for (const [title, query, expectedId] of matchingCases) {
  test(`${title}: ${query}`, () => {
    assert.ok(ids(query).includes(expectedId), `Expected product ${expectedId} for ${query}`);
  });
}

test("Exact product name ranks before a more popular partial match", () => {
  assert.equal(ids("model")[0], 8);
});

test("Product-name matches rank before description-only matches", () => {
  const rankingIndex = XaridorSearch.createIndex([
    { id: 1, name: "Phone accessory", desc: "", sold: 2, rating: 4, stock: 1 },
    { id: 2, name: "Accessory", desc: "Phone", sold: 1000, rating: 5, stock: 1 }
  ]);
  assert.equal(XaridorSearch.search(rankingIndex, "phone")[0].id, 1);
});

test("Sales, rating, and stock break relevance ties in that order", () => {
  const rankingIndex = XaridorSearch.createIndex([
    { id: 1, name: "Watch red", desc: "", sold: 10, rating: 5, stock: 0 },
    { id: 2, name: "Watch blue", desc: "", sold: 10, rating: 4, stock: 2 },
    { id: 3, name: "Watch green", desc: "", sold: 20, rating: 3, stock: 0 },
    { id: 4, name: "Watch gold", desc: "", sold: 10, rating: 5, stock: 5 }
  ]);
  assert.deepEqual(XaridorSearch.search(rankingIndex, "watch").map(product => product.id), [3, 4, 1, 2]);
});

test("No-match search returns no products", () => {
  assert.deepEqual(ids("aslo boshqa narsa"), []);
});

test("Search suggestions can be capped for autocomplete", () => {
  assert.equal(XaridorSearch.search(index, "s", 6).length <= 6, true);
});

test("Normalization handles apostrophe variants", () => {
  assert.equal(XaridorSearch.normalizeQuery("oʻzbek g’oyasi"), XaridorSearch.normalizeQuery("o'zbek g'oyasi"));
});

test("Normalization handles Uzbek digraphs and apostrophe letters", () => {
  assert.equal(XaridorSearch.normalizeQuery("O‘ G‘ Sh Ch Ng"), "ў ғ ш ч нг");
});

test("Large local index returns typo matches within the interactive budget", () => {
  const largeIndex = XaridorSearch.createIndex(Array.from({ length: 5000 }, (_, index) => ({
    id: index,
    name: index === 4999 ? "Smartfon Samsung" : `Mahsulot ${index}`,
    desc: "",
    sold: index,
    rating: 4,
    stock: 1
  })));
  const start = performance.now();
  assert.equal(XaridorSearch.search(largeIndex, "samrtfon")[0].id, 4999);
  const duration = performance.now() - start;
  console.log(`5,000 mahsulot uchun typo qidiruvi: ${duration.toFixed(1)} ms`);
  assert.ok(duration < 300, `Search took too long: ${duration.toFixed(1)} ms`);
});
