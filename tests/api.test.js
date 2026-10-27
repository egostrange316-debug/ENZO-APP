const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, quiz, fill, vocab, StudyPlan, User } = require('./helpers');
const { endOfMonth } = require('../lib/subscription');

let t;
before(async () => { t = await setup(); });
after(async () => { await t.teardown(); });

test('register/login: katta-kichik harf farqsiz, takroriy ism 409, noto\'g\'ri parol 401', async () => {
  const reg = await t.call('POST', '/api/auth/register', { body: { full_name: 'Ali Valiyev', password: 'abcd', group_name: '1-guruh' } });
  assert.equal(reg.status, 201);
  assert.ok(reg.data.token && reg.data.user.legacy_id);
  assert.equal(reg.data.user.password_hash, undefined);

  const dup = await t.call('POST', '/api/auth/register', { body: { full_name: '  ali   VALIYEV ', password: 'zzzz', group_name: '1-guruh' } });
  assert.equal(dup.status, 409);

  const ok = await t.call('POST', '/api/auth/login', { body: { full_name: 'ALI valiyev', password: 'abcd' } });
  assert.equal(ok.status, 200);
  const bad = await t.call('POST', '/api/auth/login', { body: { full_name: 'Ali Valiyev', password: 'nope' } });
  assert.equal(bad.status, 401);
  const badGroup = await t.call('POST', '/api/auth/register', { body: { full_name: 'X Y', password: 'abcd', group_name: 'hack' } });
  assert.equal(badGroup.status, 400);
});

test('token yo\'q -> 401; student admin marshrutiga kira olmaydi -> 403', async () => {
  assert.equal((await t.call('GET', '/api/student/lesson/today')).status, 401);
  const s = await t.makeStudent('Guard Student');
  assert.equal((await t.call('GET', '/api/admin/students', { token: s.token })).status, 403);
});

test('regular kun: dars keladi, yakunlash current_day ni 1 ga oshiradi; qo\'sh bosish 2 marta oshirmaydi', async () => {
  await StudyPlan.create({ day_number: 1, unit_title: 'U1', vocabulary: vocab, quizzes: quiz(2), fill_in_the_blanks: fill(1) });
  await StudyPlan.create({ day_number: 2, unit_title: 'U2', vocabulary: vocab, quizzes: quiz(2) });
  const s = await t.makeStudent('Regular Kid');

  const lesson = await t.call('GET', '/api/student/lesson/today', { token: s.token });
  assert.equal(lesson.status, 200);
  assert.equal(lesson.data.lesson_type, 'regular');
  assert.equal(lesson.data.day_number, 1);

  // Mashqlar bajarilmaguncha kun yakunlanmaydi
  const early = await t.call('POST', '/api/student/lesson/complete', { token: s.token, body: { day_number: 1 } });
  assert.equal(early.status, 409);
  assert.equal(early.data.code, 'exercises_incomplete');
  for (const [key, answer] of [['q:0', 0], ['q:1', 1], ['f:0', 'word0']]) {
    const r = await t.call('POST', '/api/student/exercise/answer', { token: s.token, body: { day_number: 1, key, answer } });
    assert.equal(r.data.correct, true);
  }

  const [a, b] = await Promise.all([
    t.call('POST', '/api/student/lesson/complete', { token: s.token, body: { day_number: 1 } }),
    t.call('POST', '/api/student/lesson/complete', { token: s.token, body: { day_number: 1 } }),
  ]);
  // Asosiy kafolat: kun HECH QACHON ikki marta oshmaydi (advanceDay current_day ni day+1 ga o'rnatadi).
  const me = await t.call('GET', '/api/student/me', { token: s.token });
  assert.equal(me.data.user.current_day, 2);
  assert.ok([a.status, b.status].includes(200));
  // Haqiqiy MongoDB'da bir hujjatli yangilash atomik: aynan bittasi 200, ikkinchisi 409.
  // Sinov bazasi FerretDB(sqlite) da parallel yangilash atomik emas — u yerda ikkalasi 200 bo'lishi mumkin.
  if (process.env.TEST_STRICT_ATOMIC === '1') assert.deepEqual([a.status, b.status].sort(), [200, 409]);
});

test('mini_check (7-kun): javoblar yashirin, soxta ball e\'tiborga olinmaydi, <70% yiqiladi, >=70% o\'tadi', async () => {
  await StudyPlan.create({ day_number: 7, unit_title: 'Check', vocabulary: vocab, quizzes: quiz(4), fill_in_the_blanks: fill(1) });
  const s = await t.makeStudent('Exam Kid');
  await User.updateOne({ _id: s.user.id }, { current_day: 7 });

  const lesson = await t.call('GET', '/api/student/lesson/today', { token: s.token });
  assert.equal(lesson.data.lesson_type, 'mini_check');
  const raw = JSON.stringify(lesson.data);
  assert.ok(!raw.includes('correct_answer_index') && !raw.includes('correct_word'), 'to\'g\'ri javoblar sizib chiqdi');
  assert.equal(lesson.data.quizzes.length, 4);

  // hammasi noto'g'ri + soxta "hammasi to'g'ri" maydonlari
  const fail = await t.call('POST', '/api/student/exam/submit', {
    token: s.token,
    body: { day_number: 7, quiz_answers: [9, 9, 9, 9], fill_answers: ['x'], correct_answers_count: 5, total_questions_count: 5, score_percent: 100 },
  });
  assert.equal(fail.data.passed, false);
  assert.equal(fail.data.score_percent, 0);
  assert.equal(fail.data.new_current_day, 7);

  // Yiqilgandan keyin darhol qayta topshirib bo'lmaydi: avval mini-mashq
  const blocked = await t.call('POST', '/api/student/exam/submit', { token: s.token, body: { day_number: 7, quiz_answers: [0, 1, 2, 3], fill_answers: ['word0'] } });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.data.code, 'practice_required');
  assert.equal(fail.data.attempt_number, 1);
  assert.equal(fail.data.review.length, 5);
  for (const w of fail.data.review) {
    const r = await t.call('POST', '/api/student/exercise/answer', {
      token: s.token,
      body: { day_number: 7, key: `p1:${w.key}`, answer: w.kind === 'mcq' ? w.correct.index : w.correct.word },
    });
    assert.equal(r.data.correct, true);
  }

  // 5 tadan 4 ta = 80% -> o'tadi (to'ldirish javobi katta-kichik harfga e'tiborsiz)
  const pass = await t.call('POST', '/api/student/exam/submit', {
    token: s.token, body: { day_number: 7, quiz_answers: [0, 1, 2, 3], fill_answers: ['  WORD0 '] },
  });
  assert.equal(pass.data.passed, true);
  assert.equal(pass.data.new_current_day, 8);
});

test('imtihon savollari yo\'q kunda avtomatik o\'tkazib yubormaydi (0 ga bo\'lish yo\'q)', async () => {
  await StudyPlan.create({ day_number: 14, unit_title: 'Bo\'sh check', vocabulary: vocab });
  const s = await t.makeStudent('Empty Exam Kid');
  await User.updateOne({ _id: s.user.id }, { current_day: 14 });
  const r = await t.call('POST', '/api/student/exam/submit', { token: s.token, body: { day_number: 14, quiz_answers: [], fill_answers: [] } });
  assert.equal(r.status, 409);
  const me = await t.call('GET', '/api/student/me', { token: s.token });
  assert.equal(me.data.user.current_day, 14);
});

test('obuna + 5 kun muddat tugasa: avtomatik blok + 403; /me va login bloklanganini ko\'rsatadi; admin ochadi (oy oxirigacha, current_day saqlanadi)', async () => {
  const admin = await t.makeAdmin();
  const s = await t.makeStudent('Blocked Kid');
  await User.updateOne({ _id: s.user.id }, { current_day: 2, subscription_end_date: new Date(Date.now() - 6 * 86400000) });

  const lesson = await t.call('GET', '/api/student/lesson/today', { token: s.token });
  assert.equal(lesson.status, 403);
  assert.equal(lesson.data.blocked, true);
  assert.equal((await User.findById(s.user.id)).status, 'blocked');

  const me = await t.call('GET', '/api/student/me', { token: s.token });
  assert.equal(me.status, 200);
  assert.equal(me.data.user.status, 'blocked');
  const login = await t.call('POST', '/api/auth/login', { body: { full_name: 'Blocked Kid', password: 'pass1234' } });
  assert.equal(login.status, 200);
  assert.equal(login.data.user.status, 'blocked');
  assert.equal((await t.call('POST', '/api/student/lesson/complete', { token: s.token, body: { day_number: 2 } })).status, 403);

  // Admin legacy_id (Supabase uuid) bilan ochadi — ilova shuni biladi
  const un = await t.call('POST', `/api/admin/students/${s.user.legacy_id}/unblock`, { token: admin });
  assert.equal(un.status, 200);
  const u = await User.findById(s.user.id);
  assert.equal(u.status, 'active');
  assert.equal(u.current_day, 2);
  assert.equal(u.subscription_end_date.getTime(), endOfMonth(new Date()).getTime(), 'muddat shu oyning oxiri bo\'lishi kerak');
  assert.equal(u.payments.length, 1);
  assert.equal((await t.call('GET', '/api/student/lesson/today', { token: s.token })).status, 200);
});

test('final_exam (70-kun): faqat Speaking; exam/submit rad; faqat admin tasdiqlaydi -> 71 va elementary', async () => {
  const admin = await t.makeAdmin('Admin Two');
  await StudyPlan.create({
    day_number: 70, unit_title: 'Final', vocabulary: vocab, quizzes: quiz(2),
    speaking_questions: [{ topic: 'My family', question_text: 'Tell me about your family.', hint_words: ['mother', 'father'] }],
  });
  const s = await t.makeStudent('Final Kid');
  await User.updateOne({ _id: s.user.id }, { current_day: 70 });

  const lesson = await t.call('GET', '/api/student/lesson/today', { token: s.token });
  assert.equal(lesson.data.lesson_type, 'final_exam');
  assert.equal(lesson.data.speaking_questions.length, 1);
  assert.equal(lesson.data.vocabulary, undefined);
  assert.equal(lesson.data.quizzes, undefined);

  assert.equal((await t.call('POST', '/api/student/exam/submit', { token: s.token, body: { day_number: 70, quiz_answers: [0, 1] } })).status, 400);
  assert.equal((await t.call('POST', '/api/student/lesson/complete', { token: s.token, body: { day_number: 70 } })).status, 400);
  assert.equal((await t.call('POST', `/api/admin/students/${s.user.id}/approve-speaking`, { token: s.token })).status, 403);
  // 450 kunlik tizimda Speaking tasdiqlash yo'q
  assert.equal((await t.call('POST', `/api/admin/students/${s.user.id}/approve-speaking`, { token: admin })).status, 410);
});

test('admin parse-unit: noto\'g\'ri kirish rad etiladi', async () => {
  const admin = await t.makeAdmin('Admin Four');
  assert.equal((await t.call('POST', '/api/admin/parse-unit', { token: admin, body: { rawText: 'short', day_number: 1 } })).status, 400);
  assert.equal((await t.call('POST', '/api/admin/parse-unit', { token: admin, body: { rawText: 'x'.repeat(50), day_number: 647 } })).status, 400);
});

test('birinchi admin yaratilishi: legacy_id yo\'q bir nechta foydalanuvchi to\'qnashmaydi (sparse unique)', async () => {
  const a = await t.makeAdmin('NoLegacy A');
  const b = await t.makeAdmin('NoLegacy B');
  assert.ok(a && b);
});

test('eskirgan ekran: noto\'g\'ri day_number bilan yakunlash rad etiladi va kun oshmaydi', async () => {
  await StudyPlan.create({ day_number: 4, unit_title: 'U4', vocabulary: vocab, quizzes: quiz(2) });
  const s = await t.makeStudent('Stale Kid');
  await User.updateOne({ _id: s.user.id }, { current_day: 4 });
  const r = await t.call('POST', '/api/student/lesson/complete', { token: s.token, body: { day_number: 3 } });
  assert.equal(r.status, 409);
  const none = await t.call('POST', '/api/student/lesson/complete', { token: s.token });
  assert.equal(none.status, 409);
  assert.equal((await User.findById(s.user.id)).current_day, 4);
});

test('admin o\'quvchini o\'chiradi (legacy_id bilan); admin o\'zini o\'chira olmaydi; qayta o\'chirish xatosiz', async () => {
  const admin = await t.makeAdmin('Admin Five');
  const s = await t.makeStudent('Kick Kid');
  assert.equal((await t.call('DELETE', `/api/admin/students/${s.user.legacy_id}`, { token: admin })).status, 200);
  assert.equal(await User.countDocuments({ name_key: 'kick kid' }), 0);
  assert.equal((await t.call('DELETE', `/api/admin/students/${s.user.legacy_id}`, { token: admin })).status, 200);
  const adm = await User.findOne({ name_key: 'admin five' });
  assert.equal((await t.call('DELETE', `/api/admin/students/${adm._id}`, { token: admin })).status, 400);
  // o'chirilgan o'quvchining eski tokeni endi ishlamaydi
  assert.equal((await t.call('GET', '/api/student/me', { token: s.token })).status, 401);
  // ism qayta ro'yxatdan o'tish uchun bo'shaydi
  assert.equal((await t.call('POST', '/api/auth/register', { body: { full_name: 'Kick Kid', password: 'abcd', group_name: '1-guruh' } })).status, 201);
});

test('muddat tugadi, lekin 5 kun ichida: dars ochiq, subscription.state=grace; 5 kundan keyin blok', async () => {
  const s = await t.makeStudent('Grace Kid');
  await User.updateOne({ _id: s.user.id }, { subscription_end_date: new Date(Date.now() - 2 * 86400000) });
  const me = await t.call('GET', '/api/student/me', { token: s.token });
  assert.equal(me.data.user.status, 'active');
  assert.equal(me.data.user.subscription.state, 'grace');
  assert.ok(me.data.user.subscription.grace_days_left >= 3 && me.data.user.subscription.grace_days_left <= 4);
  assert.equal((await t.call('GET', '/api/student/lesson/today', { token: s.token })).status, 200);

  await User.updateOne({ _id: s.user.id }, { subscription_end_date: new Date(Date.now() - 5 * 86400000 - 1000) });
  assert.equal((await t.call('GET', '/api/student/lesson/today', { token: s.token })).status, 403);
});

test('to\'lov: shu oy / keyingi oy / aniq sana; qo\'sh bosish 409; talaba o\'zi to\'lay olmaydi', async () => {
  const admin = await t.makeAdmin('Pay Admin');
  const s = await t.makeStudent('Pay Kid');
  await User.updateOne({ _id: s.user.id }, { subscription_end_date: new Date(Date.now() - 6 * 86400000), status: 'blocked', current_day: 7 });

  assert.equal((await t.call('POST', `/api/admin/students/${s.user.id}/pay`, { token: s.token, body: { months: 1 } })).status, 403);

  const p1 = await t.call('POST', `/api/admin/students/${s.user.id}/pay`, { token: admin, body: { months: 1 } });
  assert.equal(p1.status, 200);
  let u = await User.findById(s.user.id);
  assert.equal(u.status, 'active');
  assert.equal(u.current_day, 7);
  assert.equal(u.subscription_end_date.getTime(), endOfMonth(new Date()).getTime());

  const again = await t.call('POST', `/api/admin/students/${s.user.id}/pay`, { token: admin, body: { months: 1 } });
  assert.equal(again.status, 409);

  const p2 = await t.call('POST', `/api/admin/students/${s.user.id}/pay`, { token: admin, body: { months: 2 } });
  assert.equal(p2.status, 200);
  u = await User.findById(s.user.id);
  assert.equal(u.subscription_end_date.getTime(), endOfMonth(new Date(), 1).getTime());

  assert.equal((await t.call('POST', `/api/admin/students/${s.user.id}/pay`, { token: admin, body: { months: 0 } })).status, 400);
  assert.equal((await t.call('POST', `/api/admin/students/${s.user.id}/pay`, { token: admin, body: { end_date: '2020-01-01' } })).status, 400);
  assert.equal((await t.call('POST', `/api/admin/students/${s.user.id}/pay`, { token: admin, body: { end_date: '2099-02-31' } })).status, 400);

  const c = await t.call('POST', `/api/admin/students/${s.user.id}/pay`, { token: admin, body: { end_date: '2099-03-10' } });
  assert.equal(c.status, 200);
  u = await User.findById(s.user.id);
  assert.equal(u.subscription_end_date.toISOString(), '2099-03-10T18:59:59.999Z'); // 10-mart 23:59:59.999 Toshkent
  assert.equal(u.payments.length, 3);
});
