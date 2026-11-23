// Bir marta: node scripts/telegramSetup.js https://enzo-app.onrender.com
// Kerak: TELEGRAM_BOT_TOKEN va TELEGRAM_WEBHOOK_SECRET (set bilan kiriting). Token ekranga chiqmaydi.
const url = process.argv[2];
const { TELEGRAM_BOT_TOKEN: t, TELEGRAM_WEBHOOK_SECRET: s } = process.env;
if (!url || !t || !s) { console.error('Ishlatish: set TELEGRAM_BOT_TOKEN=... && set TELEGRAM_WEBHOOK_SECRET=... && node scripts/telegramSetup.js https://SIZNING-SERVER'); process.exit(1); }
fetch(`https://api.telegram.org/bot${t}/setWebhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: url.replace(/\/$/, '') + '/api/telegram/webhook', secret_token: s, allowed_updates: ['message', 'callback_query'] }) })
  .then((r) => r.json()).then((j) => console.log(j.ok ? 'Tayyor: webhook ulandi' : 'Xato: ' + j.description)).catch((e) => console.error('Xato:', e.message));
