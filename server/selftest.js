/* ==========================================================================
   Самотест сервера ШКОЛА ДРОП: node server/selftest.js
   Поднимает сервер на случайном порту с временными данными и гоняет все API:
   коды авторов, спонсорство 10%, подарки, трейдинг, админ-выдача кода.
   Никаких зависимостей — только Node 18+ (встроенный fetch).
   ========================================================================== */
'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// Временный реестр кодов, чтобы не трогать настоящий author-codes.json:
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shkola-server-test-'));
const tmpRegistry = path.join(tmpDir, 'author-codes.json');
fs.writeFileSync(tmpRegistry, JSON.stringify({
  version: 1, royaltyPercent: 10,
  codes: [
    { code: 'TESTYT', ownerUid: 'player-111', ownerName: 'Тестовый Ютубер' },
    { code: 'SECOND', ownerUid: 'player-222', ownerName: 'Второй Автор' }
  ]
}));

const PORT = 38000 + Math.floor(Math.random() * 2000);
const BASE = `http://127.0.0.1:${PORT}/api`;
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-secret': 'test-secret' };
const JSONH = { 'Content-Type': 'application/json' };

let passed = 0, failed = 0;
const t = (name, cond) => {
  if (cond) { passed++; console.log('  ✔', name); }
  else { failed++; console.log('  ✘ FAIL:', name); }
};
const j = r => r.json();

async function main() {
  const child = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
    env: Object.assign({}, process.env, {
      PORT: String(PORT), HOST: '127.0.0.1',
      ADMIN_SECRET: 'test-secret',
      SHKOLA_REGISTRY_FILE: tmpRegistry // сервер читает этот путь, если задан
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stderr.on('data', d => console.error('[server]', d.toString().trim()));

  // ждём подъёма
  let up = false;
  for (let i = 0; i < 50; i++) {
    try { await j(await fetch(`${BASE}/ping`)); up = true; break; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  t('сервер поднялся и отвечает на /api/ping', up);
  if (!up) { child.kill(); process.exit(1); }

  console.log('\n— Спонсорство / коды авторов —');
  const reg = await j(await fetch(`${BASE}/author-codes`));
  t('реестр содержит тестовый код TESTYT', reg.codes.some(c => c.code === 'TESTYT'));

  let r = await fetch(`${BASE}/auth/sync`, { method: 'POST', headers: JSONH, body: JSON.stringify({ uid: 'player-999', nick: 'Вова228' }) });
  t('sync аккаунта', r.ok);

  r = await fetch(`${BASE}/author-codes/apply`, { method: 'POST', headers: JSONH, body: JSON.stringify({ uid: 'player-999', nick: 'Вова228', code: 'testyt' }) });
  let body = await r.json();
  t('код автора применился (регистр не важен)', r.ok && body.code === 'TESTYT');

  r = await fetch(`${BASE}/author-codes/apply`, { method: 'POST', headers: JSONH, body: JSON.stringify({ uid: 'player-999', code: 'NOSUCHCODE' }) });
  t('несуществующий код отклонён', r.status === 404);

  r = await fetch(`${BASE}/royalty`, { method: 'POST', headers: JSONH, body: JSON.stringify({ uid: 'player-999', amount: 2600 }) });
  t('репорт 10% прошёл', r.ok);

  // доход владельца кода — GET и затем снятие
  let earn = await j(await fetch(`${BASE}/author/earnings?uid=player-111`));
  t('владелец видит накопленные 10% (2600)', earn.ok && earn.earned === 2600 && earn.supporters === 1);

  r = await fetch(`${BASE}/author/withdraw`, { method: 'POST', headers: JSONH, body: JSON.stringify({ uid: 'player-111' }) });
  body = await r.json();
  t('вывод 2600 автору', r.ok && body.payout === 2600);
  earn = await j(await fetch(`${BASE}/author/earnings?uid=player-111`));
  t('после вывода счётчик обнулился', earn.earned === 0 && earn.withdrawn === 2600);

  console.log('\n— Админ-выдача кода —');
  r = await fetch(`${BASE}/admin/author-codes`, { method: 'POST', headers: JSONH, body: JSON.stringify({ ownerUid: 'player-777', ownerName: 'Хакер' }) });
  t('без секрета — 403', r.status === 403);
  r = await fetch(`${BASE}/admin/author-codes`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ ownerUid: 'player-777', ownerName: 'Новый Ютубер', code: 'NEWYOUTUBER' }) });
  body = await r.json();
  t('админ выдал код NEWYOUTUBER', r.ok && body.entry && body.entry.code === 'NEWYOUTUBER');
  const reg2 = await j(await fetch(`${BASE}/author-codes`));
  t('новый код подхватился из файла', reg2.codes.some(c => c.code === 'NEWYOUTUBER'));
  const written = JSON.parse(fs.readFileSync(tmpRegistry, 'utf8'));
  t('код записался в сам файл author-codes.json', written.codes.some(c => c.ownerUid === 'player-777'));

  console.log('\n— Подарки —');
  const item = { id: 'sch_chalk', uid: 'case-abc', name: 'Коробка цветного мела', icon: '🖍️', price: 1800, rarity: 'restricted', category: 'school' };
  r = await fetch(`${BASE}/gifts`, { method: 'POST', headers: JSONH, body: JSON.stringify({ fromUid: 'player-999', fromNick: 'Вова228', toUid: 'player-111', item }) });
  t('подарок отправлен', r.ok);
  let gifts = await j(await fetch(`${BASE}/gifts?uid=player-111`));
  t('у получателя 1 входящий подарок', gifts.incoming.length === 1);
  r = await fetch(`${BASE}/gifts/${gifts.incoming[0].id}/claim`, { method: 'POST', headers: JSONH, body: JSON.stringify({ uid: 'player-111' }) });
  body = await r.json();
  t('подарок забран, предмет получен', r.ok && body.item && body.item.id === 'sch_chalk');
  gifts = await j(await fetch(`${BASE}/gifts?uid=player-111`));
  t('повторно забрать нельзя', gifts.incoming.length === 0);

  console.log('\n— Трейдинг —');
  r = await fetch(`${BASE}/trades`, { method: 'POST', headers: JSONH, body: JSON.stringify({ fromUid: 'player-999', fromNick: 'Вова228', item, wantNote: 'хочу кота' }) });
  body = await r.json();
  t('комната создана, код выдан', r.ok && /^[A-Z2-9]{6}$/.test(body.code));
  const code = body.code;
  let room = await j(await fetch(`${BASE}/trades?code=${code}`));
  t('комната видна по коду', room.ok && room.offer.id === 'sch_chalk');

  const catItem = { id: 'cat_murka', uid: 'case-zzz', name: 'Кошка Мурка', icon: '🐱', price: 50000, rarity: 'secret', category: 'cat' };
  r = await fetch(`${BASE}/trades/${code}/join`, { method: 'POST', headers: JSONH, body: JSON.stringify({ uid: 'player-111', nick: 'Ютубер', item: catItem }) });
  body = await r.json();
  t('обмен исполнен атомарно', r.ok && body.got.id === 'sch_chalk');
  room = await j(await fetch(`${BASE}/trades?code=${code}`));
  t('комната закрыта после обмена', room.ok === false);

  // выдача обеим сторонам
  let dlv999 = await j(await fetch(`${BASE}/deliveries?uid=player-999`));
  let dlv111 = await j(await fetch(`${BASE}/deliveries?uid=player-111`));
  t('создателю ждёт предмет партнёра (кошка)', dlv999.deliveries.length === 1 && dlv999.deliveries[0].item.id === 'cat_murka');
  t('партнёру ждёт предмет создателя (мел)', dlv111.deliveries.length === 1 && dlv111.deliveries[0].item.id === 'sch_chalk');
  r = await fetch(`${BASE}/deliveries/${dlv999.deliveries[0].id}/claim`, { method: 'POST', headers: JSONH, body: JSON.stringify({ uid: 'player-999' }) });
  t('выдача создателю забрана', r.ok);

  // отмена комнаты
  r = await fetch(`${BASE}/trades`, { method: 'POST', headers: JSONH, body: JSON.stringify({ fromUid: 'player-555', fromNick: 'Коля', item }) });
  body = await r.json();
  r = await fetch(`${BASE}/trades/${body.code}/cancel`, { method: 'POST', headers: JSONH, body: JSON.stringify({ uid: 'player-555' }) });
  t('комната отменена владельцем', r.ok);
  const dlv555 = await j(await fetch(`${BASE}/deliveries?uid=player-555`));
  t('предмет вернулся в выдачу', dlv555.deliveries.length === 1);

  console.log(`\n${passed} passed, ${failed} failed`);
  child.kill();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
