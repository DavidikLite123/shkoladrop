/* ==========================================================================
   ШКОЛА ДРОП — интеграционные тесты мини-игр (jsdom, без браузера)
   Запуск:  npm run test:ui      (или: node tests/crash-ui.test.js)

   Поднимает настоящий index.html в jsdom, загружает все скрипты проекта в том
   же порядке, что и браузер, и прогоняет: меню «Игры», переключение вкладок и
   полный раунд «Ракеты» (старт → автовывод → взрыв → защита от двойного
   списания). Требуется dev-зависимость jsdom: npm install
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
    // базовое рисование
    setTransform: noop, clearRect: noop, fillRect: noop, strokeRect: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop, ellipse: noop,
    quadraticCurveTo: noop, bezierCurveTo: noop, rect: noop,
    fill: noop, stroke: noop, fillText: noop, strokeText: noop, clip: noop,
    save: noop, restore: noop, translate: noop, rotate: noop, scale: noop,
    setLineDash: noop, drawImage: noop,
    createLinearGradient: () => gradient, createRadialGradient: () => gradient,
    createPattern: () => null, measureText: () => ({ width: 10 }),
    // свойства, которые код выставляет
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: '', lineJoin: '',
    font: '', textAlign: '', textBaseline: '', shadowColor: '', shadowBlur: 0
  };
  return ctx;
}

const dom = new JSDOM(html, {
  runScripts: 'dangerously',       // инлайн-скрипты из <head> выполняются
  pretendToBeVisual: true,         // requestAnimationFrame
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
window.fetch = () => Promise.reject(new Error('offline test'));   // сеть в тестах выключена

const errors = [];
window.addEventListener('error', e => errors.push(String(e.message || e.error)));
const origError = console.error;
console.error = (...a) => { errors.push(a.map(String).join(' ')); };

/* ---------- Загружаем скрипты проекта в порядке <script defer> ---------- */
const vmContext = dom.getInternalVMContext();
/** Прочитать значение из глобальной области страницы (const/let/function) */
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

// Порядок загрузки берём прямо из разметки — так тест не расходится с продакшеном
// (и сразу подхватывает новые модули вроде js/icons.js)
const scriptFiles = [...html.matchAll(/<script[^>]+src="(js\/[^"]+)"/g)].map(m => m[1].split('?')[0]);
t('в разметке подключены все модули игры', scriptFiles.length >= 8, scriptFiles.join(', '));
const loadErrors = scriptFiles.map(runScript).filter(Boolean);
t('все скрипты проекта выполнились без исключений', loadErrors.length === 0, loadErrors.join(' | '));
t('игра запустилась (initGame отработал)', typeof g('state') !== 'undefined' && g('state').balance >= 0);

/* Даём микротаскам (persist и пр.) завершиться */
const tick = () => new Promise(r => setTimeout(r, 30));

(async () => {
  await tick();

  console.log('\n🎮 МЕНЮ «ИГРЫ»');

  const { document } = window;
  const games = g('MiniGames');
  t('реестр игр доступен в окне', !!games && typeof games.list === 'function');
  t('в реестре три игры', games.list().length === 3, games.list().map(g => g.id).join(','));

  // Навигация: одна кнопка «Игры» вместо разрозненных кнопок активностей
  const navButtons = document.querySelectorAll('#tabbar .nav-tab');
  t('в нижнем меню 4 кнопки (игры свёрнуты в одну)', navButtons.length === 4, `найдено: ${navButtons.length}`);
  t('кнопка «Игры» есть и она открывает меню', !!document.getElementById('tabGames') &&
    document.getElementById('tabGames').getAttribute('onclick').includes('openGamesModal'));
  t('старых кнопок «Апгрейд»/«Кейсы» в навигации больше нет',
    !document.getElementById('tabUpgrade') && !document.getElementById('tabCases') && !document.getElementById('tabInv'));

  // Открытие меню
  g('openGamesModal')();
  const modal = document.getElementById('gamesModal');
  t('меню игр открывается', !modal.classList.contains('hidden'));
  const cards = document.querySelectorAll('#gamesList .mini-game-card');
  t('в меню отрисованы карточки всех игр', cards.length === 3, `карточек: ${cards.length}`);
  const cardText = document.getElementById('gamesList').textContent;
  t('в меню есть «Кейсы», «Апгрейд» и «Ракета»',
    cardText.includes('Кейсы') && cardText.includes('Апгрейд') && cardText.includes('Ракета'));

  console.log('\n🧭 ПЕРЕКЛЮЧЕНИЕ ИГР');

  g('selectMiniGame')('crash');
  t('выбор «Ракеты» закрывает меню', modal.classList.contains('hidden'));
  t('панель ракеты открылась', !document.getElementById('viewCrash').classList.contains('hidden'));
  t('остальные панели скрыты',
    document.getElementById('viewCases').classList.contains('hidden') &&
    document.getElementById('viewUpgrade').classList.contains('hidden'));
  t('кнопка «Игры» подсвечена как активная',
    document.getElementById('tabGames').classList.contains('nav-tab-active'));
  t('текущая вкладка = crash', g('currentTab') === 'crash', g('currentTab'));
  t('меню помечает текущую игру', document.getElementById('gamesList').textContent.includes('играешь'));

  g('selectMiniGame')('cases');
  t('переключение на «Кейсы» работает', !document.getElementById('viewCases').classList.contains('hidden'));
  g('selectMiniGame')('upgrade');
  t('переключение на «Апгрейд» работает', !document.getElementById('viewUpgrade').classList.contains('hidden'));
  g('switchTab')('crash');
  t('switchTab("crash") тоже открывает ракету', !document.getElementById('viewCrash').classList.contains('hidden'));

  console.log('\n🚀 РАУНД «РАКЕТЫ»: ПОБЕДА');

  const Crash = g('CrashGame');
  const st = g('state');
  // Награды за уровень и за достижения тоже меняют баланс и мешают точно
  // проверить списание ставки — в этих тестах обнуляем их (проверяем только ракету)
  g('RANKS').forEach(r => { r.reward = 0; });
  g('ACHIEVEMENTS').forEach(a => { a.money = 0; });
  st.balance = 1000000;
  document.getElementById('crashBetInput').value = '10000';
  document.getElementById('crashAutoInput').value = '2';

  const balanceBefore = st.balance;
  g('crashStart')();
  t('ракета стартовала (фаза flying)', Crash.phase === 'flying', Crash.phase);
  t('ставка списана ровно один раз', st.balance === balanceBefore - 10000, `${balanceBefore} -> ${st.balance}`);
  t('ставка и оборот записаны в статистику', Crash.bet === 10000 && st.stats.crashWagered === 10000);
  t('точка краша определена на старте', Crash.crashAt >= 1, String(Crash.crashAt));
  t('поля ввода заблокированы во время полёта',
    document.getElementById('crashBetInput').disabled && document.getElementById('crashAutoInput').disabled);
  t('кнопка старта заблокирована во время полёта', document.getElementById('btnCrashStart').disabled);
  t('кнопка «Забрать» активна во время полёта', !document.getElementById('btnCrashCashout').disabled);
  t('счётчик раундов увеличился', st.stats.crashRounds === 1, String(st.stats.crashRounds));

  // Повторный старт во время полёта не должен списать деньги ещё раз
  const balanceMid = st.balance;
  g('crashStart')();
  t('повторный старт во время полёта ничего не списывает',
    st.balance === balanceMid && st.stats.crashRounds === 1, `${st.balance} / ${st.stats.crashRounds}`);

  // Прокручиваем время: автовывод сработает на 2.00×
  Crash.startWall = Date.now() - 5000;      // «пролетело» 5 секунд
  Crash.frame();
  t('автовывод сработал (фаза cashed)', Crash.phase === 'cashed', Crash.phase);
  t('вывод зафиксирован ровно на автовыводе 2.00×', Crash.mult === 2, String(Crash.mult));
  t('выигрыш начислен: 10 000 × 2 = 20 000 ₽', st.balance === balanceMid + 20000, String(st.balance));
  t('статистика побед обновилась', st.stats.crashWins === 1 && st.stats.crashBestMult === 2);
  t('в историю записан множитель раунда',
    (st.stats.crashHistory || []).length === 1 && st.stats.crashHistory[0].win === true);
  t('профит в статистике положительный',
    document.getElementById('crashNetStat').textContent.trim().startsWith('+'));

  console.log('\n💥 РАУНД «РАКЕТЫ»: ВЗРЫВ');

  // Возвращаем фазу в исходную (обычно это делает таймаут через 1.8 сек)
  Crash.phase = 'idle';
  Crash.mult = 1;
  st.balance = 500000;
  document.getElementById('crashBetInput').value = '50000';
  document.getElementById('crashAutoInput').value = '';

  const beforeBoom = st.balance;
  g('crashStart')();
  Crash.crashAt = 1.5;                      // принудительно взрываем рано
  Crash.startWall = Date.now() - 5000;
  Crash.frame();
  t('ракета взорвалась (фаза crashed)', Crash.phase === 'crashed', Crash.phase);
  t('баланс не изменился — ставка уже списана и сгорела', st.balance === beforeBoom - 50000, String(st.balance));
  t('взрыв записан в статистику', st.stats.crashLosses === 1, String(st.stats.crashLosses));
  t('плашка «ВЗРЫВ» показана', !document.getElementById('crashBoom').classList.contains('hidden'));
  t('поле полёта получило класс крушения',
    document.getElementById('crashStage').classList.contains('crash-stage-boom'));
  t('история помнит и взрыв',
    (st.stats.crashHistory || []).length === 2 && st.stats.crashHistory[0].win === false);
  t('кнопка «Забрать» после взрыва не активна', document.getElementById('btnCrashCashout').disabled);

  console.log('\n🛡 ВАЛИДАЦИЯ СТАВОК');

  Crash.phase = 'idle';
  st.balance = 1000;
  document.getElementById('crashBetInput').value = '999999';
  const beforeBad = st.balance;
  g('crashStart')();
  t('ставка больше баланса не запускает раунд', Crash.phase === 'idle' && st.balance === beforeBad);

  document.getElementById('crashBetInput').value = '50';
  g('crashStart')();
  t('ставка ниже минимума не запускает раунд', Crash.phase === 'idle' && st.balance === beforeBad);

  document.getElementById('crashBetInput').value = '';
  g('crashStart')();
  t('пустая ставка не запускает раунд', Crash.phase === 'idle' && st.balance === beforeBad);

  document.getElementById('crashBetInput').value = '500';
  document.getElementById('crashAutoInput').value = '0.5';
  g('crashStart')();
  t('автовывод ниже 1.01× не запускает раунд', Crash.phase === 'idle' && st.balance === beforeBad);

  document.getElementById('crashAutoInput').value = '';
  g('crashStart')();
  t('корректная ставка запускает раунд', Crash.phase === 'flying' && st.balance === beforeBad - 500);
  Crash.cashout(false);
  t('ручной вывод работает', Crash.phase === 'cashed' && st.balance > beforeBad - 500);

  console.log('\n⏱ РАЗГОН И ЗАЩИТА ОТ МГНОВЕННОГО КРАША');

  const CFG = g('CRASH_CONFIG');
  Crash.phase = 'idle';
  Crash.mult = 1;
  st.balance = 100000;
  document.getElementById('crashBetInput').value = '1000';
  document.getElementById('crashAutoInput').value = '';

  const beforeTakeoff = st.balance;
  g('crashStart')();
  t('ставка списалась в ту же миллисекунду, что и нажатие', st.balance === beforeTakeoff - 1000,
    `${beforeTakeoff} -> ${st.balance}`);

  Crash.crashAt = 1.0;                       // худший из возможных раундов
  Crash.startWall = Date.now() - 500;        // прошло 0.5 сек
  Crash.frame();
  t('на 0.5 сек ракета ещё летит (краша нет)', Crash.phase === 'flying', Crash.phase);
  t('на разгоне множитель ровно 1.00×', Crash.mult === 1, String(Crash.mult));
  t('функция разгона отвечает правду', Crash.isTakeoff() === true);

  Crash.startWall = Date.now() - 1000;       // 1.0 сек — разгон ещё идёт
  Crash.frame();
  t('на 1.0 сек краша всё ещё нет', Crash.phase === 'flying' && Crash.mult === 1);

  Crash.startWall = Date.now() - 1500;       // 1.5 сек — разгон кончился
  Crash.frame();
  t('после минимальной длительности полёта краш случается', Crash.phase === 'crashed', Crash.phase);
  t('минимальная длительность полёта задана конфигом',
    CFG.takeoffSec >= 1 && CFG.takeoffSec <= 1.5, String(CFG.takeoffSec));

  console.log('\n🛡 ЛИМИТЫ И БАЛАНС');

  Crash.phase = 'idle';
  st.balance = 5000;
  const setBet = v => { document.getElementById('crashBetInput').value = String(v); };

  setBet(CFG.maxBet + 1);
  g('crashStart')();
  t('ставка выше максимального лимита блокируется', Crash.phase === 'idle' && st.balance === 5000);

  setBet(CFG.maxBet);
  g('crashStart')();
  t('ставка выше баланса блокируется (было бы списание в минус)',
    Crash.phase === 'idle' && st.balance === 5000);

  setBet(-500);
  g('crashStart')();
  t('отрицательная ставка блокируется', Crash.phase === 'idle' && st.balance === 5000);

  setBet(0);
  g('crashStart')();
  t('нулевая ставка блокируется', Crash.phase === 'idle' && st.balance === 5000);

  setBet(CFG.minBet - 1);
  g('crashStart')();
  t('ставка ниже минимума блокируется', Crash.phase === 'idle' && st.balance === 5000);

  // Проигрыш «в ноль»: баланс не должен уйти в минус
  Crash.phase = 'idle';
  st.balance = 150;
  setBet(150);
  g('crashStart')();
  t('ставка на весь остаток запускается', Crash.phase === 'flying' && st.balance === 0, String(st.balance));
  Crash.crashAt = 2;
  Crash.startWall = Date.now() - 9000;
  Crash.frame();
  t('после проигрыша баланс = 0, но не отрицательный', st.balance === 0, String(st.balance));

  // Быстрая кнопка MAX не предлагает больше баланса
  Crash.phase = 'idle';
  st.balance = 2500;
  document.getElementById('crashBetInput').value = '';
  Crash.applyQuickBet('max');
  t('кнопка MAX ограничена балансом',
    Number(document.getElementById('crashBetInput').value) === 2500,
    document.getElementById('crashBetInput').value);

  console.log('\n🎨 ИКОНКИ ВМЕСТО ЭМОДЗИ');

  const crashIcons = [...document.querySelectorAll('#viewCrash [data-icon]')];
  t('в панели ракеты есть места под иконки', crashIcons.length >= 6, String(crashIcons.length));
  t('все иконки ракеты — встроенные SVG',
    crashIcons.length > 0 && crashIcons.every(i => !!i.querySelector('svg')));
  t('в меню игр иконки тоже векторные',
    [...document.querySelectorAll('#gamesList .mini-game-icon')].every(i => !!i.querySelector('svg')));
  const viewText = document.getElementById('viewCrash').textContent || '';
  const hasEmoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u.test(viewText);
  t('в интерфейсе ракеты не осталось системных эмодзи', !hasEmoji);
  t('ракета рисуется на canvas вектором, а не эмодзи',
    /drawRocket/.test(String(Crash.drawRocket)) && !/fillText\(\s*['\"]🚀/.test(String(Crash.draw)));

  console.log('\n🧩 ЦЕЛОСТНОСТЬ');

  t('сохранение-statistics не ломается', typeof st.stats.crashWagered === 'number');
  t('достижения за ракету появляются в списке игры',
    g('ACHIEVEMENTS').some(a => a.id === 'crash_1'));
  t('меню игр можно расширить новым режимом',
    g('MiniGames').register({ id: 'test_game', tab: 'testGame', icon: '🎲', name: 'Тест', desc: 'Тестовая игра для проверки реестра' })
    && g('MiniGames').list().length === 4);

  const fatal = errors.filter(e => !/offline|Failed to fetch|network|fetch|CDN|tailwind/i.test(e));
  t('в консоли нет критических ошибок', fatal.length === 0, fatal.slice(0, 3).join(' | '));

  console.error = origError;
  console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
