/**
 * Gemini REST API'ning yolg'on nusxasi. Haqiqiy @google/generative-ai SDK shu serverga ulanadi
 * (GEMINI_BASE_URL orqali), shuning uchun fayl yuklash -> holat so'rovi -> generatsiya -> o'chirish
 * ketma-ketligi SDK darajasida tekshiriladi.
 */
const http = require('http');

const goodBook = () => ({
  title: 'Family and Friends',
  writing: {
    vocabulary: Array.from({ length: 8 }, (_, i) => ({ word: `word${i}`, translation_uz: `soz${i}`, example_sentence: `This is word${i}.` })),
    grammar: [
      {
        title: 'Present Simple',
        explanation_uz: "Har kuni takrorlanadigan ishlar uchun ishlatiladi.",
        examples: ['She plays tennis.', 'They go to school.'],
        exercises: [
          { sentence_with_blank: 'She ___ to school.', correct_word: 'goes', options: ['go', 'goes', 'going', 'gone'] },
          { sentence_with_blank: 'They ___ football.', correct_word: 'play', options: ['plays', 'play'] },
        ],
      },
    ],
  },
  reading: {
    title: 'My Family',
    text: 'My name is Anna and I live in a small house with my family. '.repeat(3),
    key_words: [{ word: 'family', translation_uz: 'oila' }, { word: 'house', translation_uz: 'uy' }, { word: 'live', translation_uz: 'yashamoq' }],
    questions: Array.from({ length: 5 }, (_, i) => ({ question: `Q${i}?`, options: ['a', 'b', 'c', 'd'], correct_answer_index: i % 4 })),
  },
  listening: {
    title: 'A Day',
    script: 'Tom wakes up at seven o clock every morning. He brushes his teeth and eats breakfast with his sister.',
    questions: Array.from({ length: 5 }, (_, i) => ({ question: `L${i}?`, options: ['w', 'x', 'y', 'z'], correct_answer_index: (i + 1) % 4 })),
    dictation_sentences: ['Tom wakes up early.', 'He eats breakfast.', 'They go to school.'],
  },
  speaking: {
    questions: Array.from({ length: 6 }, (_, i) => ({ topic: `Topic ${i}`, question_text: `Tell me about number ${i}.`, hint_words: ['one', 'two', 'three', 'four'] })),
  },
});

function startFakeGemini({ processingPolls = 1, responder } = {}) {
  const calls = { uploads: [], polls: 0, deletes: [], generates: [] };
  let nextId = 0;
  const files = new Map();

  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      const url = new URL(req.url, 'http://x');
      const send = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      const base = `http://127.0.0.1:${server.address().port}`;

      if (req.method === 'POST' && url.pathname === '/upload/v1beta/files') {
        const text = raw.toString('latin1');
        const mime = (text.match(/Content-Type: ([^\r\n]+)\r\n\r\n/g) || [])[1]?.replace(/Content-Type: |\r\n\r\n/g, '');
        const id = `f${++nextId}`;
        const meta = { name: `files/${id}`, mimeType: mime, uri: `${base}/v1beta/files/${id}`, state: 'PROCESSING', sizeBytes: String(raw.length) };
        files.set(id, { ...meta, polls: 0 });
        calls.uploads.push({ mime, protocol: req.headers['x-goog-upload-protocol'], apiKey: req.headers['x-goog-api-key'], bytes: raw.length });
        return send(200, { file: meta });
      }
      const fm = url.pathname.match(/^\/v1beta\/files\/(\w+)$/);
      if (fm && req.method === 'GET') {
        const f = files.get(fm[1]);
        if (!f) return send(404, { error: { code: 404, message: 'no file' } });
        calls.polls++;
        f.polls++;
        return send(200, { ...f, state: f.polls >= processingPolls ? 'ACTIVE' : 'PROCESSING' });
      }
      if (fm && req.method === 'DELETE') {
        calls.deletes.push(fm[1]);
        files.delete(fm[1]);
        return send(200, {});
      }
      const gm = url.pathname.match(/^\/v1beta\/models\/([^:]+):generateContent$/);
      if (gm && req.method === 'POST') {
        const body = JSON.parse(raw.toString('utf8'));
        calls.generates.push({ model: gm[1], body });
        const out = responder ? responder(body, calls.generates.length) : { status: 200, json: goodBook() };
        if (out.status !== 200) return send(out.status, out.error || { error: { code: out.status, status: 'ERR', message: 'fake error' } });
        const text = out.raw !== undefined ? out.raw : JSON.stringify(out.json);
        return send(200, { candidates: [{ content: { role: 'model', parts: [{ text }] }, finishReason: 'STOP', index: 0 }] });
      }
      send(404, { error: { code: 404, message: `unhandled ${req.method} ${url.pathname}` } });
    });
  });

  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({ url: `http://127.0.0.1:${server.address().port}`, calls, close: () => new Promise((r) => server.close(r)), goodBook })
    )
  );
}

module.exports = { startFakeGemini, goodBook };
