/* ==========================================================================
   ШКОЛА ДРОП — статические проверки целостности (свой «линтер» проекта)
   Запуск:  npm run test:lint      (или: node tests/static-check.test.js)

   Ловит то, что обычно всплывает только в браузере:
     • onclick/oninput вызывает функцию, которой нет в коде;
     • JS обращается к $('id'), которого нет в index.html;
     • дубли id в разметке;
     • ссылки на удалённые элементы навигации.
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let passed = 0, failed = 0;
const t = (name, cond, extra = '') => {
  if (cond) { passed++; console.log('  ✔', name); }
  else { failed++; console.log('  ✘ FAIL:', name, extra); }
};

/* ---------- 1. id в разметке ---------- */
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
const dupIds = ids.filter((id, i) => ids.indexOf(id) !== i);
t('в index.html нет дублирующихся id', dupIds.length === 0, [...new Set(dupIds)].join(', '));

/* ---------- 2. Обработчики из разметки существуют в коде ---------- */
const scriptFiles = fs.readdirSync(path.join(ROOT, 'js'))
  .filter(f => f.endsWith('.js'))
  .map(f => path.join('js', f));
const allJs = scriptFiles.map(f => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');

// Имена функций, объявленных в проекте (function name( ... ) и const name = () =>
const declared = new Set();
for (const m of allJs.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)) declared.add(m[1]);
for (const m of allJs.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/g)) declared.add(m[1]);

// Всё, что вызывается из onclick/oninput/onkeydown в разметке
const called = new Set();
for (const m of html.matchAll(/on(?:click|input|change|keydown|submit)="([^"]*)"/g)) {
  // только глобальные функции: вызовы методов (.focus(), NetPlay.open()) пропускаем
  for (const fn of m[1].matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) called.add(fn[1]);
}
const builtins = new Set(['if', 'for', 'while', 'switch', 'return', 'typeof', 'Number', 'String',
  'Boolean', 'Array', 'Object', 'JSON', 'Math', 'Date', 'event', 'function', 'new', 'catch',
  // встроенные браузерные функции, которые зовут прямо из разметки
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame',
  'alert', 'confirm', 'prompt', 'parseInt', 'parseFloat', 'isNaN', 'encodeURIComponent']);
const missingHandlers = [...called].filter(fn => !builtins.has(fn) && !declared.has(fn));
t('все обработчики из разметки объявлены в JS', missingHandlers.length === 0, missingHandlers.join(', '));

/* ---------- 3. Элементы, к которым обращается JS, есть в разметке ---------- */
const referenced = new Set();
for (const m of allJs.matchAll(/\$\('([^']+)'\)/g)) referenced.add(m[1]);
for (const m of allJs.matchAll(/getElementById\('([^']+)'\)/g)) referenced.add(m[1]);

// Список id, которые JS создаёт сам (динамические узлы) — их в HTML искать не нужно
const dynamicIds = new Set([
  'caseRouletteTrack', 'feedList', 'rebirthCardsList', 'oddsList'
]);
const missingIds = [...referenced].filter(id => !dynamicIds.has(id) && !ids.includes(id));
t('все id из JS есть в index.html', missingIds.length === 0, missingIds.join(', '));

/* ---------- 4. Навигация после объединения игр ---------- */
t('старых кнопок tabUpgrade / tabCases / tabInv нет ни в HTML, ни в JS',
  !/\btabUpgrade\b|\btabCases\b|\btabInv\b/.test(html) && !/\btabUpgrade\b|\btabCases\b|\btabInv\b/.test(allJs));
const gamesBtn = html.match(/<button[^>]*id="tabGames"[^>]*>/);
t('кнопка «Игры» подключена к openGamesModal',
  !!gamesBtn && gamesBtn[0].includes('openGamesModal'));
t('панель ракеты есть в разметке', ids.includes('viewCrash'));
t('модальное окно меню игр есть в разметке', ids.includes('gamesModal'));
t('скрипты мини-игр подключены',
  /js\/crash\.js/.test(html) && /js\/games\.js/.test(html));

/* ---------- 5. Реестр игр согласован с разметкой ---------- */
const configSrc = fs.readFileSync(path.join(ROOT, 'js', 'config.js'), 'utf8');
const ctx = { console };
vm.createContext(ctx);
vm.runInContext(configSrc, ctx);
const MINI_GAMES = vm.runInContext('MINI_GAMES', ctx);
const viewIds = MINI_GAMES.map(g => 'view' + g.tab.charAt(0).toUpperCase() + g.tab.slice(1));
t('у каждой игры из реестра есть панель в разметке',
  viewIds.every(id => ids.includes(id)), viewIds.filter(id => !ids.includes(id)).join(', '));
t('у каждой игры есть иконка и описание', MINI_GAMES.every(g => g.icon && g.desc));

/* ---------- 6. Санитайзер сейва знает про статистику ракеты ---------- */
const storageSrc = fs.readFileSync(path.join(ROOT, 'js', 'storage.js'), 'utf8');
const crashStatKeys = ['crashRounds', 'crashWins', 'crashLosses', 'crashWagered', 'crashWon', 'crashBestMult', 'crashBestWin', 'crashHistory'];
t('статистика ракеты есть в дефолтах сейва', crashStatKeys.every(k => storageSrc.includes(`${k}:`)));
t('статистика ракеты защищена в санитайзере сейва',
  /crashRounds',\s*'crashWins/.test(storageSrc) && /crashHistory/.test(storageSrc));

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
