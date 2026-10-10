/**
 * Juda oddiy xotiradagi navbat. Gemini bepul tarifida so'rovlar soni cheklangan, shuning uchun
 * bir vaqtda kam sonli tahlil ishlaydi, qolganlari navbatda kutadi.
 * DIQQAT: xotirada — server qayta ishga tushsa, navbatdagi/ishlayotgan ishlar yo'qoladi
 * (kitob yozuvi 'processing' da qolib, keyin avtomatik 'failed' deb belgilanadi).
 */
function createQueue(concurrency = 2) {
  let running = 0;
  const waiting = [];
  let idleResolvers = [];

  const notifyIdle = () => {
    if (running === 0 && waiting.length === 0) {
      idleResolvers.forEach((r) => r());
      idleResolvers = [];
    }
  };

  const next = () => {
    while (running < concurrency && waiting.length) {
      const job = waiting.shift();
      running++;
      Promise.resolve()
        .then(job)
        .catch((e) => console.error('Navbat ishi xatosi:', e))
        .finally(() => {
          running--;
          next();
          notifyIdle();
        });
    }
  };

  return {
    enqueue(job) {
      waiting.push(job);
      next();
    },
    /** Testlar uchun: navbat bo'shaguncha kutadi */
    onIdle() {
      return running === 0 && waiting.length === 0 ? Promise.resolve() : new Promise((r) => idleResolvers.push(r));
    },
    get size() {
      return running + waiting.length;
    },
  };
}

module.exports = { createQueue };
