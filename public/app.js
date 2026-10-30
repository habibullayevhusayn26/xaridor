/* Xaridor — frontend (savat va sevimlilar brauzerda, qolgani serverda). */
const $ = (s, r = document) => r.querySelector(s);
const fmt = n => new Intl.NumberFormat("uz-UZ").format(Math.round(n)).replace(/,/g, " ") + " so'm";
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem("bz_" + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem("bz_" + k, JSON.stringify(v)); } catch {} }
};

async function api(url, opts = {}) {
  const token = store.get("token", null);
  const r = await fetch("/api" + url, {
    method: opts.method || "GET",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: "Bearer " + token } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined
  });
  let data = {};
  try { data = await r.json(); } catch {}
  if (!r.ok) { const e = new Error(data.error || "Xatolik yuz berdi."); e.status = r.status; throw e; }
  return data;
}
function logout() { state.user = null; state.unreadMessages = 0; store.set("user", null); store.set("token", null); updateBadges(); }

const FREE_SHIP = 200000, SHIP = 15000;
const state = {
  cart: store.get("cart", {}), favs: store.get("favs", []),
  user: store.get("user", null), promo: store.get("promo", ""), promoInfo: null,
  unreadMessages: 0, cat: null, q: "", onlyFav: false, min: 0, max: 0, sort: "pop"
};
const byId = id => PRODUCTS.find(p => p.id === id);
const disc = p => Math.round((1 - p.price / p.old) * 100);

/* ---------- toast / overlay ---------- */
let tt;
function toast(msg, duration = 2200, notification = false) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.toggle("notification", notification);
  t.hidden = false;
  clearTimeout(tt); tt = setTimeout(() => (t.hidden = true), duration);
}
function closeAll() {
  $("#cartDrawer").hidden = true; $("#accountDrawer").hidden = true; $("#modal").hidden = true; $("#overlay").hidden = true;
  document.documentElement.classList.remove("overlay-open");
}
function openOverlay() {
  $("#overlay").hidden = false;
  document.documentElement.classList.add("overlay-open");
}

/* ---------- catalog UI ---------- */
function renderStatic() {
  $("#catMenu").innerHTML = CATEGORIES.map(c => `<button data-cat="${c.id}">${ic(c.icon, 20)}${c.name}</button>`).join("");
  $("#chips").innerHTML = `<button class="chip" data-cat="">Hammasi</button>` +
    CATEGORIES.map(c => `<button class="chip" data-cat="${c.id}">${c.name}</button>`).join("");
  $("#catGrid").innerHTML = CATEGORIES.map(c => `<button class="cat-tile" data-cat="${c.id}"><span>${ic(c.icon, 30)}</span>${c.name}</button>`).join("");
}

function filtered() {
  let list = PRODUCTS.filter(p => {
    if (state.cat && p.cat !== state.cat) return false;
    if (state.onlyFav && !state.favs.includes(p.id)) return false;
    if (state.q && !(p.name + " " + p.desc).toLowerCase().includes(state.q.toLowerCase())) return false;
    if (state.min && p.price < state.min) return false;
    if (state.max && p.price > state.max) return false;
    return true;
  });
  const s = {
    pop: (a, b) => b.sold - a.sold, cheap: (a, b) => a.price - b.price, exp: (a, b) => b.price - a.price,
    rate: (a, b) => b.rating - a.rating, disc: (a, b) => disc(b) - disc(a)
  }[state.sort];
  return list.sort(s);
}

function cardHTML(p) {
  const fav = state.favs.includes(p.id);
  return `<article class="card">
    <div class="pic" style="background:${p.color}" data-open="${p.id}">
      <span class="badge">-${disc(p)}%</span>${p.image ? `<img class="product-photo" src="${esc(p.image)}" alt="${esc(p.name)}">` : ic(p.icon, 84)}
      <button class="heart ${fav ? "on" : ""}" data-fav="${p.id}" aria-label="Sevimlilarga qo'shish">${ic("heart", 18, fav)}</button>
    </div>
    <div class="info">
      <div class="name" data-open="${p.id}">${esc(p.name)}</div>
      <div class="meta"><b>${ic("star", 13, true)} ${p.rating}</b> · ${p.sold.toLocaleString("uz-UZ")} ta sotilgan</div>
      <div class="price">${fmt(p.price)}<span class="old">${fmt(p.old)}</span></div>
      <div class="inst">Oyiga ${fmt(p.price / 12)} dan · 12 oy</div>
      <button class="add" data-add="${p.id}" ${p.stock <= 0 ? "disabled" : ""}>${p.stock <= 0 ? "Tugagan" : "Savatga"}</button>
    </div></article>`;
}

function renderGrid() {
  const list = filtered();
  const c = CATEGORIES.find(c => c.id === state.cat);
  $("#title").textContent = state.onlyFav ? "Sevimlilar" : state.q ? `«${state.q}» bo'yicha natijalar` : c ? c.name : "Barcha mahsulotlar";
  $("#grid").innerHTML = list.length ? list.map(cardHTML).join("") :
    `<div class="empty"><b>Hech narsa topilmadi</b>${state.onlyFav ? "Yurakcha belgisini bosib mahsulotni saqlang." : "Filtrlarni o'zgartirib ko'ring."}</div>`;
  document.querySelectorAll("[data-cat]").forEach(b => {
    if (b.classList.contains("chip")) b.classList.toggle("on", (b.dataset.cat || null) === state.cat && !state.onlyFav);
  });
  $("#catGrid").hidden = !!(state.cat || state.q || state.onlyFav);
  $("#hero").hidden = $("#catGrid").hidden;
}

function updateBadges() {
  const n = Object.values(state.cart).reduce((a, b) => a + b, 0);
  const cc = $("#cartCount"), fc = $("#favCount"), mc = $("#messageCount");
  cc.textContent = n; cc.hidden = !n;
  fc.textContent = state.favs.length; fc.hidden = !state.favs.length;
  mc.textContent = state.unreadMessages > 99 ? "99+" : state.unreadMessages;
  mc.hidden = !state.user || !state.unreadMessages;
  $("#messagesBtn").setAttribute("aria-label", state.unreadMessages
    ? `Xabarlar, ${state.unreadMessages} ta o'qilmagan`
    : "Xabarlar");
  $("#accLabel").textContent = state.user ? state.user.name.split(" ")[0] : "Kirish";
}

async function refreshMessages(notify = false) {
  if (!state.user || state.user.mustChangePassword) return;
  try {
    const previousUnread = state.unreadMessages;
    const result = await api("/messages");
    state.unreadMessages = result.unreadCount;
    updateBadges();
    if (notify && result.unreadCount > previousUnread) {
      toast(`Sizda ${result.unreadCount} ta o'qilmagan xabar bor`, 6000, true);
    }
  } catch (err) {
    if (err.status === 401 || err.status === 403) logout();
    else toast("Xabarlarni yuklab bo'lmadi: " + err.message);
  }
}

function persist() {
  store.set("cart", state.cart); store.set("favs", state.favs); store.set("promo", state.promo);
  updateBadges();
}

/* ---------- cart ---------- */
function addToCart(id, q = 1) { const p = byId(id); if (!p || p.stock <= 0) return toast("Mahsulot tugagan"); if ((state.cart[id] || 0) + q > p.stock) return toast("Omborda faqat " + p.stock + " dona bor"); state.cart[id] = (state.cart[id] || 0) + q; persist(); toast("Savatga qo'shildi"); if (!$("#cartDrawer").hidden) renderCart(); }
function setQty(id, q) { if (q <= 0) delete state.cart[id]; else state.cart[id] = Math.min(q, 99, (byId(id) || { stock: 99 }).stock); persist(); renderCart(); }
function toggleFav(id) {
  const i = state.favs.indexOf(id); i >= 0 ? state.favs.splice(i, 1) : state.favs.push(id);
  persist(); renderGrid(); if (!$("#modal").hidden && $("#modalBox .pd")) openProduct(id, true);
}
function totals() {
  const sub = Object.entries(state.cart).reduce((s, [id, q]) => s + (byId(+id) ? byId(+id).price * q : 0), 0);
  const promo = state.promoInfo?.code === state.promo ? state.promoInfo : null;
  const eligible = promo && sub >= (promo.minOrderAmount || 0);
  const d = eligible ? promo.type === "percent" ? Math.round(sub * promo.value / 100) : Math.min(sub, promo.value) : 0;
  const ship = sub && sub - d < FREE_SHIP ? SHIP : 0;
  return { sub, d, ship, total: sub - d + ship };
}
function renderCart() {
  const ids = Object.keys(state.cart).filter(id => byId(+id));
  if (!ids.length) {
    $("#cartBody").innerHTML = `<div class="empty"><b>Savat bo'sh</b>Mahsulotlarni tanlab, savatga qo'shing.</div>`;
    $("#cartFoot").innerHTML = ""; return;
  }
  $("#cartBody").innerHTML = ids.map(id => {
    const p = byId(+id), q = state.cart[id];
    return `<div class="line-item">
      <div class="thumb" style="background:${p.color}">${p.image ? `<img class="product-photo" src="${esc(p.image)}" alt="${esc(p.name)}">` : ic(p.icon, 34)}</div>
      <div><div style="font-size:14px">${esc(p.name)}</div>
        <div class="qty"><button data-dec="${id}" aria-label="Kamaytirish">−</button><span>${q}</span><button data-inc="${id}" aria-label="Ko'paytirish">+</button></div></div>
      <div style="text-align:right"><b>${fmt(p.price * q)}</b><br><button class="rm" data-rm="${id}">O'chirish</button></div></div>`;
  }).join("");
  const t = totals();
  $("#cartFoot").innerHTML = `
    <div class="promo"><input id="promoIn" placeholder="Promokod" value="${esc(state.promo)}"><button class="btn line" id="promoBtn">Qo'llash</button></div>
    ${state.promoInfo?.minOrderAmount && t.sub < state.promoInfo.minOrderAmount
      ? `<small class="meta">Promokod ${fmt(state.promoInfo.minOrderAmount)} yoki undan yuqori xaridga amal qiladi.</small>` : ""}
    <div class="row"><span>Mahsulotlar</span><span>${fmt(t.sub)}</span></div>
    ${t.d ? `<div class="row" style="color:#146c3a"><span>Chegirma</span><span>−${fmt(t.d)}</span></div>` : ""}
    <div class="row"><span>Yetkazish</span><span>${t.ship ? fmt(t.ship) : "Bepul"}</span></div>
    <div class="row total"><span>Jami</span><span>${fmt(t.total)}</span></div>
    <button class="btn sun block" id="checkoutBtn">Buyurtma berish</button>`;
}
function openCart() { renderCart(); $("#cartDrawer").hidden = false; openOverlay(); }

async function applyPromo() {
  const code = $("#promoIn").value.trim().toUpperCase();
  if (!code) {
    state.promo = ""; state.promoInfo = null; persist(); return renderCart();
  }
  try {
    state.promoInfo = await api("/promos/" + encodeURIComponent(code));
    state.promo = state.promoInfo.code; persist(); renderCart();
    toast(state.promoInfo.minOrderAmount && totals().sub < state.promoInfo.minOrderAmount
      ? `Kamida ${fmt(state.promoInfo.minOrderAmount)} xarid qiling` : "Promokod qo'llandi");
  } catch (err) {
    toast(err.message);
  }
}

/* ---------- modals ---------- */
function showModal(html) { $("#accountDrawer").hidden = true; $("#modalBox").innerHTML = `<button class="x" data-close aria-label="Yopish">${ic("x", 20)}</button>` + html; $("#modal").hidden = false; openOverlay(); }

function openProduct(id, keep) {
  const p = byId(id), fav = state.favs.includes(id);
  const rel = PRODUCTS.filter(x => x.cat === p.cat && x.id !== id).slice(0, 3);
  showModal(`<div class="pd">
    <div class="big" style="background:${p.color}">${p.image ? `<img class="product-photo" src="${esc(p.image)}" alt="${esc(p.name)}">` : ic(p.icon, 140)}</div>
    <div class="form">
      <h2>${esc(p.name)}</h2>
      <div class="meta"><b>${ic("star", 13, true)} ${p.rating}</b> · ${p.sold.toLocaleString("uz-UZ")} ta sotilgan</div>
      <div class="price" style="font-size:26px">${fmt(p.price)}<span class="old">${fmt(p.old)}</span></div>
      <div class="inst">Oyiga ${fmt(p.price / 12)} dan · 12 oy</div>
      <p>${esc(p.desc)}</p>
      <button class="btn sun block" data-add="${p.id}" ${p.stock <= 0 ? "disabled" : ""}>${p.stock <= 0 ? "Omborda yo'q" : "Savatga qo'shish"}</button>
      <button class="btn line block" data-fav="${p.id}">${ic("heart", 18, fav)} ${fav ? "Sevimlilardan olib tashlash" : "Sevimlilarga qo'shish"}</button>
    </div></div>
    ${rel.length ? `<h2 style="margin-top:22px">O'xshash mahsulotlar</h2><div class="grid" style="margin:0;grid-template-columns:repeat(auto-fill,minmax(160px,1fr))">${rel.map(cardHTML).join("")}</div>` : ""}`);
}

function openCheckout() {
  if (!Object.keys(state.cart).length) return;
  if (!state.user) { $("#cartDrawer").hidden = true; openAccount(); toast("Buyurtma berish uchun avval kiring"); return; }
  const t = totals(), u = state.user;
  $("#cartDrawer").hidden = true;
  showModal(`<h2>Buyurtmani rasmiylashtirish</h2>
    <form class="form" id="coForm">
      <label>Ism-familiya<input name="name" required value="${esc(u.name || "")}"></label>
      <label>Telefon<input name="phone" required placeholder="+998 90 123 45 67" value="${esc(u.phone || "")}"></label>
      <label>Shahar<select name="city"><option>Toshkent</option><option>Samarqand</option><option>Buxoro</option><option>Andijon</option><option>Namangan</option><option>Farg'ona</option><option>Nukus</option></select></label>
      <label>Manzil<textarea name="addr" required rows="2" placeholder="Ko'cha, uy, xonadon"></textarea></label>
      <label>To'lov usuli<select name="pay"><option value="Naqd">Yetkazilganda naqd</option><option value="Karta">Karta orqali (Uzcard / Humo)</option><option value="Muddatli">Muddatli to'lov (12 oy)</option></select></label>
      <div class="row total"><span>Jami</span><span>${fmt(t.total)}</span></div>
      <div class="err" id="coErr"></div>
      <button class="btn sun block" type="submit">Buyurtmani tasdiqlash</button>
    </form>`);
  $("#coForm").addEventListener("submit", async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true;
    try {
      const order = await api("/orders", { method: "POST", body: {
        ...f, promo: state.promo, items: Object.entries(state.cart).map(([id, q]) => ({ id: +id, q })) } });
      state.cart = {}; state.promo = ""; persist(); loadProducts();
      showModal(`<div class="empty" style="grid-column:auto"><div class="done">${ic("check", 72)}</div><b>Buyurtma qabul qilindi!</b>
        Buyurtma raqami: <b style="display:inline">${order.id}</b><br>Operator tez orada ${esc(order.phone)} raqamiga qo'ng'iroq qiladi.
        <br><br><button class="btn dark" id="seeOrders">Buyurtmalarim</button></div>`);
    } catch (err) {
      if (err.status === 401) { logout(); closeAll(); openAccount(); }
      $("#coErr") && ($("#coErr").textContent = err.message); btn.disabled = false;
    }
  });
}

async function openOrders() {
  if (!state.user) return openAccount();
  showModal(`<h2>Buyurtmalarim</h2><p class="meta">Yuklanmoqda...</p>`);
  let list = [];
  try { list = await api("/orders/my"); } catch (err) { if (err.status === 401) { logout(); closeAll(); return openAccount(); } }
  $("#modalBox").innerHTML = `<button class="x" data-close aria-label="Yopish">${ic("x", 20)}</button><h2>Buyurtmalarim</h2>` + (list.length ? list.map(o => `
    <div class="order"><div class="row"><b>№ ${o.id}</b><span class="status">${esc(o.status)}</span></div>
    <div class="meta">${new Date(o.created).toLocaleString("uz-UZ")} · ${esc(o.city)}, ${esc(o.addr)} · ${esc(o.pay)}</div>
    <div style="margin:8px 0">${o.items.map(i => `<div class="it">${ic(i.icon, 18)}<span>${esc(i.name)} × ${i.q}</span></div>`).join("")}</div>
    <div class="row total"><span>Jami</span><span>${fmt(o.total)}</span></div></div>`).join("")
    : `<div class="empty"><b>Buyurtmalar yo'q</b>Birinchi buyurtmangizni bering — XARID10 promokodi bilan 10% chegirma.</div>`);
}

async function openMessages() {
  if (!state.user) return openAccount();
  showModal(`<h2>Xabarlar</h2><p class="meta">Yuklanmoqda...</p>`);
  try {
    const result = await api("/messages");
    $("#modalBox").innerHTML = `<button class="x" data-close aria-label="Yopish">${ic("x", 20)}</button><h2>Xabarlar</h2>` +
      (result.messages.length ? result.messages.map(message => `
        <article class="order ${message.read ? "" : "message-unread"}">
          <div class="row"><b>${esc(message.title)}</b><small class="meta">${new Date(message.created).toLocaleString("uz-UZ")}</small></div>
          <p>${esc(message.body)}</p>
        </article>`).join("") : `<div class="empty"><b>Xabarlar yo'q</b>Saytdan kelgan xabarlar shu yerda ko'rinadi.</div>`);
    if (result.messages.some(message => !message.read)) {
      const readResult = await api("/messages/read", {
        method: "POST", body: { ids: result.messages.filter(message => !message.read).map(message => message.id) }
      });
      state.unreadMessages = readResult.unreadCount;
      updateBadges();
    }
  } catch (err) {
    $("#modalBox").innerHTML = `<button class="x" data-close aria-label="Yopish">${ic("x", 20)}</button><h2>Xabarlar</h2><p class="err">${esc(err.message)}</p>`;
  }
}

function requirePasswordChange() {
  $("#accountDrawer").hidden = true;
  $("#modalBox").innerHTML = `<h2>Yangi parol o'rnating</h2>
    <p class="meta" style="margin-bottom:14px">Admin bergan vaqtinchalik parol bir martalik. Davom etish uchun yangi parol o'rnating.</p>
    <form class="form" id="requiredPasswordForm">
      <label>Yangi parol<input name="pass" type="password" minlength="8" maxlength="100" required></label>
      <label>Yangi parolni takrorlang<input name="confirm" type="password" minlength="8" maxlength="100" required></label>
      <div class="err" id="requiredPasswordError"></div>
      <button class="btn sun block" type="submit">Parolni yangilash</button>
    </form>`;
  $("#modal").hidden = false;
  openOverlay();
  $("#requiredPasswordForm").onsubmit = async e => {
    e.preventDefault();
    const form = new FormData(e.target);
    const pass = form.get("pass");
    const button = e.target.querySelector('button[type="submit"]');
    if (pass !== form.get("confirm")) {
      $("#requiredPasswordError").textContent = "Parollar bir xil emas.";
      return;
    }
    button.disabled = true;
    try {
      const result = await api("/auth/change-password", { method: "POST", body: { pass } });
      state.user = result.user;
      store.set("user", result.user);
      store.set("token", result.token);
      updateBadges();
      closeAll();
      toast("Parol yangilandi.");
      refreshMessages(true);
    } catch (err) {
      $("#requiredPasswordError").textContent = err.message;
      button.disabled = false;
    }
  };
}

function openAccount(mode = "login") {
  $("#cartDrawer").hidden = true;
  $("#modal").hidden = true;
  $("#accountDrawer").hidden = false;
  openOverlay();
  if (state.user) {
    $("#accountBody").innerHTML = `<h2>${esc(state.user.name)}</h2><p class="meta" style="margin-bottom:16px">ID: ${esc(state.user.id || "—")}<br>${esc(state.user.phone)}</p>
      <div class="form"><button class="btn dark block" id="myOrders">Buyurtmalarim</button>${state.user.role === "admin" ? `<a class="btn sun block" style="text-align:center;text-decoration:none" href="/admin.html">Admin panel</a>` : ""}<button class="btn line block" id="logout">Chiqish</button></div>`;
    return;
  }
  const reg = mode === "reg";
  $("#accountBody").innerHTML = `<div class="tabs"><button data-auth="login" class="${reg ? "" : "on"}">Kirish</button><button data-auth="reg" class="${reg ? "on" : ""}">Ro'yxatdan o'tish</button></div>
    <form class="form" id="authForm">
      ${reg ? `<label>Ism-familiya<input name="name" required></label>` : ""}
      <label>Telefon<input name="phone" required placeholder="+998 90 123 45 67"></label>
      <label>Parol<input name="pass" type="password" required minlength="6"></label>
      ${reg ? "" : `<a class="btn line block" href="https://t.me/habibullayev_28" target="_blank" rel="noopener noreferrer">Parolni tiklash uchun supportga yozish</a>`}
      <div class="err" id="authErr"></div>
      <button class="btn sun block" type="submit">${reg ? "Ro'yxatdan o'tish" : "Kirish"}</button>
    </form>`;
  $("#authForm").addEventListener("submit", async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const btn = e.target.querySelector("button[type=submit]"); btn.disabled = true;
    try {
      const r = await api(reg ? "/auth/register" : "/auth/login", { method: "POST", body: f });
      state.user = r.user; store.set("user", r.user); store.set("token", r.token);
      if (r.user.mustChangePassword) {
        updateBadges();
        return requirePasswordChange();
      }
      updateBadges(); closeAll(); toast("Xush kelibsiz, " + r.user.name.split(" ")[0] + "!");
      refreshMessages(true);
    } catch (err) { $("#authErr").textContent = err.message; btn.disabled = false; }
  });
}

/* ---------- hero slider ---------- */
let SLIDES = [
  { title: "Yangi kolleksiya — 40% gacha chegirma", description: "Kiyim va poyabzal hafta davomida arzonroq.", icon: "shirt", bg: "linear-gradient(120deg,#0E5A5A,#17807A)", category: "kiyim" },
  { title: "Texnika bayrami", description: "Smartfon, noutbuk va quloqchinlar 12 oyga bo'lib to'lash bilan.", icon: "smartphone", bg: "linear-gradient(120deg,#25306B,#3E4FA8)", category: "elektronika" },
  { title: "Uyingiz uchun hammasi", description: "Idish-tovoq, yorug'lik va ro'zg'or buyumlari.", icon: "sofa", bg: "linear-gradient(120deg,#9A4A12,#D9812B)", category: "uy" }
];
let si = 0, st;
function renderHero() {
  $("#hero").innerHTML = SLIDES.map((s, i) => `<div class="slide ${i ? "" : "on"}" style="background:${esc(s.bg || "linear-gradient(120deg,#0E5A5A,#17807A)")}">
    ${s.image ? `<img class="hero-image" src="${esc(s.image)}" alt="">` : ""}
    <div class="slide-copy"><h2>${esc(s.title)}</h2><p>${esc(s.description)}</p>${s.category ? `<button class="btn sun" data-cat="${esc(s.category)}">Ko'rish</button>` : ""}</div>
    ${s.image ? "" : `<div class="big">${ic(s.icon || "sparkles", 160)}</div>`}</div>`).join("") +
    (SLIDES.length > 1 ? `<div class="dots">${SLIDES.map((_, i) => `<button data-slide="${i}" class="${i ? "" : "on"}" aria-label="${i + 1}-slayd"></button>`).join("")}</div>` : "");
  startSlider();
}
function goSlide(i) {
  if (!SLIDES.length) return;
  si = (i + SLIDES.length) % SLIDES.length;
  document.querySelectorAll(".slide").forEach((s, k) => s.classList.toggle("on", k === si));
  document.querySelectorAll(".dots button").forEach((s, k) => s.classList.toggle("on", k === si));
}
function startSlider() { clearInterval(st); if (SLIDES.length > 1 && !matchMedia("(prefers-reduced-motion:reduce)").matches) st = setInterval(() => goSlide(si + 1), 5000); }

/* ---------- navigation / search ---------- */
function setCat(c) { state.cat = c || null; state.q = ""; state.onlyFav = false; $("#q").value = ""; $("#catMenu").hidden = true; closeAll(); renderGrid(); scrollTo({ top: 0, behavior: "smooth" }); }
function doSearch(q) { state.q = q.trim(); state.cat = null; state.onlyFav = false; $("#suggest").hidden = true; renderGrid(); }

/* ---------- events ---------- */
document.addEventListener("click", e => {
  const t = e.target, g = a => t.closest(`[${a}]`);
  let el;
  if ((el = g("data-fav"))) { e.stopPropagation(); return toggleFav(+el.dataset.fav); }
  if ((el = g("data-add"))) return addToCart(+el.dataset.add);
  if ((el = g("data-open"))) return openProduct(+el.dataset.open);
  if ((el = g("data-cat"))) return setCat(el.dataset.cat);
  if ((el = g("data-inc"))) return setQty(+el.dataset.inc, state.cart[el.dataset.inc] + 1);
  if ((el = g("data-dec"))) return setQty(+el.dataset.dec, state.cart[el.dataset.dec] - 1);
  if ((el = g("data-rm"))) return setQty(+el.dataset.rm, 0);
  if ((el = g("data-slide"))) { goSlide(+el.dataset.slide); return startSlider(); }
  if ((el = g("data-auth"))) return openAccount(el.dataset.auth);
  if (g("data-close") || t.id === "overlay" || t.id === "modal") return closeAll();
  if (t.id === "promoBtn") return applyPromo();
  if (t.id === "checkoutBtn") return openCheckout();
  if (t.id === "seeOrders" || t.id === "myOrders") return openOrders();
  if (t.id === "messagesBtn") return openMessages();
  if (t.id === "logout") {
    $("#accountBody").innerHTML = `<p style="margin-bottom:14px">Hisobdan chiqishni tasdiqlaysizmi?</p>
      <div class="form"><button class="btn sun block" id="confirmLogout">Ha</button><button class="btn line block" id="cancelLogout">Yo'q</button></div>`;
    return;
  }
  if (t.id === "confirmLogout") { logout(); closeAll(); return toast("Chiqildi"); }
  if (t.id === "cancelLogout") return openAccount();
  if (!t.closest(".cat-wrap")) $("#catMenu").hidden = true;
  if (!t.closest(".search")) $("#suggest").hidden = true;
});
$("#catBtn").onclick = e => { e.stopPropagation(); $("#catMenu").hidden = !$("#catMenu").hidden; };
$("#brand").onclick = e => { e.preventDefault(); setCat(null); };
$("#cartBtn").onclick = openCart;
$("#accBtn").onclick = () => openAccount();
$("#messagesBtn").onclick = openMessages;
$("#favBtn").onclick = () => { state.onlyFav = true; state.cat = null; state.q = ""; renderGrid(); scrollTo({ top: 0, behavior: "smooth" }); };
$("#qBtn").onclick = () => doSearch($("#q").value);
$("#q").addEventListener("keydown", e => { if (e.key === "Enter") doSearch(e.target.value); });
$("#q").addEventListener("input", e => {
  const v = e.target.value.trim().toLowerCase(), s = $("#suggest");
  if (!v) { s.hidden = true; return; }
  const m = PRODUCTS.filter(p => p.name.toLowerCase().includes(v)).slice(0, 6);
  s.innerHTML = m.length ? m.map(p => `<button data-open="${p.id}">${ic(p.icon, 20)}${esc(p.name)}</button>`).join("") : `<div style="padding:12px 14px;color:#5E6B75">Hech narsa topilmadi</div>`;
  s.hidden = false;
});
$("#sort").onchange = e => { state.sort = e.target.value; renderGrid(); };
$("#pmin").oninput = e => { state.min = +e.target.value || 0; renderGrid(); };
$("#pmax").oninput = e => { state.max = +e.target.value || 0; renderGrid(); };
document.addEventListener("keydown", e => { if (e.key === "Escape") closeAll(); });

async function loadProducts() {
  try {
    PRODUCTS = await api("/products");
    for (const id of Object.keys(state.cart)) if (!byId(+id)) delete state.cart[id];
    persist();
  } catch { toast("Server bilan aloqa yo'q"); }
  renderGrid();
}
async function boot() {
  renderStatic(); updateBadges();
  try {
    const slides = await api("/slides");
    SLIDES = slides;
  } catch { toast("Slaydlarni yuklab bo'lmadi"); }
  renderHero();
  if (state.promo) {
    try { state.promoInfo = await api("/promos/" + encodeURIComponent(state.promo)); }
    catch { state.promo = ""; state.promoInfo = null; persist(); toast("Saqlangan promokod endi amal qilmaydi"); }
  }
  if (store.get("token", null)) {
    try {
      state.user = await api("/me");
      store.set("user", state.user);
      if (state.user.mustChangePassword) requirePasswordChange();
      else await refreshMessages(true);
    } catch (e) { if (e.status === 401 || e.status === 403) logout(); }
    updateBadges();
  }
  await loadProducts();
  setInterval(() => refreshMessages(true), 60000);
}
boot();
