-- Migratsiya TO'LIQ tugagach va hamma o'quvchi yangi tizimda kira olishini tekshirgach, Supabase SQL Editor'da ishga tushiring.
-- Eski jadvalda parollar OCHIQ matn ko'rinishida saqlangan edi. Endi login backend orqali (bcrypt hash),
-- shuning uchun bu ustun kerak emas — uni tasodifiy qiymatga almashtiramiz (ustun NOT NULL bo'lgani uchun o'chirmaymiz).
update public.students set password = gen_random_uuid()::text;
