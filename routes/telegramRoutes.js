/**
 *  POST /api/telegram/webhook : Telegram yuboradi (X-Telegram-Bot-Api-Secret-Token tekshiriladi)
 *  GET|POST /api/telegram/cron?key=CRON_SECRET : har 10 daqiqada tashqi cron (Render uxlab qolsa ham ishlaydi)
 */
const express = require('express');
const crypto = require('crypto');
const { createBot } = require('../services/telegramBot');

const same = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y); };

function buildBot() {
  return createBot({
    token: process.env.TELEGRAM_BOT_TOKEN,
    teacherIds: String(process.env.TELEGRAM_TEACHER_IDS || '').split(',').map((s) => s.trim()),
    User: require('../models/User'), Group: require('../models/Group'), CourseState: require('../models/CourseState'),
    NotifyLog: require('../models/NotifyLog'), BotState: require('../models/BotState'),
  });
}

function makeRouter(bot = buildBot(), env = process.env) {
  const router = express.Router();
  router.post('/webhook', async (req, res) => {
    if (!env.TELEGRAM_WEBHOOK_SECRET || !same(req.get('x-telegram-bot-api-secret-token'), env.TELEGRAM_WEBHOOK_SECRET)) return res.sendStatus(403);
    res.sendStatus(200); // Telegram'ga darrov javob, ishni orqada bajaramiz
    bot.handleUpdate(req.body);
  });
  const cron = async (req, res) => {
    if (!env.CRON_SECRET || !same(req.query.key, env.CRON_SECRET)) return res.sendStatus(403);
    try { res.status(200).json(await bot.runCheck()); } catch (e) { console.error('telegram cron xatosi:', e.message); res.status(500).json({ message: 'Xato' }); }
  };
  router.get('/cron', cron);
  router.post('/cron', cron);
  return router;
}
module.exports = { makeRouter, buildBot };
