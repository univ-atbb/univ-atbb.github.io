# 🏛️ بوابة مكتب الصفقات

تطبيق ويب عربي (RTL) لإدارة استشارات الصفقات الجامعية:

- الموظف ينشئ استشارة (رقم، عنوان، مدة، تاريخ فتح) ويرفع دفتر الشروط PDF
- التطبيق يولّد **QR** يُطبع ويسلَّم للمتعامل
- المتعامل يمسح QR من أي مكان → يدخل (اسم الشركة، الهاتف، البريد) → يحمّل الملف
- كل تحميل يُسجَّل في السجل (مع IP ووقت) ويصدَّر CSV
- عند فتح الأظرفة: زر واحد **يحذف الملف نهائيًا** ويُغلق التحميل على الجميع

---

## 🏗️ كيف يعمل؟

```
┌─────────────────┐         ┌──────────────────────┐
│  GitHub Pages   │  يجلب   │      Supabase        │
│  (الواجهة المجانية) ◄──────────► (قاعدة + تخزين)   │
└─────────────────┘         └──────────────────────┘
        ▲                              ▲
        │ يمسح QR من أي هاتف           │ رابط موقّع مؤقت (10 دقائق)
┌─────────────────┐                    │
│  هاتف المتعامل  │ ───────────────────┘
└─────────────────┘
```

- **GitHub Pages**: يستضيف الواجهة فقط (مجاني، يعمل من أي مكان)
- **Supabase**: يخزّن بيانات الاستشارات + سجل التحميلات (الخطة المجانية: 500MB قاعدة + 1GB ملفات)
- **Cloudflare R2**: يخزّن ملفات PDF الكبيرة (مجاني: 10GB مساحة + تنزيل غير محدود وبدون تكلفة — يتجاوز حد 50MB في Supabase المجانية)

---

## 🚀 التهيئة (مرة واحدة فقط)

### 1) أنشئ مشروع Supabase
1. اذهب إلى [supabase.com](https://supabase.com) وأنشئ حسابًا مشروعًا **مجانيًا**
2. من لوحة المشروع: **Project Settings → API** → احفظ:
   - `Project URL` (شبه: `https://xxxx.supabase.co`)
   - `anon key` (نص طويل يبدأ بـ `eyJ...`)

### 2) شغّل قاعدة البيانات
1. من لوحة Supabase افتح **SQL Editor** → **New query**
2. انسخ محتوى الملف `supabase/migrations/001_initial_schema.sql` بالكامل والصقه
3. اضغط **Run**

هذا ينشئ: الجداول + الفهارس + صلاحيات RLS + Bucket التخزين الخاص `tenders`

### 2.5) شغّل سياسات الأمان
1. في **SQL Editor** مرة أخرى، انسخ محتوى `supabase/migrations/002_security.sql` وشغّله

### 2.7) أنشئ Edge Function
1. **Edge Functions** → **New function**
2. الاسم: `get-download`
3. الصق محتوى `supabase/functions/get-download/index.ts` في المحرر
4. **Deploy**
5. في إعدادات الدالة فعّل **Allow anonymous calls**

### 2.8) Cloudflare R2 (ملفات أكبر من 50MB)
الخطة المجانية من Supabase تقيّد رفع الملف بـ 50MB. لرفع دفاتر الشروط الكبيرة (حتى 200MB):

1. أنشئ حسابًا مجانيًا على [cloudflare.com](https://dash.cloudflare.com/sign-up)
2. من القائمة: **R2 object storage** → **Create a bucket** → الاسم: `tenders`
3. في صفحة الخزنة → **Settings** → **CORS Policy** → **Add CORS policy** → تبويب **JSON** والصق:
   ```json
   [
     {
       "AllowedOrigins": ["*"],
       "AllowedMethods": ["GET", "PUT", "HEAD"],
       "AllowedHeaders": ["*"],
       "ExposeHeaders": ["ETag", "Content-Length"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
   ثم **Save**
4. من **R2** → **Manage R2 API Tokens** → **Create API Token** → الصلاحيات: **Object: Read & Write** على الخزنة `tenders` → أنشئ وانسخ: **Account ID** + **Access Key ID** + **Secret Access Key** (تظهر مرة واحدة فقط)
5. في **SQL Editor**، شغّل محتوى `supabase/migrations/003_r2_support.sql`
6. في **SQL Editor** مرة أخرى، شغّل (بعد استبدال القيم بالتي نسختها):
   ```sql
   insert into public.app_config (key, value) values
     ('r2_access_key_id', '...'),
     ('r2_secret_access_key', '...'),
     ('r2_bucket', 'tenders'),
     ('r2_account_id', '...')
   on conflict (key) do update set value = excluded.value, updated_at = now();
   ```
7. **Edge Functions** → **New function** → الاسم: `tender-files` → الصق `supabase/functions/tender-files/index.ts` → **Deploy** → يبقى **Protected** (بدون anonymous)
8. أعد نشر `get-download` بالكود الجديد (يدعم R2): افتحها في المحرر → استبدل الكود بالكامل → **Deploy**

> 💡 قبل إكمال R2: يمكن إنشاء استشارات بملفات 50MB فأقل (تخزين Supabase) — والملفات الأكبر تنتظر.

### 3) اربط التطبيق
افتح `js/config.js` واملأ:

```js
window.TENDER_CONFIG = {
  SUPABASE_URL: "https://xxxx.supabase.co",
  SUPABASE_ANON_KEY: "eyJ...",
};
```

> ⚠️ الموقع الساكن يقرأ الإعدادات من `js/config.js` (لا يقرأ `.env`). ملف `.env.example` مرجعي فقط.

### 4) جرّب محليًا
داخل مجلد المشروع:

```bash
npx serve
```

ثم افتح `http://localhost:3000` — يجب أن ترى لوحة المدير (لو ظهرت شارة صفراء "غير موصول" فأعد الخطوة 3).

---

## 📦 النشر على GitHub Pages

### 1) ارفع المشروع إلى GitHub
```bash
cd tender-portal
git init
git add .
git commit -m "تطبيق بوابة مكتب الصفقات"
git branch -M main
git remote add origin https://github.com/<اسم-حسابك>/<اسم-المستودع>.git
git push -u origin main
```

### 2) فعّل GitHub Pages
1. من مستودعك على GitHub: **Settings → Pages**
2. **Build and deployment**: Source = **Deploy from a branch**
3. Branch = `main`، folder = `/ (root)` → **Save**
4. خلال دقيقة: موقعك يصبح
   `https://<اسم-حسابك>.github.io/<اسم-المستودع>/`

### 3) تأكد
افتح الرابط — يجب أن تظهر لوحة المدير.

> 💡 **مهم**: بطاقات QR التي تُنشئها محليًا (localhost) لن تعمل خارج جهازك. أنشئ/اطبع البطاقات من **الموقع المنشور** — التطبيق يولّد رابط QR تلقائيًا من عنوان الصفحة الحالي، لذا بعد النشر كل QR سيحمل رابط الموقع الصحيح.

---

## 📖 الاستخدام اليومي

### الموظف — تسجيل الدخول
1. افتح الموقع → اضغط **إنشاء حساب جديد (أول مرة فقط)** → بريد + كلمة مرور (8+ أحرف)
2. إذا وصلك بريد تأكيد من Supabase: افتحه واضغط الرابط (أو عطّل "Confirm email" من **Authentication → Sign In / Up → Email**)
3. بعدها: **دخول** بكل مرة (يتذكر المتصفح جلسة الدخول)

### الموظف — إنشاء استشارة
1. تبويب **📝 إنشاء استشارة**: املأ الرقم والعنوان والمدة وتاريخ الفتح
2. اختر ملف PDF (حد 200MB) → **🚀 نشر وتوليد QR**
3. تظهر بطاقة QR → **🖨️ طباعة البطاقة** → سلّمها للمتعامل بعد سداد المستحقات

### المتعامل — التحميل
1. يمسح الرمز بكاميرا الهاتف
2. يملأ: اسم الشركة + الهاتف + البريد
3. يحمّل دفتر الشروط (رابط مؤقت صالح 10 دقائق، ويمكن إعادة التحميل قبل انتهائها)

### الموظف — المتابعة
- تبويب **📥 الاستشارات**:
  - **🔳 بطاقة QR** — إعادة فتح/طباعة
  - **👥 من حمّل** — السجل الكامل + **تصدير CSV**
  - **🔓 فتح الأظرفة** — في يوم الفتح: اكتب رقم الاستشارة للتأكيد ← يُحذف PDF نهائيًا وتُغلق الصفحة على المتعاملين (لا رجعة)

---

## 🔐 الأمان — ما الذي مُنع؟

| الخطر | الحل |
|---|---|
| مشاركة رابط PDF مباشر | لا يوجد رابط مباشر — الـ QR يفتح صفحة تحقق فقط |
| تجاوز نموذج البيانات | **مستحيل**: توليد الرابط يتم في Edge Function على خادم Supabase، والمتعامل لا يرى مسار الملف أبدًا |
| قراءة سجلات المتعاملين | سياسة RLS: القراءة للمصادَق فقط (الموظف بعد تسجيل الدخول) |
| إنشاء/حذف استشارات من الخارج | RLS: الكتابة للمصادَق فقط |
| رفع/حذف ملفات من الخارج | Storage مقفل: للمصادَق فقط |
| رابط دائم | Signed URL صالح 10 دقائق فقط |
| تسرب الملف بعد الفتح | حذف نهائي من الخادم عند فتح الأظرفة |
| تتبع من حمّل | الدالة تسجل IP + User-Agent + البيانات لكل تحميل (خوادم Supabase، لا يُتلاعب به من المتصفح) |

### طبقات الأمان
1. **Supabase Auth**: الموظف يسجّل الدخول (بريد + كلمة مرور) — أول مرة ينشئ الحساب من زر «إنشاء حساب جديد»
2. **RLS**: كل جدول له سياسات مقفلة (انظر `002_security.sql`)
3. **عرض عام `tenders_public`**: المتعامل يرى حقول الاستشارة المنشورة فقط — بدون `pdf_path`
4. **Edge Function `get-download`**: التحقق + التسجيل + توليد الرابط تتم كلها على خادم Supabase بصلاحية service

### متطلبات Edge Function
- تُنشأ من: **Supabase Dashboard → Edge Functions → New function**
- الاسم: `get-download`
- الكود: في `supabase/functions/get-download/index.ts`
- في الإعدادات: فعّل **Allow anonymous calls** (المتعامل لا يسجّل دخولًا)

---

## 📁 هيكل الملفات

```
tender-portal/
├── index.html                        # الصفحة الذكية (?open= → متعامل / غيره → مدير)
├── .env.example                      # مرجعي فقط
├── css/styles.css                    # أنماط + طباعة بطاقة QR
├── js/
│   ├── config.js                     # ⬅️ ضع بيانات Supabase هنا
│   ├── supabase.js                   # تهيئة العميل
│   ├── auth.js                       # دخول / إنشاء حساب / خروج
│   ├── utils.js                      # أدوات (تنسيق تواريخ، تنبيهات، نوافذ)
│   ├── admin.js                      # إنشاء + قائمة + QR + سجل + فتح الأظرفة
│   ├── download.js                   # صفحة المتعامل (عبر get-download)
│   └── app.js                        # نقطة الدخول
└── supabase/
    ├── migrations/
    │   ├── 001_initial_schema.sql    # الجداول + RLS + Storage
    │   ├── 002_security.sql          # قفل السياسات + العرض العام
    │   └── 003_r2_support.sql        # عمود pdf_source + جدول app_config
    └── functions/
        ├── get-download/index.ts     # التحقق + التسجيل + الرابط المؤقت (Supabase أو R2)
        └── tender-files/index.ts     # رفع/نشر/حذف ملفات R2 (موظفون فقط)
```
