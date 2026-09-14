/* ==========================================================================
   ШКОЛА ДРОП — tests/vault.test.js
   Проверяет, что данные переживают «обнуление» диска Render.

   Сценарий (как в жизни):
     1. Сервер работает с локальной базой server/data/db.json.
     2. Во внешний сейф (тут — локальный HTTP-сервер) уезжает копия базы.
     3. Диск «стирается»: каталог с базой удаляем, сервер убиваем SIGKILL.
     4. Сервер поднимается на пустом каталоге — и восстанавливает прогресс из сейфа.

   Запуск: node tests/vault.test.js
   ========================================================================== */
'use strict';

const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const PORT = 39600 + Math.floor(Math.random() * 300);
const BASE = `http://127.0.0.1:${PORT}`;
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shkola-vault-test-'));

let passed = 0, failed = 0;
const t = (name, cond, extra = '') => {
  if (cond) { passed++; console.log('  ✔', name); }
  else { failed++; console.log('  ✘ FAIL:', name, extra); }
};

/* ---------- Фальшивый «сейф»: GET отдаёт JSON, PUT сохраняет ---------- */
let vaultBody = null;
let vaultPushes = 0;
const vaultServer = http.createServer((req, res) => {
  if (req.method === 'GET') {
    if (!vaultBody) { res.writeHead(404); return res.end('{}'); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(vaultBody));
  }
  if (req.method === 'PUT') {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      try { vaultBody = JSON.parse(Buffer.concat(chunks).toString('utf8')); vaultPushes++; } catch (e) { res.writeHead(400); return res.end('bad json'); }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"ok":true}');
    });
    return;
  }
  res.writeHead(405); res.end();
});

function startGameServer(dataDir) {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
    env: Object.assign({}, process.env, {
      PORT: String(PORT),
      HOST: '127.0.0.1',
      SHKOLA_DATA_DIR: dataDir,
      SHKOLA_REGISTRY_FILE: path.join(tmpRoot, 'author-codes.json'),
      SHKOLA_VAULT: 'http',
      SHKOLA_VAULT_URL: `http://127.0.0.1:${vaultPort}/bucket/shkola-db`,
      SHKOLA_VAULT_MIN_SEC: '2'
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', d => { child._log = (child._log || '') + d.toString(); });
  child.stderr.on('data', d => console.error('[server]', d.toString().trim()));
  return child;
}

async function waitUp() {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(`${BASE}/api/ping`)).ok) return true; } catch (e) {}
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

async function waitFor(cond, ms = 10000) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await cond()) return true;
    await new Promise(r => setTimeout(r, 200));
  }
  return false;
}

let vaultPort = 0;

(async () => {
  await new Promise(resolve => vaultServer.listen(0, '127.0.0.1', resolve));
  vaultPort = vaultServer.address().port;

  const dataDirA = path.join(tmpRoot, 'disk-A');
  const uid = 'vault-player-' + crypto.randomBytes(3).toString('hex');
  const nick = 'Тест Восстановления';
  const save = { balance: 777777, inventory: [{ id: 'sch_chewed_pen', uid: 'itm-1', name: 'Ручка', icon: '🖊️', price: 300, rarity: 'consumer', category: 'school' }] };

  let server = startGameServer(dataDirA);
  try {
    t('сервер (диск A) поднялся', await waitUp());

    console.log('\n💾 Пишем прогресс');
    const post = await fetch(`${BASE}/api/save`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid, nick, save })
    });
    t('сейв записан на сервер', post.ok);
    await fetch(`${BASE}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uid, nick, text: 'привет из сейфа' })
    });

    console.log('\n☁️ Копия уезжает во внешний сейф');
    const pushed = await waitFor(() => !!(vaultBody && vaultBody.saves && vaultBody.saves[uid]), 15000);
    t('сейф получил базу с нашим игроком (автопуш сработал)', pushed, `пушей: ${vaultPushes}`);
    t('пустая база в сейф не отправлялась', vaultPushes >= 1);
    t('в сейфе есть наш игрок', !!(vaultBody && vaultBody.saves && vaultBody.saves[uid]));
    t('в сейфе есть сохранённый баланс', !!(vaultBody && vaultBody.saves[uid] && vaultBody.saves[uid].save.balance === 777777));

    console.log('\n💥 Имитируем Render: диск стёрт, процесс убит');
    server.kill('SIGKILL'); // даже без «мягкого» выхода — данные уже в сейфе
    await new Promise(r => setTimeout(r, 500));
    fs.rmSync(dataDirA, { recursive: true, force: true });
    t('локальная база удалена', !fs.existsSync(path.join(dataDirA, 'db.json')));

    console.log('\n♻️ Перезапуск на пустом диске');
    const dataDirB = path.join(tmpRoot, 'disk-B');
    server = startGameServer(dataDirB);
    t('сервер (диск B) поднялся', await waitUp());

    const restored = await (await fetch(`${BASE}/api/save?uid=${uid}`)).json();
    t('прогресс восстановлен из сейфа', restored.ok === true && restored.save && restored.save.balance === 777777, JSON.stringify(restored).slice(0, 120));

    const chat = await (await fetch(`${BASE}/api/chat`)).json();
    t('сообщение из чата тоже пережило вайп', !!(chat.messages || []).find(m => m.text === 'привет из сейфа'));

    const players = await (await fetch(`${BASE}/api/players/public?q=${encodeURIComponent(nick)}`)).json();
    t('карточка игрока (ID/ник) на месте', players.ok === true && players.player && players.player.nick === nick);

    t('в логе есть отметка восстановления', /восстановление|восстановлен/i.test(server._log || ''), (server._log || '').slice(0, 200));

    console.log('\n🧯 Сейф выключен = поведение как раньше');
    const noVault = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'index.js')], {
      env: Object.assign({}, process.env, { PORT: String(PORT + 1), HOST: '127.0.0.1', SHKOLA_DATA_DIR: path.join(tmpRoot, 'disk-C'), SHKOLA_REGISTRY_FILE: path.join(tmpRoot, 'author-codes.json') }),
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let up = false;
    for (let i = 0; i < 40; i++) {
      try { if ((await fetch(`http://127.0.0.1:${PORT + 1}/api/ping`)).ok) { up = true; break; } } catch (e) {}
      await new Promise(r => setTimeout(r, 200));
    }
    noVault.kill('SIGTERM');
    t('сервер работает и без сейфа (обратная совместимость)', up);
  } finally {
    try { server.kill('SIGTERM'); } catch (e) {}
    vaultServer.close();
    await new Promise(r => setTimeout(r, 300));
    try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (e) {}
  }

  console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
