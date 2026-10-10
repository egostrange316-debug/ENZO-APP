# Kids English Backend

Node.js (Express) + MongoDB (Mongoose). Ishga tushirish va ko'chirish tartibi: `../YANGI_TIZIM.md`.

```
npm install
cp .env.example .env     # to'ldiring
npm start
npm test                 # MongoDB kerak: TEST_MONGO_URI=mongodb://127.0.0.1:27017 npm test
```

## Tuzilma
- `config/curriculum.js` — 646 kun, 5 daraja, imtihon kunlari, 70% o'tish va o'zlashtirish chegarasi: yagona manba.
- `models/` — `User`, `StudyPlan` (day_number 1..646 noyob; level/lesson_type kundan hisoblanadi), `ExamAttempt`, `ExerciseProgress`, `DayMastery`, `Attendance`, `Homework`, `HomeworkSubmission`, `Message`, `PronunciationAttempt`.
- `middleware/checkSubscription.js` — muddat o'tsa avtomatik `blocked` + 403. Faqat Admin ochadi.
- `controllers/` — `auth`, `student`, `admin`. `services/geminiService.js` — AI parser (javob tekshiriladi).
- `scripts/` — `createAdmin.js`, `migrateFromSupabase.js`, `after_migration.sql`.

## API
| Metod | Yo'l | Kim | Tavsif |
|---|---|---|---|
| POST | `/api/auth/register` `{full_name,password,group_name}` | ochiq | O'quvchi ro'yxatdan o'tishi |
| POST | `/api/auth/login` `{full_name,password}` | ochiq | Bloklangan o'quvchi ham kiradi (status javobda) |
| GET | `/api/student/me` | student | Holat (bloklangan bo'lsa ham javob beradi) |
| GET | `/api/student/lesson/today` | student, faol | Bugungi dars. Mashqlar `exercises[]` (javobsiz) + `progress`; kitob kontenti `book_sections`. Imtihon kunida `exam_items` (aralash) yoki `practice`; final kunida faqat Speaking |
| POST | `/api/student/exercise/answer` `{day_number,key,answer}` | student, faol | Javob serverda tekshiriladi. Noto'g'ri -> takrorlanadi (cheklovsiz); 2-xatoda `hint`, 3-xatoda `reveal`. O'tgan kun = takrorlash (holat saqlanmaydi). Imtihon kunida faqat mini-mashq (`p<urinish>:<savol>`) |
| GET | `/api/student/lesson/day/:day` | student, faol | O'tib bo'lingan kunni takrorlash (mashqlar javobsiz) |
| GET | `/api/student/practice` | student, faol | "Mashq" bosh ekrani: bugungi holat, streak, haftalik chiziq, hisoblagichlar |
| GET | `/api/student/practice/words?offset=&limit=` | student, faol | "So'zlarim": ochilgan kunlardagi so'zlar; xato qilinganlari `hard:true` |
| GET | `/api/student/practice/mistakes` | student, faol | Faol xatolar (savol matni, javobsiz) |
| GET | `/api/student/practice/session` | student, faol | Kunlik mashq (10 savol): avval xatolar, keyin eski so'zlar; javobsiz |
| POST | `/api/student/practice/answer` `{day_number,key,answer}` | student, faol | Serverda tekshiriladi; ketma-ket 2 to'g'ri -> `cleared`; xato -> `reveal` va qaytadan faol |
| POST | `/api/student/practice/complete` | student, faol | Kuniga bir marta XP + streak (`first_today`) |
| GET | `/api/student/progress` | student | O'z progressi: bugungi vazifa foizi, kurs foizi |
| GET | `/api/student/leaderboard` | student, faol | Hamma o'quvchilar (ism, guruh, kun, foizlar). To'lov/obuna holati YO'Q |
| POST | `/api/student/lesson/complete` `{day_number}` | student, faol | Oddiy kunni yakunlash — faqat hamma mashq to'g'ri bo'lsa (aks holda 409 `exercises_incomplete`) |
| POST | `/api/student/exam/submit` `{day_number,answers:[{key,answer}]}` | student, faol | Ball serverda; >=70% -> keyingi kun. Yiqilsa: `review` (xato tahlili) va avval mini-mashq (aks holda 409 `practice_required`). Urinishlar, birinchi va eng yaxshi ball saqlanadi |
| GET | `/api/admin/students` | admin | Ro'yxat: `subscription` (paid/grace/blocked), `today` (foiz, birinchi urinish, xatolar / imtihon urinishlari), `course_percent` |
| POST | `/api/admin/students/:id/pay` `{months:1\|2..}` yoki `{end_date:'YYYY-MM-DD'}` | admin | To'lov: obuna TAQVIM OYI oxirigacha (Toshkent vaqti); status faol; kun saqlanadi. Qayta bosish 409 |
| POST | `/api/admin/students/:id/unblock` | admin | Eski nom: `pay {months:1}` bilan bir xil |
| POST | `/api/admin/students/:id/approve-speaking` | admin | Final kunida: current_day +1 (keyingi daraja) |
| DELETE | `/api/admin/students/:id` | admin | O'quvchini o'chirish |
| POST | `/api/admin/parse-unit` `{day_number,rawText,unit_title?}` | admin | Gemini -> StudyPlan |

`:id` — Mongo `_id` yoki eski Supabase uuid (`legacy_id`).
`day_number` so'rovlarda majburiy: qo'sh bosish yoki eskirgan ekran kunni ikki marta oshirib yubormasligi uchun.
| POST | `/api/admin/books` multipart: `files[]` (PDF/JPG/PNG/WEBP/HEIC, <=10 ta, <=30 MB), `title?`, `level?` | admin | Kitobni yuklaydi, 202 `{id,status:'processing'}`; Gemini fonda Writing/Reading/Listening/Speaking mashqlarini yaratib `BookMaterial` ga saqlaydi |
| GET | `/api/admin/books` | admin | Ro'yxat (holat, sanoqlar, ogohlantirishlar) |
| GET | `/api/admin/books/:id` | admin | To'liq mashqlar (holat `processing`/`ready`/`failed`) |
| POST | `/api/admin/books/:id/assign` `{day_number}` / `{day_number:null}` | admin | Tayyor to'plamni oddiy kunga biriktirish/bekor qilish (imtihon kuniga mumkin emas). Mashqlar shu kun darsiga qo'shiladi va yakunlash uchun majburiy |
| DELETE | `/api/admin/books/:id` | admin | O'chirish |

Kitob tahlili: fayl turi magic-byte bilan tekshiriladi, Gemini Files API ga yuklanadi, javob JSON sifatida tekshirilib tozalanadi,
vaqtinchalik va Gemini'dagi fayllar har doim o'chiriladi. Navbat xotirada — server qayta ishga tushsa, tahlil ketayotgan kitob 10 daqiqadan so'ng `failed` bo'ladi.
Frontend: `Codify-main/BookUploadPanel.jsx` (Admin -> Kurs tabida).

## Obuna qoidasi
Obuna taqvim oyi oxirigacha (28/29/30/31 — oyning haqiqiy oxirgi kuni, 23:59 Toshkent). Muddat tugagach **5 kun** to'lov muddati (`grace`): dars ochiq, o'quvchiga ogohlantirish chiqadi. Undan keyin avtomatik blok. Faqat admin ochadi (`/pay`). To'lov holati faqat admin API'da; o'quvchilar reytingida yo'q.

## Mashq va imtihon qoidasi
- Mashq: to'g'ri bo'lguncha takrorlanadi, urinish cheklovsiz. Foiz = to'g'ri yakunlangan / jami (kamaymaydi); alohida `first_try_percent`.
- Imtihon (3/25-kunlar karralari): har urinishda savollar aralash; yiqilsa xato tahlili + mini-mashq (to'g'ri bo'lguncha), keyin qayta topshiriladi. Final (100, 200...) — faqat Speaking, o'qituvchi tasdiqlaydi.
- Sinov bazasi (FerretDB) bir hujjatli parallel yangilashni atomik bajarmaydi; shuning uchun har savol holati alohida hujjatda. Haqiqiy MongoDB/Atlas'da qo'shimcha `TEST_STRICT_ATOMIC=1 npm test` ham o'tishi kerak.

## Tayyor kitob kontentini yuklash (AI'siz)

`content/eviu-elementary/` — English Vocabulary in Use Elementary uchun 60 ta unit (o'zimiz yozgan mashqlar).

    node scripts/seedBook.js eviu-elementary elementary            # har unit = 1 kun (60 kun)
    node scripts/seedBook.js eviu-elementary elementary --split    # har unit = 2 kun (120 qism)

Idempotent: qayta ishga tushirsa yangilaydi. Imtihon kunlari o'tkazib yuboriladi.


## Butun kursni joylash (646 kun, AI'siz)

    node scripts/seedAll.js            # hamma darajani + grammatika + imtihonlarni bazaga yozadi (idempotent)

Tuzilma (`config/curriculum.js`): Beginner 70 kun (EVIU 1-30-unit, har unit 2 kun), Elementary 70 (EVIU 31-60),
Pre-Intermediate 154 (Key Words, 132 bet), Intermediate 170 (148 bet), Upper-Intermediate 182 (156 bet).
Imtihonlar: Pre-Int/Int — har bo'lim oxirida; qolganlarida har 6 darsdan keyin; darajaning oxirgi kuni = yakuniy Speaking.
Har dars kunida: lug'at, grammatika kartasi (mavzu 2 kunga), gap to'ldirish, reading, listening, speaking
va "Bugun kitobda: ..., N-bet" ma'lumoti (`book_ref`). Imtihon savollari (`lib/examBuilder.js`) faqat shu
imtihon qamrab olgan kunlardagi so'z va grammatikadan yig'iladi.

## O'yin tizimi

`config/gamification.js` (XP, streak, nishon, liga, do'kon, o'yinlar), `services/gameService.js`, `/api/student/game/*`.
XP va tanga faqat serverda hisoblanadi; o'yin XP'i kuniga cheklangan; mashqda yurak/urinish cheklovi yo'q.

## Talaffuz tekshirish (Gemini)
- `POST /api/student/pronunciation` `{word, uz?, day_number?, audio_base64, mime_type}` -> `{score, transcript, feedback, tip, best_score}`.
- `GET /api/student/pronunciation/history?word=` — o'quvchining o'z urinishlari.
- Ball = 60% aniq matn solishtirish (Gemini eshitgan so'z vs maqsad) + 40% Gemini bahosi. Gemini ishlamasa soxta ball berilmaydi (502/503).
- Himoya: audio <= 1.5 MB, MIME tekshiruvi, daqiqasiga 12 urinish, `GEMINI_API_KEY` serverda (frontendda emas).
- Urinishlar `PronunciationAttempt` kolleksiyasida saqlanadi. Eski Supabase `analyze-speech` funksiyasi endi kerak emas.

## Sinf (davomat, uy vazifasi, xabar, avatar) — `/api/class/*`
Hammasi token bilan; o'quvchi bloklangan bo'lsa 403. Rasmlar `UPLOAD_DIR` ga yoziladi va `/uploads/...` da beriladi (faqat JPG/PNG/WEBP/GIF, bayt bo'yicha tekshiriladi).
| Metod | Yo'l | Kim | Tavsif |
|---|---|---|---|
| GET | `/roster` | hamma | O'quvchilar ro'yxati (`ball` = XP + uy vazifasi). Admin uchun `blocked` ham |
| POST | `/avatar` (multipart `file`) | hamma | Profil rasmi |
| GET / PUT | `/attendance` | o'z guruhi / admin | Davomat: PUT `{student_id,date,status: present\|absent\|clear}` faqat admin |
| GET / POST / DELETE | `/homework` | hamma / admin | Vazifalar. GET muddati o'tganlarga jarimani bir marta hisoblaydi |
| POST | `/homework/:id/submit` (multipart `file`) | o'quvchi | Rasm topshirish. O'z vaqtida birinchi marta = mukofot |
| GET / POST | `/messages` | hamma | O'z xabarlari; POST `{to, body}` |

Admin qo'shimchalari: `GET /api/admin/students/:id/card` (kartochka), `POST .../pass-day` (mavzuni qo'lda o'tkazish),
`POST .../set-day {day}` (kursdagi o'rnini belgilash). `GET /api/admin/today` har o'quvchi uchun `retry`/`needs_teacher` belgisini beradi.

`POST /api/student/lesson/complete` birinchi urinish ulushi `MASTERY_THRESHOLD_PERCENT` dan past bo'lsa `{retry_required:true, mastery_percent}` qaytaradi,
mashqlar noldan boshlanadi va kun oshmaydi.
