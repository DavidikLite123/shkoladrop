/* ==========================================================================
   ШКОЛА ДРОП — tests/vip-rotate.test.js
   Проверяет ротацию VIP-кодов после утечки:

   1. Старые 100 кодов (были опубликованы на сайте) больше НЕ активируются.
   2. Новые коды из vip_codes_funpay.txt (файл в .gitignore) — активируются.
   3. Открытых кодов в репозитории нет: в js/config.js только хеши.
   4. Все новые коды уникальны, и хешей в config.js ровно столько же.

   Запуск: node tests/vip-rotate.test.js
   (если vip_codes_funpay.txt нет — проверяем только пункт 1 и 3)
   ========================================================================== */
'use strict';

const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CODES_FILE = path.join(ROOT, 'vip_codes_funpay.txt');

let passed = 0, failed = 0;
const t = (name, cond, extra = '') => {
  if (cond) { passed++; console.log('  ✔', name); }
  else { failed++; console.log('  ✘ FAIL:', name, extra); }
};

const hashOf = code => crypto.createHash('sha256')
  .update('shkoladrop-vip:' + String(code).trim().toUpperCase())
  .digest('hex').slice(0, 24);

const config = fs.readFileSync(path.join(ROOT, 'js', 'config.js'), 'utf8');
const start = config.indexOf('const VIP_CODE_HASHES = [');
const end = config.indexOf('\n];', start);
const hashes = config.slice(start, end).match(/'[0-9a-f]{24}'/g).map(s => s.replace(/'/g, ''));

/* Коды, которые лежали в публичном репозитории и раздавались сайтом */
const LEAKED = ['VIP-RS77-J7Y6', 'VIP-FR5H-JDV7', 'VIP-38YK-ULK3', 'VIP-YU25-A3VN', 'VIP-NNKN-NLN3'];

/* Настоящий код — это VIP-XXXX-XXXX без «заглушек» (в текстах встречается VIP-XXXX-XXXX) */
const CODE_RX = /VIP-[A-Z0-9]{4}-[A-Z0-9]{4}/g;
const realCodes = text => (text.match(CODE_RX) || []).filter(c => !c.includes('XXXX'));

console.log('\n🔓 СТАРЫЕ КОДЫ АННУЛИРОВАНЫ');
t('в config.js есть список хешей', hashes.length > 0, `найдено: ${hashes.length}`);
LEAKED.forEach(code => {
  t(`${code} больше не активируется`, !hashes.includes(hashOf(code)));
});

console.log('\n📄 ОТКРЫТЫХ КОДОВ В РЕПОЗИТОРИИ НЕТ');
const tracked = ['js/config.js', 'index.html', 'README.md', 'docs/SERVER_START.md', 'codes/promo-codes.md'];
tracked.forEach(f => {
  const full = path.join(ROOT, f);
  if (!fs.existsSync(full)) return;
  const text = fs.readFileSync(full, 'utf8');
  const found = realCodes(text);
  t(`в ${f} нет открытых VIP-кодов`, found.length === 0, found.slice(0, 3).join(', '));
});
t('codes/vip-codes.md удалён из репозитория', !fs.existsSync(path.join(ROOT, 'codes', 'vip-codes.md')));
t('codes/admin-codes.md удалён из репозитория', !fs.existsSync(path.join(ROOT, 'codes', 'admin-codes.md')));
t('vip_codes_funpay.txt в .gitignore', fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').includes('vip_codes_funpay.txt'));

if (fs.existsSync(CODES_FILE)) {
  console.log('\n✨ НОВЫЕ КОДА РАБОТАЮТ');
  const text = fs.readFileSync(CODES_FILE, 'utf8');
  const codes = Array.from(new Set(realCodes(text)));
  t('новый список непустой', codes.length >= 10, `кодов: ${codes.length}`);
  t('все новые коды уникальны', new Set(codes).size === codes.length);
  t('хешей в config.js столько же, сколько кодов', hashes.length === codes.length, `хешей ${hashes.length}, кодов ${codes.length}`);
  const allValid = codes.every(c => hashes.includes(hashOf(c)));
  t('каждый новый код активируется', allValid);
  const leakedStillInVault = LEAKED.filter(c => codes.includes(c));
  t('старых утёкших кодов в новом списке нет', leakedStillInVault.length === 0, leakedStillInVault.join(','));
} else {
  console.log('\n⚠️  vip_codes_funpay.txt нет (файл приватный) — проверки новых кодов пропущены');
}

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
