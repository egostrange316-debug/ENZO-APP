process.env.JWT_SECRET = 'test_secret_test_secret_123';
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const StudyPlan = require('../models/StudyPlan');

const MONGO = process.env.TEST_MONGO_URI || 'mongodb://127.0.0.1:27017';

async function setup() {
  const app = require('../server');
  await mongoose.connect(`${MONGO}/kids_test_${Date.now()}_${Math.floor(Math.random() * 1e6)}`);
  await Promise.all([User.init(), StudyPlan.init()]);
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(method, path, { token, body } = {}) {
    const res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json().catch(() => ({})) };
  }
  async function teardown() {
    server.close();
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
  async function makeAdmin(name = 'Admin Test', password = 'adminpass123') {
    await User.create({ full_name: name, password_hash: await bcrypt.hash(password, 4), role: 'admin' });
    const r = await call('POST', '/api/auth/login', { body: { full_name: name, password } });
    return r.data.token;
  }
  async function makeStudent(name, password = 'pass1234', group_name = '1-guruh') {
    const r = await call('POST', '/api/auth/register', { body: { full_name: name, password, group_name } });
    return r.data;
  }
  return { call, teardown, makeAdmin, makeStudent };
}

const quiz = (n) => Array.from({ length: n }, (_, i) => ({
  question: `Savol ${i}`, options: ['a', 'b', 'c', 'd'], correct_answer_index: i % 4,
}));
const fill = (n) => Array.from({ length: n }, (_, i) => ({
  sentence_with_blank: `I like ___ ${i}.`, correct_word: `word${i}`,
}));
const vocab = [{ word: 'apple', translation_uz: 'olma', example_sentence: 'An apple.' }];

module.exports = { setup, quiz, fill, vocab, StudyPlan, User };
