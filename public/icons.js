/* Bir xil uslubdagi (24px, 1.75 chiziq, yumaloq uchlar) SVG ikonlar.
   Ko'pchiligi Lucide (lucide.dev, ISC litsenziya) uslubi/shaklida, qolganlari shu uslubda chizilgan. */
const ICONS = {
  /* mahsulot va kategoriya ikonlari */
  smartphone: '<rect width="14" height="20" x="5" y="2" rx="2"/><path d="M12 18h.01"/>',
  headphones: '<path d="M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3"/>',
  laptop: '<path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9m16 0H4m16 0 1.28 2.55a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45L4 16"/>',
  watch: '<circle cx="12" cy="12" r="6"/><path d="M12 10v2l1 1"/><path d="m16.13 7.66-.81-4.05a2 2 0 0 0-2-1.61h-2.68a2 2 0 0 0-2 1.61l-.78 4.05"/><path d="m7.88 16.36.8 4a2 2 0 0 0 2 1.61h2.72a2 2 0 0 0 2-1.61l.81-4.05"/>',
  vacuum: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v3"/>',
  plug: '<path d="M9 2v6M15 2v6"/><path d="M6 8h12v4a6 6 0 0 1-12 0z"/><path d="M12 18v4"/>',
  kettle: '<path d="M5 10h11l-1 11H6z"/><path d="M16 12h2a2 2 0 0 1 0 5h-1.5"/><path d="M5 10 3 6"/><path d="M8 10V7h5v3"/>',
  blender: '<path d="m6 8 1.75 12.28a2 2 0 0 0 2 1.72h4.54a2 2 0 0 0 2-1.72L18 8"/><path d="M5 8h14"/><path d="M7 15a6.47 6.47 0 0 1 5 0 6.47 6.47 0 0 0 5 0"/><path d="m12 8 1-6h2"/>',
  shirt: '<path d="M20.38 3.46 16 2a4 4 0 0 1-8 0L3.62 3.46a2 2 0 0 0-1.34 2.23l.58 3.47a1 1 0 0 0 .99.84H6v10c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V10h2.15a1 1 0 0 0 .99-.84l.58-3.47a2 2 0 0 0-1.34-2.23z"/>',
  dress: '<path d="M9 2l1 6-5 13h14L14 8l1-6"/><path d="M10 8h4"/>',
  jacket: '<path d="M8 3 3 6l1 14h16l1-14-5-3"/><path d="M8 3c1 2 7 2 8 0"/><path d="M12 7v13"/>',
  sneaker: '<path d="M2 18v-4c3 0 5-1 6-4l3 2 4 1c3 1 5 2 5 5z"/><path d="M2 18h20"/>',
  shoe: '<path d="M8 3h5v7l6 3c1 .5 2 1 2 3v2H4V3z"/><path d="M4 8h4"/>',
  sofa: '<path d="M20 9V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v3"/><path d="M2 11v5a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-5a2 2 0 0 0-4 0v2H6v-2a2 2 0 0 0-4 0Z"/><path d="M4 18v2"/><path d="M20 18v2"/>',
  utensils: '<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
  lightbulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
  sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/>',
  jar: '<path d="M6 10h12v9a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z"/><path d="M5 6h14v4H5z"/>',
  perfume: '<rect x="6" y="9" width="12" height="12" rx="2"/><path d="M10 9V6h4v3"/><path d="M9 3h6v3H9z"/>',
  blocks: '<rect width="18" height="12" x="3" y="8" rx="1"/><path d="M10 8V5c0-.6-.4-1-1-1H6a1 1 0 0 0-1 1v3"/><path d="M19 8V5c0-.6-.4-1-1-1h-3a1 1 0 0 0-1 1v3"/>',
  teddy: '<circle cx="12" cy="13" r="7"/><circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M10 12h.01M14 12h.01"/><path d="M10.5 16c.8.7 2.2.7 3 0"/>',
  ball: '<circle cx="12" cy="12" r="10"/><path d="m12 8 3.5 2.5-1.3 4h-4.4l-1.3-4z"/><path d="M12 8V2"/><path d="m15.5 10.5 5.5-1.5"/><path d="m14.2 14.5 3 4.5"/><path d="m9.8 14.5-3 4.5"/><path d="M8.5 10.5 3 9"/>',
  mat: '<rect x="3" y="8" width="18" height="8" rx="4"/><circle cx="17" cy="12" r="1.5"/>',
  dumbbell: '<path d="M3 10v4M6 7v10M18 7v10M21 10v4M6 12h12"/>',
  honey: '<path d="M7 7h10v13a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1z"/><path d="M6 3h12v4H6z"/><path d="M10 12h4v4h-4z"/>',
  apple: '<path d="M12 7c-2-2-7-1-7 5 0 4 3 9 5 9 1 0 1.5-.5 2-.5s1 .5 2 .5c2 0 5-5 5-9 0-6-5-7-7-5z"/><path d="M12 7c0-2 1-4 3-5"/>',
  package: '<path d="m7.5 4.27 9 5.15"/><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  /* interfeys ikonlari */
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  user: '<path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>',
  cart: '<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  check: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="m9 11 3 3L22 4"/>',
  truck: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18H9"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.62l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>'
};

/* Mahsulot uchun tanlanadigan ikonlar (admin panelda ko'rinadi) */
const ICON_CHOICES = [
  ["smartphone", "Telefon"], ["headphones", "Quloqchin"], ["laptop", "Noutbuk"], ["watch", "Soat"],
  ["vacuum", "Changyutgich"], ["plug", "Elektr jihoz"], ["kettle", "Choynak"], ["blender", "Blender"],
  ["shirt", "Futbolka"], ["dress", "Ko'ylak"], ["jacket", "Kurtka"], ["sneaker", "Krossovka"], ["shoe", "Tufli"],
  ["sofa", "Divan"], ["utensils", "Idish-tovoq"], ["lightbulb", "Chiroq"], ["sparkles", "Go'zallik"],
  ["jar", "Krem"], ["perfume", "Parfyum"], ["blocks", "Konstruktor"], ["teddy", "O'yinchoq"],
  ["ball", "To'p"], ["mat", "Gilam"], ["dumbbell", "Gantel"], ["honey", "Asal"], ["apple", "Meva"], ["package", "Boshqa"]
];

/* ic("cart", 22) -> SVG qatori. fill=true bo'lsa ichi to'ladi (yurak, yulduz). */
function ic(name, size = 24, fill = false) {
  const body = ICONS[name] || ICONS.package;
  const s = typeof size === "number" ? size + "" : size;
  return `<svg class="ic" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${s}" height="${s}" fill="${fill ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
}

/* HTML ichidagi <span data-ic="user" data-size="22"> elementlarini to'ldiradi */
function fillIcons(root = document) {
  root.querySelectorAll("[data-ic]").forEach(el => {
    el.innerHTML = ic(el.dataset.ic, +el.dataset.size || 22);
    el.removeAttribute("data-ic");
  });
}
if (typeof document !== "undefined") fillIcons();
