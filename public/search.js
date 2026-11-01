(function (root, factory) {
  const synonymGroups = typeof module !== "undefined" && module.exports
    ? require("./search-synonyms")
    : root.XARIDOR_SEARCH_SYNONYMS;
  const api = factory(synonymGroups || []);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.XaridorSearch = api;
})(globalThis, synonymGroups => {
  const apostrophes = /[\u0027\u2018\u2019\u02BB\u02BC\u0060\u00B4]/g;
  const latinMappings = [
    ["shch", "щ"], ["yo", "ё"], ["yu", "ю"], ["ya", "я"], ["ye", "е"],
    ["zh", "ж"], ["kh", "х"], ["ts", "ц"], ["ch", "ч"], ["sh", "ш"], ["ng", "нг"]
  ];
  const latinLetters = {
    a: "а", b: "б", c: "ц", d: "д", e: "е", f: "ф", g: "г", h: "ҳ",
    i: "и", j: "ж", k: "к", l: "л", m: "м", n: "н", o: "о", p: "п",
    q: "қ", r: "р", s: "с", t: "т", u: "у", v: "в", w: "в", x: "х",
    y: "й", z: "з"
  };
  const synonymMap = new Map();

  function clean(value) {
    return String(value || "")
      .normalize("NFKC")
      .toLocaleLowerCase("uz-UZ")
      .replace(apostrophes, "'")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .replace(/\s+/g, " ");
  }

  function toCyrillic(value) {
    let text = clean(value).replace(/o'/g, "ў").replace(/g'/g, "ғ");
    for (const [latin, cyrillic] of latinMappings) {
      text = text.replace(new RegExp(latin, "g"), cyrillic);
    }
    return [...text].map(character => latinLetters[character] || character).join("")
      .replace(/ы/g, "и")
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim()
      .replace(/\s+/g, " ");
  }

  function forms(value) {
    const raw = clean(value)
      .replace(/o'/g, "ў").replace(/g'/g, "ғ")
      .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
    const cyrillic = toCyrillic(value);
    const folded = cyrillic.replace(/ё/g, "е");
    return [...new Set([raw, cyrillic, folded].filter(Boolean))];
  }

  function normalizeQuery(value) {
    return toCyrillic(value);
  }

  function addSynonym(key, values) {
    if (!key) return;
    const existing = synonymMap.get(key) || new Set();
    for (const value of values) {
      for (const form of forms(value)) existing.add(form);
    }
    synonymMap.set(key, existing);
  }

  for (const group of synonymGroups) {
    const groupForms = [...new Set(group.flatMap(forms))];
    for (const term of group) {
      for (const key of forms(term)) addSynonym(key, groupForms);
    }
  }

  function variantsForTerm(term) {
    const variants = new Set(forms(term));
    for (const form of [...variants]) {
      for (const synonym of synonymMap.get(form) || []) variants.add(synonym);
    }
    return variants;
  }

  function editDistanceWithin(left, right, limit) {
    if (Math.abs(left.length - right.length) > limit) return limit + 1;
    let previous = Array(right.length + 1).fill(limit + 1);
    for (let column = 0; column <= Math.min(right.length, limit); column++) previous[column] = column;
    for (let row = 1; row <= left.length; row++) {
      const current = Array(right.length + 1).fill(limit + 1);
      if (row <= limit) current[0] = row;
      let minimum = current[0];
      const start = Math.max(1, row - limit);
      const end = Math.min(right.length, row + limit);
      for (let column = start; column <= end; column++) {
        const cost = left[row - 1] === right[column - 1] ? 0 : 1;
        const value = Math.min(
          previous[column] + 1,
          current[column - 1] + 1,
          previous[column - 1] + cost
        );
        current[column] = value;
        minimum = Math.min(minimum, value);
      }
      if (minimum > limit) return limit + 1;
      previous = current;
    }
    return previous[right.length];
  }

  function maxEditDistance(term) {
    if (term.length < 4) return 0;
    if (term.length < 7) return 1;
    return 2;
  }

  function matchToken(alternatives, targetTokens) {
    for (const alternative of alternatives) {
      if (targetTokens.has(alternative)) return 0;
    }
    for (const alternative of alternatives) {
      if (alternative.length >= 1) {
        for (const target of targetTokens) {
          if (target.startsWith(alternative)) return 0.25;
        }
      }
    }
    let bestDistance = Infinity;
    for (const alternative of alternatives) {
      for (const target of targetTokens) {
        const maxDistance = maxEditDistance(alternative);
        if (maxDistance) {
          const distance = editDistanceWithin(alternative, target, maxDistance);
          if (distance <= maxDistance) bestDistance = Math.min(bestDistance, distance);
        }
      }
    }
    return bestDistance;
  }

  function createIndex(products) {
    return products.map(product => {
      const nameForms = forms(product.name);
      const descriptionForms = forms(product.desc || product.descr || "");
      const tokens = values => new Set(values.flatMap(value => value.split(" ")).filter(Boolean));
      return {
        product,
        nameForms,
        nameTokens: tokens(nameForms),
        allForms: [...new Set([...nameForms, ...descriptionForms])],
        allTokens: tokens([...nameForms, ...descriptionForms])
      };
    });
  }

  function rankMatches(index, query) {
    const queryForms = forms(query);
    const queryTokens = [...new Set(queryForms.flatMap(form => form.split(" ")).filter(Boolean))];
    if (!queryTokens.length) return [];

    const queryAlternatives = queryTokens.map(variantsForTerm);
    const synonymPhrases = new Set(queryForms);
    for (const form of queryForms) {
      for (const synonym of synonymMap.get(form) || []) synonymPhrases.add(synonym);
    }

    const matches = [];
    for (const entry of index) {
      const exactName = entry.nameForms.some(name => synonymPhrases.has(name));
      const phraseInName = [...synonymPhrases].some(phrase =>
        phrase.length >= 2 && entry.nameForms.some(name => name.includes(phrase))
      );
      const nameDistances = queryAlternatives.map(alternatives => matchToken(alternatives, entry.nameTokens));
      const allDistances = queryAlternatives.map(alternatives => matchToken(alternatives, entry.allTokens));
      const nameMatches = nameDistances.filter(Number.isFinite).length;
      const allMatches = allDistances.filter(Number.isFinite).length;
      if (!exactName && !phraseInName && !allMatches) continue;

      const nameCoverage = nameMatches / queryAlternatives.length;
      const allCoverage = allMatches / queryAlternatives.length;
      const fuzzyCost = allDistances.reduce((sum, distance) => sum + (Number.isFinite(distance) ? distance : 0), 0);
      matches.push({
        product: entry.product,
        exactName,
        phraseInName,
        nameCoverage,
        allCoverage,
        fuzzyCost
      });
    }

    matches.sort((left, right) =>
      Number(right.exactName) - Number(left.exactName) ||
      Number(right.phraseInName) - Number(left.phraseInName) ||
      right.nameCoverage - left.nameCoverage ||
      right.allCoverage - left.allCoverage ||
      left.fuzzyCost - right.fuzzyCost ||
      (Number(right.product.sold) || 0) - (Number(left.product.sold) || 0) ||
      (Number(right.product.rating) || 0) - (Number(left.product.rating) || 0) ||
      Number(right.product.stock > 0) - Number(left.product.stock > 0)
    );
    return matches;
  }

  function search(index, query, limit = Infinity) {
    return rankMatches(index, query).slice(0, limit).map(match => match.product);
  }

  return { createIndex, normalizeQuery, rankMatches, search };
});
