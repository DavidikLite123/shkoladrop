/* ==========================================================================
   ШКОЛА ДРОП — tests/server-security.test.js
   Проверяет закрытие утечек (сезон 4.1) на живом сервере:

   1. Статика: сервер сообщества больше НЕ отдаёт codes/, author-codes.json,
      docs/, tests/, server/ — только саму игру (index.html, js/, css/, assets/).
   2. Админка: вход только по коду (POST /api/admin/login) → токен роли;
      старые утёкшие код «1337» и секрет «david-admin-1337» не работают.
   3. Токен: с токеном админ-ручки открыты, без токена — 403;
      просроченный/поддельный токен не проходит.

   Запуск: node tests/server-security.test.js
   ========================================================================== */
'use strict';

const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shkola-sec-test-'));
const PORT = 39000 + Math.floor(Math.random() * 500);
const BASE = `http://127.0.0.1:${PORT}`;

const OWNER_CODE = 'owner-code-test-' + crypto.randomBytes(3).toString('hex');
const STAFF_CODE = 'staff-code-test-' + crypto.randomBytes(3).toString('hex');

let passed = 0, failed = 0;
const t = (name, cond, extra = '') => {
  if (cond) { passed++; console.log('  ✔', name); }
  else { failed++; console.log('  ✘ FAIL:', name, extra); }
};

function startServer() {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      HOST: '127.0.0.1',
      OWNER_ADMIN_CODE: OWNER_CODE,
      STAFF_ADMIN_CODE: STAFF_CODE,
      SHKOLA_DATA_DIR: path.join(tmpDir, 'data'),
      SHKOLA_REGISTRY_FILE: path.join(tmpDir, 'author-codes.json')
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', d => console.error('[server]', d.toString().trim()));
  return child;
}

async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`${BASE}/api/ping`);
      if (r.ok) return true;
    } catch (e) {}
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

const code = async (p, opts) => (await fetch(BASE + p, opts)).status;
const json = async (p, opts) => (await fetch(BASE + p, opts)).json();

(async () => {
  const server = startServer();
  try {
    t('сервер поднялся', await waitUp());

    console.log('\n🔒 СТАТИКА: отдаём только игру');
    t('index.html — отдаётся', await code('/index.html') === 200);
    // РЕГРЕССИЯ: белый список статики однажды начал отбрасывать пустой путь,
    // и при заходе на сервер браузером вместо игры отдавался 404.
    const rootResp = await fetch(BASE + '/');
    const rootBody = rootResp.ok ? await rootResp.text() : '';
    t('корень «/» открывает игру, а не 404',
      rootResp.status === 200 && rootBody.includes('ШКОЛА ДРОП'), 'код ' + rootResp.status);
    t('js/config.js — отдаётся (это клиент игры)', await code('/js/config.js') === 200);
    t('css/style.css — отдаётся', await code('/css/style.css') === 200);
    t('codes/vip-codes.md — НЕ отдаётся', await code('/codes/vip-codes.md') === 404);
    t('codes/admin-codes.md — НЕ отдаётся', await code('/codes/admin-codes.md') === 404);
    t('codes/promo-codes.md — НЕ отдаётся', await code('/codes/promo-codes.md') === 404);
    t('author-codes.json — НЕ отдаётся', await code('/author-codes.json') === 404);
    t('tests/*.test.js — НЕ отдаётся', await code('/tests/static-check.test.js') === 404);
    t('server/index.js — НЕ отдаётся', await code('/server/index.js') === 404);
    t('docs/SERVER_START.md — НЕ отдаётся', await code('/docs/SERVER_START.md') === 404);
    t('package.json — НЕ отдаётся', await code('/package.json') === 404);
    t('попытка выйти из корня (../) — не отдаётся', await code('/..%2f..%2fetc%2fpasswd') === 404);

    console.log('\n🔑 ВХОД В АДМИНКУ: только по серверному коду');
    const oldCode = await json('/api/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: '1337' })
    });
    t('старый утёкший код «1337» не пускает', !oldCode.ok && oldCode.error, JSON.stringify(oldCode));

    const oldSecret = await code('/api/admin/dump', { headers: { 'x-admin-secret': 'david-admin-1337' } });
    t('старый утёкший секрет «david-admin-1337» не пускает', oldSecret === 403, 'код ' + oldSecret);

    const bad = await json('/api/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'неверный-код' })
    });
    t('неверный код — отказ', bad.ok === false);

    const owner = await json('/api/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: OWNER_CODE })
    });
    t('верный код владельца выдаёт токен', owner.ok === true && owner.role === 'owner' && !!owner.token);
    t('токен имеет срок жизни (12 ч)', owner.exp - Date.now() > 11 * 3600 * 1000);

    const staff = await json('/api/admin/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'STAFF' + STAFF_CODE }) // префикс срезается, как раньше
    });
    t('код администрации (с префиксом) даёт роль admin', staff.ok === true && staff.role === 'admin');

    console.log('\n🛡 ТОКЕН: кого пускаем, кого нет');
    const meOk = await json('/api/admin/me', { headers: { 'x-admin-token': owner.token } });
    t('/api/admin/me с токеном владельца — owner', meOk.ok === true && meOk.role === 'owner');

    const noToken = await code('/api/admin/players');
    t('без токена админ-ручка закрыта (403)', noToken === 403);

    const withToken = await code('/api/admin/players', { headers: { 'x-admin-token': owner.token } });
    t('с токеном админ-ручка открыта (200)', withToken === 200);

    const forged = owner.token.replace(/\.[^.]+$/, '.poddelka');
    t('подделанная подпись токена не проходит', await code('/api/admin/me', { headers: { 'x-admin-token': forged } }) === 401);

    const expired = [owner.token.split('.')[0], Date.now() - 1000, owner.token.split('.')[2]].join('.');
    t('просроченный токен не проходит', await code('/api/admin/me', { headers: { 'x-admin-token': expired } }) === 401);

    const staffDump = await code('/api/admin/dump', { headers: { 'x-admin-token': staff.token } });
    t('администратор в /api/admin/dump не пускается (только владелец)', staffDump === 403);

    const ownerDump = await code('/api/admin/dump', { headers: { 'x-admin-token': owner.token } });
    t('владелец в /api/admin/dump пускается', ownerDump === 200);

    console.log('\n🚫 АНТИБРУТФОРС');
    let last = 0;
    for (let i = 0; i < 12; i++) {
      last = (await fetch(BASE + '/api/admin/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'перебор-' + i })
      })).status;
    }
    t('после 10 неверных попыток сервер отвечает 429', last === 429, 'последний код ' + last);

    console.log('\n🧼 В КЛИЕНТЕ НЕТ КОДОВ И СЕКРЕТОВ');
    const clientFiles = ['js/config.js', 'js/netplay.js', 'js/game.js', 'index.html'];
    const forbidden = [
      ['хеш кода владельца (OWNER_CODE_HASH)', /OWNER_CODE_HASH/],
      ['хеш кода админа (ADMIN_CODE_HASH)', /ADMIN_CODE_HASH/],
      ['старый секрет владельца', /OWNER_SERVER_SECRET|david-admin/],
      ['старый секрет администрации', /ADMIN_SERVER_SECRET|david-staff/],
      ['функция betaCodeHash', /betaCodeHash/]
    ];
    for (const f of clientFiles) {
      const text = fs.readFileSync(path.join(ROOT, f), 'utf8');
      const hits = forbidden.filter(([, rx]) => rx.test(text)).map(([name]) => name);
      t(`в ${f} нет секретов админки`, hits.length === 0, hits.join(', '));
    }
    const gameJs = fs.readFileSync(path.join(ROOT, 'js', 'game.js'), 'utf8');
    t('панель ходит на сервер (AdminAuth.login), а не считает хеши сама', /AdminAuth\.login/.test(gameJs));
  } finally {
    server.kill('SIGTERM');
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  }

  console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
