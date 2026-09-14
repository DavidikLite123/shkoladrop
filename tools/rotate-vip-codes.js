/* ==========================================================================
   ШКОЛА ДРОП — tools/rotate-vip-codes.js
   Ротация VIP-кодов: аннулирует старые и выпускает новые.

   Зачем: список VIP-кодов лежал в репозитории, а сайт (Vercel) и сервер
   сообщества раздавали его публично — любой мог активировать VIP бесплатно.
   Этот скрипт делает так, что открытые коды НЕ попадают в git:
     • в js/config.js перезаписываются только SHA-256-хеши (первые 24 hex);
     • сами коды (то, что продаётся за 150 ₽) уходят в vip_codes_funpay.txt,
       который лежит в .gitignore и никогда не коммитится.

   Запуск:
     node tools/rotate-vip-codes.js            # 100 кодов, спросит подтверждение при перезаписи
     node tools/rotate-vip-codes.js 50 --force # 50 кодов, перезаписать файл без вопросов
   ========================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_FILE = path.join(ROOT, 'js', 'config.js');
const CODES_FILE = path.join(ROOT, 'vip_codes_funpay.txt'); // в .gitignore — в git не попадает

const args = process.argv.slice(2);
const force = args.includes('--force');
const count = Math.max(1, Math.min(1000, Number(args.find(a => /^\d+$/.test(a))) || 100));

/* Алфавит без 0/O и 1/I — чтобы код нельзя было перепутать на скриншоте */
const ABC = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const block = n => Array.from({ length: n }, () => ABC[crypto.randomInt(ABC.length)]).join('');
const genCode = () => `VIP-${block(4)}-${block(4)}`;
const hashOf = code => crypto.createHash('sha256')
  .update('shkoladrop-vip:' + String(code).trim().toUpperCase())
  .digest('hex').slice(0, 24); // ровно тот же алгоритм, что в js/game.js → vipCodeHash()

/* 1. Генерируем уникальные коды */
const codes = [];
const seen = new Set();
while (codes.length < count) {
  const c = genCode();
  if (seen.has(c)) continue;
  seen.add(c);
  codes.push(c);
}

/* 2. Перезаписываем хеши в js/config.js */
const src = fs.readFileSync(CONFIG_FILE, 'utf8');
const start = src.indexOf('const VIP_CODE_HASHES = [');
if (start === -1) {
  console.error('✘ Не нашёл const VIP_CODE_HASHES в js/config.js — правь вручную.');
  process.exit(1);
}
const endIdx = src.indexOf('\n];', start);
if (endIdx === -1) {
  console.error('✘ Не нашёл конец массива VIP_CODE_HASHES в js/config.js.');
  process.exit(1);
}
const today = new Date().toISOString().slice(0, 10);
const newArray = 'const VIP_CODE_HASHES = [\n' +
  codes.map(c => `  '${hashOf(c)}'`).join(',\n') +
  '\n  /* Ротация от ' + today + ': ' + count + ' новых кодов. Старый список утёк публично и аннулирован.\n' +
  '     Открытые коды — в vip_codes_funpay.txt (в .gitignore, в git не попадает). */\n';
const next = src.slice(0, start) + newArray + src.slice(endIdx);
fs.writeFileSync(CONFIG_FILE, next, 'utf8');

/* 3. Пишем человеческий список (только локально, файл в .gitignore) */
if (fs.existsSync(CODES_FILE) && !force) {
  console.error('⚠️  vip_codes_funpay.txt уже существует. Если в нём есть выданные коды —');
  console.error('    сначала перенеси их, иначе потеряешь, кому что выдано.');
  console.error('    Повтори запуск с --force, если уверен.');
  process.exit(2);
}
const pad = n => String(n).padStart(3, ' ');
const head = [
  '# 💎 VIP-коды ШКОЛА ДРОП — ' + count + ' шт. (ротация ' + today + ')',
  '',
  '> ЭТОТ ФАЙЛ НЕ КОММИТИТСЯ (он в .gitignore). Открытые коды живут только здесь.',
  '> В игре (js/config.js → VIP_CODE_HASHES) лежат только их SHA-256-хеши.',
  '> Прежний список (100 кодов от 2026-09-12) был опубликован в интернете вместе с сайтом',
  '> и сервером — все старые коды аннулированы этим же обновлением.',
  '',
  '## Правила',
  '- Формат: VIP-XXXX-XXXX. Один код = один покупатель = одно использование на аккаунт.',
  '- Цена 150 ₽, продажа через почту shkoladrop.contact@gmail.com (ник + ID игрока).',
  '- Выдавай по порядку и отмечай выданные прямо в таблице.',
  '',
  '## Список кодов',
  '',
  '| № | Код | Хеш (первые 24 симв. SHA-256) | Выдан? |',
  '|---|-----|-------------------------------|--------|'
];
const rows = codes.map((c, i) => `| ${pad(i + 1)} | \`${c}\` | \`${hashOf(c)}\` | ☐ |`);
const copyBlock = ['', '## Коды для копирования (одним списком)', '', '```', ...codes, '```', ''];
fs.writeFileSync(CODES_FILE, head.concat(rows, copyBlock).join('\n'), 'utf8');

console.log('✅ Готово.');
console.log(`   Хеши обновлены в js/config.js (${count} шт.) — старые коды больше не активируются.`);
console.log(`   Открытые коды записаны в ${path.relative(ROOT, CODES_FILE)} (в git не попадут).`);
console.log('   Дальше: передеплой сайта и сервера, чтобы новые хеши уехали игрокам.');
console.log('   Проверка старого кода: node -e "..." → см. tests/vip-rotate.test.js');
