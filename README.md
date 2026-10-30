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
- Admin botdagi **Foydalanuvchini qidirish** yoki **Buyurtmani qidirish** tugmasi orqali foydalanuvchini telefon/7 belgili ID bilan, buyurtmani esa `XR1234567` raqami bilan topadi. Buyurtma holatini botdagi tugmalar orqali o'zgartirish, foydalanuvchi ma'lumotlari va so'nggi buyurtmalarini ko'rish, hisobini bloklash yoki blokdan chiqarish mumkin. `/report today|week|month` savdo hisobotini, `/messagestats` esa ommaviy xabar kampaniyalari bo'yicha saytga yetkazilgan va o'qilgan xabarlar sonini ko'rsatadi. `/help` barcha buyruqlarni ko'rsatadi.
- Bot admini `/promos` bilan promokodlarni ko'radi, `/addpromo` bilan yangi kod qo'shadi; bot tugmalari orqali kodni yoqish/o'chirish va o'chirish mumkin. Kod formati: `KOD percent|fixed MIQDOR SANA|- JAMI|- USER|- MIN|-`; masalan, `BAHOR10 percent 10 2027-03-31 100 1 200000`. `MIN` — minimal savdo summasi, `JAMI` — umumiy qo'llashlar soni, `USER` — bir foydalanuvchiga limit.
- Buyurtma holati o'zgarganda foydalanuvchiga xabarlar bo'limida bildirishnoma saqlanadi. Admin paneldagi **Xabar yuborish** bo'limidan ism, telefon yoki ID bilan foydalanuvchini topib shaxsiy xabar yuborish mumkin. Telegram botda foydalanuvchini qidirib, **Xabar yuborish** tugmasi bilan `Sarlavha | Xabar matni` formatida shaxsiy xabar jo'natish mumkin. `/broadcast` barcha saytdagi foydalanuvchilarga ommaviy xabar tayyorlaydi; bot yuborishdan oldin qabul qiluvchilar soni va matnni ko'rsatib tasdiq so'raydi. Ommaviy xabar saytning xabarlar qutisiga saqlanadi; shu sababli "yetkazildi" soni saytdagi qutiga muvaffaqiyatli saqlangan xabarlarni, "o'qildi" esa foydalanuvchi xabarni ochganini bildiradi. `/cancel` joriy amalni bekor qiladi. Foydalanuvchi qayta kirganda o'qilmagan xabar haqida ekran chetida bildirishnoma ko'radi va uni bosib aynan shu xabarni ochadi; xabarlar ro'yxatidagi sarlavha ham alohida oynada xabarni ochadi.
- Foydalanuvchi parolni unutsa, saytdagi support tugmasi orqali [@habibullayev_28](https://t.me/habibullayev_28) ga murojaat qiladi. Botda foydalanuvchini topgach, admin vaqtinchalik parol berishi mumkin; asl parol ko'rinmaydi va user vaqtinchalik parol bilan kirgach yangisini o'rnatishi shart.
- Bot qidiruviga ruxsat berilgan Telegram akkauntining ID sini `TG_ADMIN_ID` ga kiriting. Bu sozlama bo'sh bo'lsa, `TG_CHAT_ID` ishlatiladi; guruh chatidan qidiruv bajarilmaydi.

## 5. Moslash
- Banner slaydlari admin panelning **Slaydlar** bo'limida boshqariladi; JPG, PNG yoki WebP (5 MB gacha) yuklash mumkin.
- Promokodlar admin panelning **Promokodlar** bo'limida ham boshqariladi. Foizli yoki belgilangan summadagi chegirma, tugash sanasi, jami va foydalanuvchi boshiga limit hamda minimal savdo summasi sozlanadi.
- Faqat akkauntiga tegishli buyurtmada mahsulot bor va buyurtma holati **Yetkazildi** bo'lgan foydalanuvchi baho va sharh yubora oladi. Sharh admin paneldagi **Sharhlar** bo'limida tasdiqlangandan keyin ommaga ko'rinadi. Bir foydalanuvchi har bir mahsulotga bitta sharh qoldiradi.
- Foydalanuvchi buyurtmalarida holatlar bosqichma-bosqich ko'rsatiladi. **Qayta xarid qilish** oldingi buyurtmadan omborda bor mahsulotlarni savatga qo'shadi.
- Brend nomi: `public/index.html`, `public/admin.html`, `public/logo.svg`.
- Ranglar: `public/style.css` boshidagi `:root`.
- Dastlabki promokodlar bazaga bir marta XARID10 va YANGI5 sifatida qo'shiladi; keyin admin panel yoki Telegram botdan boshqariladi. XARID10 faqat akkauntning birinchi buyurtmasida va bir marta amal qiladi.
- Ikonlar: `public/icons.js`. Admin panelda mahsulotga ro'yxatdan ikon tanlanadi.
- Mahsulot qo'shish yoki tahrirlashda 5 MB gacha JPG, PNG va WebP rasmlarni yuklash mumkin; ular MongoDB da saqlanadi.

## Cheklovlar
- Onlayn to'lov (Payme, Click, Uzum Bank) ulanmagan: to'lov usuli buyurtmada saqlanadi, xolos.
- Mahsulot rasmlari ixtiyoriy; rasm yuklanmagan mahsulotlarda ikon ko'rsatiladi.
