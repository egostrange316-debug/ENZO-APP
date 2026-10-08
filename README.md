# Kids English Backend

Node.js (Express) + MongoDB (Mongoose). Ishga tushirish va ko'chirish tartibi: `../YANGI_TIZIM.md`.

```
npm install
cp .env.example .env     # to'ldiring
npm start
npm test                 # MongoDB kerak: TEST_MONGO_URI=mongodb://127.0.0.1:27017 npm test
```

## Tuzilma
- `config/curriculum.js` — 400 kun, darajalar, imtihon kunlari (3/25/100) va 70% chegarasi: yagona manba.
- `models/` — `User`, `StudyPlan` (day_number 1..400 noyob; level/lesson_type kundan hisoblanadi), `ExamAttempt`.
- `middleware/checkSubscription.js` — muddat o'tsa avtomatik `blocked` + 403. Faqat Admin ochadi.
- `controllers/` — `auth`, `student`, `admin`. `services/geminiService.js` — AI parser (javob tekshiriladi).
- `scripts/` — `createAdmin.js`, `migrateFromSupabase.js`, `after_migration.sql`.

## API
| Metod | Yo'l | Kim | Tavsif |
|---|---|---|---|
| POST | `/api/auth/register` `{full_name,password,group_name}` | ochiq | O'quvchi ro'yxatdan o'tishi |
| POST | `/api/auth/login` `{full_name,password}` | ochiq | Bloklangan o'quvchi ham kiradi (status javobda) |
| GET | `/api/student/me` | student | Holat (bloklangan bo'lsa ham javob beradi) |
| GET | `/api/student/lesson/today` | student, faol | Bugungi dars. Imtihon kunida javobsiz; final kunida faqat Speaking |
| POST | `/api/student/lesson/complete` `{day_number}` | student, faol | Oddiy kunni yakunlash |
| POST | `/api/student/exam/submit` `{day_number,quiz_answers[],fill_answers[]}` | student, faol | Ball serverda; >=70% -> keyingi kun |
| GET | `/api/admin/students` | admin | Ro'yxat |
| POST | `/api/admin/students/:id/unblock` | admin | Faol + bugundan +30 kun, kun saqlanadi |
| POST | `/api/admin/students/:id/approve-speaking` | admin | Final kunida: current_day +1 (keyingi daraja) |
| DELETE | `/api/admin/students/:id` | admin | O'quvchini o'chirish |
| POST | `/api/admin/parse-unit` `{day_number,rawText,unit_title?}` | admin | Gemini -> StudyPlan |

`:id` — Mongo `_id` yoki eski Supabase uuid (`legacy_id`).
`day_number` so'rovlarda majburiy: qo'sh bosish yoki eskirgan ekran kunni ikki marta oshirib yubormasligi uchun.
