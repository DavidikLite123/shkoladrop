/* ==========================================================================
   ШКОЛА ДРОП — интеграционные тесты мини-игры «Бутылочка» (jsdom)
   Запуск:  npm run test:ui      (или: node tests/bottle-ui.test.js)

   Поднимает настоящий index.html в jsdom, загружает все скрипты проекта в том
   же порядке, что и браузер, и прогоняет: меню «Игры», переключение вкладки,
   выбор предметов, назначение ставки и полные раунды «Бутылочки»
   (выигрыш и проигрыш), плюс защиту от невалидных столов. Требуется jsdom.
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

let JSDOM;
try {
  ({ JSDOM } = require('jsdom'));
} catch (e) {
  console.log('⚠️  jsdom не установлен — пропускаем UI-тесты (npm install)');
  process.exit(0);
}

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let passed = 0, failed = 0;
const t = (name, cond, extra = '') => {
  if (cond) { passed++; console.log('  ✔', name); }
  else { failed++; console.log('  ✘ FAIL:', name, extra); }
};

/* ---------- Заглушки браузерных API, которых в jsdom нет ---------- */
const noop = () => {};
function stubCanvasContext() {
  const gradient = { addColorStop: noop };
  const ctx = {
    setTransform: noop, clearRect: noop, fillRect: noop, strokeRect: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop, ellipse: noop,
    quadraticCurveTo: noop, bezierCurveTo: noop, rect: noop,
    fill: noop, stroke: noop, fillText: noop, strokeText: noop, clip: noop,
    save: noop, restore: noop, translate: noop, rotate: noop, scale: noop,
    setLineDash: noop, drawImage: noop,
    createLinearGradient: () => gradient, createRadialGradient: () => gradient,
    createPattern: () => null, measureText: () => ({ width: 10 }),
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: '', lineJoin: '',
    font: '', textAlign: '', textBaseline: '', shadowColor: '', shadowBlur: 0
  };
  return ctx;
}

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  url: 'http://localhost:3377/'
});
const { window } = dom;

window.HTMLCanvasElement.prototype.getContext = () => stubCanvasContext();
window.confetti = noop;
window.scrollTo = noop;
if (!window.navigator.vibrate) window.navigator.vibrate = noop;
if (!window.crypto || !window.crypto.getRandomValues) {
  window.crypto = { getRandomValues: arr => { for (let i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 4294967296); return arr; } };
}
window.fetch = () => Promise.reject(new Error('offline test'));

const errors = [];
window.addEventListener('error', e => errors.push(String(e.message || e.error)));
const origError = console.error;
console.error = (...a) => { errors.push(a.map(String).join(' ')); };

/* ---------- Загружаем скрипты проекта в порядке <script defer> ---------- */
const vmContext = dom.getInternalVMContext();
const g = expr => vm.runInContext(String(expr), vmContext);

function runScript(rel) {
  const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  try {
    vm.runInContext(code, vmContext, { filename: rel });
    return null;
  } catch (e) {
    return `${rel}: ${e.message}`;
  }
}

console.log('\n📦 ЗАГРУЗКА ПРОЕКТА');

const scriptFiles = [...html.matchAll(/<script[^>]+src="(js\/[^"]+)"/g)].map(m => m[1].split('?')[0]);
t('в разметке подключены все модули игры', scriptFiles.length >= 9, scriptFiles.join(', '));
t('модуль бутылочки подключён после иконок', scriptFiles.indexOf('js/bottle.js') > scriptFiles.indexOf('js/icons.js'));
const loadErrors = scriptFiles.map(runScript).filter(Boolean);
t('все скрипты проекта выполнились без исключений', loadErrors.length === 0, loadErrors.join(' | '));
t('игра запустилась (initGame отработал)', typeof g('state') !== 'undefined' && g('state').balance >= 0);

const tick = () => new Promise(r => setTimeout(r, 30));

(async () => {
  await tick();

  const { document } = window;
  const B = g('BottleGame');
  const st = g('state');
  const RNG = g('RNG');
  const origFloat = RNG.float;

  // Нейтрализуем побочные награды (уровни/достижения), чтобы точно мерить баланс
  g('RANKS').forEach(r => { r.reward = 0; });
  g('ACHIEVEMENTS').forEach(a => { a.money = 0; });
  // Сезонный подарок-извинение выдаётся таймером через 900 мс — отключаем, чтобы рюкзак был ровно стартовым
  st.apologyGiftPending = false;

  console.log('\n🍾 МЕНЮ «ИГРЫ» И ВКЛАДКА');

  const games = g('MiniGames');
  const bottleEntry = games.find('bottle');
  t('бутылочка есть в реестре игр', !!bottleEntry && bottleEntry.tab === 'bottle' && bottleEntry.iconSvg === 'bottle');
  t('в реестре четыре игры', games.list().length === 4, games.list().map(x => x.id).join(','));

  g('selectMiniGame')('bottle');
  t('панель бутылочки открылась', !document.getElementById('viewBottle').classList.contains('hidden'));
  t('остальные панели скрыты',
    document.getElementById('viewCrash').classList.contains('hidden') &&
    document.getElementById('viewCases').classList.contains('hidden'));
  t('текущая вкладка = bottle', g('currentTab') === 'bottle');
  t('кнопка «Игры» подсвечена как активная', document.getElementById('tabGames').classList.contains('nav-tab-active'));
  t('меню помечает текущую игру', document.getElementById('gamesList').textContent.includes('играешь'));

  console.log('\n🎨 ИКОНКИ ВМЕСТО ЭМОДЗИ');

  t('иконка bottle есть в реестре Icons', g('Icons').has('bottle'));
  const bottleEl = document.getElementById('bottleBottle');
  t('бутылочка — встроенный SVG (не эмодзи)',
    !!bottleEl && !!bottleEl.querySelector('svg') && !/[\u{1F300}-\u{1FAFF}]/u.test(bottleEl.textContent || ''));
  const viewIcons = [...document.querySelectorAll('#viewBottle [data-icon]')];
  t('в панели бутылочки есть векторные иконки', viewIcons.length >= 3, String(viewIcons.length));
  t('все иконки панели — встроенные SVG', viewIcons.every(i => !!i.querySelector('svg')));

  console.log('\n🃏 ВЫБОР ПРЕДМЕТОВ И СТАВКИ');

  const uidById = id => (st.inventory.find(i => i.id === id) || {}).uid;
  const u = { a: uidById('sch_bad_grade'), b: uidById('sch_cold_cutlet'), c: uidById('sch_chewed_pen'), d: uidById('sch_eraser') };
  t('стартовый рюкзак = 4 предмета', st.inventory.length === 4, String(st.inventory.length));
  t('все стартовые предметы опознаны по uid', !!(u.a && u.b && u.c && u.d), JSON.stringify(u));

  const pick = document.getElementById('bottlePick');
  const rowA = pick.querySelector(`[data-uid="${u.a}"]`);
  t('пикер отрисовал предметы рюкзака', !!rowA);
  rowA.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  t('клик по предмету кладёт его на стол (делегирование)', B.table.length === 1, String(B.table.length));
  B.toggleItem(u.b);
  B.toggleItem(u.c);
  B.toggleItem(u.d);
  t('на столе 4 предмета', B.table.length === 4, String(B.table.length));
  t('счётчик выбора показывает 4 / 6', document.getElementById('bottleCountInfo').textContent.includes('4 / 6'));
  t('авто-ставка = самый дешёвый предмет (двойка)', B.betUid === u.a, B.betUid);
  t('на столе отрисовано 4 слота', document.querySelectorAll('#bottleSlots .bottle-slot').length === 4);
  t('слот ставки помечен бейджем «СТАВКА»', document.querySelectorAll('#bottleSlots .bottle-slot-badge').length === 1);

  console.log('\n🛡 ВАЛИДАЦИЯ СТОЛА');

  B.clearTable();
  t('очистка стола работает', B.table.length === 0 && B.betUid === '');
  B.toggleItem(u.a);
  const beforeBad = st.balance;
  g('bottleSpin')();
  t('меньше 2 предметов не запускает вращение', B.phase === 'idle' && st.balance === beforeBad && st.inventory.length === 4);
  t('попытка не списала предметы', st.inventory.length === 4 && st.stats.bottleSpins === 0);

  B.toggleItem(u.b);              // на столе a(60) и b(150)
  B.setBet(u.b);                  // ставка = самый дорогой на столе → выиграть нельзя
  g('bottleSpin')();
  t('ставка = самый дорогой предмет блокирует вращение', B.phase === 'idle' && st.inventory.length === 4, B.phase);
  B.clearTable();                 // собираем полный стол заново, в известном порядке
  B.toggleItem(u.a);
  B.toggleItem(u.b);
  B.toggleItem(u.c);
  B.toggleItem(u.d);              // [a, b, c, d] → d (ластик, 500 ₽) на индексе 3
  B.setBet(u.a);                  // ставка = самый дешёвый (двойка, 60 ₽)

  console.log('\n🏆 ВРАЩЕНИЕ: ВЫИГРЫШ');

  RNG.float = () => 0.99;         // угол ~356° → сектор №3 = ластик (500 ₽), дороже ставки (60 ₽)
  st.balance = 1000000;
  g('bottleSpin')();
  t('вращение стартовало (phase = spinning)', B.spinning === true && B.phase === 'spinning', B.phase);
  t('точка остановки определена ДО вращения', B.landedIndex === 3 && B.landed && B.landed.id === 'sch_eraser',
    `${B.landedIndex} / ${B.landed && B.landed.id}`);
  t('предметы сняты с рюкзака на время вращения', st.inventory.length === 0, String(st.inventory.length));

  const spinsAfterStart = st.stats.bottleSpins;
  g('bottleSpin')();
  t('повторный запуск во время вращения ничего не списывает',
    B.table.length === 4 && st.stats.bottleSpins === spinsAfterStart);

  B.startWall = Date.now() - 5000;   // «бутылочка докрутилась»
  B.frame();
  t('выигрыш засчитан (phase = won)', B.phase === 'won', B.phase);
  t('бонус начислен: 500 − 60 = 440 ₽', st.balance === 1000000 + 440, String(st.balance));
  t('все предметы вернулись в рюкзак', st.inventory.length === 4, String(st.inventory.length));
  t('статистика выигрыша обновилась',
    st.stats.bottleWins === 1 && st.stats.bottleSpins === 1 && st.stats.bottleBestWin === 440 && st.stats.bottleWon === 440);
  t('в историю записан выигрыш',
    (st.stats.bottleHistory || []).length === 1 && st.stats.bottleHistory[0].win === true);
  t('статистика на панели обновилась', document.getElementById('bottleWinsStat').textContent === '1');

  console.log('\n💔 ВРАЩЕНИЕ: ПРОИГРЫШ');

  clearTimeout(B.resetTimer);
  B.phase = 'idle';
  B.spinning = false;
  B.clearTable();
  B.toggleItem(u.a);
  B.toggleItem(u.b);
  B.toggleItem(u.c);
  B.toggleItem(u.d);
  t('ставка снова = самый дешёвый предмет', B.betUid === u.a, B.betUid);

  RNG.float = () => 0.01;         // угол ~3.6° → сектор №0 = сама ставка (двойка, 60 ₽) → проигрыш
  st.balance = 500000;
  const beforeLossBal = st.balance;
  g('bottleSpin')();
  B.startWall = Date.now() - 5000;
  B.frame();
  t('проигрыш засчитан (phase = lost)', B.phase === 'lost', B.phase);
  t('баланс при проигрыше не изменился', st.balance === beforeLossBal, String(st.balance));
  t('ставка сгорела — в рюкзаке 3 предмета', st.inventory.length === 3, String(st.inventory.length));
  t('сгорел именно предмет-ставка (двойка)', !st.inventory.some(i => i.id === 'sch_bad_grade'));
  t('остальные предметы вернулись', st.inventory.some(i => i.id === 'sch_eraser') && st.inventory.some(i => i.id === 'sch_chewed_pen'));
  t('статистика проигрыша обновилась', st.stats.bottleLosses === 1 && st.stats.bottleSpins === 2);
  t('в историю записан проигрыш',
    (st.stats.bottleHistory || []).length === 2 && st.stats.bottleHistory[0].win === false);

  console.log('\n🧩 ЦЕЛОСТНОСТЬ');

  RNG.float = origFloat;
  t('сохранение-статистика не ломается',
    typeof st.stats.bottleSpins === 'number' && typeof st.stats.bottleWon === 'number');
  t('бутылочка не мешает реестру и ракете',
    games.find('crash') !== null && typeof g('CrashGame') !== 'undefined' && typeof g('crashStart') === 'function');

  const fatal = errors.filter(e => !/offline|Failed to fetch|network|fetch|CDN|tailwind/i.test(e));
  t('в консоли нет критических ошибок', fatal.length === 0, fatal.slice(0, 3).join(' | '));

  console.error = origError;
  console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
