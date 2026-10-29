"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const rateLimit = require("express-rate-limit");

// ---- .env (lokal ishga tushirish uchun; hostingda Environment ishlatiladi) ----
try {
  for (const line of fs.readFileSync(path.join(__dirname, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
} catch {}

// ---- Majburiy sozlamalar: bo'lmasa server ishga tushmaydi ----
const env = n => (process.env[n] || "").trim();
const missing = ["MONGODB_URI", "JWT_SECRET", "TG_BOT_TOKEN", "TG_CHAT_ID"].filter(n => !env(n));
if (missing.length) {
  console.error("\n[XATO] Quyidagi sozlamalar kiritilmagan: " + missing.join(", "));
  console.error("Ularni .env faylga (yoki hosting Environment bo'limiga) yozing. Namuna: .env.example");
  console.error("Telegram bot tokeni va chat ID majburiy: har bir buyurtma botga yuboriladi.\n");
  process.exit(1);
}
if (env("JWT_SECRET").length < 16) {
  console.error("[XATO] JWT_SECRET kamida 16 belgi bo'lsin (uzun tasodifiy qator).");
  process.exit(1);
}
const SECRET = env("JWT_SECRET");
const TG_TOKEN = env("TG_BOT_TOKEN");
const TG_CHAT = env("TG_CHAT_ID");
const PORT = env("PORT") || 3000;

// ---- Telegram ----
async function tgCall(method, payload) {
  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}), signal: AbortSignal.timeout(10000)
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.ok) {
    const e = new Error(d.description || "HTTP " + r.status);
    e.tgStatus = r.status;
    throw e;
  }
  return d;
}

// ---- Sozlamalar ----
const PROMO = { XARID10: 0.1, YANGI5: 0.05 };
const FREE_SHIP = 200000, SHIP = 15000;
const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;
const STATUSES = ["Qabul qilindi", "Yig'ilmoqda", "Yo'lda", "Yetkazildi", "Bekor qilindi"];
const PAYS = ["Naqd", "Karta", "Muddatli"];
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, "seed.json"), "utf8"));
const CATEGORIES = seed.categories;

const normPhone = s => {
  const d = String(s || "").replace(/[^\d+]/g, "");
  return /^\+?998\d{9}$/.test(d) ? "+" + d.replace("+", "") : null;
};
const fmtSum = n => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " so'm";
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

let db, users, products, orders, counters;

async function nextProductId() {
  const r = await counters.findOneAndUpdate({ _id: "products" }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: "after" });
  return r.seq;
}

// ---- Buyurtmani Telegramga yuborish (muvaffaqiyatsiz bo'lsa qayta uriniladi) ----
const sending = new Set();
async function sendOrderToTelegram(o) {
  if (sending.has(o._id)) return;
  sending.add(o._id);
  try {
    const lines = o.items.map(i => `• ${i.name} × ${i.q} = ${fmtSum(i.price * i.q)}`).join("\n");
    const text = `Yangi buyurtma ${o._id}\n\n${o.name}\n${o.phone}\n${o.city}, ${o.addr}\nTo'lov: ${o.pay}${o.promo ? "\nPromokod: " + o.promo : ""}\n\n${lines}\n\nJami: ${fmtSum(o.total)}`;
    await tgCall("sendMessage", { chat_id: TG_CHAT, text });
    await orders.updateOne({ _id: o._id }, { $set: { tgSent: true } });
  } finally {
    sending.delete(o._id);
  }
}
async function flushTelegram() {
  try {
    const list = await orders.find({ tgSent: false }).sort({ created: 1 }).limit(20).toArray();
    for (const o of list) await sendOrderToTelegram(o);
  } catch (e) {
    console.warn("Telegramga yuborib bo'lmadi (keyin qayta uriniladi):", e.message);
  }
}

// ---- Yordamchilar ----
const sign = u => jwt.sign({ id: String(u._id), role: u.role }, SECRET, { expiresIn: "30d" });
const publicUser = u => ({ id: String(u._id), name: u.name, phone: u.phone, role: u.role });
const productOut = p => ({ id: p._id, name: p.name, cat: p.cat, price: p.price, old: p.old, rating: p.rating,
  sold: p.sold, icon: p.icon, color: p.color, image: p.image ? `/api/products/${p._id}/image` : null,
  desc: p.descr, stock: p.stock, active: !!p.active });
const orderOut = o => ({ id: o._id, name: o.name, phone: o.phone, city: o.city, addr: o.addr, pay: o.pay,
  total: o.total, promo: o.promo, status: o.status, items: o.items, created: o.created.toISOString(), tgSent: !!o.tgSent });

function readProductImage(value) {
  if (typeof value !== "string") throw new Error("Mahsulot rasmi noto'g'ri.");
  const match = value.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) throw new Error("JPG, PNG yoki WebP rasm tanlang.");
  const data = Buffer.from(match[2], "base64");
  if (!data.length || data.length > MAX_PRODUCT_IMAGE_BYTES || data.toString("base64") !== match[2])
    throw new Error("Rasm hajmi 5 MB dan oshmasligi kerak.");
  const validSignature = match[1] === "image/jpeg"
    ? data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
    : match[1] === "image/png"
      ? data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      : data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP";
  if (!validSignature) throw new Error("Rasm faylining formati noto'g'ri.");
  return { contentType: match[1], data: match[2] };
}

function auth(required = true) {
  return ah(async (req, res, next) => {
    const h = req.headers.authorization || "";
    if (h.startsWith("Bearer ")) {
      try {
        const t = jwt.verify(h.slice(7), SECRET);
        const u = await users.findOne({ _id: new ObjectId(t.id) });
        if (u) req.user = u;
      } catch {}
    }
    if (required && !req.user) return res.status(401).json({ error: "Avval tizimga kiring." });
    next();
  });
}
const adminOnly = (req, res, next) =>
  req.user && req.user.role === "admin" ? next() : res.status(403).json({ error: "Ruxsat yo'q." });

// ---- Express ----
const app = express();
app.disable("x-powered-by");
app.set("trust proxy", 1); // Render/Railway orqasida haqiqiy IP ni ko'rish uchun
app.use(express.json({ limit: "7mb" }));
app.use((req, res, next) => {
  res.set({ "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY", "Referrer-Policy": "same-origin" });
  next();
});
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: "Juda ko'p urinish. 15 daqiqadan keyin qayta urinib ko'ring." } });
const orderLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: "Juda ko'p buyurtma. Keyinroq urinib ko'ring." } });

// ---- Ochiq API ----
app.get("/api/health", (req, res) => res.json({ ok: true }));
app.get("/api/categories", (req, res) => res.json(CATEGORIES));
app.get("/api/products", ah(async (req, res) =>
  res.json((await products.find({ active: true }).sort({ sold: -1 }).toArray()).map(productOut))));
app.get("/api/products/:id/image", ah(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id)) return res.status(404).end();
  const p = await products.findOne({ _id: id }, { projection: { image: 1 } });
  if (!p || !p.image) return res.status(404).end();
  res.set({ "Content-Type": p.image.contentType, "Cache-Control": "no-cache" });
  res.send(Buffer.from(p.image.data, "base64"));
}));

app.post("/api/auth/register", authLimiter, ah(async (req, res) => {
  const name = String(req.body.name || "").trim().slice(0, 80);
  const phone = normPhone(req.body.phone);
  const pass = String(req.body.pass || "");
  if (name.length < 2) return res.status(400).json({ error: "Ismni kiriting." });
  if (!phone) return res.status(400).json({ error: "Telefon raqami noto'g'ri." });
  if (pass.length < 6 || pass.length > 100) return res.status(400).json({ error: "Parol kamida 6 belgi bo'lsin." });
  const doc = { name, phone, passHash: await bcrypt.hash(pass, 10), role: "user", created: new Date() };
  try { await users.insertOne(doc); }
  catch (e) { if (e.code === 11000) return res.status(409).json({ error: "Bu raqam ro'yxatdan o'tgan." }); throw e; }
  res.json({ token: sign(doc), user: publicUser(doc) });
}));

app.post("/api/auth/login", authLimiter, ah(async (req, res) => {
  const phone = normPhone(req.body.phone);
  const u = phone && await users.findOne({ phone });
  if (!u || !(await bcrypt.compare(String(req.body.pass || ""), u.passHash)))
    return res.status(401).json({ error: "Telefon yoki parol noto'g'ri." });
  res.json({ token: sign(u), user: publicUser(u) });
}));

app.get("/api/me", auth(), (req, res) => res.json(publicUser(req.user)));

// ---- Buyurtmalar ----
app.post("/api/orders", orderLimiter, auth(), ah(async (req, res) => {
  const b = req.body || {};
  const name = String(b.name || "").trim().slice(0, 80);
  const phone = normPhone(b.phone);
  const city = String(b.city || "").trim().slice(0, 40);
  const addr = String(b.addr || "").trim().slice(0, 300);
  const pay = PAYS.includes(b.pay) ? b.pay : null;
  if (name.length < 2 || !city || addr.length < 3 || !pay) return res.status(400).json({ error: "Barcha maydonlarni to'ldiring." });
  if (!phone) return res.status(400).json({ error: "Telefon raqami noto'g'ri." });
  if (!Array.isArray(b.items) || !b.items.length || b.items.length > 50) return res.status(400).json({ error: "Savat bo'sh." });

  const qty = new Map();
  for (const it of b.items) {
    const id = Number(it.id), q = Number(it.q);
    if (!Number.isInteger(id) || !Number.isInteger(q) || q < 1 || q > 99) return res.status(400).json({ error: "Savat ma'lumoti noto'g'ri." });
    qty.set(id, (qty.get(id) || 0) + q);
  }
  const ids = [...qty.keys()];
  const found = await products.find({ _id: { $in: ids }, active: true }).toArray();
  if (found.length !== ids.length) return res.status(400).json({ error: "Mahsulot topilmadi yoki sotuvdan olingan." });

  // Omborni kamaytirish (har biri alohida, shartli); xato bo'lsa qaytariladi
  const done = [];
  const rollback = () => Promise.all(done.map(([id, q]) => products.updateOne({ _id: id }, { $inc: { stock: q, sold: -q } })));
  for (const p of found) {
    const q = qty.get(p._id);
    const r = await products.updateOne({ _id: p._id, active: true, stock: { $gte: q } }, { $inc: { stock: -q, sold: q } });
    if (!r.modifiedCount) {
      await rollback();
      return res.status(400).json({ error: `«${p.name}» omborda yetarli emas.` });
    }
    done.push([p._id, q]);
  }

  const promo = String(b.promo || "").toUpperCase();
  const rate = PROMO[promo] || 0;
  const items = found.map(p => ({ id: p._id, name: p.name, icon: p.icon, q: qty.get(p._id), price: p.price }));
  const sub = items.reduce((s, i) => s + i.price * i.q, 0);
  const discount = Math.round(sub * rate);
  const total = sub - discount + (sub - discount < FREE_SHIP ? SHIP : 0);

  let order;
  try {
    for (let k = 0; k < 5 && !order; k++) {
      const doc = { _id: "XR" + crypto.randomInt(1000000, 9999999), userId: req.user._id, name, phone, city, addr, pay,
        total, promo: rate ? promo : null, status: STATUSES[0], items, created: new Date(), tgSent: false };
      try { await orders.insertOne(doc); order = doc; }
      catch (e) { if (e.code !== 11000) throw e; }
    }
    if (!order) throw new Error("Buyurtma raqamini yaratib bo'lmadi.");
  } catch (e) {
    await rollback();
    throw e;
  }
  sendOrderToTelegram(order).catch(e => console.warn("Telegram (qayta uriniladi):", e.message));
  res.json(orderOut(order));
}));

app.get("/api/orders/my", auth(), ah(async (req, res) =>
  res.json((await orders.find({ userId: req.user._id }).sort({ created: -1 }).toArray()).map(orderOut))));

// ---- Admin ----
const admin = express.Router();
admin.use(auth(), adminOnly);

admin.get("/stats", ah(async (req, res) => {
  const tz = 5 * 3600e3; // Toshkent UTC+5
  const dayStart = new Date(Math.floor((Date.now() + tz) / 864e5) * 864e5 - tz);
  const sum = async match => (await orders.aggregate([{ $match: match }, { $group: { _id: null, s: { $sum: "$total" } } }]).toArray())[0]?.s || 0;
  res.json({
    orders: await orders.countDocuments(),
    newOrders: await orders.countDocuments({ status: STATUSES[0] }),
    revenue: await sum({ status: { $ne: "Bekor qilindi" } }),
    today: await sum({ status: { $ne: "Bekor qilindi" }, created: { $gte: dayStart } }),
    users: await users.countDocuments({ role: "user" }),
    products: await products.countDocuments(),
    telegramPending: await orders.countDocuments({ tgSent: false }),
    lowStock: (await products.find({ active: true, stock: { $lte: 5 } }).sort({ stock: 1 }).limit(10).toArray())
      .map(p => ({ id: p._id, name: p.name, stock: p.stock }))
  });
}));

admin.post("/telegram-test", ah(async (req, res) => {
  try { await tgCall("sendMessage", { chat_id: TG_CHAT, text: "Xaridor: Telegram ulanishi ishlayapti." }); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
}));

admin.get("/orders", ah(async (req, res) =>
  res.json((await orders.find().sort({ created: -1 }).limit(500).toArray()).map(orderOut))));

admin.patch("/orders/:id", ah(async (req, res) => {
  const status = req.body.status;
  if (!STATUSES.includes(status)) return res.status(400).json({ error: "Noto'g'ri holat." });
  const o = await orders.findOne({ _id: req.params.id });
  if (!o) return res.status(404).json({ error: "Buyurtma topilmadi." });
  if (o.status === "Bekor qilindi" && status !== o.status) return res.status(400).json({ error: "Bekor qilingan buyurtmani qayta ochib bo'lmaydi." });
  if (status === "Bekor qilindi" && o.status !== status)
    for (const i of o.items) await products.updateOne({ _id: i.id }, { $inc: { stock: i.q, sold: -i.q } });
  await orders.updateOne({ _id: o._id }, { $set: { status } });
  res.json(orderOut(await orders.findOne({ _id: o._id })));
}));

admin.get("/products", ah(async (req, res) =>
  res.json((await products.find().sort({ _id: -1 }).toArray()).map(productOut))));

function readProduct(b) {
  const p = {
    name: String(b.name || "").trim().slice(0, 120), cat: String(b.cat || ""),
    price: Math.round(Number(b.price)), old: Math.round(Number(b.old) || Number(b.price)),
    icon: /^[a-z-]{2,24}$/.test(b.icon) ? b.icon : "package",
    color: /^#[0-9a-fA-F]{6}$/.test(b.color) ? b.color : "#E6EEF0",
    descr: String(b.desc || "").slice(0, 1000), stock: Math.max(0, Math.round(Number(b.stock) || 0)),
    active: !(b.active === false || b.active === 0)
  };
  if (p.name.length < 2) throw new Error("Mahsulot nomini kiriting.");
  if (!CATEGORIES.some(c => c.id === p.cat)) throw new Error("Kategoriyani tanlang.");
  if (!(p.price > 0)) throw new Error("Narx noto'g'ri.");
  if (p.old < p.price) p.old = p.price;
  return p;
}
admin.post("/products", ah(async (req, res) => {
  let p, image;
  try {
    p = readProduct(req.body);
    if (req.body.image) image = readProductImage(req.body.image);
  } catch (e) { return res.status(400).json({ error: e.message }); }
  const doc = { _id: await nextProductId(), ...p, ...(image ? { image } : {}), rating: 4.5, sold: 0, created: new Date() };
  await products.insertOne(doc);
  res.json(productOut(doc));
}));
admin.put("/products/:id", ah(async (req, res) => {
  let p, image;
  try {
    p = readProduct(req.body);
    if (req.body.image) image = readProductImage(req.body.image);
  } catch (e) { return res.status(400).json({ error: e.message }); }
  const removeImage = req.body.removeImage === true || req.body.removeImage === "true" || req.body.removeImage === "on";
  const update = { $set: { ...p }, ...(image ? {} : removeImage ? { $unset: { image: "" } } : {}) };
  if (image) update.$set.image = image;
  const r = await products.findOneAndUpdate({ _id: Number(req.params.id) }, update, { returnDocument: "after" });
  if (!r) return res.status(404).json({ error: "Mahsulot topilmadi." });
  res.json(productOut(r));
}));
admin.delete("/products/:id", ah(async (req, res) => {
  await products.deleteOne({ _id: Number(req.params.id) });
  res.json({ ok: true });
}));
app.use("/api/admin", admin);

app.use("/api", (req, res) => res.status(404).json({ error: "Topilmadi." }));
app.use(express.static(path.join(__dirname, "public")));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "Server xatosi." });
});

// ---- Ishga tushirish ----
async function main() {
  // 1) Telegram tokenini tekshirish
  try {
    const me = await tgCall("getMe");
    console.log("Telegram bot ulandi: @" + me.result.username);
  } catch (e) {
    if (e.tgStatus === 401 || e.tgStatus === 404) {
      console.error("[XATO] TG_BOT_TOKEN noto'g'ri. @BotFather dan olingan tokenni tekshiring.");
      process.exit(1);
    }
    console.warn("[!] Telegram bilan hozircha bog'lanib bo'lmadi:", e.message);
  }

  // 2) MongoDB
  const client = new MongoClient(env("MONGODB_URI"), { serverSelectionTimeoutMS: 15000 });
  try { await client.connect(); }
  catch (e) {
    console.error("[XATO] MongoDB ga ulanib bo'lmadi:", e.message);
    console.error("MONGODB_URI va Atlas dagi Network Access (0.0.0.0/0) ni tekshiring.");
    process.exit(1);
  }
  db = client.db(env("MONGODB_DB") || "xaridor");
  users = db.collection("users"); products = db.collection("products");
  orders = db.collection("orders"); counters = db.collection("counters");
  await users.createIndex({ phone: 1 }, { unique: true });
  await orders.createIndex({ userId: 1, created: -1 });
  await orders.createIndex({ tgSent: 1, created: 1 });
  await products.createIndex({ active: 1, sold: -1 });

  // 3) Namuna mahsulotlar (faqat baza bo'sh bo'lsa)
  if (await products.countDocuments() === 0) {
    await products.insertMany(seed.products.map(p => ({ _id: p.id, name: p.name, cat: p.cat, price: p.price, old: p.old,
      rating: p.rating, sold: p.sold, icon: p.icon, color: p.color, descr: p.desc, stock: 50, active: true, created: new Date() })));
    await counters.updateOne({ _id: "products" }, { $set: { seq: Math.max(...seed.products.map(p => p.id)) } }, { upsert: true });
    console.log("Namuna mahsulotlar qo'shildi.");
  }

  // 4) Admin
  if (!(await users.findOne({ role: "admin" }))) {
    const ph = normPhone(env("ADMIN_PHONE")), pw = env("ADMIN_PASSWORD");
    if (!ph || pw.length < 8) {
      console.error("[XATO] Admin yo'q. .env ga ADMIN_PHONE (+998XXXXXXXXX) va ADMIN_PASSWORD (kamida 8 belgi) yozing.");
      process.exit(1);
    }
    await users.updateOne({ phone: ph }, { $set: { role: "admin", name: env("ADMIN_NAME") || "Admin", passHash: await bcrypt.hash(pw, 10) },
      $setOnInsert: { created: new Date() } }, { upsert: true });
    console.log("Admin yaratildi:", ph);
  }

  // 5) Yuborilmay qolgan buyurtmalarni Telegramga qayta yuborish
  flushTelegram();
  setInterval(flushTelegram, 60 * 1000).unref();

  app.listen(PORT, () => console.log(`Xaridor ishlayapti: http://localhost:${PORT}  (admin: /admin.html)`));
}
main().catch(e => { console.error(e); process.exit(1); });
