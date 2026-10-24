/**
 * Mashq (exercise) mantig'i: savollar ro'yxati, javobni SERVERDA tekshirish, maslahat va foiz.
 *
 * Qoidalar (o'qituvchi bilan kelishilgan):
 *  - Mashq to'g'ri bo'lguncha takrorlanadi: noto'g'ri savol keyinroq yana chiqadi, cheklov yo'q.
 *  - 2-xatodan keyin maslahat, 3-xatodan keyin to'g'ri javob ko'rsatiladi (bola tiqilib qolmasin);
 *    shundan keyin ham savol "tugagan" hisoblanmaydi — to'g'ri javob bergandagina tugaydi.
 *  - Foiz = to'g'ri yakunlangan savollar / jami. U hech qachon kamaymaydi.
 *  - first_try_percent = birinchi urinishda to'g'ri topilganlar (o'qituvchi uchun, qayta ishlash uni o'zgartirmaydi).
 */
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

const HINT_AFTER = 2;   // shuncha xatodan keyin maslahat
const REVEAL_AFTER = 3; // shuncha xatodan keyin to'g'ri javob ko'rsatiladi

/** Barqaror (har chaqiruvda bir xil) tasodifiy tartib: javob indeksi o'zgarmasligi shart */
function seeded(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return () => {
    h += 0x6d2b79f5; let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffled(arr, seedStr) {
  const rnd = seeded(seedStr);
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/** So'z -> tarjima tanlash (EN->UZ). pool: boshqa so'zlar (chalg'ituvchi variantlar uchun) */
function vocabMcq(key, v, pool, extra = {}) {
  const wrong = [...new Set(pool.filter((p) => norm(p.translation_uz) !== norm(v.translation_uz)).map((p) => p.translation_uz))];
  const opts = shuffled([v.translation_uz, ...shuffled(wrong, key).slice(0, 3)], key + ':o');
  if (opts.length < 2) return null;
  return {
    key, kind: 'mcq', section: 'vocab', group: "Lug'at", question: `"${v.word}" so'zining tarjimasi qaysi?`,
    options: opts, correct_index: opts.indexOf(v.translation_uz), speak_text: v.word, ...extra,
  };
}
/** Tarjima -> inglizcha yozish (UZ->EN) */
function vocabFill(key, v, extra = {}) {
  return {
    key, kind: 'fill', section: 'vocab', group: "Lug'at", question: `Inglizchasini yozing: ${v.translation_uz}`,
    options: [], correct_word: v.word, ...extra,
  };
}

/** Rejadagi (StudyPlan) mashqlar -> yagona ro'yxat. Kalitlar barqaror: q:0, f:0 ... */
function itemsFromPlan(plan) {
  const items = [];
  (plan.quizzes || []).forEach((q, i) =>
    items.push({
      key: `q:${i}`, kind: 'mcq', section: 'quiz',
      question: q.question, options: [...q.options], correct_index: q.correct_answer_index,
    })
  );
  (plan.fill_in_the_blanks || []).forEach((f, i) =>
    items.push({
      key: `f:${i}`, kind: 'fill', section: 'fill',
      question: f.sentence_with_blank, options: [...(f.options || [])], correct_word: f.correct_word,
    })
  );
  return items;
}

/**
 * Kitob (BookMaterial) mashqlari -> yagona ro'yxat. Kalit: b<kitob id oxirgi 6 belgi>:<bo'lim>:<indeks>
 * Tartib: Writing (grammatika) -> Reading -> Listening -> diktant.
 */
// Iboralardan ("have breakfast", "wait for") yozishda talab qilinadigan asosiy so'zni ajratadi: breakfast, wait
const PHRASE_STOP = new Set(['a', 'an', 'the', 'to', 'for', 'of', 'in', 'on', 'at', 'up', 'down', 'out', 'off', 'with', 'your', 'my', 'his', 'her', 'their', 'our', 'some', 'have', 'get', 'make', 'do', 'take', 'be', 'go', 'is', 'are', 'it', 'and', 'or', 'by', 'from', 'into', 'about', 'someone', 'something', 'sb', 'sth']);
function keyWordOf(phrase) {
  const toks = String(phrase || '').toLowerCase().match(/[a-z']+/g) || [];
  const cand = toks.filter((t) => t.length >= 3 && !PHRASE_STOP.has(t));
  if (!cand.length) return null;
  return cand.sort((a, b) => b.length - a.length)[0];
}

function itemsFromBook(book) {
  const id = String(book._id).slice(-6);
  const items = [];
  (book.writing?.grammar || []).forEach((g, gi) =>
    (g.exercises || []).forEach((e, ei) =>
      items.push({
        key: `b${id}:g${gi}:${ei}`, kind: 'fill', section: 'grammar', source: 'book', group: g.title,
        question: e.sentence_with_blank, options: [...(e.options || [])], correct_word: e.correct_word,
      })
    )
  );
  const vocab = (book.writing?.vocabulary || []).filter((v) => v.word && v.translation_uz);
  vocab.forEach((v, i) => {
    const m = vocabMcq(`b${id}:v:${i}`, v, vocab, { source: 'book' });
    if (m) items.push(m);
    items.push(vocabFill(`b${id}:w:${i}`, v, { source: 'book' }));
  });
  (book.reading?.questions || []).forEach((q, i) =>
    items.push({
      key: `b${id}:r:${i}`, kind: 'mcq', section: 'reading', source: 'book',
      question: q.question, options: [...q.options], correct_index: q.correct_answer_index,
      // Matn savollar bilan birga ko'rsatiladi (bola o'qib javob beradi)
      ...(book.reading?.text ? { passage: book.reading.text, passage_title: book.reading.title || '' } : {}),
    })
  );
  (book.listening?.questions || []).forEach((q, i) =>
    items.push({
      key: `b${id}:l:${i}`, kind: 'mcq', section: 'listening', source: 'book',
      question: q.question, options: [...q.options], correct_index: q.correct_answer_index,
      // Audio (qurilma ovozi) savol turgan joyda eshitiladi; matnning o'zi ko'rsatilmaydi
      ...(book.listening?.script ? { speak_text: book.listening.script } : {}),
    })
  );
  // Qo'shimcha CEFR/IELTS uslubidagi o'qish matnlari (matn savollar bilan birga ko'rinadi)
  (book.readings || []).forEach((r, j) => {
    const meta = { passage: r.text, passage_title: `${r.title}${r.cefr ? ` (${r.cefr})` : ''}` };
    (r.questions || []).forEach((q, i) =>
      items.push({ key: `b${id}:rx${j}:${i}`, kind: 'mcq', section: 'reading', source: 'book',
        question: q.question, options: [...q.options], correct_index: q.correct_answer_index, ...(q.explanation ? { explanation: q.explanation } : {}), ...meta })
    );
    (r.fill || []).forEach((f, i) =>
      items.push({ key: `b${id}:rxf${j}:${i}`, kind: 'fill', section: 'reading', source: 'book', loose: true,
        question: f.sentence_with_blank, options: [], correct_word: f.correct_word, ...(f.accept?.length ? { accept: [...f.accept] } : {}),
        ...(f.explanation ? { explanation: f.explanation } : {}), ...meta })
    );
  });
  // Tashqi ochiq manba (VOA): haqiqiy audio fayl; savollar audio bilan birga ko'rsatiladi
  (book.voa?.questions || []).forEach((q, i) =>
    items.push({
      key: `b${id}:voa:${i}`, kind: 'mcq', section: 'listening', source: 'book',
      question: q.question, options: [...q.options], correct_index: q.correct_answer_index,
      audio_url: book.voa.audio_url, ...(book.voa.credit ? { credit: book.voa.credit } : {}),
      ...(book.voa.transcript ? { speak_text: book.voa.transcript } : {}),
    })
  );
  const voa = book.voa;
  if (voa?.audio_url) {
    (voa.fill || []).forEach((e, i) =>
      items.push({ key: `b${id}:voaf:${i}`, kind: 'fill', section: 'grammar', source: 'book', group: voa.title,
        question: e.sentence_with_blank, options: [...(e.options || [])], correct_word: e.correct_word })
    );
    (voa.gaps || []).forEach((g, i) =>
      items.push({ key: `b${id}:voag:${i}`, kind: 'fill', section: 'dictation', source: 'book', loose: true,
        question: g.sentence_with_blank, options: [], correct_word: g.correct_word, audio_url: voa.audio_url, ...(voa.credit ? { credit: voa.credit } : {}) })
    );
    (voa.dictation || []).forEach((t, i) =>
      items.push({ key: `b${id}:voad:${i}`, kind: 'fill', section: 'dictation', source: 'book', loose: true,
        question: "Eshiting va yozing", speak_text: t, options: [], correct_word: t })
    );
    if (voa.writing?.question)
      items.push({ key: `b${id}:voaw:0`, kind: 'write', section: 'writing', source: 'book', loose: true,
        question: voa.writing.question, must_words: [...(voa.writing.must_words || [])], min_words: voa.writing.min_words || 4, options: [] });
    if (voa.speaking?.question_text)
      items.push({ key: `b${id}:voas:0`, kind: 'speak', section: 'speaking', source: 'book', loose: true,
        question: voa.speaking.question_text, hint_words: [...(voa.speaking.hint_words || [])], options: [] });
  }
  (book.listening?.dictation_sentences || []).forEach((sentence, i) =>
    items.push({
      key: `b${id}:d:${i}`, kind: 'fill', section: 'dictation', source: 'book', loose: true,
      question: "Eshiting va yozing", speak_text: sentence, options: [], correct_word: sentence,
    })
  );
  // Writing: mavzu bo'yicha qisqa matn (serverda: so'z soni + bugungi so'zlar ishlatilganini tekshiradi)
  const topic = book.speaking?.questions?.[0]?.topic || book.title;
  const must = [...new Set(vocab.map((v) => keyWordOf(v.word)).filter(Boolean))].slice(0, 3);
  if (vocab.length) {
    items.push({
      key: `b${id}:wr:0`, kind: 'write', section: 'writing', source: 'book', loose: true,
      question: `"${topic}" mavzusida 2-3 ta gap yozing (inglizcha).`,
      must_words: must, min_words: WRITE_MIN_WORDS, options: [],
    });
  }
  // Speaking: bolaning aytgani yozib olinadi (ovozni tanish bo'lmasa, o'zi "aytdim" deb tasdiqlaydi)
  const sq = book.speaking?.questions?.[0];
  if (sq?.question_text) {
    items.push({
      key: `b${id}:sp:0`, kind: 'speak', section: 'speaking', source: 'book', loose: true,
      question: sq.question_text, hint_words: [...(sq.hint_words || [])], options: [],
    });
  }
  return items;
}

const WRITE_MIN_WORDS = 6;
const TASK_LENIENT_AFTER = 2; // shuncha muvaffaqiyatsiz urinishdan keyin 3+ so'zli matn qabul qilinadi
const wordRe = (w) => new RegExp(`\\b${String(w).toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(s|es|ed|ing)?\\b`);
/** Writing/Speaking: qaysi shartlar bajarilmagan (bo'sh ro'yxat = hammasi bajarilgan) */
function taskProblems(item, answer) {
  const text = norm(answer);
  const words = text ? text.split(/\s+/).filter(Boolean) : [];
  if (item.kind === 'speak') return words.length >= 1 ? { short: false, missing: [] } : { short: true, missing: [] };
  const missing = (item.must_words || []).filter((w) => !wordRe(w).test(text));
  return { short: words.length < (item.min_words || WRITE_MIN_WORDS), missing };
}

/** Eski so'zlarni takrorlash (kalit: o:<so'z>) — hamma o'quvchiga bir xil, shuning uchun foiz jadvali to'g'ri ishlaydi */
const REVIEW_COUNT = 5;
const REVIEW_OFFSETS = [1, 3, 7, 14, 30]; // oraliqli takrorlash: shuncha kun oldingi so'zlar qaytadi

function reviewItems(day, pool, todayWords = []) {
  const seen = new Set(todayWords.map((w) => norm(w)));
  const uniq = [];
  for (const v of pool) {
    const k = norm(v.word);
    if (!k || !v.translation_uz || seen.has(k)) continue;
    seen.add(k);
    uniq.push(v);
  }
  const chosen = [];
  const used = new Set();
  // 1) Har bir oraliq (1, 3, 7, 14, 30 kun oldin) uchun bittadan so'z — kun raqami ma'lum bo'lsa
  for (const off of REVIEW_OFFSETS) {
    const bucket = shuffled(uniq.filter((v) => v._day === day - off && !used.has(norm(v.word))), `review:${day}:${off}`);
    if (bucket.length) { chosen.push(bucket[0]); used.add(norm(bucket[0].word)); }
  }
  // 2) Qolgan o'rinlarni boshqa eski so'zlar bilan to'ldiramiz
  for (const v of shuffled(uniq, `review:${day}`)) {
    if (chosen.length >= REVIEW_COUNT) break;
    if (!used.has(norm(v.word))) { chosen.push(v); used.add(norm(v.word)); }
  }
  return chosen.slice(0, REVIEW_COUNT)
    .map((v) => vocabMcq(`o:${norm(v.word)}`, v, uniq, { source: 'review', group: "Takrorlash: eski so'zlar" }))
    .filter(Boolean);
}

/** Bolaga yuboriladigan ko'rinish: to'g'ri javobsiz */
function publicItem(item, state) {
  return {
    key: item.key,
    kind: item.kind,
    section: item.section,
    ...(item.group ? { group: item.group } : {}),
    ...(item.audio_url ? { audio_url: item.audio_url, credit: item.credit || '' } : {}),
    ...(item.speak_text ? { speak_text: item.speak_text } : {}), // diktant/listening: ilova TTS bilan o'qib beradi
    ...(item.must_words ? { must_words: item.must_words, min_words: item.min_words } : {}),
    ...(item.hint_words ? { hint_words: item.hint_words } : {}),
    ...(item.passage ? { passage: item.passage, passage_title: item.passage_title || '' } : {}), // reading matni
    question: item.question,
    options: item.options,
    state: state ? { status: state.status, wrong: state.wrong || 0 } : { status: 'pending', wrong: 0 },
  };
}

function isCorrect(item, answer) {
  if (item.kind === 'write' || item.kind === 'speak') {
    const p = taskProblems(item, answer);
    return !p.short && p.missing.length === 0;
  }
  if (item.kind === 'mcq') return Number.isInteger(answer) && answer === item.correct_index;
  if (norm(answer) === '') return false;
  if (item.loose) {
    // Diktant: tinish belgilari va harf kattaligiga e'tibor berilmaydi (bola uchun adolatli)
    const strip = (x) => norm(x).replace(/[^\p{L}\p{N}\s']/gu, '').replace(/\s+/g, ' ').trim();
    return [item.correct_word, ...(item.accept || [])].some((w) => strip(answer) === strip(w));
  }
  return norm(answer) === norm(item.correct_word);
}

/** wrongCount (shu javobni ham qo'shgandagi) bo'yicha maslahat va javobni ochish */
function feedbackFor(item, wrongCount) {
  const out = {};
  if (wrongCount >= HINT_AFTER) {
    if (item.kind === 'mcq' || (item.options && item.options.length > 2)) {
      // Bitta noto'g'ri variantni olib tashlaymiz (eng kichik indeksli)
      const idx = item.kind === 'mcq'
        ? item.options.findIndex((_, i) => i !== item.correct_index)
        : item.options.findIndex((o) => norm(o) !== norm(item.correct_word));
      if (idx >= 0) out.hint = { type: 'eliminate_option', option_index: idx };
    } else {
      const w = String(item.correct_word);
      out.hint = { type: 'first_letter', text: `${w[0]}${'_'.repeat(Math.max(0, w.length - 1))} (${w.length} harf)` };
    }
  }
  if (wrongCount >= REVEAL_AFTER) {
    out.reveal = item.kind === 'mcq'
      ? { correct_index: item.correct_index, correct_text: item.options[item.correct_index] }
      : { correct_word: item.correct_word };
    out.must_retype = true; // ko'rsatilgan javobni o'zi bir marta kiritishi kerak
  }
  return out;
}

/** Saqlangan holat (progress.items) + joriy savollar -> umumiy ko'rsatkichlar */
function summarize(items, states) {
  const byKey = new Map((states || []).map((s) => [s.key, s]));
  let done = 0;
  let firstTry = 0;
  let wrongTotal = 0;
  for (const it of items) {
    const s = byKey.get(it.key);
    if (!s) continue;
    wrongTotal += s.wrong || 0;
    if (s.status === 'done') {
      done++;
      if (s.first_try) firstTry++;
    }
  }
  const total = items.length;
  return {
    total,
    done,
    percent: total === 0 ? 100 : Math.round((done / total) * 100),
    first_try_percent: total === 0 ? 100 : Math.round((firstTry / total) * 100),
    wrong_total: wrongTotal,
    complete: done === total,
  };
}

module.exports = { TASK_LENIENT_AFTER, taskProblems, WRITE_MIN_WORDS, reviewItems, REVIEW_COUNT, norm, HINT_AFTER, REVEAL_AFTER, itemsFromPlan, itemsFromBook, publicItem, isCorrect, feedbackFor, summarize };
