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

/* ---------- 7. Адаптивность и вёрстка ---------- */
const css = fs.readFileSync(path.join(ROOT, 'css', 'style.css'), 'utf8');

t('в <head> есть корректный viewport',
  /<meta[^>]+name=["']viewport["'][^>]+width=device-width/.test(html));

t('ширина оболочки задана переменной и меняется по брейкпоинтам',
  /--app-max:\s*28rem/.test(css) &&
  /@media\s*\(min-width:\s*768px\)\s*{[^}]*--app-max/.test(css) &&
  /@media\s*\(min-width:\s*1280px\)\s*{[^}]*--app-max/.test(css));
t('body и нижнее меню ограничены одной шириной',
  /body\.shkola-app\s*{[^}]*max-width:\s*var\(--app-max\)/.test(css) &&
  /\.tabbar\s*{[^}]*max-width:\s*var\(--app-max\)/.test(css));
t('есть защита от горизонтального скролла',
  /overflow-x:\s*(clip|hidden)/.test(css));

t('контейнер мини-игры ограничен по ширине и отцентрован',
  /\.crash-shell\s*{[^}]*max-width:[^;]+;[^}]*margin:\s*0 auto/.test(css) ||
  /\.crash-shell\s*{[^}]*margin:\s*0 auto/.test(css));
t('поле полёта резиновое: clamp + относительные единицы',
  /\.crash-stage\s*{[^}]*height:\s*clamp\([^)]*\)/.test(css) &&
  /\.crash-stage[\s\S]{0,400}max-height:\s*\d+vh/.test(css));
t('панель ставки на ПК становится двухколоночной',
  /\.crash-panel-grid\s*{[^}]*grid-template-columns/.test(css) &&
  /@media\s*\(min-width:\s*768px\)\s*{[^}]*\.crash-panel-grid\s*{[^}]*1fr 1fr/.test(css));
t('крупные цели под палец: поля >= 44px, кнопки >= 48px',
  /\.crash-input\s*{[^}]*min-height:\s*4[4-9]px/.test(css) &&
  /\.crash-action-btn\s*{[^}]*min-height:\s*(4[89]|5\d)px/.test(css));
t('есть отдельные правила для узких экранов',
  /@media\s*\(max-width:\s*360px\)/.test(css));

/* ---------- 8. Иконки: ключи из разметки есть в реестре ---------- */
const iconsSrc = fs.readFileSync(path.join(ROOT, 'js', 'icons.js'), 'utf8');
const usedIcons = [...html.matchAll(/data-icon="([^"]+)"/g)].map(m => m[1]);
const missingIcons = [...new Set(usedIcons)].filter(name => !new RegExp(`\\b${name}:`).test(iconsSrc));
t('все иконки из разметки есть в js/icons.js', missingIcons.length === 0, missingIcons.join(', '));
t('реестр иконок не пустой', /rocket:/.test(iconsSrc) && /burst:/.test(iconsSrc) && /banknote:/.test(iconsSrc));
// Проверяем определения иконок (в комментариях эмодзи допустимы — там они как подписи)
const iconDefs = iconsSrc.slice(iconsSrc.indexOf('set: {'), iconsSrc.indexOf('has(name)'))
  .replace(/\/\*[\s\S]*?\*\//g, '');   // комментарии (там эмодзи-подписи) не считаем
t('иконки — вектор (SVG), а не эмодзи',
  /viewBox="0 0 24 24"/.test(iconsSrc) && !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(iconDefs));
// Порядок подключения — по реальным тегам <script>, а не по первому упоминанию в тексте
const srcOrder = [...html.matchAll(/<script[^>]+src="(js\/[^"]+)"/g)].map(m => m[1].split('?')[0]);
t('js/icons.js подключён до модулей мини-игр',
  srcOrder.indexOf('js/icons.js') >= 0 && srcOrder.indexOf('js/icons.js') < srcOrder.indexOf('js/crash.js'),
  srcOrder.join(' → '));

/* ---------- 9. Спрайт ракеты: есть в разметке, стилях и коде ---------- */
t('в поле полёта есть отдельный спрайт ракеты #crashRocket',
  /id="crashRocket"/.test(html) && /id="crashStage"[\s\S]{0,600}id="crashRocket"/.test(html));
t('спрайт ракеты — заливной SVG из реестра иконок',
  /id="crashRocket"[\s\S]{0,300}data-icon="rocketSolid"/.test(html) && /\brocketSolid:/.test(iconsSrc));
t('у спрайта есть слой пламени', /crash-rocket-flame/.test(html) && /crash-rocket-flame/.test(css));
t('спрайт ракеты — абсолютный элемент выше канваса',
  /\.crash-rocket\s*{[^}]*position:\s*absolute/.test(css) &&
  /\.crash-rocket\s*{[^}]*z-index:\s*[3-9]/.test(css) &&
  /\.crash-canvas\s*{[^}]*position:\s*absolute/.test(css));
t('спрайт centred по точке траектории (отрицательный margin на полразмера)',
  /\.crash-rocket\s*{[^}]*margin:[^;]*calc\(var\(--rocket-size\) \/ -2\)/.test(css));
t('пламя появляется только в полёте (классы состояния)',
  /\.crash-rocket-flying\s+\.crash-rocket-flame/.test(css) &&
  /\.crash-rocket-takeoff\s+\.crash-rocket-flame/.test(css));
t('ракета спрайтом двигается из JS (transform + классы состояния)',
  /placeRocket\([\s\S]{0,900}translate3d/.test(allJs) && /crash-rocket-flying/.test(allJs));
t('есть векторный фолбэк ракеты внутри canvas', /drawRocket\(/.test(allJs));
t('в спрайте ракеты нет системных эмодзи',
  !/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test((html.match(/id="crashRocket"[\s\S]{0,400}/) || [''])[0]));

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
