(function (root) {
  const groups = [
    ["telefon", "smartfon", "mobil", "phone", "iphone"],
    ["g'ilof", "gilof", "chexol", "чехол", "case"],
    ["quloqchin", "naushnik", "наушник", "headphone", "earphone"],
    ["krossovka", "кроссовка", "krasovka", "sport oyoq kiyim"],
    ["noutbuk", "ноутбук", "laptop", "notebook"],
    ["televizor", "телевизор", "tv"],
    ["changyutgich", "пылесос", "pilesos", "vacuum"],
    ["muzlatgich", "холодильник", "holodilnik", "xolodilnik"],
    ["soat", "часы", "watch"],
    ["sumka", "сумка", "bag"],
    ["ko'ylak", "koʻylak", "рубашка", "shirt"],
    ["zaryadlagich", "зарядка", "charger", "adapter"]
  ];

  if (typeof module !== "undefined" && module.exports) module.exports = groups;
  else root.XARIDOR_SEARCH_SYNONYMS = groups;
})(globalThis);
