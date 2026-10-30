"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const { MongoClient, ObjectId } = require("mongodb");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
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
let telegramBotUsername = "";
const PORT = env("PORT") || 3000;
const GOOGLE_CLIENT_ID = env("GOOGLE_CLIENT_ID");
const googleOAuthClient = new OAuth2Client(GOOGLE_CLIENT_ID || undefined);
const USER_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const USER_CODE_LETTERS = USER_CODE_ALPHABET.slice(0, -8);
const USER_CODE_DIGITS = USER_CODE_ALPHABET.slice(-8);
const USER_CODE_PATTERN = /^(?=.*[A-Z])(?=.*[0-9])[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{7}$/;
const TELEGRAM_USER_BUTTON = "🔎 Foydalanuvchini qidirish";
const TELEGRAM_ORDER_BUTTON = "📦 Buyurtmani qidirish";
const TELEGRAM_PROMOS_BUTTON = "🎟 Promokodlar";
const TELEGRAM_ADD_PROMO_BUTTON = "➕ Promokod qo'shish";
const TELEGRAM_REPORT_BUTTON = "📊 Savdo hisoboti";
const TELEGRAM_BROADCAST_BUTTON = "📢 Ommaviy xabar";
const TELEGRAM_MESSAGE_STATS_BUTTON = "📈 Xabar statistikasi";

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
  { title: "Yangi kolleksiya — 40% gacha chegirma", description: "Kiyim va poyabzal hafta davomida arzonroq.", icon: "shirt", bg: "linear-gradient(120deg,#F2A900,#17807A)", category: "kiyim" },
  { title: "Texnika bayrami", description: "Smartfon, noutbuk va quloqchinlar 12 oyga bo'lib to'lash bilan.", icon: "smartphone", bg: "linear-gradient(120deg,#25306B,#3E4FA8)", category: "elektronika" },
  { title: "Uyingiz uchun hammasi", description: "Idish-tovoq, yorug'lik va ro'zg'or buyumlari.", icon: "sofa", bg: "linear-gradient(120deg,#9A4A12,#D9812B)", category: "uy" }
];

const normPhone = s => {
  const d = String(s || "").replace(/[^\d+]/g, "");
  return /^\+?998\d{9}$/.test(d) ? "+" + d.replace("+", "") : null;
};
const fmtSum = n => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " so'm";
const htmlEscape = value => String(value).replace(/[&<>"']/g, character => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[character]));
const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

let db, users, sellers, products, orders, counters, slides, promos, promoUses, messages, reviews, messageCampaigns;

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
async function orderTelegramTargets(order) {
  const productIds = order.items.map(item => item.id);
  const productList = await products.find({ _id: { $in: productIds } }, {
    projection: { _id: 1, sellerId: 1, sellerStoreName: 1 }
  }).toArray();
  const productById = new Map(productList.map(product => [product._id, product]));
  const sellerIds = [...new Set(order.items.map(item =>
    item.sellerId || productById.get(item.id)?.sellerId
  ).filter(Boolean).map(String))].map(id => new ObjectId(id));
  const sellerList = sellerIds.length
    ? await sellers.find({ _id: { $in: sellerIds } }, {
      projection: { storeName: 1, telegramChatId: 1, status: 1 }
    }).toArray()
    : [];
  const sellerById = new Map(sellerList.map(seller => [String(seller._id), seller]));
  const groups = new Map();
  for (const item of order.items) {
    const product = productById.get(item.id);
    const sellerId = item.sellerId || product?.sellerId;
    if (!sellerId) {
      const group = groups.get("admin") || { key: "admin", chatId: TG_CHAT, kind: "admin", items: [] };
      group.items.push(item);
      groups.set("admin", group);
      continue;
    }
    const seller = sellerById.get(String(sellerId));
    if (!seller || seller.status !== "approved" || !seller.telegramChatId)
      throw new Error(`Sotuvchi Telegram botini ulab bo'lmagan: ${item.sellerStoreName || product?.sellerStoreName || seller?.storeName || sellerId}`);
    const key = `seller:${seller._id}`;
    const group = groups.get(key) || {
      key, chatId: seller.telegramChatId, kind: "seller",
      storeName: item.sellerStoreName || product?.sellerStoreName || seller.storeName, items: []
    };
    group.items.push(item);
    groups.set(key, group);
  }
  return [...groups.values()];
}

async function sendOrderToTelegram(o) {
  if (sending.has(o._id)) return;
  sending.add(o._id);
  try {
    const targets = await orderTelegramTargets(o);
    for (const target of targets) {
      const current = await orders.findOne({ _id: o._id }, { projection: { tgSentTo: 1 } });
      if (current?.tgSentTo?.includes(target.key)) continue;
      const lines = target.items.map(item => `• ${item.name} × ${item.q} = ${fmtSum(item.price * item.q)}`).join("\n");
      const subtotal = target.items.reduce((sum, item) => sum + item.price * item.q, 0);
      const title = target.kind === "seller"
        ? `Yangi buyurtma ${o._id}\nDo'kon: ${target.storeName}`
        : `Yangi buyurtma ${o._id}`;
      const text = `${title}\n\n${o.name}\n${o.phone}\n${o.city}, ${o.addr}\nTo'lov: ${o.pay}${o.promo ? "\nPromokod: " + o.promo : ""}\n\n${lines}\n\nMahsulotlar jami: ${fmtSum(subtotal)}`;
      await tgCall("sendMessage", { chat_id: target.chatId, text });
      await orders.updateOne({ _id: o._id }, { $addToSet: { tgSentTo: target.key } });
    }
    await orders.updateOne({ _id: o._id }, { $set: { tgSent: true } });
  } finally {
    sending.delete(o._id);
  }
}

const sellerApplicationsSending = new Set();
async function notifySellerApplication(seller) {
  if (sellerApplicationsSending.has(String(seller._id))) return;
  sellerApplicationsSending.add(String(seller._id));
  try {
    const sent = await tgCall("sendMessage", {
      chat_id: TG_CHAT,
      text: `Yangi sotuvchi arizasi\nDo'kon: ${seller.storeName}\nIsm: ${seller.name}\nEmail: ${seller.email}\nTelefon: ${seller.phone}\nManzil: ${seller.address}`,
      reply_markup: {
        inline_keyboard: [[
          { text: "✅ Tasdiqlash", callback_data: `seller:${seller._id}:approve` },
          { text: "❌ Rad etish", callback_data: `seller:${seller._id}:reject` }
        ]]
      }
    });
    await sellers.updateOne({ _id: seller._id, status: "pending" }, {
      $set: {
        telegramApplicationNotifiedAt: new Date(),
        telegramApplicationChatId: String(TG_CHAT),
        telegramApplicationMessageId: sent.result.message_id
      }
    });
    try {
      await tgCall("pinChatMessage", {
        chat_id: TG_CHAT, message_id: sent.result.message_id, disable_notification: true
      });
    } catch (error) {
      console.warn("Yangi sotuvchi xabarini pin qilib bo'lmadi:", error.message);
    }
  } finally {
    sellerApplicationsSending.delete(String(seller._id));
  }
}
async function flushSellerApplications() {
  try {
    const pending = await sellers.find({
      status: "pending", telegramApplicationNotifiedAt: { $exists: false }
    }).sort({ created: 1 }).limit(20).toArray();
    for (const seller of pending) {
      try { await notifySellerApplication(seller); }
      catch (error) { console.warn("Sotuvchi arizasi Telegramga yuborilmadi:", error.message); }
    }
  } catch (error) {
    console.warn("Sotuvchi arizalarini Telegramdan olishda xatolik:", error.message);
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
const telegramBroadcastFlows = new Set();
const telegramBroadcastDrafts = new Map();
const telegramKeyboard = {
  keyboard: [
    [{ text: TELEGRAM_USER_BUTTON }, { text: TELEGRAM_ORDER_BUTTON }],
    [{ text: TELEGRAM_PROMOS_BUTTON }, { text: TELEGRAM_ADD_PROMO_BUTTON }],
    [{ text: TELEGRAM_REPORT_BUTTON }, { text: TELEGRAM_MESSAGE_STATS_BUTTON }],
    [{ text: TELEGRAM_BROADCAST_BUTTON }]
  ],
  resize_keyboard: true,
  is_persistent: true
};
const telegramMenu = () => ({ text: "Kerakli qidiruv turini tanlang:", reply_markup: telegramKeyboard });
const telegramSend = (chatId, text, replyMarkup = telegramKeyboard) =>
  tgCall("sendMessage", { chat_id: chatId, text, reply_markup: replyMarkup });

function telegramPeriodRange(period, now = new Date()) {
  const offset = 5 * 60 * 60 * 1000;
  const localNow = new Date(now.getTime() + offset);
  const localStart = new Date(Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate()));
  if (period === "week") localStart.setUTCDate(localStart.getUTCDate() - ((localStart.getUTCDay() + 6) % 7));
  if (period === "month") localStart.setUTCDate(1);
  return {
    start: new Date(localStart.getTime() - offset),
    end: now,
    label: period === "today" ? "Bugun" : period === "week" ? "Shu hafta" : "Shu oy"
  };
}

async function showTelegramReport(chatId, period) {
  if (!["today", "week", "month"].includes(period))
    return telegramSend(chatId, "Hisobot davri noto'g'ri. /report today|week|month");
  const range = telegramPeriodRange(period);
  const match = { created: { $gte: range.start, $lte: range.end }, status: { $ne: "Bekor qilindi" } };
  const [summary, topProducts] = await Promise.all([
    orders.aggregate([
      { $match: match },
      { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: "$total" } } }
    ]).toArray(),
    orders.aggregate([
      { $match: match }, { $unwind: "$items" },
      { $group: { _id: "$items.name", quantity: { $sum: "$items.q" }, revenue: { $sum: { $multiply: ["$items.price", "$items.q"] } } } },
      { $sort: { quantity: -1 } }, { $limit: 5 }
    ]).toArray()
  ]);
  const totals = summary[0] || { orders: 0, revenue: 0 };
  const productsText = topProducts.length
    ? topProducts.map((product, index) => `${index + 1}. ${product._id} — ${product.quantity} dona`).join("\n")
    : "Sotuv bo'lmadi.";
  await telegramSend(chatId,
    `${range.label} hisoboti\nBuyurtmalar: ${totals.orders}\nTushum: ${fmtSum(totals.revenue)}\n\nKo'p sotilganlar:\n${productsText}`);
}

async function showTelegramReportMenu(chatId) {
  await telegramSend(chatId, "Hisobot davrini tanlang:", {
    inline_keyboard: [[
      { text: "Bugun", callback_data: "report:today" },
      { text: "Hafta", callback_data: "report:week" },
      { text: "Oy", callback_data: "report:month" }
    ]]
  });
}

async function showTelegramMessageStats(chatId) {
  const campaigns = await messageCampaigns.find().sort({ created: -1 }).limit(10).toArray();
  if (!campaigns.length) return telegramSend(chatId, "Hozircha ommaviy xabar kampaniyalari yo'q.");
  const lines = await Promise.all(campaigns.map(async campaign => {
    const [stats] = await messages.aggregate([
      { $match: { campaignId: campaign._id } },
      { $group: { _id: null, delivered: { $sum: 1 }, read: { $sum: { $cond: [{ $ne: ["$readAt", null] }, 1, 0] } } } }
    ]).toArray();
    const delivered = stats?.delivered || 0;
    const read = stats?.read || 0;
    const date = new Date(campaign.created).toLocaleString("uz-UZ");
    return `${date} · ${campaign.title}\nYetkazildi: ${delivered}/${campaign.recipientCount} · O'qildi: ${read}`;
  }));
  await telegramSend(chatId, `So'nggi ommaviy xabarlar:\n\n${lines.join("\n\n")}`);
}

async function sendTelegramBroadcast(chatId, draft) {
  const campaignId = new ObjectId();
  let recipients = [];
  let campaignCreated = false;
  try {
    recipients = await users.find({ role: "user" }, { projection: { _id: 1 } }).toArray();
    if (!recipients.length) return telegramSend(chatId, "Xabar yuborilmadi: foydalanuvchilar topilmadi.");
    await messageCampaigns.insertOne({
      _id: campaignId, title: draft.title, body: draft.body,
      recipientCount: recipients.length, sentCount: 0, status: "sending",
      created: new Date(), senderTelegramId: String(chatId)
    });
    campaignCreated = true;
    for (let offset = 0; offset < recipients.length; offset += 500) {
      const created = new Date();
      const batch = recipients.slice(offset, offset + 500).map(user => ({
        _id: new ObjectId(), userId: user._id, type: "admin",
        title: draft.title, body: draft.body, campaignId,
        readAt: null, created
      }));
      await messages.insertMany(batch);
      await messageCampaigns.updateOne({ _id: campaignId }, { $set: { sentCount: offset + batch.length } });
    }
    await messageCampaigns.updateOne({ _id: campaignId }, { $set: { status: "sent", sentAt: new Date() } });
  } catch (error) {
    const delivered = campaignCreated ? await messages.countDocuments({ campaignId }) : 0;
    if (campaignCreated) await messageCampaigns.updateOne({ _id: campaignId }, {
      $set: { status: delivered ? "partial" : "failed", sentCount: delivered, error: error.message.slice(0, 300) }
    });
    console.error("Telegram ommaviy xabari to'liq yuborilmadi:", error);
    await telegramSend(chatId, campaignCreated
      ? `Ommaviy xabar qisman yuborildi: ${delivered}/${recipients.length}. /messagestats orqali holatni tekshiring.`
      : "Ommaviy xabar yuborilmadi. Server logini tekshiring va qayta urinib ko'ring.");
    return;
  }
  await telegramSend(chatId,
    `Ommaviy xabar yuborildi.\nKampaniya: ${String(campaignId)}\nYetkazildi: ${recipients.length}/${recipients.length}\nO'qilganlar holatini /messagestats orqali ko'ring.`);
}

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

async function reviewSellerApplication(id, status, reviewedBy, telegramMessage = null) {
  if (!ObjectId.isValid(id)) return null;
  const selector = { _id: new ObjectId(id), status: "pending" };
  if (status === "approved") selector.emailVerifiedAt = { $exists: true, $ne: null };
  if (telegramMessage) {
    selector.telegramApplicationChatId = String(telegramMessage.chat.id);
    selector.telegramApplicationMessageId = telegramMessage.message_id;
  }
  return sellers.findOneAndUpdate(
    selector,
    { $set: { status, reviewedAt: new Date(), reviewedBy } },
    { returnDocument: "after" }
  );
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
  const [type, id, action] = String(callback.data || "").split(":");
  if (type === "seller" && ObjectId.isValid(id) && ["approve", "reject"].includes(action)) {
    if (String(callback.from?.id) !== TG_ADMIN_ID || String(callback.message?.chat?.id) !== String(TG_CHAT)) {
      await tgCall("answerCallbackQuery", { callback_query_id: callback.id, text: "Ruxsat yo'q." });
      return;
    }
    const status = action === "approve" ? "approved" : "rejected";
    const seller = await reviewSellerApplication(id, status, String(callback.from.id), callback.message);
    if (!seller) {
      await tgCall("answerCallbackQuery", { callback_query_id: callback.id, text: "Ariza topilmadi yoki allaqachon ko'rib chiqilgan." });
      return;
    }
    await tgCall("answerCallbackQuery", {
      callback_query_id: callback.id,
      text: status === "approved" ? "Sotuvchi tasdiqlandi." : "Ariza rad etildi."
    });
    await tgCall("editMessageText", {
      chat_id: callback.message.chat.id,
      message_id: callback.message.message_id,
      text: `${callback.message.text}\n\nHolat: ${status === "approved" ? "✅ Tasdiqlandi" : "❌ Rad etildi"}`,
      reply_markup: { inline_keyboard: [] }
    });
    return;
  }
  if (String(callback.from?.id) !== TG_ADMIN_ID || callback.message?.chat?.type !== "private") {
    await tgCall("answerCallbackQuery", { callback_query_id: callback.id, text: "Ruxsat yo'q." });
    return;
  }
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
  if (type === "report" && ["today", "week", "month"].includes(id)) {
    await tgCall("answerCallbackQuery", { callback_query_id: callback.id, text: "Hisobot tayyorlanmoqda." });
    await showTelegramReport(callback.message.chat.id, id);
    return;
  }
  if (type === "bc" && ["confirm", "cancel"].includes(id)) {
    const chatId = String(callback.message.chat.id);
    const draft = telegramBroadcastDrafts.get(chatId);
    if (!draft || draft.status !== "ready") {
      await tgCall("answerCallbackQuery", { callback_query_id: callback.id, text: "Tasdiqlash oynasi eskirgan." });
      return;
    }
    if (Date.now() - draft.created > 10 * 60 * 1000) {
      telegramBroadcastDrafts.delete(chatId);
      await tgCall("answerCallbackQuery", { callback_query_id: callback.id, text: "Tasdiqlash vaqti tugadi." });
      await telegramSend(chatId, "Ommaviy xabar tasdiqlash muddati tugadi. /broadcast bilan qaytadan boshlang.");
      return;
    }
    if (id === "cancel") {
      telegramBroadcastDrafts.delete(chatId);
      await tgCall("answerCallbackQuery", { callback_query_id: callback.id, text: "Bekor qilindi." });
      await telegramSend(chatId, "Ommaviy xabar bekor qilindi.");
      return;
    }
    draft.status = "sending";
    await tgCall("answerCallbackQuery", { callback_query_id: callback.id, text: "Yuborish boshlandi." });
    telegramBroadcastDrafts.delete(chatId);
    await sendTelegramBroadcast(chatId, draft);
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
  const text = message.text.trim();
  const match = text.match(/^\/([a-z]+)(?:@\w+)?(?:\s+([\s\S]+))?$/i);
  const command = match?.[1].toLowerCase();
  const inlineQuery = match?.[2]?.trim();
  if (command === "start" && /^link_[a-f0-9]{48}$/.test(inlineQuery || "")) {
    const sellerReply = text =>
      tgCall("sendMessage", { chat_id: message.chat.id, text, reply_markup: { remove_keyboard: true } });
    const tokenHash = crypto.createHash("sha256").update(inlineQuery.slice(5)).digest("hex");
    try {
      const seller = await sellers.findOneAndUpdate(
        {
          telegramLinkTokenHash: tokenHash,
          telegramLinkExpiresAt: { $gt: new Date() },
          status: "approved",
          telegramChatId: { $exists: false }
        },
        {
          $set: { telegramChatId: String(message.chat.id), telegramLinkedAt: new Date() },
          $unset: { telegramLinkTokenHash: "", telegramLinkExpiresAt: "" }
        },
        { returnDocument: "after" }
      );
      if (!seller) return sellerReply("Telegram ulash kodi eskirgan, ishlatilgan yoki sotuvchi arizasi hali tasdiqlanmagan. Saytdagi sotuvchi kabinetidan yangi havola oling.");
      return sellerReply(`Telegram ulandi!\n${seller.storeName} do'konining yangi buyurtmalari shu chatga yuboriladi.`);
    } catch (error) {
      if (error.code === 11000) return sellerReply("Bu Telegram akkaunti boshqa sotuvchiga ulangan.");
      throw error;
    }
  }
  if (String(message.from?.id) !== TG_ADMIN_ID) {
    if (text.startsWith("/")) await reply("Bu buyruqdan foydalanishga ruxsat yo'q.");
    return;
  }
  const chatId = String(message.chat.id);
  if (command) {
    telegramMessageFlows.delete(chatId);
    if (command !== "broadcast") {
      telegramBroadcastFlows.delete(chatId);
      telegramBroadcastDrafts.delete(chatId);
    }
  }
  if (["start", "help"].includes(command)) {
    telegramSearches.delete(String(message.chat.id));
    telegramPromoFlows.delete(String(message.chat.id));
    telegramBroadcastFlows.delete(chatId);
    telegramBroadcastDrafts.delete(chatId);
    await reply("Foydalanuvchi va buyurtmalarni boshqaring.\n\n/promos — promokodlar\n/addpromo — yangi kod\n/report today|week|month — savdo hisoboti\n/broadcast — barcha userlarga xabar yuborish\n/messagestats — xabar kampaniyalari statistikasi\n/cancel — joriy amalni bekor qilish");
    return;
  }
  if (command === "cancel") {
    telegramSearches.delete(chatId);
    telegramPromoFlows.delete(chatId);
    telegramMessageFlows.delete(chatId);
    telegramBroadcastFlows.delete(chatId);
    telegramBroadcastDrafts.delete(chatId);
    return reply("Joriy amal bekor qilindi.");
  }
  if (command === "report" || text === TELEGRAM_REPORT_BUTTON) {
    telegramSearches.delete(chatId);
    telegramPromoFlows.delete(chatId);
    telegramMessageFlows.delete(chatId);
    telegramBroadcastFlows.delete(chatId);
    telegramBroadcastDrafts.delete(chatId);
    if (inlineQuery) return showTelegramReport(chatId, inlineQuery.toLowerCase());
    return showTelegramReportMenu(chatId);
  }
  if (["messagestats", "xabarstatistika"].includes(command) || text === TELEGRAM_MESSAGE_STATS_BUTTON) {
    telegramSearches.delete(chatId);
    telegramPromoFlows.delete(chatId);
    telegramMessageFlows.delete(chatId);
    telegramBroadcastFlows.delete(chatId);
    telegramBroadcastDrafts.delete(chatId);
    return showTelegramMessageStats(chatId);
  }
  if (command === "broadcast" || text === TELEGRAM_BROADCAST_BUTTON) {
    telegramSearches.delete(chatId);
    telegramPromoFlows.delete(chatId);
    telegramMessageFlows.delete(chatId);
    telegramBroadcastDrafts.delete(chatId);
    telegramBroadcastFlows.add(chatId);
    return reply("Barcha foydalanuvchilarga yuboriladigan xabarni shu formatda yozing:\nSarlavha | Xabar matni\n\nXabar yuborishdan oldin qabul qiluvchilar soni va matnni tasdiqlaysiz. Bekor qilish uchun /cancel.");
  }
  if (telegramBroadcastFlows.has(chatId) && !command) {
    const separator = text.indexOf("|");
    const title = separator < 0 ? "" : text.slice(0, separator).trim();
    const body = separator < 0 ? "" : text.slice(separator + 1).trim();
    if (!title || !body || title.length > 100 || body.length > 2000)
      return reply("Format noto'g'ri yoki matn juda uzun. 100 belgigacha sarlavha va 2000 belgigacha matn yuboring:\nSarlavha | Xabar matni");
    const recipientCount = await users.countDocuments({ role: "user" });
    if (!recipientCount) {
      telegramBroadcastFlows.delete(chatId);
      return reply("Xabar yuborilmadi: foydalanuvchilar topilmadi.");
    }
    telegramBroadcastFlows.delete(chatId);
    telegramBroadcastDrafts.set(chatId, { title, body, recipientCount, status: "ready", created: Date.now() });
    return telegramSend(chatId,
      `Ommaviy xabarni tasdiqlang.\nQabul qiluvchilar: ${recipientCount}\n\nSarlavha: ${title}\n\n${body}`,
      { inline_keyboard: [[
        { text: `✅ Yuborish (${recipientCount})`, callback_data: "bc:confirm" },
        { text: "Bekor qilish", callback_data: "bc:cancel" }
      ]] });
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
    telegramMessageFlows.delete(chatId);
    telegramBroadcastFlows.delete(chatId);
    telegramBroadcastDrafts.delete(chatId);
    telegramSearches.delete(String(message.chat.id));
    telegramPromoFlows.delete(String(message.chat.id));
    return showTelegramPromos(message.chat.id);
  }
  if (["addpromo", "promokod"].includes(command) || text === TELEGRAM_ADD_PROMO_BUTTON) {
    telegramMessageFlows.delete(chatId);
    telegramBroadcastFlows.delete(chatId);
    telegramBroadcastDrafts.delete(chatId);
    telegramSearches.delete(chatId);
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
const sellerOut = seller => ({
  id: String(seller._id), name: seller.name, phone: seller.phone, email: seller.email,
  storeName: seller.storeName, address: seller.address, status: seller.status,
  emailVerified: !!seller.emailVerifiedAt, telegramLinked: !!seller.telegramChatId
});
function readSellerProfile(body, defaultName) {
  const name = String(body.name || defaultName || "").trim().slice(0, 80);
  const phone = normPhone(body.phone);
  const storeName = String(body.storeName || "").trim().slice(0, 100);
  const address = String(body.address || "").trim().slice(0, 250);
  if (name.length < 2) throw new Error("Ism-familiyani kiriting.");
  if (!phone) throw new Error("Telefon raqami noto'g'ri.");
  if (!storeName) throw new Error("Do'kon nomini kiriting.");
  if (address.length < 5) throw new Error("Do'kon manzilini to'liq kiriting.");
  return { name, phone, storeName, address };
}
const productOut = p => ({ id: p._id, name: p.name, cat: p.cat, price: p.price, old: p.old, rating: p.rating,
  sold: p.sold, icon: p.icon, color: p.color, image: p.image ? `/api/products/${p._id}/image` : null,
  desc: p.descr, stock: p.stock, active: !!p.active, sellerStoreName: p.sellerStoreName || null });
async function publicProductListOut(list) {
  const sellerIds = [...new Map(list.filter(product => product.sellerId && !product.sellerStoreName)
    .map(product => [String(product.sellerId), product.sellerId])).values()];
  const storeNames = sellerIds.length
    ? new Map((await sellers.find({ _id: { $in: sellerIds } }, { projection: { storeName: 1 } }).toArray())
      .map(seller => [String(seller._id), seller.storeName]))
    : new Map();
  return list.map(product => ({
    ...productOut(product),
    sellerStoreName: product.sellerStoreName || storeNames.get(String(product.sellerId)) || null
  }));
}
const orderOut = o => ({ id: o._id, name: o.name, phone: o.phone, city: o.city, addr: o.addr, pay: o.pay,
  total: o.total, promo: o.promo, status: o.status,
  items: o.items.map(({ id, name, icon, q, price }) => ({ id, name, icon, q, price })),
  created: o.created.toISOString(), tgSent: !!o.tgSent });

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
        const isSellerToken = t.role === "seller";
        if (isSellerToken && !req.originalUrl.startsWith("/api/seller/")) {
          if (required) return res.status(403).json({ error: "Bu sahifaga sotuvchi akkaunti bilan kirib bo'lmaydi." });
          return next();
        }
        const u = await (isSellerToken ? sellers : users).findOne({ _id: new ObjectId(t.id) });
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
const sellerOnly = (req, res, next) =>
  req.user && req.user.role === "seller" ? next() : res.status(403).json({ error: "Sotuvchi akkaunti talab qilinadi." });

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
const sellerAuthLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false,
  message: { error: "Juda ko'p urinish. Bir soatdan keyin qayta urinib ko'ring." } });
const orderLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false,
  message: { error: "Juda ko'p buyurtma. Keyinroq urinib ko'ring." } });

// ---- Ochiq API ----
app.get("/api/health", (req, res) => res.json({ ok: true }));
app.get("/api/categories", (req, res) => res.json(CATEGORIES));
app.get("/api/slides", ah(async (req, res) =>
  res.json((await slides.find().sort({ created: 1, _id: 1 }).toArray()).map(s => ({
    id: String(s._id), title: s.title, description: s.description, category: s.category || null,
    icon: s.icon || "sparkles", bg: s.bg || "linear-gradient(120deg,#F2A900,#17807A)",
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
  res.json(await publicProductListOut(await products.find({ active: true }).sort({ sold: -1 }).toArray()))));
app.get("/api/products/:id/reviews", auth(false), ah(async (req, res) => {
  const productId = Number(req.params.id);
  if (!Number.isSafeInteger(productId)) return res.status(404).json({ error: "Mahsulot topilmadi." });
  const product = await products.findOne({ _id: productId, active: true }, { projection: { _id: 1 } });
  if (!product) return res.status(404).json({ error: "Mahsulot topilmadi." });
  const [list, totals, myReview, eligible] = await Promise.all([
    reviews.find({ productId, status: "approved", purchaseVerified: true }).sort({ created: -1 }).limit(50).toArray(),
    reviews.aggregate([
      { $match: { productId, status: "approved", purchaseVerified: true } },
      { $group: { _id: null, count: { $sum: 1 }, average: { $avg: "$rating" } } }
    ]).toArray(),
    req.user?.role === "user" ? reviews.findOne({ productId, userId: req.user._id, purchaseVerified: true }) : null,
    req.user?.role === "user" ? orders.findOne({
      userId: req.user._id, status: "Yetkazildi", "items.id": productId
    }, { projection: { _id: 1 } }) : null
  ]);
  const average = totals[0] ? Math.round(totals[0].average * 10) / 10 : 0;
  res.json({
    count: totals[0]?.count || 0, average,
    reviews: list.map(review => ({
      id: String(review._id), name: review.userName, rating: review.rating,
      body: review.body, created: review.created
    })),
    myReview: myReview ? { status: myReview.status, rating: myReview.rating, body: myReview.body } : null,
    eligible: !!eligible
  });
}));
app.post("/api/products/:id/reviews", auth(), ah(async (req, res) => {
  const productId = Number(req.params.id);
  const rating = Number(req.body.rating);
  const body = String(req.body.body || "").trim();
  if (!Number.isSafeInteger(productId)) return res.status(404).json({ error: "Mahsulot topilmadi." });
  if (req.user.role !== "user") return res.status(403).json({ error: "Sharhni faqat foydalanuvchi akkaunti bilan yuborish mumkin." });
  if (!Number.isInteger(rating) || rating < 1 || rating > 5)
    return res.status(400).json({ error: "Bahoni 1 dan 5 gacha tanlang." });
  if (body.length < 5 || body.length > 1000)
    return res.status(400).json({ error: "Sharh 5 dan 1000 belgigacha bo'lishi kerak." });
  const product = await products.findOne({ _id: productId, active: true }, { projection: { _id: 1 } });
  if (!product) return res.status(404).json({ error: "Mahsulot topilmadi." });
  const eligible = await orders.findOne({
    userId: req.user._id, status: "Yetkazildi", "items.id": productId
  }, { projection: { _id: 1 } });
  if (!eligible)
    return res.status(403).json({ error: "Sharh faqat shu mahsulot buyurtmangizda bo'lib, holati «Yetkazildi» bo'lganda yoziladi." });
  const existing = await reviews.findOne({ productId, userId: req.user._id });
  if (existing) {
    if (!existing.purchaseVerified) {
      await reviews.updateOne({ _id: existing._id }, {
        $set: { rating, body, status: "pending", purchaseVerified: true, updated: new Date() }
      });
      return res.json({ ok: true, status: "pending" });
    }
    if (existing.status !== "pending")
      return res.status(409).json({ error: "Bu mahsulotga sharh allaqachon yuborilgan." });
    await reviews.updateOne({ _id: existing._id, status: "pending" }, {
      $set: { rating, body, purchaseVerified: true, updated: new Date() }
    });
    return res.json({ ok: true, status: "pending" });
  }
  try {
    await reviews.insertOne({
      _id: new ObjectId(), productId, userId: req.user._id,
      userCode: req.user.userCode, userName: req.user.name,
      rating, body, status: "pending", purchaseVerified: true, created: new Date()
    });
  } catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: "Bu mahsulotga sharh allaqachon yuborilgan." });
    throw error;
  }
  res.json({ ok: true, status: "pending" });
}));
app.get("/api/products/:id/image", ah(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id)) return res.status(404).end();
  const p = await products.findOne({ _id: id }, { projection: { image: 1 } });
  if (!p || !p.image) return res.status(404).end();
  res.set({ "Content-Type": p.image.contentType, "Cache-Control": "no-cache" });
  res.send(Buffer.from(p.image.data, "base64"));
}));

app.get("/api/seller/google-config", (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.status(503).json({ error: "Google orqali kirish sozlanmagan." });
  res.json({ clientId: GOOGLE_CLIENT_ID });
});

app.post("/api/seller/google", sellerAuthLimiter, ah(async (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.status(503).json({ error: "Google orqali kirish sozlanmagan." });
  const credential = typeof req.body.credential === "string" ? req.body.credential : "";
  if (!credential || credential.length > 10000)
    return res.status(400).json({ error: "Google tokeni noto'g'ri." });
  let googleUser;
  try {
    const ticket = await googleOAuthClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload?.sub || !payload.email || payload.email_verified !== true)
      return res.status(401).json({ error: "Google akkaunt emaili tasdiqlanmagan." });
    googleUser = {
      sub: payload.sub,
      email: payload.email.trim().toLowerCase(),
      name: String(payload.name || "").trim().slice(0, 80)
    };
  } catch {
    return res.status(401).json({ error: "Google orqali tasdiqlash amalga oshmadi. Qayta urinib ko'ring." });
  }

  let seller = await sellers.findOne({ email: googleUser.email });
  const profileSubmitted = req.body.profileSubmitted === true;
  if (!seller) {
    if (!profileSubmitted) {
      return res.json({
        needsProfile: true, email: googleUser.email, name: googleUser.name
      });
    }
    let profile;
    try { profile = readSellerProfile(req.body, googleUser.name); }
    catch (error) { return res.status(400).json({ error: error.message }); }
    const doc = {
      _id: new ObjectId(), role: "seller", ...profile, email: googleUser.email,
      googleSub: googleUser.sub, emailVerifiedAt: new Date(),
      status: "pending", tokenVersion: 0, created: new Date()
    };
    try {
      await sellers.insertOne(doc);
      seller = doc;
    } catch (error) {
      if (error.code === 11000)
        return res.status(409).json({ error: "Bu telefon raqami allaqachon sotuvchi akkauntida ishlatilgan." });
      throw error;
    }
    notifySellerApplication(seller).catch(error =>
      console.warn("Telegramga sotuvchi arizasi yuborilmadi:", error.message));
    const token = jwt.sign({ id: String(seller._id), role: "seller", ver: seller.tokenVersion || 0 }, SECRET, { expiresIn: "30d" });
    return res.status(201).json({ token, seller: sellerOut(seller) });
  } else {
    if (seller.googleSub && seller.googleSub !== googleUser.sub)
      return res.status(401).json({ error: "Google akkaunt mos kelmadi." });
    let updates = {};
    if (!seller.googleSub) updates.googleSub = googleUser.sub;
    if (!seller.emailVerifiedAt) updates.emailVerifiedAt = new Date();
    if (!seller.phone || !seller.storeName || !seller.address) {
      if (!profileSubmitted)
        return res.json({ needsProfile: true, email: seller.email, name: seller.name || googleUser.name });
      try { updates = { ...updates, ...readSellerProfile(req.body, googleUser.name) }; }
      catch (error) { return res.status(400).json({ error: error.message }); }
    }
    if (Object.keys(updates).length) {
      await sellers.updateOne({ _id: seller._id }, { $set: updates });
      seller = { ...seller, ...updates };
    }
  }

  const token = jwt.sign({ id: String(seller._id), role: "seller", ver: seller.tokenVersion || 0 }, SECRET, { expiresIn: "30d" });
  res.json({ token, seller: sellerOut(seller) });
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
  const items = found.map(p => ({
    id: p._id, name: p.name, icon: p.icon, q: qty.get(p._id), price: p.price,
    ...(p.sellerId ? {
      sellerId: String(p.sellerId),
      sellerStoreName: p.sellerStoreName || null
    } : {})
  }));
  try { await orderTelegramTargets({ items }); }
  catch (error) { return res.status(409).json({ error: "Buyurtmani qabul qilib bo'lmadi. " + error.message }); }
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

admin.get("/sellers", ah(async (req, res) => {
  const list = await sellers.find({ status: "pending" }).sort({ created: 1 }).limit(200).toArray();
  res.json(list.map(sellerOut));
}));

admin.patch("/sellers/:id", ah(async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Sotuvchi ID noto'g'ri." });
  if (!["approved", "rejected"].includes(req.body.status))
    return res.status(400).json({ error: "Sotuvchi holati noto'g'ri." });
  const result = await reviewSellerApplication(req.params.id, req.body.status, req.user._id);
  if (!result) return res.status(409).json({ error: "Sotuvchi topilmadi yoki email hali tasdiqlanmagan." });
  res.json(sellerOut(result));
}));

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

admin.get("/reviews", ah(async (req, res) => {
  const list = await reviews.find({ status: "pending", purchaseVerified: true }).sort({ created: 1 }).limit(200).toArray();
  const productIds = [...new Set(list.map(review => review.productId))];
  const productList = await products.find({ _id: { $in: productIds } }, { projection: { name: 1 } }).toArray();
  const names = new Map(productList.map(product => [product._id, product.name]));
  res.json(list.map(review => ({
    id: String(review._id), productId: review.productId,
    productName: names.get(review.productId) || "O'chirilgan mahsulot",
    userName: review.userName, userCode: review.userCode,
    rating: review.rating, body: review.body, created: review.created
  })));
}));

admin.patch("/reviews/:id", ah(async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Sharh ID noto'g'ri." });
  if (req.body.status !== "approved") return res.status(400).json({ error: "Sharh holati noto'g'ri." });
  const result = await reviews.updateOne(
    { _id: new ObjectId(req.params.id), status: "pending", purchaseVerified: true },
    { $set: { status: "approved", moderatedAt: new Date() } }
  );
  if (!result.modifiedCount) return res.status(404).json({ error: "Tasdiqlanmagan sharh topilmadi." });
  res.json({ ok: true });
}));

admin.delete("/reviews/:id", ah(async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) return res.status(400).json({ error: "Sharh ID noto'g'ri." });
  const result = await reviews.deleteOne({ _id: new ObjectId(req.params.id), status: "pending", purchaseVerified: true });
  if (!result.deletedCount) return res.status(404).json({ error: "Tasdiqlanmagan sharh topilmadi." });
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

const sellerRouter = express.Router();
sellerRouter.use(auth(), sellerOnly);
sellerRouter.get("/me", (req, res) => res.json(sellerOut(req.user)));
sellerRouter.post("/telegram-link", ah(async (req, res) => {
  if (req.user.status !== "approved")
    return res.status(403).json({ error: "Telegram botni faqat tasdiqlangan sotuvchi ulay oladi." });
  if (req.user.telegramChatId)
    return res.status(409).json({ error: "Telegram bot allaqachon ulangan." });
  if (!telegramBotUsername)
    return res.status(503).json({ error: "Telegram bot hozircha tayyor emas. Birozdan so'ng qayta urinib ko'ring." });
  const rawToken = crypto.randomBytes(24).toString("hex");
  const updated = await sellers.updateOne(
    { _id: req.user._id, status: "approved", telegramChatId: { $exists: false } },
    {
      $set: {
        telegramLinkTokenHash: crypto.createHash("sha256").update(rawToken).digest("hex"),
        telegramLinkExpiresAt: new Date(Date.now() + 10 * 60 * 1000)
      }
    }
  );
  if (!updated.matchedCount)
    return res.status(409).json({ error: "Telegram bot allaqachon ulangan yoki sotuvchi holati o'zgargan. Sahifani yangilang." });
  res.json({ botUrl: `https://t.me/${telegramBotUsername}?start=link_${rawToken}` });
}));
sellerRouter.get("/products", ah(async (req, res) =>
  res.json((await products.find({ sellerId: req.user._id }).sort({ _id: -1 }).toArray()).map(productOut))));
sellerRouter.post("/products", ah(async (req, res) => {
  if (req.user.status !== "approved")
    return res.status(403).json({ error: "Mahsulot qo'shish uchun admin tasdig'ini kuting." });
  if (!req.user.telegramChatId)
    return res.status(403).json({ error: "Avval sotuvchi kabinetidan Telegram botni ulang." });
  let product, image;
  try {
    product = readProduct({ ...req.body, active: true });
    if (req.body.image) image = readProductImage(req.body.image);
  } catch (error) { return res.status(400).json({ error: error.message }); }
  const doc = {
    _id: await nextProductId(), ...product, active: true, sellerId: req.user._id,
    sellerStoreName: req.user.storeName,
    ...(image ? { image } : {}), rating: 0, sold: 0, created: new Date()
  };
  await products.insertOne(doc);
  res.status(201).json(productOut(doc));
}));
sellerRouter.put("/products/:id", ah(async (req, res) => {
  if (req.user.status !== "approved")
    return res.status(403).json({ error: "Sotuvchi akkauntingiz faol emas." });
  let product, image;
  try {
    product = readProduct({ ...req.body, active: true });
    if (req.body.image) image = readProductImage(req.body.image);
  } catch (error) { return res.status(400).json({ error: error.message }); }
  const removeImage = req.body.removeImage === true || req.body.removeImage === "true";
  const update = { $set: { ...product, active: true }, ...(image ? {} : removeImage ? { $unset: { image: "" } } : {}) };
  if (image) update.$set.image = image;
  const result = await products.findOneAndUpdate(
    { _id: Number(req.params.id), sellerId: req.user._id }, update, { returnDocument: "after" }
  );
  if (!result) return res.status(404).json({ error: "Mahsulot topilmadi." });
  res.json(productOut(result));
}));
sellerRouter.delete("/products/:id", ah(async (req, res) => {
  if (req.user.status !== "approved")
    return res.status(403).json({ error: "Sotuvchi akkauntingiz faol emas." });
  const result = await products.deleteOne({ _id: Number(req.params.id), sellerId: req.user._id });
  if (!result.deletedCount) return res.status(404).json({ error: "Mahsulot topilmadi." });
  res.json({ ok: true });
}));

app.use("/api/seller", sellerRouter);
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
    telegramBotUsername = me.result.username;
    console.log("Telegram bot ulandi: @" + telegramBotUsername);
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
  users = db.collection("users"); sellers = db.collection("sellers"); products = db.collection("products");
  orders = db.collection("orders"); counters = db.collection("counters");
  slides = db.collection("slides"); promos = db.collection("promos"); promoUses = db.collection("promoUses");
  messages = db.collection("messages"); reviews = db.collection("reviews");
  messageCampaigns = db.collection("messageCampaigns");
  await users.createIndex({ phone: 1 }, { unique: true });
  await sellers.createIndex({ email: 1 }, { unique: true });
  await sellers.createIndex({ phone: 1 }, { unique: true });
  await sellers.createIndex({ telegramChatId: 1 }, { unique: true, sparse: true });
  await sellers.createIndex({ telegramLinkTokenHash: 1 }, { unique: true, sparse: true });
  await sellers.createIndex({ status: 1, created: 1 });
  await migrateUserCodes();
  await orders.createIndex({ userId: 1, created: -1 });
  await orders.createIndex({ tgSent: 1, created: 1 });
  await products.createIndex({ active: 1, sold: -1 });
  await slides.createIndex({ created: 1 });
  await promos.createIndex({ code: 1 }, { unique: true });
  await promoUses.createIndex({ code: 1, uses: -1 });
  await messages.createIndex({ userId: 1, created: -1 });
  await messages.createIndex({ userId: 1, readAt: 1 });
  await reviews.createIndex({ productId: 1, userId: 1 }, { unique: true });
  await reviews.createIndex({ status: 1, created: 1 });
  await messageCampaigns.createIndex({ created: -1 });
  await messages.createIndex({ campaignId: 1, readAt: 1 });

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
  flushSellerApplications();
  setInterval(flushSellerApplications, 60 * 1000).unref();
  pollTelegram();

  app.listen(PORT, () => console.log(`Xaridor ishlayapti: http://localhost:${PORT}  (admin: /admin.html)`));
}
main().catch(e => { console.error(e); process.exit(1); });
