const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { setup, quiz, fill, vocab, StudyPlan, User } = require('./helpers');

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

  const [a, b] = await Promise.all([
    t.call('POST', '/api/student/lesson/complete', { token: s.token, body: { day_number: 1 } }),
    t.call('POST', '/api/student/lesson/complete', { token: s.token, body: { day_number: 1 } }),
  ]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  const me = await t.call('GET', '/api/student/me', { token: s.token });
  assert.equal(me.data.user.current_day, 2);
});

test('mini_check (3-kun): javoblar yashirin, soxta ball e\'tiborga olinmaydi, <70% yiqiladi, >=70% o\'tadi', async () => {
  await StudyPlan.create({ day_number: 3, unit_title: 'Check', vocabulary: vocab, quizzes: quiz(4), fill_in_the_blanks: fill(1) });
  const s = await t.makeStudent('Exam Kid');
  await User.updateOne({ _id: s.user.id }, { current_day: 3 });

  const lesson = await t.call('GET', '/api/student/lesson/today', { token: s.token });
  assert.equal(lesson.data.lesson_type, 'mini_check');
  const raw = JSON.stringify(lesson.data);
  assert.ok(!raw.includes('correct_answer_index') && !raw.includes('correct_word'), 'to\'g\'ri javoblar sizib chiqdi');
  assert.equal(lesson.data.quizzes.length, 4);

  // hammasi noto'g'ri + soxta "hammasi to'g'ri" maydonlari
  const fail = await t.call('POST', '/api/student/exam/submit', {
    token: s.token,
    body: { day_number: 3, quiz_answers: [9, 9, 9, 9], fill_answers: ['x'], correct_answers_count: 5, total_questions_count: 5, score_percent: 100 },
  });
  assert.equal(fail.data.passed, false);
  assert.equal(fail.data.score_percent, 0);
  assert.equal(fail.data.new_current_day, 3);

  // 5 tadan 3 ta to'g'ri = 60% -> yiqiladi
  const sixty = await t.call('POST', '/api/student/exam/submit', {
    token: s.token, body: { day_number: 3, quiz_answers: [0, 1, 2, 0], fill_answers: ['nope'] },
  });
  assert.equal(sixty.data.score_percent, 60);
  assert.equal(sixty.data.passed, false);
  assert.equal(sixty.data.new_current_day, 3);

  // 5 tadan 4 ta = 80% -> o'tadi (to'ldirish javobi katta-kichik harfga e'tiborsiz)
  const pass = await t.call('POST', '/api/student/exam/submit', {
    token: s.token, body: { day_number: 3, quiz_answers: [0, 1, 2, 3], fill_answers: ['  WORD0 '] },
  });
  assert.equal(pass.data.passed, true);
  assert.equal(pass.data.new_current_day, 4);
});

test('imtihon savollari yo\'q kunda avtomatik o\'tkazib yubormaydi (0 ga bo\'lish yo\'q)', async () => {
  await StudyPlan.create({ day_number: 6, unit_title: 'Bo\'sh check', vocabulary: vocab });
  const s = await t.makeStudent('Empty Exam Kid');
  await User.updateOne({ _id: s.user.id }, { current_day: 6 });
  const r = await t.call('POST', '/api/student/exam/submit', { token: s.token, body: { day_number: 6, quiz_answers: [], fill_answers: [] } });
  assert.equal(r.status, 409);
  const me = await t.call('GET', '/api/student/me', { token: s.token });
  assert.equal(me.data.user.current_day, 6);
});

test('obuna muddati o\'tsa: avtomatik blok + 403; /me va login bloklanganini ko\'rsatadi; admin ochadi (+30 kun, current_day saqlanadi)', async () => {
  const admin = await t.makeAdmin();
  const s = await t.makeStudent('Blocked Kid');
  await User.updateOne({ _id: s.user.id }, { current_day: 2, subscription_end_date: new Date(Date.now() - 1000) });

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
  const days = (u.subscription_end_date - Date.now()) / 86400000;
  assert.ok(days > 29.9 && days <= 30, `muddat ~30 kun bo'lishi kerak, ${days}`);
  assert.equal((await t.call('GET', '/api/student/lesson/today', { token: s.token })).status, 200);
});

test('final_exam (100-kun): faqat Speaking; exam/submit rad; faqat admin tasdiqlaydi -> 101 va intermediate', async () => {
  const admin = await t.makeAdmin('Admin Two');
  await StudyPlan.create({
    day_number: 100, unit_title: 'Final', vocabulary: vocab, quizzes: quiz(2),
    speaking_questions: [{ topic: 'My family', question_text: 'Tell me about your family.', hint_words: ['mother', 'father'] }],
  });
  const s = await t.makeStudent('Final Kid');
  await User.updateOne({ _id: s.user.id }, { current_day: 100 });

  const lesson = await t.call('GET', '/api/student/lesson/today', { token: s.token });
  assert.equal(lesson.data.lesson_type, 'final_exam');
  assert.equal(lesson.data.speaking_questions.length, 1);
  assert.equal(lesson.data.vocabulary, undefined);
  assert.equal(lesson.data.quizzes, undefined);

  assert.equal((await t.call('POST', '/api/student/exam/submit', { token: s.token, body: { day_number: 100, quiz_answers: [0, 1] } })).status, 400);
  assert.equal((await t.call('POST', '/api/student/lesson/complete', { token: s.token, body: { day_number: 100 } })).status, 400);
  assert.equal((await t.call('POST', `/api/admin/students/${s.user.id}/approve-speaking`, { token: s.token })).status, 403);

  const ok = await t.call('POST', `/api/admin/students/${s.user.id}/approve-speaking`, { token: admin });
  assert.equal(ok.status, 200);
  assert.equal(ok.data.student.current_day, 101);
  assert.equal(ok.data.student.level, 'intermediate');

  // ikkinchi marta bosish -> 101-kun final emas
  assert.equal((await t.call('POST', `/api/admin/students/${s.user.id}/approve-speaking`, { token: admin })).status, 400);
});

test('400-kundan keyin kurs tugaydi', async () => {
  const admin = await t.makeAdmin('Admin Three');
  const s = await t.makeStudent('Graduate Kid');
  await User.updateOne({ _id: s.user.id }, { current_day: 400 });
  const ok = await t.call('POST', `/api/admin/students/${s.user.id}/approve-speaking`, { token: admin });
  assert.equal(ok.data.student.current_day, 401);
  const lesson = await t.call('GET', '/api/student/lesson/today', { token: s.token });
  assert.equal(lesson.data.completed, true);
});

test('admin parse-unit: noto\'g\'ri kirish rad etiladi', async () => {
  const admin = await t.makeAdmin('Admin Four');
  assert.equal((await t.call('POST', '/api/admin/parse-unit', { token: admin, body: { rawText: 'short', day_number: 1 } })).status, 400);
  assert.equal((await t.call('POST', '/api/admin/parse-unit', { token: admin, body: { rawText: 'x'.repeat(50), day_number: 401 } })).status, 400);
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
