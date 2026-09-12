/* ==========================================================================
   ШКОЛА ДРОП — интеграционные тесты ПЕРЕРОЖДЕНИЯ 4.1 (jsdom, без браузера)
   Запуск:  npm run test:rebirth   (или: node tests/rebirth-ui.test.js)

   Регрессия на баг «невозможно переродиться»: doRebirth() вызывал
   несуществующий Modal.confirm — клик по кнопке молча падал с TypeError
   и подтверждение никогда не открывалось. Тесты прогоняют весь путь
   игрока: требования → диалог подтверждения → сброс прогресса → карта.
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
  console.log('⚠️  jsdom не установлен — пропускаем тесты перерождения (npm install)');
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
window.fetch = () => Promise.reject(new Error('offline test'));

const errors = [];
window.addEventListener('error', e => errors.push(String(e.message || e.error)));
const origError = console.error;
console.error = (...a) => { errors.push(a.map(String).join(' ')); };

const vmContext = dom.getInternalVMContext();
const g = expr => vm.runInContext(String(expr), vmContext);

const scriptFiles = [...html.matchAll(/<script[^>]+src="(js\/[^"]+)"/g)].map(m => m[1].split('?')[0]);
const loadErrors = scriptFiles.map(rel => {
  try {
    vm.runInContext(fs.readFileSync(path.join(ROOT, rel), 'utf8'), vmContext, { filename: rel });
    return null;
  } catch (e) {
    return `${rel}: ${e.message}`;
  }
}).filter(Boolean);

console.log('\n📦 ЗАГРУЗКА ПРОЕКТА');
t('все скрипты проекта выполнились без исключений', loadErrors.length === 0, loadErrors.join(' | '));

const tick = () => new Promise(r => setTimeout(r, 40));

(async () => {
  await tick();

  const { document } = window;

  console.log('\n⚙️  КОНФИГ ПЕРЕРОЖДЕНИЯ');

  const max = g('REBIRTH_MAX');
  t('REBIRTH_MAX = 10', max === 10, `получено: ${max}`);
  const cards = g('REBIRTH_CARDS');
  t('на каждое перерождение есть кредитная карта',
    Array.isArray(cards) && cards.length === max && cards.every((c, i) => c.level === i + 1 && c.limit > 0 && !!c.name));
  const reqs = g('REBIRTH_REQUIREMENTS');
  t('требования заданы для всех 10 уровней без дыр',
    Array.isArray(reqs) && reqs.length === max &&
    reqs.every((r, i) => r.level === i + 1 && r.needLevel > 0 && r.needCases > 0 && r.needMoney >= 0));

  console.log('\n🚫 ДО ВЫПОЛНЕНИЯ ТРЕБОВАНИЙ');

  // чистый аккаунт: перерождение 0, низкий уровень
  g('state.stats.rebirth = 0; state.stats.level = 1; state.stats.casesOpened = 0; state.balance = 500; state.stats.creditDebt = 0;');
  let chk = g('canRebirthNext()');
  t('на чистом аккаунте перерождение недоступно', !chk.ok && chk.reason === 'LEVEL', JSON.stringify(chk));

  g('openRebirthModal()');
  const reqEl = document.getElementById('rebirthNextReq');
  const doBtn = document.getElementById('rebirthDoBtn');
  t('модалка открылась', g('Modal.isOpen("rebirthModal")'));
  t('блок требований отрендерился (не пустой и без «не найдены»)',
    !!reqEl && reqEl.textContent.trim().length > 0 && !reqEl.textContent.includes('Требования не найдены'),
    reqEl && reqEl.textContent.slice(0, 60));
  t('в требованиях виден уровень, кейсы, деньги и долг',
    !!reqEl && /Уровень:/.test(reqEl.textContent) && /Кейсов открыто:/.test(reqEl.textContent) &&
    /Деньги:/.test(reqEl.textContent) && /Долг:/.test(reqEl.textContent));
  t('кнопка перерождения заблокирована', !!doBtn && doBtn.disabled === true, doBtn && String(doBtn.disabled));
  t('заголовок требований без дубля «карта → карта»',
    !!reqEl && !/^(.+)\s→\s\1\b/m.test(reqEl.querySelector('div') ? reqEl.querySelector('div').textContent.replace('Следующее: ', '') : ''),
    reqEl && reqEl.querySelector('div') && reqEl.querySelector('div').textContent);

  console.log('\n✅ ТРЕБОВАНИЯ ВЫПОЛНЕНЫ → ДИАЛОГ');

  // выполняем требования 1-го перерождения: уровень 10, 25 кейсов
  g('state.stats.level = 10; state.stats.casesOpened = 25; state.balance = 5000; renderAll(); openRebirthModal();');
  chk = g('canRebirthNext()');
  t('canRebirthNext() разрешает перерождение', chk.ok === true && chk.next === 1, JSON.stringify(chk));
  t('кнопка перерождения активна', !!doBtn && doBtn.disabled === false, doBtn && String(doBtn.disabled));
  t('на кнопке текст «ПЕРЕРОДИТЬСЯ В 1 УРОВЕНЬ»', /ПЕРЕРОДИТЬСЯ В 1/i.test(doBtn.textContent), doBtn.textContent.trim());

  // КЛИК по кнопке — регрессия «Modal.confirm is not a function»
  doBtn.click();
  await tick();
  t('открылся диалог подтверждения', g('Modal.isOpen("confirmModal")'),
    'если false — doRebirth снова сломан (раньше: Modal.confirm is not a function)');
  t('в диалоге текст про карту и сброс прогресса',
    /Бронзовой картой|Бронзовая карта/i.test(document.getElementById('confirmText').textContent) &&
    /сбросится/i.test(document.getElementById('confirmText').textContent));

  console.log('\n🔄 ПОДТВЕРЖДЕНИЕ → СБРОС ПРОГРЕССА');

  // перед подтверждением пометим инвентарь и опыт — они должны сгореть при сбросе
  g('state.inventory = [{ id:"sch_eraser", uid:"x" }]; state.stats.xp = 5000;');
  document.getElementById('btnConfirmOk').click();
  await tick();

  t('перерождение состоялось: rebirth = 1', g('state.stats.rebirth') === 1, String(g('state.stats.rebirth')));
  t('уровень сброшен в 1', g('state.stats.level') === 1, String(g('state.stats.level')));
  t('опыт сброшен', g('state.stats.xp') === 0, String(g('state.stats.xp')));
  t('баланс после сброса — стартовые 2000 ₽', g('state.balance') === 2000, String(g('state.balance')));
  t('рюкзак очищен и выданы стартовые предметы',
    Array.isArray(g('state.inventory')) && g('state.inventory').length === g('START_ITEMS').length,
    JSON.stringify(g('state.inventory') && g('state.inventory').map(i => i.id)));
  t('выдан титул карты (Бронза)', g('state.stats.unlockedTitles').includes('Бронза'),
    JSON.stringify(g('state.stats.unlockedTitles')));
  t('текущая карта — бронзовая с лимитом 1000 ₽',
    g('getCurrentCard() && getCurrentCard().id') === 'card_bronze' && g('getCreditLimit()') === 1000);
  t('диалог подтверждения закрылся', !g('Modal.isOpen("confirmModal")'));
  t('модалка перерождения осталась открыта с новой картой',
    g('Modal.isOpen("rebirthModal")') && g('Modal.isOpen("rebirthModal")'));

  console.log('\n💳 ОТМЕНА ДИАЛОГА');

  // требования 2-го перерождения: уровень 11, 75 кейсов, 500 000 ₽
  g('closeRebirthModal(); state.stats.level = 11; state.stats.casesOpened = 75; state.balance = 600000;');
  chk = g('canRebirthNext()');
  t('2-е перерождение доступно по требованиям', chk.ok === true && chk.next === 2, JSON.stringify(chk));
  g('doRebirth()');
  await tick();
  t('диалог снова открылся', g('Modal.isOpen("confirmModal")'));
  document.querySelector('#confirmModal button[onclick="resolveConfirm(false)"]').click();
  await tick();
  t('после «Отмена» перерождение НЕ произошло (rebirth = 1)', g('state.stats.rebirth') === 1, String(g('state.stats.rebirth')));
  t('баланс не тронут', g('state.balance') === 600000, String(g('state.balance')));

  console.log('\n🔒 ГРАНИЦЫ');

  g('state.stats.rebirth = 10;');
  chk = g('canRebirthNext()');
  t('на 10-м перерождении дальше нельзя', !chk.ok && chk.reason === 'MAX');
  g('openRebirthModal()');
  t('в модалке показан «Максимум!»', /Максимум!/.test(document.getElementById('rebirthNextReq').textContent));
  t('кнопка заблокирована с текстом «МАКСИМУМ ДОСТИГНУТ»',
    doBtn.disabled === true && /МАКСИМУМ/i.test(doBtn.textContent), doBtn.textContent.trim());
  g('state.stats.rebirth = 1;'); // вернуть в адекватное состояние

  const fatal = errors.filter(e => !/offline|Failed to fetch|network|fetch|CDN|tailwind/i.test(e));
  t('в консоли нет критических ошибок', fatal.length === 0, fatal.slice(0, 3).join(' | '));

  console.error = origError;
  console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})().catch(e => {
  console.error = origError;
  console.log(`❌ Тесты перерождения упали: ${e.stack || e}`);
  process.exit(1);
});
