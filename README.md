# Xaridor — onlayn bozor (Node.js + MongoDB + Telegram)

## 1. Kerakli hisoblar
- **MongoDB Atlas** (bepul M0): mongodb.com/atlas
  1. Klaster yarating.
  2. *Database Access*: foydalanuvchi va parol yarating.
  3. *Network Access*: `0.0.0.0/0` ni ruxsat eting (Render IP si o'zgarib turadi).
  4. *Connect > Drivers* dan ulanish manzilini (`mongodb+srv://...`) oling. Parol maxsus belgilarga ega bo'lsa, URL-kodlang.
- **Telegram bot** (MAJBURIY): @BotFather > /newbot > tokenni oling. Botga /start yozing.
  Chat ID: @userinfobot ga yozing, u sizning ID ingizni aytadi. Guruhga yuborish uchun botni guruhga qo'shing
  (guruh ID si manfiy son bo'ladi). Sotuvchi arizalarini pin qilish uchun botga guruhda xabar pinlash huquqini bering.

## 2. Lokal ishga tushirish
```
npm install
cp .env.example .env      # Windows: copy .env.example .env
# .env ni to'ldiring
npm start
```
Sayt: http://localhost:3000 · Admin: http://localhost:3000/admin.html
Sotuvchi kabineti: http://localhost:3000/seller.html

`MONGODB_URI`, `JWT_SECRET`, `TG_BOT_TOKEN`, `TG_CHAT_ID` bo'lmasa server ishga tushmaydi.
Birinchi ishga tushishda 24 ta namuna mahsulot va admin akkaunt yaratiladi.

Sotuvchi kabinetida Google orqali kirish ishlashi uchun Google OAuth Client ID kerak.
Google Cloud Console'da OAuth Client ID (Web application) yarating, saytingiz manzilini
**Authorized JavaScript origins** ga kiriting (`http://localhost:3000` lokal sinov uchun),
so'ng Client ID'ni `.env` yoki hosting Environment bo'limidagi `GOOGLE_CLIENT_ID` ga yozing.
Google akkaunt emailni o'zi tekshiradi; sayt Google parolini so'ramaydi va tasdiqlash kodini emailga yubormaydi.

## 3. Render ga qo'yish
1. Loyihani GitHub ga yuklang (`.env` ni yuklamang, `.gitignore` da bor).
2. Render > New > Web Service > repozitoriyni tanlang.
   Build Command: `npm install` · Start Command: `npm start`
3. *Environment* bo'limiga `.env.example` dagi hamma qiymatlarni kiriting.
   `GOOGLE_CLIENT_ID` ni yaratilgan OAuth Web Client ID bilan to'ldiring.
4. Baza Atlas da turgani uchun Render da disk kerak emas.
5. Bepul tarifda sayt 15 daqiqa so'rovsiz qolsa uxlaydi. UptimeRobot / cron-job.org dan
   `https://SAYT.onrender.com/api/health` manziliga har 10 daqiqada so'rov yuboring.

## 4. Telegram
- Xaridorlar `/start` bilan mahsulotlar katalogi, nom bo'yicha qidiruv va yordam menyusini oladi. Katalog va qidiruv natijalari raqamlangan inline tugmalar bilan ko'rsatiladi; mahsulot tanlanganda tafsiloti chiqadi va "Saytda sotib olish" aniq mahsulot sahifasini ochadi. Sayt manzili `.env` dagi ixtiyoriy `PUBLIC_SITE_URL` dan, Render'da esa `RENDER_EXTERNAL_URL` dan olinadi. Xaridor menyusida admin yoki sotuvchi amallari ko'rsatilmaydi.
- Telegram Bot API 9.4+ qo'llaydigan `icon_custom_emoji_id` va `style` maydonlari Reply hamda inline tugmalarda ishlatiladi; xaridor menyusida asosiy va muvaffaqiyat ranglari, tasdiqlash/bekor qilish amallarida mos ranglar qo'llanadi.
- Sotuvchi mahsuloti buyurtma qilinsa, faqat tegishli sotuvchiga; saytning o'z mahsuloti buyurtma qilinsa admin Telegramiga yuboriladi. Aralash savatda xabarlar tegishli qismlarga ajratiladi. Telegram vaqtincha ishlamasa, buyurtma yo'qolmaydi: server uni belgilab qo'yadi va har daqiqada qayta yuboradi. Sotuvchi Telegramini ulab olmaguncha uning mahsulotiga buyurtma berish bloklanadi.
- Sotuvchi botda faqat o'ziga tegishli mahsulot va buyurtmalarni boshqaradi; admin buyruqlari va tugmalari sotuvchi chatiga yuborilmaydi. **Mahsulot ID** va **Buyurtma ID** tugmalari orqali yozuvni qidiradi. Mahsulotni faollashtirish/yashirish, nomi, kategoriya IDsi, narxi, eski narxi, ombori, tavsifi, teglari va rasmini o'zgartirish mumkin. Matnli tahrir formati: `Nomi | Kategoriya ID | Narxi | Eski narxi | Ombor | Tavsif | Teglar (ixtiyoriy)`; rasm uchun JPG, PNG yoki WebP yuboring (5 MB gacha).
- Sotuvchi saytdagi kabinetda ham buyurtmani `XR1234567` IDsi bilan qidirib holatini o'zgartiradi, mahsulotni ID bo'yicha topadi, tahrirlaydi va faollashtiradi/yashiradi. Aralash savatdagi buyurtma holati umumiy bo'lgani uchun sotuvchi statusni almashtirsa butun buyurtma holati yangilanadi.
- Yangi sotuvchi arizasi `TG_CHAT_ID` chatiga inline **Tasdiqlash/Rad etish** tugmalari bilan yuboriladi va pin qilinadi. Guruhda tugmalarni ishlatish uchun `TG_ADMIN_ID` ga adminning shaxsiy Telegram ID sini yozing; botga guruhda xabar pinlash huquqini bering.
- Admin panelda "Telegramni tekshirish" tugmasi sinov xabarini yuboradi,
  statistikada yuborilmay qolgan buyurtmalar soni ko'rinadi.
- Admin botdagi **Foydalanuvchini qidirish** yoki **Buyurtmani qidirish** tugmasi orqali foydalanuvchini telefon/7 belgili ID bilan, buyurtmani esa `XR1234567` raqami bilan topadi. Buyurtma holatini botdagi tugmalar orqali o'zgartirish, foydalanuvchi ma'lumotlari va so'nggi buyurtmalarini ko'rish, hisobini bloklash yoki blokdan chiqarish mumkin. `/report today|week|month` savdo hisobotini, `/messagestats` esa ommaviy xabar kampaniyalari bo'yicha saytga yetkazilgan va o'qilgan xabarlar sonini ko'rsatadi. `/help` barcha buyruqlarni ko'rsatadi.
- Bot admini `/promos` bilan promokodlarni ko'radi, `/addpromo` bilan yangi kod qo'shadi; bot tugmalari orqali kodni yoqish/o'chirish va o'chirish mumkin. Kod formati: `KOD percent|fixed MIQDOR SANA|- JAMI|- USER|- MIN|-`; masalan, `BAHOR10 percent 10 2027-03-31 100 1 200000`. `MIN` — minimal savdo summasi, `JAMI` — umumiy qo'llashlar soni, `USER` — bir foydalanuvchiga limit.
- Buyurtma holati o'zgarganda foydalanuvchiga xabarlar bo'limida bildirishnoma saqlanadi. Admin paneldagi **Xabar yuborish** bo'limidan ism, telefon yoki ID bilan foydalanuvchini topib shaxsiy xabar yuborish mumkin. Telegram botda foydalanuvchini qidirib, **Xabar yuborish** tugmasi bilan `Sarlavha | Xabar matni` formatida shaxsiy xabar jo'natish mumkin. `/broadcast` barcha saytdagi foydalanuvchilarga ommaviy xabar tayyorlaydi; bot yuborishdan oldin qabul qiluvchilar soni va matnni ko'rsatib tasdiq so'raydi. Ommaviy xabar saytning xabarlar qutisiga saqlanadi; shu sababli "yetkazildi" soni saytdagi qutiga muvaffaqiyatli saqlangan xabarlarni, "o'qildi" esa foydalanuvchi xabarni ochganini bildiradi. `/cancel` joriy amalni bekor qiladi. Foydalanuvchi qayta kirganda o'qilmagan xabar haqida ekran chetida bildirishnoma ko'radi va uni bosib aynan shu xabarni ochadi; xabarlar ro'yxatidagi sarlavha ham alohida oynada xabarni ochadi.
- Foydalanuvchi parolni unutsa, saytdagi support tugmasi orqali [@habibullayev_28](https://t.me/habibullayev_28) ga murojaat qiladi. Botda foydalanuvchini topgach, admin vaqtinchalik parol berishi mumkin; asl parol ko'rinmaydi va user vaqtinchalik parol bilan kirgach yangisini o'rnatishi shart.
- Bot qidiruviga ruxsat berilgan adminning shaxsiy Telegram akkaunt ID sini `TG_ADMIN_ID` ga kiriting. Guruhda sotuvchi arizasi tugmalarini bosish uchun ham shu ID ishlatiladi.

## 5. Sayt qidiruvi
- Qidiruv Node.js/Express backend'da MongoDB'dagi faol mahsulot nomi, kategoriya, tavsif va teglari bo'yicha ishlaydi. Matn kichik harfga o'tkaziladi, apostroflar me'yorlanadi, o'zbek lotin/kirill transliteratsiyasi va trigram fuzzy ballari qo'llanadi. Fuzzy va semantik ro'yxatlar Reciprocal Rank Fusion bilan birlashtirilib, sotuv, reyting va ombor holati bilan tartiblanadi.
- Semantik qatlam uchun `text-embedding-3-small` modeli tanlangan: u ko'p tilli qidiruv uchun, kichik embedding modeli va MongoDB hujjatlarida saqlash uchun mos. So'rov embeddingi 30 kunlik keshga yoziladi; mosligi past natija bo'lsa `gpt-4o-mini` faqat zaxirada so'rovni tuzatadi va tuzatish 30 kun keshlanadi. LLM ishlamasa fuzzy natija ishlashda davom etadi.
- Hostingdagi Environment yoki lokal `.env` faylga `OPENAI_API_KEY` ni faqat serverda kiriting. Embedding yaratish uchun mahsulot nomi, kategoriya, tavsif va teglar; qidiruv vaqtida esa foydalanuvchi so'rovi OpenAI API'ga yuboriladi. API kalit frontendga chiqarilmaydi. Kalit bo'lmasa qidiruv fuzzy rejimda ishlaydi, lekin yangi/tahrirlangan mahsulotni saqlash uchun embedding API mavjud bo'lishi kerak.
- Mavjud mahsulotlar uchun bir martalik embedding backfill: `npm run search:backfill`. Skript faqat embeddingi o'zgargan mahsulotlarni batch bilan qayta indekslaydi; `OPENAI_API_KEY` va `MONGODB_URI` kerak.
- Natijasiz qidiruvlar MongoDB `searchQueries` to'plamida kunlik hisoblagich bilan yoziladi va 90 kundan keyin tozalanadi. Qidiruv natijasi bo'lmasa tasodifiy mahsulot ko'rsatilmaydi; yaqin nom takliflari va LLM tuzatishi mavjud bo'lsa ko'rsatiladi.
- `npm test` qidiruvni transliteratsiya, typo/fuzzy, semantik qatlamni almashtiruvchi test embeddinglari, threshold, ranking va 5 000 mahsulotlik lokal benchmark bilan tekshiradi. Test vektorlari OpenAI modelining real sifati yoki API latency'sini o'lchamaydi.

## 5. Moslash
- Sotuvchilar `/seller.html` sahifasida Google orqali kiradi; yangi sotuvchi do'kon ma'lumotlarini to'ldirib ariza yuboradi. Google emailni tasdiqlaydi, admin panel yoki Telegramdagi inline tugma orqali admin arizani faollashtiradi. Tasdiqlangach sotuvchi kabinetidagi Telegram ulash havolasini ochib botda **Start** bosadi; parol so'ralmaydi. Ulangan Telegram akkauntiga o'z mahsulotlarining buyurtmalari boradi.
- Banner slaydlari admin panelning **Slaydlar** bo'limida boshqariladi; JPG, PNG yoki WebP (5 MB gacha) yuklash mumkin.
- Promokodlar admin panelning **Promokodlar** bo'limida ham boshqariladi. Foizli yoki belgilangan summadagi chegirma, tugash sanasi, jami va foydalanuvchi boshiga limit hamda minimal savdo summasi sozlanadi.
- Faqat akkauntiga tegishli buyurtmada mahsulot bor va buyurtma holati **Yetkazildi** bo'lgan foydalanuvchi baho va sharh yubora oladi. Sharh admin paneldagi **Sharhlar** bo'limida tasdiqlangandan keyin ommaga ko'rinadi. Bir foydalanuvchi har bir mahsulotga bitta sharh qoldiradi.
- Foydalanuvchi buyurtmalarida holatlar bosqichma-bosqich ko'rsatiladi. **Qayta xarid qilish** oldingi buyurtmadan omborda bor mahsulotlarni savatga qo'shadi.
- Buyurtma berishda foydalanuvchi xaritadan yetkazib berish nuqtasini belgilaydi yoki brauzer ruxsati bilan joriy joylashuvini aniqlaydi. Hudud/qishloq nomi avtomatik to'ldiriladi, koordinata buyurtmada saqlanadi va mijoz hamda sotuvchiga xaritada ochish havolasi ko'rsatiladi.
- Brend nomi: `public/index.html`, `public/admin.html`, `public/logo.svg`.
- Ranglar: `public/style.css` boshidagi `:root`.
- Dastlabki promokodlar bazaga bir marta XARID10 va YANGI5 sifatida qo'shiladi; keyin admin panel yoki Telegram botdan boshqariladi. XARID10 faqat akkauntning birinchi buyurtmasida va bir marta amal qiladi.
- Ikonlar: `public/icons.js`. Admin panelda mahsulotga ro'yxatdan ikon tanlanadi.
- Mahsulot qo'shish yoki tahrirlashda 5 MB gacha JPG, PNG va WebP rasmlarni yuklash mumkin; ular MongoDB da saqlanadi.

## Cheklovlar
- Onlayn to'lov (Payme, Click, Uzum Bank) ulanmagan: to'lov usuli buyurtmada saqlanadi, xolos.
- Mahsulot rasmlari ixtiyoriy; rasm yuklanmagan mahsulotlarda ikon ko'rsatiladi.
