/* ==========================================================================
   ШКОЛА ДРОП — тесты математики мини-игры «Ракета» (Crash)
   Запуск:  npm run test:unit     (или: node tests/crash-math.test.js)

   Тесты не требуют браузера и зависимостей: js/config.js поднимается в
   изолированном контексте Node, поэтому проверяется именно та математика,
   которая работает в игре.
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* ---------- Загружаем конфиг игры «как есть» ---------- */
const configSrc = fs.readFileSync(path.resolve(__dirname, '..', 'js', 'config.js'), 'utf8');
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(configSrc, ctx);

/* Достаём объявления из контекста выражениями: top-level const/class в скрипте
   не становятся свойствами globalThis, но видны следующим runInContext. */
const get = expr => vm.runInContext(expr, ctx);

const CRASH_CONFIG = get('CRASH_CONFIG');
const MINI_GAMES = get('MINI_GAMES');
const ACHIEVEMENTS = get('ACHIEVEMENTS');
const XP_REWARDS = get('XP_REWARDS');
const crashPointFromRoll = get('crashPointFromRoll');
const crashMultiplierAt = get('crashMultiplierAt');
const crashTimeToMultiplier = get('crashTimeToMultiplier');
const crashPayout = get('crashPayout');

let passed = 0, failed = 0;
const t = (name, cond, extra = '') => {
  if (cond) { passed++; console.log('  ✔', name); }
  else { failed++; console.log('  ✘ FAIL:', name, extra); }
};
const close = (a, b, tol) => Math.abs(a - b) <= tol;

/* Детерминированный PRNG (mulberry32), чтобы тесты были стабильными */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

console.log('\n🚀 МАТЕМАТИКА РАКЕТЫ');

/* ---------- 1. Границы и формула точки краша ---------- */
{
  const roll = seeded(20260912);
  let min = Infinity, max = -Infinity, bad = 0;
  const N = 300000;
  for (let i = 0; i < N; i++) {
    const x = crashPointFromRoll(roll());
    if (!Number.isFinite(x) || x < 1 || x > CRASH_CONFIG.maxMultiplier) bad++;
    if (x < min) min = x;
    if (x > max) max = x;
  }
  t('точка краша всегда >= 1.00× и <= максимума', bad === 0, `битых: ${bad}`);
  t('нижняя граница = 1.00×', close(min, 1, 1e-9), `min=${min}`);
  t('верхняя граница в пределах потолка', max <= CRASH_CONFIG.maxMultiplier && max > 1000, `max=${max.toFixed(2)}`);

  t('roll=0.5 даёт 1.90× (по формуле (1-edge)/(1-r))',
    close(crashPointFromRoll(0.5), (1 - CRASH_CONFIG.houseEdge) / 0.5, 1e-9));
  t('мусор на входе не ломает формулу',
    crashPointFromRoll(NaN) >= 1 && crashPointFromRoll(-5) >= 1 && crashPointFromRoll(2) >= 1);
}

/* ---------- 2. Распределение: P(долететь до X) = (1 - edge) / X ---------- */
{
  const roll = seeded(777);
  const N = 400000;
  const marks = [1.5, 2, 3, 5, 10, 25];
  let worst = 0;
  for (const X of marks) {
    let hits = 0;
    for (let i = 0; i < N; i++) if (crashPointFromRoll(roll()) >= X) hits++;
    const actual = hits / N;
    const expected = (1 - CRASH_CONFIG.houseEdge) / X;
    worst = Math.max(worst, Math.abs(actual - expected) / expected);
  }
  t('распределение совпадает с теорией (отклонение < 3%)', worst < 0.03,
    `макс. отклонение ${(worst * 100).toFixed(2)}%`);
}

/* ---------- 3. RTP: при выводе на фиксированном X возврат = 1 - edge ---------- */
{
  const roll = seeded(31337);
  const N = 400000;
  for (const X of [1.5, 2, 5, 10]) {
    let stake = 0, payout = 0;
    for (let i = 0; i < N; i++) {
      stake += 1;
      if (crashPointFromRoll(roll()) >= X) payout += X;   // успели забрать
    }
    const rtp = payout / stake;
    t(`RTP при выводе на ${X.toFixed(2)}× ≈ ${(1 - CRASH_CONFIG.houseEdge).toFixed(2)}`,
      close(rtp, 1 - CRASH_CONFIG.houseEdge, 0.02), `получилось ${rtp.toFixed(4)}`);
  }
}

/* ---------- 4. Тайминг полёта: разгон, кривая роста ---------- */
{
  const TO = CRASH_CONFIG.takeoffSec;
  t('в момент старта множитель = 1.00×', close(crashMultiplierAt(0), 1, 1e-12));

  // Фаза разгона: множитель держится ровно 1.00×, взрыв раньше невозможен
  t('разгон длится не меньше 1 секунды', TO >= 1 && TO <= 1.5, `${TO} сек`);
  let flat = true;
  for (let t = 0; t < TO; t += 0.05) if (crashMultiplierAt(t) !== 1) flat = false;
  t('всю фазу разгона множитель ровно 1.00×', flat);
  t('сразу после разгона множитель начинает расти', crashMultiplierAt(TO + 0.05) > 1);

  // Монотонный рост после разгона
  const after = [TO, TO + 1, TO + 2, TO + 4, TO + 8, TO + 15];
  t('множитель растёт монотонно после разгона', after.every((v, i, a) =>
    i === 0 || crashMultiplierAt(v) > crashMultiplierAt(a[i - 1])));
  t('множитель растёт монотонно и на разгоне-границе',
    crashMultiplierAt(TO) >= crashMultiplierAt(TO - 0.01));

  // Ни один раунд не может взорваться раньше минимального времени полёта
  const roll = seeded(4242);
  let minTime = Infinity;
  for (let i = 0; i < 200000; i++) {
    minTime = Math.min(minTime, crashTimeToMultiplier(crashPointFromRoll(roll())));
  }
  t('минимальное время до возможного взрыва >= takeoffSec',
    minTime >= TO - 1e-9, `минимум ${minTime.toFixed(3)} сек`);
  t('мгновенного краша на первой миллисекунде нет', crashTimeToMultiplier(1) >= 1);

  // Плавный и предсказуемый старт + ускорение на высоких иксах
  const m1 = crashMultiplierAt(TO + 1);
  const m10 = crashMultiplierAt(TO + 10);
  t('за первую секунду полёта множитель вырастает не больше чем на 0.30',
    m1 - 1 <= 0.3, `${(m1 - 1).toFixed(3)}`);
  t('на высоких иксах рост ускоряется',
    (crashMultiplierAt(TO + 20) / m10) > (m10 / m1) / 10, `10с=${m10.toFixed(2)}×`);

  const t2 = crashTimeToMultiplier(2);
  t('2.00× достигается за разумные 2–8 секунд', t2 > 2 && t2 < 8, `${t2.toFixed(2)} сек`);
  t('время и множитель согласованы (прямая + обратная формула)',
    close(crashMultiplierAt(crashTimeToMultiplier(7.5)), 7.5, 1e-9));
  t('отрицательное время не даёт множитель ниже 1', crashMultiplierAt(-10) === 1);
  t('лимиты ставок заданы и адекватны',
    CRASH_CONFIG.minBet > 0 && CRASH_CONFIG.maxBet > CRASH_CONFIG.minBet &&
    CRASH_CONFIG.maxBet <= 1e9, `${CRASH_CONFIG.minBet}…${CRASH_CONFIG.maxBet}`);
}

/* ---------- 5. Выплата ---------- */
{
  t('выплата = ставка × множитель (округление вниз)', crashPayout(1000, 2.5) === 2500);
  t('дробный множитель округляется вниз до целых ₽', crashPayout(333, 1.33) === 442);
  t('мусорная ставка даёт 0, а не NaN', crashPayout(NaN, 5) === 0 && crashPayout(-100, 5) === 0);
  t('множитель ниже 1 не срезает ставку', crashPayout(1000, 0.5) === 1000);
}

console.log('\n🎮 РЕЕСТР МИНИ-ИГР');

/* ---------- 6. Меню мини-игр ---------- */
{
  t('MINI_GAMES — массив', Array.isArray(MINI_GAMES));
  t('все игры имеют id/tab/name/icon', MINI_GAMES.every(g =>
    g && g.id && g.tab && g.name && g.icon));
  t('id игр уникальны', new Set(MINI_GAMES.map(g => g.id)).size === MINI_GAMES.length);
  const ids = MINI_GAMES.map(g => g.id);
  t('в меню есть Кейсы, Апгрейд и Ракета',
    ids.includes('cases') && ids.includes('upgrade') && ids.includes('crash'), ids.join(', '));
  const crash = MINI_GAMES.find(g => g.id === 'crash');
  t('ракета ведёт на вкладку crash', crash && crash.tab === 'crash');
  t('у каждой игры есть описание для меню', MINI_GAMES.every(g => typeof g.desc === 'string' && g.desc.length > 10));
  t('enabled() у игр возвращает true', MINI_GAMES.every(g => g.enabled() === true));
}

console.log('\n🏆 ДОСТИЖЕНИЯ И ОПЫТ');

/* ---------- 7. Достижения ракеты ---------- */
{
  const crashAch = ACHIEVEMENTS.filter(a => String(a.id).startsWith('crash_'));
  t('достижения ракеты добавлены', crashAch.length >= 4, `найдено: ${crashAch.length}`);
  t('у достижений ракеты числовые метрики', crashAch.every(a =>
    ['crashRounds', 'crashWins', 'crashBestMult'].includes(a.metric)));
  t('id достижений уникальны', new Set(ACHIEVEMENTS.map(a => a.id)).size === ACHIEVEMENTS.length);
  t('у всех достижений есть награда', ACHIEVEMENTS.every(a => a.money >= 0 && a.xp >= 0));
  t('опыт за раунд и за победу задан', XP_REWARDS.crashRound > 0 && XP_REWARDS.crashWin > XP_REWARDS.crashRound);
}

/* ---------- Итог ---------- */
console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
