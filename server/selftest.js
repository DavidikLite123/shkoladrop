/* ==========================================================================
   Самотест сервера ШКОЛА ДРОП: node server/selftest.js
   Поднимает сервер на случайном порту с временными данными и гоняет все API:
   коды авторов, спонсорство 10%, подарки, трейдинг, админ-выдача кода,
   аккаунты (e-mail+пароль+код) и одноразовый вайп экономики сезона 3.7.
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
const tmpDataDir = path.join(tmpDir, 'data');
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
const ADMIN = { 'Content-Type': 'application/json', 'x-admin-secret': 'test-secret' };       // владелец (owner)
const STAFF = { 'Content-Type': 'application/json', 'x-admin-secret': 'test-staff' };        // администрация (admin)
const JSONH = { 'Content-Type': 'application/json' };

let passed = 0, failed = 0;
const t = (name, cond) => {
  if (cond) { passed++; console.log('  ✔', name); }
  else { failed++; console.log('  ✘ FAIL:', name); }
};
const j = r => r.json();

function startServer() {
  const child = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
    env: Object.assign({}, process.env, {
      PORT: String(PORT), HOST: '127.0.0.1',
      ADMIN_SECRET: 'test-secret',
      STAFF_SECRET: 'test-staff',
      SHKOLA_REGISTRY_FILE: tmpRegistry, // сервер читает этот путь, если задан
      SHKOLA_DATA_DIR: tmpDataDir        // изолированная база во временной папке
    }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stderr.on('data', d => console.error('[server]', d.toString().trim()));
  return child;
}

async function waitUp() {
  for (let i = 0; i < 50; i++) {
    try { await j(await fetch(`${BASE}/ping`)); return true; } catch (e) { await new Promise(r => setTimeout(r, 200)); }
  }
  return false;
}

function stopServer(child) {
  return new Promise(res => {
    if (!child) return res();
    child.once('exit', () => setTimeout(res, 100));
    child.kill();
  });
}

async function main() {
  const child = startServer();
  let liveChild = child;

  // ждём подъёма
  const up = await waitUp();
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

  console.log('\n— Сообщество: уникальные ID, галочки, чат, облачные сейвы —');
  r = await fetch(`${BASE}/auth/sync`, { method: 'POST', headers: JSONH, body: JSON.stringify({ uid: 'player-999', nick: 'Вова228' }) });
  body = await r.json();
  t('sync вернул уникальный ID (#123456)', r.ok && /^#\d{6}$/.test(body.tag));
  t('по умолчанию верификации нет', body.verified === false);

  r = await fetch(`${BASE}/auth/sync`, { method: 'POST', headers: JSONH, body: JSON.stringify({ uid: 'player-999', nick: 'Вова228' }) });
  const body2 = await r.json();
  t('ID выдаётся один раз и не меняется', body2.tag === body.tag);

  r = await fetch(`${BASE}/auth/sync`, { method: 'POST', headers: JSONH, body: JSON.stringify({ uid: 'player-111', nick: 'Ютубер' }) });
  const sync111 = await r.json();
  t('второму игроку выдан ДРУГОЙ ID', /^#\d{6}$/.test(sync111.tag) && sync111.tag !== body.tag);

  let pub = await j(await fetch(`${BASE}/players/public?q=${encodeURIComponent(body.tag)}`));
  t('поиск игрока по уникальному ID', pub.ok && pub.player.uid === 'player-999');
  pub = await j(await fetch(`${BASE}/players/public?q=${encodeURIComponent('вова228')}`));
  t('поиск игрока по нику (регистр не важен)', pub.ok && pub.player.uid === 'player-999');
  r = await fetch(`${BASE}/players/public?q=NOSUCH` , { headers: JSONH });
  t('неизвестный ID → 404', r.status === 404);

  r = await fetch(`${BASE}/admin/players`, { headers: JSONH });
  t('список игроков без секрета — 403', r.status === 403);
  const plist = await j(await fetch(`${BASE}/admin/players`, { headers: ADMIN }));
  t('админ видит список игроков с ID', plist.ok && plist.players.length >= 2 && plist.players.every(p => p.tag));

  r = await fetch(`${BASE}/admin/players/verify`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ uid: 'player-999', verified: true }) });
  body = await r.json();
  t('админ выдал галочку', r.ok && body.verified === true);
  r = await fetch(`${BASE}/auth/sync`, { method: 'POST', headers: JSONH, body: JSON.stringify({ uid: 'player-999', nick: 'Вова228' }) });
  body = await r.json();
  t('sync видит выданную галочку', body.verified === true);
  r = await fetch(`${BASE}/admin/players/verify`, { method: 'POST', headers: JSONH, body: JSON.stringify({ uid: 'player-999', verified: true }) });
  t('без секрета галочку выдать нельзя', r.status === 403);

  r = await fetch(`${BASE}/chat`, { method: 'POST', headers: JSONH, body: JSON.stringify({ uid: 'player-999', nick: 'Вова228', text: 'Всем привет с перемены!' }) });
  t('сообщение в чат отправлено', r.ok);
  r = await fetch(`${BASE}/admin/chat`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ text: 'Официально: сезон продлён!' }) });
  t('админ написал официальное сообщение', r.ok);
  let chat = await j(await fetch(`${BASE}/chat`));
  t('чат отдаёт сообщения', chat.ok && chat.messages.length === 2);
  t('у игрока с галочкой сообщение подсвечено', chat.messages[0].verified === true && chat.messages[0].tag === body.tag);
  t('админ в чате помечен kind=admin', chat.messages[1].kind === 'admin' && chat.messages[1].verified === true);
  chat = await j(await fetch(`${BASE}/chat?after=${chat.messages[0].at}`));
  t('дельта-запрос чата работает', chat.ok && chat.messages.length === 1);
  r = await fetch(`${BASE}/chat`, { method: 'POST', headers: JSONH, body: JSON.stringify({ uid: 'player-111', nick: 'Ютубер', text: '   ' }) });
  t('пустое сообщение отклонено', r.status === 400);
  r = await fetch(`${BASE}/admin/chat/delete`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ id: 'msg-nope' }) });
  body = await r.json();
  t('удаление чужого id — 0 удалено', r.ok && body.removed === 0);

  // ---- РОЛИ АДМИНКИ: owner vs admin ----
  console.log('\n— роли админки (owner / admin), бан, назначение, удаление, смена ника —');
  let staffList = await j(await fetch(`${BASE}/admin/players`, { headers: STAFF }));
  t('администрация видит список игроков (role=admin)', staffList.ok && staffList.role === 'admin' && staffList.players.length >= 2);
  t('администрация НЕ видит почты игроков', staffList.players.every(p => p.email === undefined));
  t('в списке есть онлайн-статус и lastSeen', staffList.players.every(p => typeof p.online === 'boolean' && typeof p.lastSeen === 'number'));
  const ownerList = await j(await fetch(`${BASE}/admin/players`, { headers: ADMIN }));
  t('владелец видит список с role=owner', ownerList.ok && ownerList.role === 'owner');
  r = await fetch(`${BASE}/admin/players/verify`, { method: 'POST', headers: STAFF, body: JSON.stringify({ uid: 'player-999', verified: false }) });
  t('администрация НЕ может выдавать/снимать галочки', r.status === 403);
  r = await fetch(`${BASE}/admin/players/role`, { method: 'POST', headers: STAFF, body: JSON.stringify({ uid: 'player-999', role: 'admin' }) });
  t('администрация НЕ может назначать админов', r.status === 403);
  r = await fetch(`${BASE}/admin/players/delete`, { method: 'POST', headers: STAFF, body: JSON.stringify({ uid: 'player-999' }) });
  t('администрация НЕ может удалять аккаунты', r.status === 403);
  r = await fetch(`${BASE}/admin/author-codes`, { method: 'POST', headers: STAFF, body: JSON.stringify({ ownerUid: 'player-5', ownerName: 'X' }) });
  t('администрация НЕ может выдавать коды авторов', r.status === 403);
  r = await fetch(`${BASE}/admin/chat`, { method: 'POST', headers: STAFF, body: JSON.stringify({ text: 'Модератор на связи', nick: 'Модер' }) });
  t('администрация может писать официально в чат', r.ok);
  chat = await j(await fetch(`${BASE}/chat`));
  t('сообщение администрации подписано (АДМИНИСТРАЦИЯ)', chat.messages[chat.messages.length - 1].nick.includes('АДМИНИСТРАЦИЯ'));
  r = await fetch(`${BASE}/admin/chat/delete`, { method: 'POST', headers: STAFF, body: JSON.stringify({ id: chat.messages[chat.messages.length - 1].id }) });
  body = await r.json();
  t('администрация может удалять сообщения', r.ok && body.removed === 1);

  r = await fetch(`${BASE}/admin/players/role`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ uid: 'player-999', role: 'admin' }) });
  body = await r.json();
  t('владелец назначил игрока админом', r.ok && body.role === 'admin');
  body = await j(await fetch(`${BASE}/auth/sync`, { method: 'POST', headers: JSONH, body: JSON.stringify({ uid: 'player-999', nick: 'Вова228' }) }));
  t('sync отдаёт роль admin игроку', body.role === 'admin' && body.banned === false);
  chat = await j(await fetch(`${BASE}/chat`));
  t('в чате у назначенного админа role=admin', chat.messages[0].role === 'admin');
  pub = await j(await fetch(`${BASE}/players/public?q=player-999`));
  t('публичная карточка показывает роль и онлайн', pub.ok && pub.player.role === 'admin' && pub.player.online === true);

  // смена ника — тот же аккаунт
  r = await fetch(`${BASE}/players/nick`, { method: 'POST', headers: JSONH, body: JSON.stringify({ uid: 'player-999', nick: 'НовыйВова' }) });
  body = await r.json();
  t('смена ника: uid и ID не изменились', r.ok && body.uid === 'player-999' && body.nick === 'НовыйВова' && body.tag === pub.player.tag);
  chat = await j(await fetch(`${BASE}/chat`));
  t('смена ника обновила старые сообщения в чате', chat.messages[0].nick === 'НовыйВова');
  r = await fetch(`${BASE}/auth/sync`, { method: 'POST', headers: JSONH, body: JSON.stringify({ uid: 'player-111', nick: 'НовыйВова' }) });
  body = await r.json();
  t('чужой занятый ник через sync не перехватывается', body.nick !== 'НовыйВова');
  r = await fetch(`${BASE}/players/nick`, { method: 'POST', headers: JSONH, body: JSON.stringify({ uid: 'player-111', nick: 'новыйвова' }) });
  t('занятый ник (без учёта регистра) → 409', r.status === 409);
  r = await fetch(`${BASE}/players/nick`, { method: 'POST', headers: JSONH, body: JSON.stringify({ uid: 'player-111', nick: 'A' }) });
  t('слишком короткий ник → 400', r.status === 400);

  // бан
  r = await fetch(`${BASE}/admin/players/ban`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ uid: 'player-999', banned: true }) });
  body = await r.json();
  t('владелец забанил игрока', r.ok && body.banned === true);
  body = await j(await fetch(`${BASE}/auth/sync`, { method: 'POST', headers: JSONH, body: JSON.stringify({ uid: 'player-999' }) }));
  t('бан снимает роль админа', body.banned === true && body.role === null);
  r = await fetch(`${BASE}/chat`, { method: 'POST', headers: JSONH, body: JSON.stringify({ uid: 'player-999', nick: 'НовыйВова', text: 'а я пишу' }) });
  t('забаненный не может писать в чат', r.status === 403);
  r = await fetch(`${BASE}/players/nick`, { method: 'POST', headers: JSONH, body: JSON.stringify({ uid: 'player-999', nick: 'Хитрец' }) });
  t('забаненный не может сменить ник', r.status === 403);
  r = await fetch(`${BASE}/admin/players/ban`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ uid: 'player-999', banned: false }) });
  t('владелец разбанил', r.ok);

  // причина бана обязательна для администрации; бан по IP; DM; статусы; карточка
  r = await fetch(`${BASE}/admin/players/ban`, { method: 'POST', headers: STAFF, body: JSON.stringify({ uid: 'player-999', banned: true }) });
  t('администрация без причины забанить не может (400)', r.status === 400);
  r = await fetch(`${BASE}/admin/players/ban`, { method: 'POST', headers: STAFF, body: JSON.stringify({ uid: 'player-999', banned: true, reason: 'нашёл дюп и не сообщил', by: 'Модер' }) });
  body = await r.json();
  t('администрация банит с причиной', r.ok && body.banned === true && body.reason === 'нашёл дюп и не сообщил');
  body = await j(await fetch(`${BASE}/auth/sync`, { method: 'POST', headers: JSONH, body: JSON.stringify({ uid: 'player-999' }) }));
  t('sync отдаёт причину и кто забанил', body.banned === true && body.banReason === 'нашёл дюп и не сообщил' && body.banBy === 'Модер');
  r = await fetch(`${BASE}/account/start`, { method: 'POST', headers: JSONH, body: JSON.stringify({ email: 'evil@gmail.com', password: 'qwerty', uid: 'player-new-evil', nick: 'Злодей' }) });
  body = await r.json();
  t('бан по IP: новый аккаунт с того же адреса → 403 с причиной', r.status === 403 && body.banned === true && body.reason === 'нашёл дюп и не сообщил');
  staffList = await j(await fetch(`${BASE}/admin/players`, { headers: STAFF }));
  t('забаненный остаётся в списке с причиной', staffList.players.some(p => p.uid === 'player-999' && p.banned && p.banReason));
  r = await fetch(`${BASE}/admin/players/ban`, { method: 'POST', headers: STAFF, body: JSON.stringify({ uid: 'player-999', banned: false }) });
  t('администрация разбанила', r.ok);
  r = await fetch(`${BASE}/account/start`, { method: 'POST', headers: JSONH, body: JSON.stringify({ email: 'evil@gmail.com', password: 'qwerty', uid: 'player-new-evil', nick: 'Злодей' }) });
  t('после разбана IP свободен — регистрация проходит', r.ok);

  r = await fetch(`${BASE}/admin/players/status`, { method: 'POST', headers: STAFF, body: JSON.stringify({ uid: 'player-999', status: 'scam' }) });
  t('статусы выдаёт только владелец (403 для админа)', r.status === 403);
  r = await fetch(`${BASE}/admin/players/status`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ uid: 'player-999', status: 'scam' }) });
  body = await r.json();
  t('владелец выдал статус scam', r.ok && body.status === 'scam');

  // ---- Защита владельца: со статусом owner забанить нельзя ни админу, ни владельцу ----
  r = await fetch(`${BASE}/auth/sync`, { method: 'POST', headers: JSONH, body: JSON.stringify({ uid: 'player-boss', nick: 'DavidLite' }) });
  r = await fetch(`${BASE}/admin/players/status`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ uid: 'player-boss', status: 'owner' }) });
  t('владелец поставил себе статус owner', r.ok);
  r = await fetch(`${BASE}/admin/players/ban`, { method: 'POST', headers: STAFF, body: JSON.stringify({ uid: 'player-boss', banned: true, reason: 'попытка переворота' }) });
  t('администрация НЕ может забанить владельца (403)', r.status === 403);
  r = await fetch(`${BASE}/admin/players/ban`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ uid: 'player-boss', banned: true, reason: 'случайно' }) });
  t('даже владельческий секрет не банит аккаунт со статусом owner (защита от случайности)', r.status === 403);
  r = await fetch(`${BASE}/admin/players/delete`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ uid: 'player-boss' }) });
  t('аккаунт владельца нельзя удалить', r.status === 403);
  let bossList = await j(await fetch(`${BASE}/admin/players`, { headers: ADMIN }));
  t('владелец не забанен', bossList.players.some(p => p.uid === 'player-boss' && !p.banned));
  // ютубера/легенду админ не банит, владелец — может
  r = await fetch(`${BASE}/admin/players/status`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ uid: 'player-999', status: 'youtuber' }) });
  r = await fetch(`${BASE}/admin/players/ban`, { method: 'POST', headers: STAFF, body: JSON.stringify({ uid: 'player-999', banned: true, reason: 'x' }) });
  t('администрация не банит ютубера (403)', r.status === 403);
  r = await fetch(`${BASE}/admin/players/status`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ uid: 'player-999', status: 'scam' }) });

  // ---- Код автора, привязанный по уникальному ID (#tag), а не по uid ----
  r = await fetch(`${BASE}/auth/sync`, { method: 'POST', headers: JSONH, body: JSON.stringify({ uid: 'player-legenda', nick: 'Легенда_пх' }) });
  const legenda = await r.json();
  r = await fetch(`${BASE}/admin/author-codes`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ ownerUid: legenda.tag, ownerName: 'Легенда_пх', code: 'LEGENDA_PH' }) });
  body = await r.json();
  t('код автора выдан по уникальному ID игрока', r.ok && body.entry.ownerUid === 'player-legenda' && body.entry.ownerTag === legenda.tag);
  r = await fetch(`${BASE}/author/earnings?uid=player-legenda`);
  body = await r.json();
  t('автор видит свой кабинет по коду, выданному через ID', r.ok && body.code === 'LEGENDA_PH');
  r = await fetch(`${BASE}/author-codes/apply`, { method: 'POST', headers: JSONH, body: JSON.stringify({ uid: 'player-legenda', nick: 'Легенда_пх', code: 'legenda_ph' }) });
  t('свой собственный код (по ID) ввести нельзя', r.status === 400);
  r = await fetch(`${BASE}/admin/players/status`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ uid: 'player-999', status: 'hacker' }) });
  t('неизвестный статус → 400', r.status === 400);
  chat = await j(await fetch(`${BASE}/chat`));
  t('статус виден в чате', chat.messages[0].status === 'scam');

  r = await fetch(`${BASE}/admin/players/dm`, { method: 'POST', headers: STAFF, body: JSON.stringify({ uid: 'player-999', text: 'Привет, круто играешь!', from: 'Модер' }) });
  t('администрация написала игроку в личку', r.ok);
  body = await j(await fetch(`${BASE}/dms?uid=player-999`));
  t('игрок видит 1 непрочитанное', body.ok && body.unread === 1 && body.dms[0].from === 'Модер');
  body = await j(await fetch(`${BASE}/auth/sync`, { method: 'POST', headers: JSONH, body: JSON.stringify({ uid: 'player-999' }) }));
  t('sync отдаёт unreadDms', body.unreadDms === 1);
  r = await fetch(`${BASE}/dms/read`, { method: 'POST', headers: JSONH, body: JSON.stringify({ uid: 'player-999' }) });
  body = await j(await fetch(`${BASE}/dms?uid=player-999`));
  t('после прочтения unread=0', body.unread === 0);

  body = await j(await fetch(`${BASE}/admin/players/detail?uid=player-999`, { headers: STAFF }));
  t('карточка игрока для администрации (без почты/IP)', body.ok && body.player.uid === 'player-999' && body.player.email === undefined && body.player.ip === undefined && body.player.dms.length === 1);
  body = await j(await fetch(`${BASE}/admin/players/detail?uid=player-999`, { headers: ADMIN }));
  t('карточка игрока для владельца (с IP)', body.ok && body.player.ip !== undefined);

  // удаление аккаунта
  r = await fetch(`${BASE}/account/start`, { method: 'POST', headers: JSONH, body: JSON.stringify({ email: 'del@gmail.com', password: 'qwerty', uid: 'player-del', nick: 'Удаляемый' }) });
  t('аккаунт для удаления создан', r.ok);
  r = await fetch(`${BASE}/account/start`, { method: 'POST', headers: JSONH, body: JSON.stringify({ email: 'second@gmail.com', password: 'qwerty', uid: 'player-del', nick: 'Удаляемый' }) });
  t('вторая почта на тот же профиль → 409 (один аккаунт = одна почта)', r.status === 409);
  r = await fetch(`${BASE}/chat`, { method: 'POST', headers: JSONH, body: JSON.stringify({ uid: 'player-del', nick: 'Удаляемый', text: 'прощайте' }) });
  r = await fetch(`${BASE}/admin/players/delete`, { method: 'POST', headers: ADMIN, body: JSON.stringify({ uid: 'player-del' }) });
  body = await r.json();
  t('владелец удалил аккаунт (почта + сообщения)', r.ok && body.removed.emails.includes('del@gmail.com') && body.removed.chatMessages === 1);
  r = await fetch(`${BASE}/players/public?q=player-del`);
  t('удалённый игрок больше не находится', r.status === 404);
  const ex = await j(await fetch(`${BASE}/account/exists?email=del@gmail.com`));
  t('удалённая почта снова свободна', ex.exists === false);
  const ov = await j(await fetch(`${BASE}/admin/overview`, { headers: ADMIN }));
  t('overview отдаёт онлайн и роль', ov.ok && typeof ov.online === 'number' && ov.role === 'owner');

  const savePayload = { version: 11, balance: 123456, inventory: [{ id: 'sch_chalk', uid: 'x1', price: 1800 }], user: { id: 'player-999', nick: 'Вова228' }, stats: { level: 5 }, lastSeen: Date.now() };
  const syncBeforeSave = await j(await fetch(`${BASE}/auth/sync`, { method: 'POST', headers: JSONH, body: JSON.stringify({ uid: 'player-999', nick: 'Вова228' }) }));
  r = await fetch(`${BASE}/save`, { method: 'POST', headers: JSONH, body: JSON.stringify({ uid: 'player-999', nick: 'Вова228', save: savePayload }) });
  const saveResp = await r.json();
  t('облачное сохранение залито', r.ok);
  t('сейв-ответ отдаёт уникальный ID (второй канал выдачи)', saveResp.ok && saveResp.tag === syncBeforeSave.tag);
  t('сейв-ответ отдаёт и галочку верификации', saveResp.verified === true);

  // Второй канал выдаёт ID даже новому игроку, который НИКОГДА не звал sync
  r = await fetch(`${BASE}/save`, { method: 'POST', headers: JSONH, body: JSON.stringify({ uid: 'player-saveonly', nick: 'Тихоня', save: { ...savePayload, user: { id: 'player-saveonly', nick: 'Тихоня' } } }) });
  const saveOnly = await r.json();
  t('игрок без sync получает ID через ответ на /api/save', saveOnly.ok && /^#\d{6}$/.test(saveOnly.tag || ''));

  r = await fetch(`${BASE}/auth/sync`, { method: 'POST', headers: JSONH, body: JSON.stringify({ nick: 'без uid' }) });
  t('sync без uid → понятная 400 (клиент сам починит uid)', r.status === 400 && !!(await r.json()).error);
  let cloud = await j(await fetch(`${BASE}/save?uid=player-999`));
  t('облачное сохранение читается', cloud.ok && cloud.save.balance === 123456 && Number.isFinite(cloud.updatedAt));
  r = await fetch(`${BASE}/save?uid=player-nobody`);
  t('нет сохранения → 404', r.status === 404);
  r = await fetch(`${BASE}/save`, { method: 'POST', headers: JSONH, body: JSON.stringify({ uid: 'player-999', save: { hello: 'world' } }) });
  t('битый save отклонён', r.status === 400);

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

  /* ---------------- АККАУНТЫ: E-MAIL + ПАРОЛЬ + КОД (сезон 3.7) ---------------- */
  console.log('\n— Аккаунты: e-mail + пароль + код —');
  let acc = await j(await fetch(`${BASE}/account/start`, { method: 'POST', headers: JSONH, body: JSON.stringify({ email: 'Player@Gmail.com', password: 's1stol', uid: 'player-999', nick: 'Вова228' }) }));
  t('регистрация: mode=register, uid привязан к игровому', acc.ok && acc.mode === 'register' && acc.uid === 'player-999');
  t('демо-код «из письма» вернулся (ровно 6 цифр)', /^[0-9]{6}$/.test(acc.demoCode || ''));

  const exists = await j(await fetch(`${BASE}/account/exists?email=player@gmail.com`));
  t('exists=true для свежей почты', exists.ok && exists.exists === true);

  const wrong = acc.demoCode === '654321' ? '654322' : '654321';
  r = await fetch(`${BASE}/account/verify`, { method: 'POST', headers: JSONH, body: JSON.stringify({ email: 'player@gmail.com', code: wrong }) });
  t('неверный код отклонён (403)', r.status === 403);

  const ver = await j(await fetch(`${BASE}/account/verify`, { method: 'POST', headers: JSONH, body: JSON.stringify({ email: 'player@gmail.com', code: acc.demoCode }) }));
  t('код подтверждён: аккаунт принят', ver.ok === true && ver.uid === 'player-999');
  t('уникальный ID входящего на месте', typeof ver.tag === 'string' && ver.tag.startsWith('#'));

  const relogin = await j(await fetch(`${BASE}/account/start`, { method: 'POST', headers: JSONH, body: JSON.stringify({ email: 'PLAYER@gmail.com', password: 's1stol' }) }));
  t('повторный вход: mode=login, тот же uid (регистр букв не важен)', relogin.ok && relogin.mode === 'login' && relogin.uid === 'player-999');

  r = await fetch(`${BASE}/account/start`, { method: 'POST', headers: JSONH, body: JSON.stringify({ email: 'player@gmail.com', password: 'wrongpass' }) });
  t('неверный пароль отклонён (403)', r.status === 403);

  r = await fetch(`${BASE}/account/start`, { method: 'POST', headers: JSONH, body: JSON.stringify({ email: 'not-an-email', password: 'x' }) });
  t('невалидный e-mail отклонён (400)', r.status === 400);

  const ver2 = await j(await fetch(`${BASE}/account/verify`, { method: 'POST', headers: JSONH, body: JSON.stringify({ email: 'player@gmail.com', code: relogin.demoCode }) }));
  t('второй вход по коду: снова внутри, ник сохранён', ver2.ok === true && ver2.nick === 'Вова228');

  /* ---------------- ОДНОРАЗОВЫЙ ВАЙП ЭКОНОМИКИ СЕЗОНА 3.7 ---------------- */
  console.log('\n— Одноразовый вайп экономики 3.7 —');
  await stopServer(liveChild);
  fs.mkdirSync(tmpDataDir, { recursive: true });
  const dbFile = path.join(tmpDataDir, 'db.json');
  fs.writeFileSync(dbFile, JSON.stringify({
    players: { 'player-old': { uid: 'player-old', nick: 'Старожил', tag: '#424242', verified: true, lastSeen: 1 } },
    accounts: { 'old@gmail.com': { email: 'old@gmail.com', salt: 's', passHash: 'h', uid: 'player-old' } },
    saves: { 'player-old': { save: { balance: 999999, inventory: [{ id: 'sch_chalk', price: 2100 }] }, updatedAt: 1 } },
    gifts: [{ id: 'g1', fromUid: 'a', fromNick: 'a', toUid: 'b', toNick: 'b', item: { id: 'x', price: 1 }, createdAt: 1, claimed: false }],
    trades: [{ code: 'AAAAAA', fromUid: 'a', fromNick: 'a', offer: { id: 'x', price: 1 }, createdAt: 1, status: 'open' }],
    deliveries: [{ id: 'd1', toUid: 'b', toNick: 'b', item: { id: 'x', price: 1 }, source: 'trade', createdAt: 1, claimed: false }],
    supporters: { 'player-old': 'TESTYT' },
    earnings: { TESTYT: { earned: 100, withdrawn: 0 } },
    chat: [{ id: 'm1', uid: null, kind: 'admin', nick: 'Админ', text: 'привет', at: 1 }]
    // meta.seasonWipe НАМЕРЕННО отсутствует — это база «из прошлого сезона»
  }));

  liveChild = startServer();
  t('сервер перезапущен поверх «старой» базы', await waitUp());
  await new Promise(r => setTimeout(r, 400)); // dbSave отрабатывает с дебаунсом
  const after = JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  t('вайп: облачные сейвы стёрты', Object.keys(after.saves || {}).length === 0);
  t('вайп: подарки/трейды/выдача стёрты', (after.gifts || []).length + (after.trades || []).length + (after.deliveries || []).length === 0);
  t('вайп: игрок с ником, ID и галочкой СОХРАНЁН', !!(after.players && after.players['player-old'] && after.players['player-old'].tag === '#424242' && after.players['player-old'].verified === true));
  t('вайп: e-mail аккаунт сохранён', !!(after.accounts && after.accounts['old@gmail.com']));
  t('вайп: спонсорка/начисления/чат сохранены', !!(after.supporters && after.supporters['player-old'] && after.earnings.TESTYT && after.chat.length === 1));
  t('вайп: флаг проставлен (второй раз не запустится)', after.meta && after.meta.seasonWipe === '3.7');

  // новый прогресс ПОСЛЕ вайпа — и ещё один рестарт: повторного вайпа быть не должно
  r = await fetch(`${BASE}/save`, { method: 'POST', headers: JSONH, body: JSON.stringify({ uid: 'player-old', nick: 'Старожил', save: { balance: 12345, inventory: [] } }) });
  t('после вайпа новый сейв заливается', r.ok);
  await new Promise(rs => setTimeout(rs, 350));
  await stopServer(liveChild);
  liveChild = startServer();
  t('третий запуск сервера', await waitUp());
  const sv = await j(await fetch(`${BASE}/save?uid=player-old`));
  t('повторного вайпа нет: новый прогресс пережил рестарт', sv.ok && sv.save && sv.save.balance === 12345);

  console.log(`\n${passed} passed, ${failed} failed`);
  liveChild.kill();
  fs.rmSync(tmpDir, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
