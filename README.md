# Xaridor — onlayn bozor (Node.js + MongoDB + Telegram)

## 1. Kerakli hisoblar
- **MongoDB Atlas** (bepul M0): mongodb.com/atlas
  1. Klaster yarating.
  2. *Database Access*: foydalanuvchi va parol yarating.
  3. *Network Access*: `0.0.0.0/0` ni ruxsat eting (Render IP si o'zgarib turadi).
  4. *Connect > Drivers* dan ulanish manzilini (`mongodb+srv://...`) oling. Parol maxsus belgilarga ega bo'lsa, URL-kodlang.
- **Telegram bot** (MAJBURIY): @BotFather > /newbot > tokenni oling. Botga /start yozing.
  Chat ID: @userinfobot ga yozing, u sizning ID ingizni aytadi. Guruhga yuborish uchun botni guruhga qo'shing
  (guruh ID si manfiy son bo'ladi).

## 2. Lokal ishga tushirish
```
npm install
cp .env.example .env      # Windows: copy .env.example .env
# .env ni to'ldiring
npm start
```
Sayt: http://localhost:3000 · Admin: http://localhost:3000/admin.html

`MONGODB_URI`, `JWT_SECRET`, `TG_BOT_TOKEN`, `TG_CHAT_ID` bo'lmasa server ishga tushmaydi.
Birinchi ishga tushishda 24 ta namuna mahsulot va admin akkaunt yaratiladi.

## 3. Render ga qo'yish
1. Loyihani GitHub ga yuklang (`.env` ni yuklamang, `.gitignore` da bor).
2. Render > New > Web Service > repozitoriyni tanlang.
   Build Command: `npm install` · Start Command: `npm start`
3. *Environment* bo'limiga `.env.example` dagi hamma qiymatlarni kiriting.
4. Baza Atlas da turgani uchun Render da disk kerak emas.
5. Bepul tarifda sayt 15 daqiqa so'rovsiz qolsa uxlaydi. UptimeRobot / cron-job.org dan
   `https://SAYT.onrender.com/api/health` manziliga har 10 daqiqada so'rov yuboring.

## 4. Telegram
- Har bir buyurtma saqlangach botga yuboriladi. Telegram vaqtincha ishlamasa, buyurtma yo'qolmaydi:
  server uni belgilab qo'yadi va har daqiqada qayta yuboradi.
- Admin panelda "Telegramni tekshirish" tugmasi sinov xabarini yuboradi,
  statistikada yuborilmay qolgan buyurtmalar soni ko'rinadi.
- Admin botdagi **Foydalanuvchini qidirish** yoki **Buyurtmani qidirish** tugmasi orqali foydalanuvchini telefon/7 belgili ID bilan, buyurtmani esa `XR1234567` raqami bilan topadi. Buyurtma holatini botdagi tugmalar orqali o'zgartirish, foydalanuvchi ma'lumotlari va so'nggi buyurtmalarini ko'rish, hisobini bloklash yoki blokdan chiqarish mumkin. `/help` menyuni ko'rsatadi.
- Bot qidiruviga ruxsat berilgan Telegram akkauntining ID sini `TG_ADMIN_ID` ga kiriting. Bu sozlama bo'sh bo'lsa, `TG_CHAT_ID` ishlatiladi; guruh chatidan qidiruv bajarilmaydi.

## 5. Moslash
- Brend nomi: `public/index.html`, `public/admin.html`, `public/logo.svg`.
- Ranglar: `public/style.css` boshidagi `:root`.
- Promokodlar: `server.js` (`PROMO`) va `public/app.js` (`PROMO`) ichida bir xil bo'lsin: XARID10, YANGI5.
- Ikonlar: `public/icons.js`. Admin panelda mahsulotga ro'yxatdan ikon tanlanadi.
- Mahsulot qo'shish yoki tahrirlashda 5 MB gacha JPG, PNG va WebP rasmlarni yuklash mumkin; ular MongoDB da saqlanadi.

## Cheklovlar
- Onlayn to'lov (Payme, Click, Uzum Bank) ulanmagan: to'lov usuli buyurtmada saqlanadi, xolos.
- Mahsulot rasmlari ixtiyoriy; rasm yuklanmagan mahsulotlarda ikon ko'rsatiladi.
