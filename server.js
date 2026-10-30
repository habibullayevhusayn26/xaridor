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
const TG_ADMIN_ID = env("TG_ADMIN_ID") || TG_CHAT;
const PORT = env("PORT") || 3000;
const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const USER_CODE_LETTERS = USER_CODE_ALPHABET.slice(0, -8);
const USER_CODE_DIGITS = USER_CODE_ALPHABET.slice(-8);
const USER_CODE_PATTERN = /^(?=.*[A-Z])(?=.*[0-9])[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{7}$/;
const TELEGRAM_USER_BUTTON = "🔎 Foydalanuvchini qidirish";
const TELEGRAM_ORDER_BUTTON = "📦 Buyurtmani qidirish";
const TELEGRAM_PROMOS_BUTTON = "🎟 Promokodlar";
const TELEGRAM_ADD_PROMO_BUTTON = "➕ Promokod qo'shish";

// ---- Telegram ----
async function tgCall(method, payload, timeout = 10000) {
  const r = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}), signal: AbortSignal.timeout(timeout)
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
const FREE_SHIP = 200000, SHIP = 15000;
const MAX_PRODUCT_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_SLIDE_IMAGE_BYTES = 5 * 1024 * 1024;
const STATUSES = ["Qabul qilindi", "Yig'ilmoqda", "Yo'lda", "Yetkazildi", "Bekor qilindi"];
const PAYS = ["Naqd", "Karta", "Muddatli"];
const seed = JSON.parse(fs.readFileSync(path.join(__dirname, "seed.json"), "utf8"));
const CATEGORIES = seed.categories;
const DEFAULT_SLIDES = [
  { title: "Yangi kolleksiya — 40% gacha chegirma", description: "Kiyim va poyabzal hafta davomida arzonroq.", icon: "shirt", bg: "linear-gradient(120deg,#0E5A5A,#17807A)", category: "kiyim" },
  { title: "Texnika bayrami", description: "Smartfon, noutbuk va quloqchinlar 12 oyga bo'lib to'lash bilan.", icon: "smartphone", bg: "linear-gradient(120deg,#25306B,#3E4FA8)", category: "elektronika" },
  { title: "Uyingiz uchun hammasi", description: "Idish-tovoq, yorug'lik va ro'zg'or buyumlari.", icon: "sofa", bg: "linear-gradient(120deg,#9A4A12,#D9812B)", category: "uy" }
];

const normPhone = s => {
  const d = String(s || "").replace(/[^\d+]/g, "");
  return /^\+?998\d{9}$/.test(d) ? "+" + d.replace("+", "") : null;
};
const fmtSum = n => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " so'm";
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

let db, users, products, orders, counters, slides, promos, promoUses, messages;

const promoOut = p => ({
  code: p.code, type: p.type, value: p.value, active: !!p.active,
  expiresAt: p.expiresAt || null, maxUses: p.maxUses ?? null, usedCount: p.usedCount || 0,
  perUserLimit: p.perUserLimit ?? null, minOrderAmount: p.minOrderAmount || 0,
  firstOrderOnly: p.firstOrderOnly || p.code === "XARID10", created: p.created
});

function readSlide(body) {
  const title = String(body.title || "").trim().slice(0, 100);
  const description = String(body.description || "").trim().slice(0, 300);
  const category = String(body.category || "");
  if (!title) throw new Error("Slayd sarlavhasini kiriting.");
  if (!description) throw new Error("Slayd izohini kiriting.");
  if (category && !CATEGORIES.some(c => c.id === category)) throw new Error("Kategoriya noto'g'ri.");
  return { title, description, category: category || null };
}

function readPromo(body) {
  const code = String(body.code || "").trim().toUpperCase();
  const type = String(body.type || "");
  const value = Number(body.value);
  if (!/^[A-Z0-9_-]{3,24}$/.test(code)) throw new Error("Kod 3–24 ta lotin harfi, raqam, _ yoki - dan iborat bo'lsin.");
  if (!["percent", "fixed"].includes(type)) throw new Error("Chegirma turini tanlang.");
  if (!Number.isFinite(value) || value <= 0 || (type === "percent" && value > 100))
    throw new Error(type === "percent" ? "Foiz 1 dan 100 gacha bo'lishi kerak." : "Chegirma summasi noto'g'ri.");
  const maxUses = body.maxUses === "" || body.maxUses == null ? null : Number(body.maxUses);
  if (maxUses !== null && (!Number.isSafeInteger(maxUses) || maxUses < 1))
    throw new Error("Foydalanish limiti kamida 1 bo'lishi kerak.");
  const perUserLimit = body.perUserLimit === "" || body.perUserLimit == null ? null : Number(body.perUserLimit);
  if (perUserLimit !== null && (!Number.isSafeInteger(perUserLimit) || perUserLimit < 1))
    throw new Error("Har bir foydalanuvchi limiti kamida 1 bo'lishi kerak.");
  const minOrderAmount = body.minOrderAmount === "" || body.minOrderAmount == null ? 0 : Number(body.minOrderAmount);
  if (!Number.isSafeInteger(minOrderAmount) || minOrderAmount < 0)
    throw new Error("Minimal xarid summasi 0 yoki undan katta butun son bo'lishi kerak.");
  const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
  if (expiresAt && !Number.isFinite(expiresAt.getTime())) throw new Error("Tugash sanasi noto'g'ri.");
  if (expiresAt && expiresAt <= new Date()) throw new Error("Tugash sanasi kelajakda bo'lishi kerak.");
  return {
    code, type, value: type === "fixed" ? Math.round(value) : Math.round(value * 100) / 100,
    maxUses, perUserLimit: code === "XARID10" ? 1 : perUserLimit,
    minOrderAmount, expiresAt, firstOrderOnly: code === "XARID10"
  };
}

function telegramPromoExpiry(value) {
  if (value === "-") return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date("invalid");
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? new Date(`${value}T23:59:59.999+05:00`) : new Date("invalid");
}

function promoFilter(code, now = new Date()) {
  return {
    code, active: true,
    $and: [
      { $or: [{ expiresAt: null }, { expiresAt: { $exists: false } }, { expiresAt: { $gt: now } }] },
      { $or: [{ maxUses: null }, { maxUses: { $exists: false } }, { $expr: { $lt: ["$usedCount", "$maxUses"] } }] }
    ]
  };
}

async function reservePromoUserUse(promo, userId) {
  const key = `${promo.code}:${userId}`;
  const perUserLimit = promo.code === "XARID10" ? 1 : promo.perUserLimit ?? null;
  const existing = await promoUses.findOne({ _id: key }, { projection: { uses: 1 } });
  if (existing) {
    const result = await promoUses.updateOne(
      { _id: key, ...(perUserLimit === null ? {} : { uses: { $lt: perUserLimit } }) },
      { $inc: { uses: 1 } }
    );
    return result.modifiedCount > 0;
  }

  const priorUses = await orders.countDocuments({ userId, promo: promo.code });
  if (perUserLimit !== null && priorUses >= perUserLimit) return false;
  try {
    await promoUses.insertOne({ _id: key, code: promo.code, userId, uses: priorUses + 1 });
    return true;
  } catch (error) {
    if (error.code !== 11000) throw error;
    const result = await promoUses.updateOne(
      { _id: key, ...(perUserLimit === null ? {} : { uses: { $lt: perUserLimit } }) },
      { $inc: { uses: 1 } }
    );
    return result.modifiedCount > 0;
  }
}

async function releasePromoUserUse(promo, userId) {
  await promoUses.updateOne({ _id: `${promo.code}:${userId}`, uses: { $gt: 0 } }, { $inc: { uses: -1 } });
}

async function highestPromoUserUses(code) {
  const [orderUses, reservedUses] = await Promise.all([
    orders.aggregate([
      { $match: { promo: code } },
      { $group: { _id: "$userId", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 1 }
    ]).toArray(),
    promoUses.aggregate([
      { $match: { code } },
      { $group: { _id: null, maxUses: { $max: "$uses" } } }
    ]).toArray()
  ]);
  return Math.max(orderUses[0]?.count || 0, reservedUses[0]?.maxUses || 0);
}

function readSlideImage(value) {
  if (typeof value !== "string") throw new Error("Slayd rasmi noto'g'ri.");
  const match = value.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match) throw new Error("JPG, PNG yoki WebP rasm tanlang.");
  const data = Buffer.from(match[2], "base64");
  if (!data.length || data.length > MAX_SLIDE_IMAGE_BYTES || data.toString("base64") !== match[2])
    throw new Error("Rasm hajmi 5 MB dan oshmasligi kerak.");
  const validSignature = match[1] === "image/jpeg"
    ? data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff
    : match[1] === "image/png"
      ? data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      : data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP";
  if (!validSignature) throw new Error("Rasm faylining formati noto'g'ri.");
  return { contentType: match[1], data: match[2] };
}

function makeUserCode() {
  const chars = [
    ...Array.from({ length: 5 }, () => USER_CODE_ALPHABET[crypto.randomInt(USER_CODE_ALPHABET.length)]),
    USER_CODE_LETTERS[crypto.randomInt(USER_CODE_LETTERS.length)],
    USER_CODE_DIGITS[crypto.randomInt(USER_CODE_DIGITS.length)]
  ];
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

async function nextUserCode() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = makeUserCode();
    if (!(await users.findOne({ userCode: code }, { projection: { _id: 1 } }))) return code;
  }
  throw new Error("Foydalanuvchi ID raqamini yaratib bo'lmadi.");
}

async function migrateUserCodes() {
  for await (const user of users.find({ userCode: { $not: USER_CODE_PATTERN } }, { projection: { _id: 1, userCode: 1 } })) {
    let assigned = false;
    const filter = user.userCode
      ? { _id: user._id, userCode: user.userCode }
      : { _id: user._id, userCode: { $exists: false } };
    for (let attempt = 0; attempt < 20; attempt++) {
      try {
        const result = await users.updateOne(filter, { $set: { userCode: await nextUserCode() } });
        if (!result.matchedCount) { assigned = true; break; }
        assigned = true;
        break;
      } catch (e) {
        if (e.code !== 11000) throw e;
      }
    }
    if (!assigned) throw new Error("Mavjud foydalanuvchiga ID berib bo'lmadi.");
  }
  await users.createIndex({ userCode: 1 }, { unique: true });
}

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

const telegramSearches = new Map();
const telegramPromoFlows = new Set();
const telegramMessageFlows = new Map();
const telegramKeyboard = {
  keyboard: [
    [{ text: TELEGRAM_USER_BUTTON }, { text: TELEGRAM_ORDER_BUTTON }],
    [{ text: TELEGRAM_PROMOS_BUTTON }, { text: TELEGRAM_ADD_PROMO_BUTTON }]
  ],
  resize_keyboard: true,
  is_persistent: true
};
const telegramMenu = () => ({ text: "Kerakli qidiruv turini tanlang:", reply_markup: telegramKeyboard });
const telegramSend = (chatId, text, replyMarkup = telegramKeyboard) =>
  tgCall("sendMessage", { chat_id: chatId, text, reply_markup: replyMarkup });

function telegramPromoDetails(p) {
  const discount = p.type === "percent" ? `${p.value}%` : fmtSum(p.value);
  const expiry = p.expiresAt ? new Date(p.expiresAt).toLocaleDateString("uz-UZ") : "muddatsiz";
  const totalLimit = p.maxUses == null ? "cheksiz" : `${p.usedCount || 0}/${p.maxUses}`;
  const userLimit = p.perUserLimit == null ? "cheksiz" : `${p.perUserLimit}/user`;
  const threshold = p.minOrderAmount ? `xarid ≥ ${fmtSum(p.minOrderAmount)}` : "minimal xarid yo'q";
  return `${p.code} — ${discount} · ${p.active ? "faol" : "o'chirilgan"} · jami ${totalLimit} · user ${userLimit} · ${threshold} · ${expiry}${p.firstOrderOnly || p.code === "XARID10" ? " · faqat 1-xarid" : ""}`;
}

async function showTelegramPromos(chatId, messageId) {
  const list = await promos.find().sort({ created: -1 }).limit(20).toArray();
  const total = await promos.countDocuments();
  const text = list.length
    ? `Promokodlar (${Math.min(total, list.length)}/${total}):\n\n${list.map(telegramPromoDetails).join("\n")}`
    : "Promokodlar yo'q. Yangi kod qo'shish uchun /addpromo yuboring.";
  const replyMarkup = list.length ? {
    inline_keyboard: list.map(p => [
      { text: `${p.active ? "⏸ O'chirish" : "▶️ Yoqish"} · ${p.code}`, callback_data: `promo:${p.code}:toggle` },
      { text: "🗑", callback_data: `promo:${p.code}:delete` }
    ])
  } : telegramKeyboard;
  if (messageId) {
    await tgCall("editMessageText", { chat_id: chatId, message_id: messageId, text, reply_markup: replyMarkup });
  } else {
    await telegramSend(chatId, text, replyMarkup);
  }
}

async function findTelegramUser(query) {
  const phone = normPhone(query);
  const code = query.toUpperCase();
  if (!phone && !USER_CODE_PATTERN.test(code)) return null;
  const user = await users.findOne(
    { role: "user", ...(phone ? { phone } : { userCode: code }) },
    { projection: { userCode: 1, name: 1, phone: 1, role: 1, created: 1, blockedAt: 1 } }
  );
  if (!user) return null;
  const [totalOrders, recentOrders] = await Promise.all([
    orders.countDocuments({ userId: user._id }),
    orders.find({ userId: user._id }).sort({ created: -1 }).limit(10).toArray()
  ]);
  const orderInfo = recentOrders.length
    ? recentOrders.map(order => {
      const items = order.items.map(item => `${item.name} × ${item.q}`).join(", ").slice(0, 100);
      return `• ${order._id} · ${order.status} · ${fmtSum(order.total)} · ${new Date(order.created).toLocaleDateString("uz-UZ")}\n  ${items}\n  ${order.city}, ${order.addr}`.slice(0, 350);
    }).join("\n")
    : "Buyurtmalari yo'q.";
  const moreOrders = totalOrders > recentOrders.length ? `\nSo'nggi ${recentOrders.length} ta ko'rsatildi.` : "";
  return {
    user,
    text: `Foydalanuvchi ma'lumotlari\nID: ${user.userCode}\nIsm: ${user.name}\nTelefon: ${user.phone}\nRol: ${user.role}\nRo'yxatdan o'tgan: ${user.created ? new Date(user.created).toLocaleString("uz-UZ") : "Noma'lum"}\nSaytdagi holati: ${user.blockedAt ? "Bloklangan" : "Faol"}\nJami buyurtmalar: ${totalOrders}\n\nBuyurtmalar:\n${orderInfo}${moreOrders}`,
    replyMarkup: {
      inline_keyboard: [
        [{ text: "✉️ Xabar yuborish", callback_data: `usr:${user.userCode}:message` }],
        [{ text: "🔑 Vaqtinchalik parol berish", callback_data: `usr:${user.userCode}:reset` }],
        [{ text: user.blockedAt ? "🔓 Blokdan chiqarish" : "🚫 Saytdan bloklash",
          callback_data: `usr:${user.userCode}:${user.blockedAt ? "unblock" : "block"}` }]
      ]
    }
  };
}

async function findTelegramOrder(query) {
  const id = query.trim().toUpperCase();
  if (!/^XR\d{7}$/.test(id)) return null;
  const order = await orders.findOne({ _id: id });
  if (!order) return null;
  const itemLines = order.items.map(item => `• ${item.name} × ${item.q} — ${fmtSum(item.price * item.q)}`);
  const header = `Buyurtma ${order._id}\nHolati: ${order.status}\nSana: ${new Date(order.created).toLocaleString("uz-UZ")}\n\nMijoz: ${order.name}\nTelefon: ${order.phone}\nManzil: ${order.city}, ${order.addr}\nTo'lov: ${order.pay}${order.promo ? `\nPromokod: ${order.promo}` : ""}\n\n`;
  let items = "";
  let shown = 0;
  for (const line of itemLines) {
    if (header.length + items.length + line.length + 100 > 3900) break;
    items += `${items ? "\n" : ""}${line}`;
    shown++;
  }
  if (shown < itemLines.length) items += `\n... va yana ${itemLines.length - shown} ta mahsulot`;
  return {
    order,
    text: `${header}${items}\n\nJami: ${fmtSum(order.total)}`,
    replyMarkup: {
      inline_keyboard: STATUSES.map((status, index) => [{
        text: `${status === order.status ? "✅ " : ""}${status}`,
        callback_data: `ord:${order._id}:${index}`
      }])
    }
  };
}

async function setUserBlocked(userCode, blocked) {
  const update = blocked ? { $set: { blockedAt: new Date() } } : { $unset: { blockedAt: "" } };
  const result = await users.updateOne({
    userCode, role: "user", blockedAt: blocked ? { $exists: false } : { $exists: true }
  }, update);
  return result.matchedCount > 0;
}

async function resetUserPassword(userCode) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const temporaryPassword = Array.from({ length: 14 }, () => alphabet[crypto.randomInt(alphabet.length)]).join("");
  const result = await users.updateOne(
    { userCode, role: "user" },
    {
      $set: { passHash: await bcrypt.hash(temporaryPassword, 10), mustChangePassword: true },
      $inc: { tokenVersion: 1 }
    }
  );
  return result.matchedCount ? temporaryPassword : null;
}

async function changeOrderStatus(id, status) {
  if (!STATUSES.includes(status)) return { error: "Noto'g'ri holat.", statusCode: 400 };
  const order = await orders.findOne({ _id: id });
  if (!order) return { error: "Buyurtma topilmadi.", statusCode: 404 };
  if (order.status === "Bekor qilindi" && status !== order.status)
    return { error: "Bekor qilingan buyurtmani qayta ochib bo'lmaydi.", statusCode: 400 };
  if (order.status === status) return { order };
  const notification = order.userId ? {
    _id: new ObjectId(), userId: order.userId, type: "order",
    title: "Buyurtma holati yangilandi",
    body: `${order._id} raqamli buyurtmangiz holati: ${status}.`,
    orderId: order._id, readAt: null, created: new Date()
  } : null;
  if (notification) await messages.insertOne(notification);
  let updated;
  try {
    updated = await orders.findOneAndUpdate(
      { _id: order._id, status: order.status },
      { $set: { status } },
      { returnDocument: "after" }
    );
  } catch (error) {
    if (notification) await messages.deleteOne({ _id: notification._id });
    throw error;
  }
  if (!updated) {
    if (notification) await messages.deleteOne({ _id: notification._id });
    return { error: "Buyurtma holati boshqa joyda o'zgartirildi. Qayta yuklang.", statusCode: 409 };
  }
  if (status === "Bekor qilindi")
    for (const item of order.items)
      await products.updateOne({ _id: item.id }, { $inc: { stock: item.q, sold: -item.q } });
  return { order: updated };
}

async function handleTelegramCallback(callback) {
  if (String(callback.from?.id) !== TG_ADMIN_ID || callback.message?.chat?.type !== "private") {
    await tgCall("answerCallbackQuery", { callback_query_id: callback.id, text: "Ruxsat yo'q." });
    return;
  }
  const [type, id, action] = String(callback.data || "").split(":");
  if (type === "usr" && USER_CODE_PATTERN.test(id) && action === "message") {
    const chatId = String(callback.message.chat.id);
    telegramSearches.delete(chatId);
    telegramPromoFlows.delete(chatId);
    telegramMessageFlows.set(chatId, id);
    await tgCall("answerCallbackQuery", { callback_query_id: callback.id, text: "Xabar yuborish rejimi yoqildi." });
    await telegramSend(callback.message.chat.id,
      `Foydalanuvchi ${id} uchun xabarni quyidagi formatda yuboring:\nSarlavha | Xabar matni\n\nBekor qilish uchun /cancel yuboring.`);
    return;
  }
  if (type === "usr" && USER_CODE_PATTERN.test(id) && action === "reset") {
    const temporaryPassword = await resetUserPassword(id);
    if (!temporaryPassword) {
      await tgCall("answerCallbackQuery", { callback_query_id: callback.id, text: "Foydalanuvchi topilmadi." });
      return;
    }
    await tgCall("answerCallbackQuery", { callback_query_id: callback.id, text: "Parol yangilandi." });
    await telegramSend(callback.message.chat.id,
      `Yangi vaqtinchalik parol: ${temporaryPassword}\n\nUni foydalanuvchiga maxfiy tarzda yuboring. U shu parol bilan kirgach, darhol yangisini o'rnatishi shart.`);
    const info = await findTelegramUser(id);
    if (info) await tgCall("editMessageText", {
      chat_id: callback.message.chat.id,
      message_id: callback.message.message_id,
      text: info.text,
      reply_markup: info.replyMarkup
    });
    return;
  }
  if (type === "usr" && USER_CODE_PATTERN.test(id) && ["block", "unblock"].includes(action)) {
    const blocked = action === "block";
    const updated = await setUserBlocked(id, blocked);
    await tgCall("answerCallbackQuery", {
      callback_query_id: callback.id,
      text: updated ? (blocked ? "Foydalanuvchi bloklandi." : "Blokdan chiqarildi.") : "Foydalanuvchi topilmadi."
    });
    if (updated && callback.message) {
      const info = await findTelegramUser(id);
      if (info) await tgCall("editMessageText", {
        chat_id: callback.message.chat.id,
        message_id: callback.message.message_id,
        text: info.text,
        reply_markup: info.replyMarkup
      });
    }
    return;
  }
  if (type === "ord" && /^XR\d{7}$/.test(id) && /^\d$/.test(action) && Number(action) < STATUSES.length) {
    const status = STATUSES[Number(action)];
    const result = await changeOrderStatus(id, status);
    await tgCall("answerCallbackQuery", {
      callback_query_id: callback.id,
      text: result.error || "Buyurtma holati yangilandi."
    });
    if (result.order && callback.message) {
      const details = await findTelegramOrder(id);
      if (details) await tgCall("editMessageText", {
        chat_id: callback.message.chat.id,
        message_id: callback.message.message_id,
        text: details.text,
        reply_markup: details.replyMarkup
      });
    }
    return;
  }
  if (type === "promo" && /^[A-Z0-9_-]{3,24}$/.test(id) && ["toggle", "delete"].includes(action)) {
    if (action === "delete") {
      const result = await promos.deleteOne({ code: id });
      await tgCall("answerCallbackQuery", {
        callback_query_id: callback.id,
        text: result.deletedCount ? `${id} o'chirildi.` : "Promokod topilmadi."
      });
    } else {
      const promo = await promos.findOne({ code: id });
      if (!promo) {
        await tgCall("answerCallbackQuery", { callback_query_id: callback.id, text: "Promokod topilmadi." });
      } else {
        await promos.updateOne({ code: id }, { $set: { active: !promo.active } });
        await tgCall("answerCallbackQuery", { callback_query_id: callback.id, text: promo.active ? "Promokod o'chirildi." : "Promokod yoqildi." });
      }
    }
    await showTelegramPromos(callback.message.chat.id, callback.message.message_id);
    return;
  }
  await tgCall("answerCallbackQuery", { callback_query_id: callback.id, text: "Bu tugma eskirgan." });
}

async function handleTelegramUpdate(update) {
  if (update.callback_query) {
    await handleTelegramCallback(update.callback_query);
    return;
  }
  const message = update.message;
  if (!message?.text || message.chat?.type !== "private") return;
  const reply = text => telegramSend(message.chat.id, text);
  if (String(message.from?.id) !== TG_ADMIN_ID) {
    if (message.text.trim().startsWith("/")) await reply("Bu buyruqdan foydalanishga ruxsat yo'q.");
    return;
  }
  const text = message.text.trim();
  const match = text.match(/^\/([a-z]+)(?:@\w+)?(?:\s+([\s\S]+))?$/i);
  const command = match?.[1].toLowerCase();
  const inlineQuery = match?.[2]?.trim();
  const chatId = String(message.chat.id);
  if (command) telegramMessageFlows.delete(chatId);
  if (["start", "help"].includes(command)) {
    telegramSearches.delete(String(message.chat.id));
    telegramPromoFlows.delete(String(message.chat.id));
    await reply("Foydalanuvchi va buyurtmalarni qidiring, promokodlarni boshqaring va foydalanuvchilarga xabar yuboring.\n\n/promos — kodlar ro'yxati\n/addpromo — yangi kod qo'shish\n/editpromo KOD percent|fixed MIQDOR SANA|- JAMI|- USER|- MIN|- — tahrirlash\n/promo KOD on|off|delete — yoqish/o'chirish\n/cancel — joriy amalni bekor qilish\n\nFormat: KOD percent|fixed MIQDOR SANA|- JAMI|- USER|- MIN|-");
    return;
  }
  if (command === "cancel") {
    telegramSearches.delete(chatId);
    telegramPromoFlows.delete(chatId);
    return reply("Joriy amal bekor qilindi.");
  }
  if (telegramMessageFlows.has(chatId) && !command) {
    const userCode = telegramMessageFlows.get(chatId);
    const separator = text.indexOf("|");
    const title = separator < 0 ? "" : text.slice(0, separator).trim();
    const body = separator < 0 ? "" : text.slice(separator + 1).trim();
    if (!title || !body || title.length > 100 || body.length > 2000)
      return reply("Format noto'g'ri yoki matn juda uzun. 100 belgigacha sarlavha va 2000 belgigacha matn yuboring:\nSarlavha | Xabar matni");
    const user = await users.findOne({ userCode, role: "user" }, { projection: { _id: 1 } });
    if (!user) {
      telegramMessageFlows.delete(chatId);
      return reply("Foydalanuvchi topilmadi. Qidiruvni qayta boshlang.");
    }
    try {
      await messages.insertOne({
        _id: new ObjectId(), userId: user._id, type: "admin", title, body,
        readAt: null, created: new Date()
      });
    } catch (error) {
      console.warn("Telegram orqali xabar saqlanmadi:", error.message);
      return reply("Xabarni saqlab bo'lmadi. Qayta urinib ko'ring.");
    }
    telegramMessageFlows.delete(chatId);
    return reply(`${userCode} foydalanuvchisiga xabar yuborildi.`);
  }
  if (["promos", "promokodlar"].includes(command) || text === TELEGRAM_PROMOS_BUTTON) {
    telegramSearches.delete(String(message.chat.id));
    telegramPromoFlows.delete(String(message.chat.id));
    return showTelegramPromos(message.chat.id);
  }
  if (["addpromo", "promokod"].includes(command) || text === TELEGRAM_ADD_PROMO_BUTTON) {
    telegramSearches.delete(String(message.chat.id));
    telegramPromoFlows.add(String(message.chat.id));
    return reply("Yangi promokod ma'lumotlarini bitta qatorda yuboring:\nKOD percent|fixed MIQDOR SANA|- JAMI|- USER|- MIN|-\nMisol: BAHOR10 percent 10 2027-03-31 100 1 200000\nCheksiz limit yoki minimal xarid bo'lmasa - yozing. XARID10 faqat birinchi xaridga.");
  }
  if (command === "editpromo") {
    telegramSearches.delete(String(message.chat.id));
    telegramPromoFlows.delete(String(message.chat.id));
    const parts = (inlineQuery || "").split(/\s+/);
    if (![5, 7].includes(parts.length)) return reply("Foydalanish: /editpromo KOD percent|fixed MIQDOR SANA|- JAMI|- USER|- MIN|-");
    const [code, type, rawValue, rawExpiry, rawLimit, rawUserLimit = "-", rawMinOrder = "-"] = parts;
    const current = await promos.findOne({ code: code.toUpperCase() });
    if (!current) return reply("Promokod topilmadi.");
    const expiresAt = telegramPromoExpiry(rawExpiry);
    let updated;
    try {
      updated = readPromo({
        code, type, value: rawValue, expiresAt, maxUses: rawLimit === "-" ? null : rawLimit,
        perUserLimit: rawUserLimit === "-" ? null : rawUserLimit,
        minOrderAmount: rawMinOrder === "-" ? 0 : rawMinOrder
      });
    } catch (e) { return reply(e.message); }
    if (updated.maxUses !== null && updated.maxUses < (current.usedCount || 0))
      return reply("Foydalanish limiti ishlatilgan kodlar sonidan kam bo'lmasligi kerak.");
    if (updated.perUserLimit !== null && code.toUpperCase() !== "XARID10" &&
        updated.perUserLimit < await highestPromoUserUses(code.toUpperCase()))
      return reply("Har bir user limiti oldin ishlatilgan miqdordan kam bo'lmasligi kerak.");
    await promos.updateOne({ code: current.code }, { $set: {
      type: updated.type, value: updated.value, expiresAt: updated.expiresAt,
      maxUses: updated.maxUses, perUserLimit: updated.perUserLimit,
      minOrderAmount: updated.minOrderAmount, firstOrderOnly: updated.firstOrderOnly
    } });
    return reply(`${code.toUpperCase()} yangilandi. ${telegramPromoDetails({ ...current, ...updated })}`);
  }
  if (command === "promo") {
    telegramSearches.delete(String(message.chat.id));
    telegramPromoFlows.delete(String(message.chat.id));
    const [code, action] = (inlineQuery || "").toUpperCase().split(/\s+/);
    if (!/^[A-Z0-9_-]{3,24}$/.test(code || "") || !["ON", "OFF", "DELETE"].includes(action))
      return reply("Foydalanish: /promo KOD on|off|delete");
    if (action === "DELETE") {
      const result = await promos.deleteOne({ code });
      return reply(result.deletedCount ? `${code} o'chirildi.` : "Promokod topilmadi.");
    }
    const result = await promos.updateOne({ code }, { $set: { active: action === "ON" } });
    return reply(result.matchedCount ? `${code}: ${action === "ON" ? "faol" : "o'chirilgan"}.` : "Promokod topilmadi.");
  }
  if (telegramPromoFlows.has(String(message.chat.id))) {
    telegramPromoFlows.delete(String(message.chat.id));
    const parts = text.split(/\s+/);
    if (![5, 7].includes(parts.length)) return reply("Format noto'g'ri. /addpromo tugmasini bosib, 7 ta maydonni yuboring.");
    const [code, type, rawValue, rawExpiry, rawLimit, rawUserLimit = "-", rawMinOrder = "-"] = parts;
    const expiresAt = telegramPromoExpiry(rawExpiry);
    let promo;
    try {
      promo = readPromo({
        code, type, value: rawValue, expiresAt, maxUses: rawLimit === "-" ? null : rawLimit,
        perUserLimit: rawUserLimit === "-" ? null : rawUserLimit,
        minOrderAmount: rawMinOrder === "-" ? 0 : rawMinOrder
      });
    } catch (e) { return reply(e.message); }
    if (await promos.findOne({ code: promo.code }, { projection: { _id: 1 } }))
      return reply("Bu promokod avvaldan mavjud. Boshqa kod tanlang.");
    await promos.insertOne({ ...promo, active: true, usedCount: 0, created: new Date() });
    return reply(`${promo.code} promokodi qo'shildi. ${telegramPromoDetails({ ...promo, active: true, usedCount: 0 })}`);
  }
  if (["user", "search", "qidir"].includes(command)) {
    telegramSearches.set(String(message.chat.id), "user");
    if (!inlineQuery) return reply("Foydalanuvchi telefon raqami yoki 7 belgili ID sini yuboring.");
  } else if (command === "buyurtma") {
    telegramSearches.set(String(message.chat.id), "order");
    if (!inlineQuery) return reply("Buyurtma raqamini yuboring. Masalan: XR1234567");
  } else if (text === TELEGRAM_USER_BUTTON) {
    telegramSearches.set(String(message.chat.id), "user");
    return reply("Foydalanuvchi telefon raqami yoki 7 belgili ID sini yuboring.");
  } else if (text === TELEGRAM_ORDER_BUTTON) {
    telegramSearches.set(String(message.chat.id), "order");
    return reply("Buyurtma raqamini yuboring. Masalan: XR1234567");
  }
  const searchType = command ? (["user", "search", "qidir"].includes(command) ? "user" : command === "buyurtma" ? "order" : null)
    : telegramSearches.get(String(message.chat.id));
  if (!searchType) {
    await reply("Qidiruv turini tanlash uchun tugmalardan foydalaning.");
    return;
  }
  const query = inlineQuery || text;
  telegramSearches.delete(String(message.chat.id));
  if (searchType === "user") {
    const phone = normPhone(query), code = query.toUpperCase();
    if (!phone && !USER_CODE_PATTERN.test(code)) {
      await reply("Telefon raqami yoki 7 belgili ID noto'g'ri. Qidiruv tugmasini qayta bosing.");
      return;
    }
    const result = await findTelegramUser(query);
    await telegramSend(message.chat.id, result ? result.text : "Foydalanuvchi topilmadi.",
      result ? result.replyMarkup : telegramKeyboard);
    return;
  }
  const result = await findTelegramOrder(query);
  await telegramSend(message.chat.id, result ? result.text : "Buyurtma topilmadi. Raqam XR1234567 ko'rinishida bo'lishi kerak.",
    result ? result.replyMarkup : telegramKeyboard);
}

async function pollTelegram() {
  let offset = 0;
  while (true) {
    try {
      const { result } = await tgCall("getUpdates", { offset, timeout: 25, allowed_updates: ["message", "callback_query"] }, 35000);
      for (const update of result) {
        offset = update.update_id + 1;
        try { await handleTelegramUpdate(update); }
        catch (e) {
          console.warn("Telegram buyruq bajarilmadi:", e.message);
          if (update.callback_query) await tgCall("answerCallbackQuery", {
            callback_query_id: update.callback_query.id,
            text: "Xatolik yuz berdi. Qayta urinib ko'ring."
          }).catch(error => console.warn("Telegram tugmasiga javob yuborilmadi:", error.message));
        }
      }
    } catch (e) {
      console.warn("Telegram bot buyruqlarini tekshirib bo'lmadi:", e.message);
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }
}

// ---- Yordamchilar ----
const sign = u => jwt.sign({ id: String(u._id), role: u.role, ver: u.tokenVersion || 0 }, SECRET, { expiresIn: "30d" });
const publicUser = u => ({
  id: u.userCode, name: u.name, phone: u.phone, role: u.role, mustChangePassword: !!u.mustChangePassword
});
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
        if (u && (t.ver || 0) !== (u.tokenVersion || 0))
          return res.status(401).json({ error: "Sessiya muddati tugagan. Qayta kiring." });
        if (u && u.blockedAt) return res.status(403).json({ error: "Akkauntingiz bloklangan." });
        if (u?.mustChangePassword && !["/api/me", "/api/auth/change-password"].includes(req.path))
          return res.status(403).json({ error: "Davom etish uchun vaqtinchalik parolni yangilang." });
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
app.get("/api/slides", ah(async (req, res) =>
  res.json((await slides.find().sort({ created: 1, _id: 1 }).toArray()).map(s => ({
    id: String(s._id), title: s.title, description: s.description, category: s.category || null,
    icon: s.icon || "sparkles", bg: s.bg || "linear-gradient(120deg,#0E5A5A,#17807A)",
    image: s.image ? `/api/slides/${s._id}/image` : null
  })))));
app.get("/api/slides/:id/image", ah(async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(404).end();
  const slide = await slides.findOne({ _id: new ObjectId(req.params.id) }, { projection: { image: 1 } });
  if (!slide?.image) return res.status(404).end();
  res.set({ "Content-Type": slide.image.contentType, "Cache-Control": "no-cache" });
  res.send(Buffer.from(slide.image.data, "base64"));
}));
app.get("/api/promos/:code", ah(async (req, res) => {
  const code = String(req.params.code || "").trim().toUpperCase();
  const promo = await promos.findOne(promoFilter(code));
  if (!promo) return res.status(400).json({ error: "Promokod noto'g'ri, muddati tugagan yoki limiti to'lgan." });
  res.json(promoOut(promo));
}));
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
  for (let attempt = 0; attempt < 5; attempt++) {
    doc.userCode = await nextUserCode();
    try { await users.insertOne(doc); break; }
    catch (e) {
      if (e.code === 11000 && e.keyPattern?.userCode && attempt < 4) continue;
      if (e.code === 11000 && e.keyPattern?.phone) return res.status(409).json({ error: "Bu raqam ro'yxatdan o'tgan." });
      throw e;
    }
  }
  res.json({ token: sign(doc), user: publicUser(doc) });
}));

app.post("/api/auth/login", authLimiter, ah(async (req, res) => {
  const phone = normPhone(req.body.phone);
  const u = phone && await users.findOne({ phone });
  if (!u || !(await bcrypt.compare(String(req.body.pass || ""), u.passHash)))
    return res.status(401).json({ error: "Telefon yoki parol noto'g'ri." });
  if (u.blockedAt) return res.status(403).json({ error: "Akkauntingiz bloklangan." });
  res.json({ token: sign(u), user: publicUser(u) });
}));

app.post("/api/auth/change-password", auth(), ah(async (req, res) => {
  const pass = String(req.body.pass || "");
  if (!req.user.mustChangePassword || req.user.role !== "user")
    return res.status(403).json({ error: "Parolni yangilash uchun vaqtinchalik parol bilan kiring." });
  if (pass.length < 8 || pass.length > 100)
    return res.status(400).json({ error: "Yangi parol 8 dan 100 tagacha belgi bo'lishi kerak." });
  const result = await users.updateOne(
    { _id: req.user._id, mustChangePassword: true, tokenVersion: req.user.tokenVersion || 0 },
    {
      $set: { passHash: await bcrypt.hash(pass, 10) },
      $unset: { mustChangePassword: "" },
      $inc: { tokenVersion: 1 }
    }
  );
  if (!result.modifiedCount) return res.status(409).json({ error: "Parol yangilanmadi. Qayta kiring." });
  const user = await users.findOne({ _id: req.user._id });
  res.json({ token: sign(user), user: publicUser(user) });
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
  const promoCode = String(b.promo || "").trim().toUpperCase();
  const selectedPromo = promoCode ? await promos.findOne(promoFilter(promoCode)) : null;
  if (promoCode && !selectedPromo) return res.status(400).json({ error: "Promokod noto'g'ri, muddati tugagan yoki limiti to'lgan." });
  const items = found.map(p => ({ id: p._id, name: p.name, icon: p.icon, q: qty.get(p._id), price: p.price }));
  const sub = items.reduce((s, i) => s + i.price * i.q, 0);
  if (selectedPromo?.minOrderAmount && sub < selectedPromo.minOrderAmount)
    return res.status(400).json({ error: `Bu promokod ${fmtSum(selectedPromo.minOrderAmount)} yoki undan yuqori xaridga amal qiladi.` });
  if ((selectedPromo?.firstOrderOnly || selectedPromo?.code === "XARID10") &&
      await orders.countDocuments({ userId: req.user._id }) > 0)
    return res.status(400).json({ error: "XARID10 faqat birinchi xarid uchun amal qiladi." });

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

  const discount = selectedPromo
    ? selectedPromo.type === "percent" ? Math.round(sub * selectedPromo.value / 100) : Math.min(sub, selectedPromo.value)
    : 0;
  let promoTotalReserved = false, promoUserReserved = false;
  if (selectedPromo) {
    let claimed;
    try { claimed = await promos.updateOne(promoFilter(selectedPromo.code), { $inc: { usedCount: 1 } }); }
    catch (e) { await rollback(); throw e; }
    if (!claimed.modifiedCount) {
      await rollback();
      return res.status(400).json({ error: "Promokod limiti tugadi yoki endi amal qilmaydi." });
    }
    promoTotalReserved = true;
    try {
      promoUserReserved = await reservePromoUserUse(selectedPromo, req.user._id);
    } catch (e) {
      await promos.updateOne({ code: selectedPromo.code, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } });
      await rollback();
      throw e;
    }
    if (!promoUserReserved) {
      await promos.updateOne({ code: selectedPromo.code, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } });
      await rollback();
      return res.status(400).json({ error: selectedPromo.code === "XARID10"
        ? "XARID10 faqat birinchi xarid uchun va bir marta ishlatiladi."
        : "Bu promokod uchun foydalanish limitingiz tugagan." });
    }
  }
  const total = sub - discount + (sub - discount < FREE_SHIP ? SHIP : 0);

  let order;
  try {
    for (let k = 0; k < 5 && !order; k++) {
      const doc = { _id: "XR" + crypto.randomInt(1000000, 9999999), userId: req.user._id, name, phone, city, addr, pay,
        total, promo: selectedPromo?.code || null, status: STATUSES[0], items, created: new Date(), tgSent: false };
      try { await orders.insertOne(doc); order = doc; }
      catch (e) { if (e.code !== 11000) throw e; }
    }
    if (!order) throw new Error("Buyurtma raqamini yaratib bo'lmadi.");
  } catch (e) {
    await rollback();
    if (selectedPromo && promoTotalReserved)
      await promos.updateOne({ code: selectedPromo.code, usedCount: { $gt: 0 } }, { $inc: { usedCount: -1 } });
    if (selectedPromo && promoUserReserved) await releasePromoUserUse(selectedPromo, req.user._id);
    throw e;
  }
  sendOrderToTelegram(order).catch(e => console.warn("Telegram (qayta uriniladi):", e.message));
  res.json(orderOut(order));
}));

app.get("/api/orders/my", auth(), ah(async (req, res) =>
  res.json((await orders.find({ userId: req.user._id }).sort({ created: -1 }).toArray()).map(orderOut))));

app.get("/api/messages", auth(), ah(async (req, res) => {
  const [list, unreadCount] = await Promise.all([
    messages.find({ userId: req.user._id }).sort({ created: -1 }).limit(100).toArray(),
    messages.countDocuments({ userId: req.user._id, readAt: null })
  ]);
  res.json({
    unreadCount,
    messages: list.map(m => ({
      id: String(m._id), type: m.type, title: m.title, body: m.body,
      orderId: m.orderId || null, read: !!m.readAt, created: m.created
    }))
  });
}));

app.post("/api/messages/read", auth(), ah(async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : [];
  if (ids.length > 100 || ids.some(id => typeof id !== "string" || !ObjectId.isValid(id)))
    return res.status(400).json({ error: "Xabarlar ro'yxati noto'g'ri." });
  await messages.updateMany(
    { _id: { $in: ids.map(id => new ObjectId(id)) }, userId: req.user._id, readAt: null },
    { $set: { readAt: new Date() } }
  );
  res.json({ ok: true, unreadCount: await messages.countDocuments({ userId: req.user._id, readAt: null }) });
}));

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

admin.get("/users", ah(async (req, res) => {
  const query = String(req.query.q || "").trim();
  if (query.length < 2) return res.json([]);
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(escaped, "i");
  const list = await users.find({
    role: "user",
    $or: [{ name: regex }, { phone: regex }, { userCode: regex }]
  }, { projection: { userCode: 1, name: 1, phone: 1 } }).sort({ name: 1 }).limit(20).toArray();
  res.json(list.map(user => ({ id: user.userCode, name: user.name, phone: user.phone })));
}));

admin.post("/messages", ah(async (req, res) => {
  const userCode = String(req.body.userCode || "").trim().toUpperCase();
  const title = String(req.body.title || "").trim().slice(0, 100);
  const body = String(req.body.body || "").trim().slice(0, 2000);
  if (!USER_CODE_PATTERN.test(userCode)) return res.status(400).json({ error: "Foydalanuvchini tanlang." });
  if (title.length < 2) return res.status(400).json({ error: "Xabar sarlavhasini kiriting." });
  if (body.length < 2) return res.status(400).json({ error: "Xabar matnini kiriting." });
  const user = await users.findOne({ userCode, role: "user" }, { projection: { _id: 1 } });
  if (!user) return res.status(404).json({ error: "Foydalanuvchi topilmadi." });
  await messages.insertOne({
    userId: user._id, type: "admin", title, body, readAt: null, created: new Date()
  });
  res.json({ ok: true });
}));

admin.get("/slides", ah(async (req, res) =>
  res.json((await slides.find().sort({ created: 1, _id: 1 }).toArray()).map(s => ({
    id: String(s._id), title: s.title, description: s.description, category: s.category || "",
    image: s.image ? `/api/slides/${s._id}/image` : null
  })))));

admin.post("/slides", ah(async (req, res) => {
  let slide, image;
  try {
    slide = readSlide(req.body);
    image = readSlideImage(req.body.image);
  } catch (e) { return res.status(400).json({ error: e.message }); }
  const doc = { _id: new ObjectId(), ...slide, image, created: new Date() };
  await slides.insertOne(doc);
  res.json({ id: String(doc._id) });
}));

admin.put("/slides/:id", ah(async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Slayd ID noto'g'ri." });
  let slide, image;
  try {
    slide = readSlide(req.body);
    if (req.body.image) image = readSlideImage(req.body.image);
  } catch (e) { return res.status(400).json({ error: e.message }); }
  const removeImage = req.body.removeImage === true || req.body.removeImage === "true" || req.body.removeImage === "on";
  const update = { $set: slide };
  if (image) update.$set.image = image;
  else if (removeImage) update.$unset = { image: "" };
  const result = await slides.updateOne({ _id: new ObjectId(req.params.id) }, update);
  if (!result.matchedCount) return res.status(404).json({ error: "Slayd topilmadi." });
  res.json({ ok: true });
}));

admin.delete("/slides/:id", ah(async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Slayd ID noto'g'ri." });
  await slides.deleteOne({ _id: new ObjectId(req.params.id) });
  res.json({ ok: true });
}));

admin.get("/promos", ah(async (req, res) =>
  res.json((await promos.find().sort({ created: -1 }).toArray()).map(promoOut))));

admin.post("/promos", ah(async (req, res) => {
  let promo;
  try { promo = readPromo(req.body); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  try {
    const doc = { ...promo, active: true, usedCount: 0, created: new Date() };
    await promos.insertOne(doc);
    res.json(promoOut(doc));
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: "Bu promokod avvaldan mavjud." });
    throw e;
  }
}));

admin.put("/promos/:code", ah(async (req, res) => {
  const code = String(req.params.code || "").toUpperCase();
  let promo;
  try { promo = readPromo({ ...req.body, code }); }
  catch (e) { return res.status(400).json({ error: e.message }); }
  const existing = await promos.findOne({ code }, { projection: { usedCount: 1 } });
  if (!existing) return res.status(404).json({ error: "Promokod topilmadi." });
  if (promo.maxUses !== null && promo.maxUses < (existing.usedCount || 0))
    return res.status(400).json({ error: "Foydalanish limiti ishlatilgan kodlar sonidan kam bo'lmasligi kerak." });
  if (promo.perUserLimit !== null && code !== "XARID10") {
    const highestUseCount = await highestPromoUserUses(code);
    if (promo.perUserLimit < highestUseCount)
      return res.status(400).json({ error: "Har bir user limiti oldin ishlatilgan miqdordan kam bo'lmasligi kerak." });
  }
  const result = await promos.findOneAndUpdate(
    { code },
    { $set: {
      type: promo.type, value: promo.value, expiresAt: promo.expiresAt, maxUses: promo.maxUses,
      perUserLimit: promo.perUserLimit, minOrderAmount: promo.minOrderAmount, firstOrderOnly: promo.firstOrderOnly
    } },
    { returnDocument: "after" }
  );
  res.json(promoOut(result));
}));

admin.patch("/promos/:code", ah(async (req, res) => {
  const code = String(req.params.code || "").toUpperCase();
  if (typeof req.body.active !== "boolean") return res.status(400).json({ error: "Promokod holati noto'g'ri." });
  const result = await promos.findOneAndUpdate({ code }, { $set: { active: req.body.active } }, { returnDocument: "after" });
  if (!result) return res.status(404).json({ error: "Promokod topilmadi." });
  res.json(promoOut(result));
}));

admin.delete("/promos/:code", ah(async (req, res) => {
  const code = String(req.params.code || "").toUpperCase();
  const result = await promos.deleteOne({ code });
  if (!result.deletedCount) return res.status(404).json({ error: "Promokod topilmadi." });
  res.json({ ok: true });
}));

admin.get("/orders/search", ah(async (req, res) => {
  const id = String(req.query.id || "").trim().toUpperCase();
  if (!id) return res.status(400).json({ error: "Buyurtma raqamini kiriting." });
  const order = await orders.findOne({ _id: id });
  res.json(order ? [orderOut(order)] : []);
}));

admin.get("/orders", ah(async (req, res) =>
  res.json((await orders.find().sort({ created: -1 }).limit(500).toArray()).map(orderOut))));

admin.patch("/orders/:id", ah(async (req, res) => {
  const result = await changeOrderStatus(req.params.id, req.body.status);
  if (result.error) return res.status(result.statusCode).json({ error: result.error });
  res.json(orderOut(result.order));
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
  slides = db.collection("slides"); promos = db.collection("promos"); promoUses = db.collection("promoUses");
  messages = db.collection("messages");
  await users.createIndex({ phone: 1 }, { unique: true });
  await migrateUserCodes();
  await orders.createIndex({ userId: 1, created: -1 });
  await orders.createIndex({ tgSent: 1, created: 1 });
  await products.createIndex({ active: 1, sold: -1 });
  await slides.createIndex({ created: 1 });
  await promos.createIndex({ code: 1 }, { unique: true });
  await promoUses.createIndex({ code: 1, uses: -1 });
  await messages.createIndex({ userId: 1, created: -1 });
  await messages.createIndex({ userId: 1, readAt: 1 });

  const slideSeed = await counters.updateOne(
    { _id: "slide-seed-v1" }, { $setOnInsert: { created: new Date() } }, { upsert: true }
  );
  if (slideSeed.upsertedCount) {
    await slides.insertMany(DEFAULT_SLIDES.map((s, i) => ({ ...s, created: new Date(Date.now() + i) })));
  }
  const promoSeed = await counters.updateOne(
    { _id: "promo-seed-v1" }, { $setOnInsert: { created: new Date() } }, { upsert: true }
  );
  if (promoSeed.upsertedCount) {
    await promos.updateOne({ code: "XARID10" }, {
      $setOnInsert: { code: "XARID10", type: "percent", value: 10, active: true, expiresAt: null, maxUses: null, usedCount: 0, created: new Date() }
    }, { upsert: true });
    await promos.updateOne({ code: "YANGI5" }, {
      $setOnInsert: { code: "YANGI5", type: "percent", value: 5, active: true, expiresAt: null, maxUses: null, usedCount: 0, created: new Date() }
    }, { upsert: true });
  }
  await promos.updateOne({ code: "XARID10" }, { $set: { firstOrderOnly: true, perUserLimit: 1 } });

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
      $setOnInsert: { created: new Date(), userCode: await nextUserCode() } }, { upsert: true });
    console.log("Admin yaratildi:", ph);
  }

  // 5) Yuborilmay qolgan buyurtmalarni Telegramga qayta yuborish
  flushTelegram();
  setInterval(flushTelegram, 60 * 1000).unref();
  pollTelegram();

  app.listen(PORT, () => console.log(`Xaridor ishlayapti: http://localhost:${PORT}  (admin: /admin.html)`));
}
main().catch(e => { console.error(e); process.exit(1); });
