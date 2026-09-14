/* ==========================================================================
   ШКОЛА ДРОП — регрессионные тесты ПЕРЕРОЖДЕНИЯ (4.1) в jsdom
   Запуск:  npm run test:ui      (или: node tests/rebirth-ui.test.js)

   Проверяет полный цикл функции, которая раньше была сломана (doRebirth
   вызывал несуществующий Modal.confirm — перерождение было невозможно):
   чек-лист заданий в профиле и модалке, текст/состояние кнопки, блокировку
   по долгу и по невыполненным заданиям, и doRebirth() до «перерождён».
   Требуется dev-зависимость jsdom: npm install
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

const noop = () => {};
function stubCanvasContext() {
  const gradient = { addColorStop: noop };
  const ctx = {
    setTransform: noop, clearRect: noop, fillRect: noop, strokeRect: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, arc: noop,
    ellipse: noop, quadraticCurveTo: noop, bezierCurveTo: noop, rect: noop,
    fill: noop, stroke: noop, fillText: noop, strokeText: noop, clip: noop,
    save: noop, restore: noop, translate: noop, rotate: noop, scale: noop,
    setLineDash: noop, drawImage: noop,
    createLinearGradient: () => gradient, createRadialGradient: () => gradient,
    createPattern: () => null, measureText: () => ({ width: 10 }),
    globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: '',
    lineJoin: '', font: '', textAlign: '', textBaseline: '', shadowColor: '', shadowBlur: 0
  };
  return ctx;
}

const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost:3377/' });
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

const vmContext = dom.getInternalVMContext();
const g = expr => vm.runInContext(String(expr), vmContext);

function runScript(rel) {
  const code = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  try { vm.runInContext(code, vmContext, { filename: rel }); return null; }
  catch (e) { return `${rel}: ${e.message}`; }
}

console.log('\n📦 ЗАГРУЗКА ПРОЕКТА');
const scriptFiles = [...html.matchAll(/<script[^>]+src="(js\/[^"]+)"/g)].map(m => m[1].split('?')[0]);
const loadErrors = scriptFiles.map(runScript).filter(Boolean);
t('все скрипты проекта выполнились без исключений', loadErrors.length === 0, loadErrors.join(' | '));
t('игра запустилась (initGame отработал)', typeof g('state') !== 'undefined' && g('state').balance >= 0);

const tick = () => new Promise(r => setTimeout(r, 30));

(async () => {
  await tick();
  const { document } = window;
  const st = g('state');

  // У rebirth не нужен аккаунт, но для renderProfile() зададим профиль
  vm.runInContext('state.user = { id: "player-ui-test", nick: "Тестер", avatar: "🎒", grade: "Ученик школы" }', vmContext);

  // Заглушка подтверждения: возвращает true и запоминает параметры
  vm.runInContext('ConfirmDialog.ask = (opts) => { window.__confirmOpts = opts; return Promise.resolve(true); }', vmContext);

  console.log('\n🔄 ПЕРЕРОЖДЕНИЕ: БЛОКИРОВКА (задания не выполнены)');
  vm.runInContext(`
    state.stats.rebirth = 0;
    state.stats.level = 3;
    state.stats.casesOpened = 4;
    state.stats.upgradesWon = 0;
    state.stats.creditDebt = 0;
  `, vmContext);
  g('openRebirthModal')();

  const modal = document.getElementById('rebirthModal');
  t('модалка перерождения открывается', modal && !modal.classList.contains('hidden'));
  t('в списке карт есть «Бронзовая карта»', document.getElementById('rebirthCardsList').textContent.includes('Бронзовая карта'));
  t('бронзовая карта помечена как следующая («след.»)', document.getElementById('rebirthCardsList').textContent.includes('след.'));

  const reqText = document.getElementById('rebirthNextReq').textContent;
  t('показан заголовок заданий для перерождения №1', reqText.includes('Задания для перерождения №1'));
  t('в чек-листе есть «Достигни уровня»', reqText.includes('Достигни уровня'));
  t('в чек-листе есть «Открой кейсов»', reqText.includes('Открой кейсов'));
  t('в чек-листе есть «Выиграй апгрейдов»', reqText.includes('Выиграй апгрейдов'));
  t('невыполненные задания помечены ❌', reqText.includes('❌'));
  t('есть подсказка «Выполни все задания»', reqText.includes('Выполни все задания'));

  const doBtn = document.getElementById('rebirthDoBtn');
  t('кнопка перерождения заблокирована', doBtn.disabled === true);
  t('кнопка приглушена (opacity-50)', doBtn.classList.contains('opacity-50'));
  t('текст кнопки = «НЕ ВСЕ ЗАДАНИЯ ВЫПОЛНЕНЫ»', doBtn.textContent === 'НЕ ВСЕ ЗАДАНИЯ ВЫПОЛНЕНЫ', doBtn.textContent);

  // Чек-лист прямо в профиле
  g('renderProfile')();
  const tasksBox = document.getElementById('rebirthTasksList');
  t('в профиле отрисован чек-лист заданий', tasksBox && tasksBox.textContent.includes('Задания для перерождения №1'));
  t('в профиле виден прогресс (0/N)', tasksBox && tasksBox.textContent.includes('/ 25'));

  console.log('\n💳 ПЕРЕРОЖДЕНИЕ: БЛОКИРОВКА ПО ДОЛГУ (все задания сделаны)');
  vm.runInContext(`
    state.stats.level = 10;
    state.stats.casesOpened = 30;
    state.stats.upgradesWon = 6;
    state.stats.creditDebt = 500;
  `, vmContext);
  const chkDebt = g('canRebirthNext')();
  t('canRebirthNext блокирует по долгу (reason=DEBT)', chkDebt.ok === false && chkDebt.reason === 'DEBT', JSON.stringify({ ok: chkDebt.ok, reason: chkDebt.reason }));
  g('openRebirthModal')();
  t('кнопка перерождения заблокирована при долге', document.getElementById('rebirthDoBtn').disabled === true);

  console.log('\n✅ ПЕРЕРОЖДЕНИЕ: ВСЁ ГОТОВО');
  vm.runInContext('state.stats.creditDebt = 0', vmContext);
  const chkOk = g('canRebirthNext')();
  t('canRebirthNext разрешает (ok=true)', chkOk.ok === true, JSON.stringify(chkOk));
  g('openRebirthModal')();
  t('кнопка перерождения разблокирована', document.getElementById('rebirthDoBtn').disabled === false);
  t('текст кнопки = «🔄 ПЕРЕРОДИТЬСЯ В 1 УРОВЕНЬ»', document.getElementById('rebirthDoBtn').textContent === '🔄 ПЕРЕРОДИТЬСЯ В 1 УРОВЕНЬ', document.getElementById('rebirthDoBtn').textContent);
  t('есть подсказка «Все задания выполнены»', document.getElementById('rebirthNextReq').textContent.includes('Все задания выполнены'));
  t('в чек-листе все задания ✅', !document.getElementById('rebirthNextReq').textContent.includes('❌'));

  console.log('\n🔁 ПОЛНЫЙ ЦИКЛ: doRebirth()');
  vm.runInContext('state.balance = 100000', vmContext);
  await g('doRebirth')();
  t('уровень перерождения стал 1', st.stats.rebirth === 1, String(st.stats.rebirth));
  t('баланс сброшен к 2000', st.balance === 2000, String(st.balance));
  t('уровень сброшен к 1', st.stats.level === 1, String(st.stats.level));
  t('опыт сброшен к 0', st.stats.xp === 0, String(st.stats.xp));
  t('долг обнулён', st.stats.creditDebt === 0, String(st.stats.creditDebt));
  t('титул «Бронза» разблокирован', Array.isArray(st.stats.unlockedTitles) && st.stats.unlockedTitles.includes('Бронза'));
  t('стартовый рюкзак выдан (4 предмета)', st.inventory.length === 4, String(st.inventory.length));
  const opts = window.__confirmOpts || {};
  t('показан диалог подтверждения', !!opts.title);
  t('заголовок подтверждения упоминает «Бронзовая карта»', String(opts.title || '').includes('Бронзовая карта'), opts.title);
  t('кнопка подтверждения = «🔄 ПЕРЕРОДИТЬСЯ»', opts.okText === '🔄 ПЕРЕРОДИТЬСЯ', opts.okText);

  console.log('\n👤 ПРОФИЛЬ ПОСЛЕ ПЕРЕРОЖДЕНИЯ');
  g('renderProfile')();
  t('бейдж уровня перерождения = «1 / 10»', document.getElementById('rebirthLevelBadge').textContent === '1 / 10', document.getElementById('rebirthLevelBadge').textContent);
  t('в профиле показана активная карта', document.getElementById('rebirthCardDisplay').textContent.includes('Бронзовая карта'));
  const creditNorm = document.getElementById('creditInfo').textContent.replace(/\s+/g, ' ');
  t('кредит-блок показывает лимит 1 000 ₽', creditNorm.includes('1 000 ₽'), creditNorm);
  t('в профиле чек-лист уже для перерождения №2', document.getElementById('rebirthTasksList').textContent.includes('Задания для перерождения №2'));

  // Двойное перерождение подряд не должно сработать (задания 2-го уровня не сделаны)
  console.log('\n🚫 ЗАЩИТА ОТ ПОВТОРА');
  const chk2 = g('canRebirthNext')();
  t('сразу после перерождения 2-й уровень снова заблокирован', chk2.ok === false, JSON.stringify({ ok: chk2.ok, reason: chk2.reason }));

  const fatal = errors.filter(e => !/offline|Failed to fetch|network|fetch|CDN|tailwind/i.test(e));
  t('в консоли нет критических ошибок', fatal.length === 0, fatal.slice(0, 3).join(' | '));

  console.error = origError;
  console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
