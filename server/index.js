/* ==========================================================================
   ШКОЛА ДРОП — ЛЁГКИЙ ИГРОВОЙ СЕРВЕР (server/index.js)

   Один файл, НОЛЬ зависимостей (только встроенные модули Node.js 18+).

   Что умеет:
   • Раздаёт саму игру (статика из корня репозитория) — одна команда на всё.
   • Коды авторов: читает реестр author-codes.json из корня репо (тот самый
     файл в GitHub). Через админ-запросы может ДОПИСЫВАТЬ в него новые коды.
   • Спонсорство 10%: игроки репортят траты на кейсы, сервер копит долю
     владельца кода; владелец кода забирает накопленное кнопкой в игре.
   • Подарки: игрок → игрок по id аккаунта или нику, с выдачей предмета.
   • Трейдинг: «комната обмена» по коду — создать, вступить, атомарный обмен
     и выдача предметов обеим сторонам.
   • Аккаунты (сезон 3.7): e-mail + пароль + код подтверждения (возврат
     к своему uid/ID с любого устройства). Демо-режим: код возвращается
     в ответе API и показывается в игре, настоящего SMTP нет.
   • Одноразовый вайп экономики 3.7 при первом запуске этой версии:
     чистит сохранения/подарки/трейды, аккаунты и ID остаются.

   Запуск:  node server/index.js        (порт 3377, сменить: PORT=xxxx)
   Секреты админки: ADMIN_SECRET=секрет-владельца STAFF_SECRET=секрет-админов node server/index.js
   Роли: owner (владелец) — всё; admin (администрация) — модерация чата и просмотр игроков.
   ========================================================================== */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* --------------------------------- КОНФИГ -------------------------------- */
const PORT = Number(process.env.PORT) || 3377;
const HOST = process.env.HOST || '0.0.0.0';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'david-admin-1337'; // секрет ВЛАДЕЛЬЦА (owner) — ПОМЕНЯЙ через env!
const STAFF_SECRET = process.env.STAFF_SECRET || 'david-staff-7331'; // секрет АДМИНИСТРАЦИИ (admin) — урезанные права
const ONLINE_WINDOW = 2 * 60 * 1000; // игрок считается «онлайн», если был активен последние 2 минуты
const REPO_ROOT = path.resolve(__dirname, '..');
const REGISTRY_FILE = process.env.SHKOLA_REGISTRY_FILE || path.join(REPO_ROOT, 'author-codes.json'); // список кодов авторов (в GitHub)
const DATA_DIR = process.env.SHKOLA_DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SERVER_VERSION = '1.4.0'; // +роли админки (owner/admin), бан, удаление аккаунтов, смена ника, онлайн
const MAX_BODY = 512 * 1024; // 512 КБ на запрос
const MAX_ITEM_PRICE = 100000000000; // защита от абсурдных предметов (100 млрд)
const AUTH_CODE_TTL = 10 * 60 * 1000;  // код из «письма» живёт 10 минут
const AUTH_CODE_TRIES = 6;             // попыток на один код

/* ------------------------------- БАЗА ДАННЫХ ------------------------------ */
/* Всё хранится в одном JSON-файле server/data/db.json.
   Структура — простая и чинится руками при необходимости. */
const dbEmpty = () => ({
  players: {},      // uid -> { uid, nick, tag, verified, role, banned, banReason, banBy, banAt, status, ip, firstSeen, lastSeen }
  bannedIps: {},    // ip -> { reason, by, at, uid }  — бан по IP: с этого адреса нельзя зарегистрироваться
  dms: [],          // { id, toUid, from, fromRole, text, at, read } — личные сообщения от администрации
  accounts: {},     // email -> { email, salt, passHash, uid, code, codeExp, codeTries, createdAt, verifiedAt }
  supporters: {},   // uid игрока -> код автора, который он ввёл
  earnings: {},     // код автора -> { earned, withdrawn }
  gifts: [],        // { id, fromUid, fromNick, toUid, toNick, item, createdAt, claimed }
  trades: [],       // { code, fromUid, fromNick, offer, wantNote, createdAt, status, joined? }
  deliveries: [],   // { id, toUid, toNick, item, source, createdAt, claimed }
  chat: [],         // { id, uid, nick, tag, text, at, kind } — общий чат сообщества
  saves: {},        // uid -> { save, updatedAt } — облачный бэкап прогресса
  meta: {}          // служебные флаги (например, одноразовый вайп сезона)
});

const CHAT_MAX = 200;      // сколько сообщений чата хранить
const CHAT_TEXT_MAX = 240; // максимальная длина одного сообщения

let db = dbEmpty();
let saveTimer = null;

function dbLoad() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      db = Object.assign(dbEmpty(), parsed);
      return true;
    }
  } catch (e) {
    console.error('[db] не смог прочитать', DB_FILE, e.message);
  }
  return false;
}

function dbSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      const tmp = DB_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
      fs.renameSync(tmp, DB_FILE); // атомарная замена — база не побьётся на середине записи
    } catch (e) {
      console.error('[db] ошибка записи:', e.message);
    }
  }, 150);
}

/* ------------------------- РЕЕСТР КОДОВ АВТОРОВ ---------------------------- */
/* Читаем author-codes.json из корня репо при каждом запросе, но кэшируем по
   mtime — так правки файла через GitHub/vscode подхватываются без рестарта. */
let registryCache = { mtime: 0, data: null };

function loadRegistry() {
  try {
    const stat = fs.statSync(REGISTRY_FILE);
    if (registryCache.data && stat.mtimeMs === registryCache.mtime) return registryCache.data;
    const data = JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
    data.codes = Array.isArray(data.codes) ? data.codes : [];
    registryCache = { mtime: stat.mtimeMs, data };
    return data;
  } catch (e) {
    return { version: 1, royaltyPercent: 10, codes: [], _error: e.message };
  }
}

function saveRegistry(data) {
  data.updatedAt = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(data, null, 2) + '\n');
  registryCache.mtime = 0; // сброс кэша
}

function normalizeCode(code) {
  return String(code || '').trim().replace(/\s+/g, '').toUpperCase();
}

function findAuthorCode(code) {
  const norm = normalizeCode(code);
  return loadRegistry().codes.find(c => normalizeCode(c.code) === norm) || null;
}

function royaltyPct() {
  const pct = Number(loadRegistry().royaltyPercent);
  return Number.isFinite(pct) && pct > 0 && pct <= 100 ? pct : 10;
}

/* -------------------------------- УТИЛИТЫ --------------------------------- */
function uid(prefix) {
  return prefix + '-' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
}

/* ---------- Аккаунты: пароль с солью, код подтверждения ---------- */
function isEmail(v) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v || ''));
}

function hashPassword(password, salt) {
  return crypto.createHash('sha256').update('shkoladrop:' + salt + ':' + String(password)).digest('hex');
}

function genAuthCode() {
  return String(crypto.randomInt(100000, 1000000)); // 6 цифр
}

function roomCode() {
  const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // без 0/O/1/I — чтобы не путались на скриншотах
  let out = '';
  for (let i = 0; i < 6; i++) out += abc[crypto.randomInt(abc.length)];
  return out;
}

function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, x-admin-secret',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('слишком большой запрос')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(new Error('невалидный JSON')); }
    });
    req.on('error', reject);
  });
}

/* ---------- РОЛИ АДМИНКИ ----------
   owner — владелец проекта (секрет ADMIN_SECRET): всё.
   admin — администрация (секрет STAFF_SECRET): модерация чата, список игроков,
           онлайн. НЕЛЬЗЯ: банить, удалять аккаунты, выдавать галочки, назначать
           админов, выдавать коды авторов. */
function adminRole(req) {
  const s = req.headers['x-admin-secret'];
  if (!s) return null;
  if (s === ADMIN_SECRET) return 'owner';
  if (s === STAFF_SECRET) return 'admin';
  return null;
}
function isAdmin(req) { return adminRole(req) !== null; }
function isOwner(req) { return adminRole(req) === 'owner'; }
function isOnline(p) { return !!(p && p.lastSeen && Date.now() - p.lastSeen < ONLINE_WINDOW); }
function clientIp(req) {
  const xf = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || (req.socket && req.socket.remoteAddress) || '';
}
function ipBan(req) { const ip = clientIp(req); return ip && db.bannedIps && db.bannedIps[ip] ? Object.assign({ ip }, db.bannedIps[ip]) : null; }
const PLAYER_STATUSES = ['scam', 'spam', 'test', 'admin', 'owner', 'vip', 'youtuber', 'legend'];
/* Единый ответ «ты забанен» */
function banPayload(p, ipb) {
  const src = p && p.banned ? p : ipb;
  return { ok: false, banned: true, reason: (src && src.reason) || (p && p.banReason) || 'без причины', by: (src && src.by) || (p && p.banBy) || 'администрация', at: (src && src.at) || (p && p.banAt) || 0,
    error: `Аккаунт заблокирован. Причина: ${(src && src.reason) || (p && p.banReason) || 'без причины'}` };
}
function accountEmailOf(uidValue) {
  const acc = Object.values(db.accounts || {}).find(a => a.uid === uidValue);
  return acc ? acc.email : null;
}
function nickTakenBy(nick, exceptUid) {
  const n = cleanStr(nick, 24).toLowerCase();
  if (!n) return null;
  return Object.values(db.players).find(p => p.uid !== exceptUid && String(p.nick || '').toLowerCase() === n) || null;
}

function cleanStr(v, max = 40) {
  return String(v == null ? '' : v).trim().slice(0, max);
}

function cleanItem(item) {
  if (!item || typeof item !== 'object') throw new Error('предмет не задан');
  const price = Number(item.price);
  if (!cleanStr(item.id, 60)) throw new Error('у предмета нет id');
  if (!Number.isFinite(price) || price < 0 || price > MAX_ITEM_PRICE) throw new Error('цена предмета вне диапазона');
  return {
    id: cleanStr(item.id, 60),
    uid: cleanStr(item.uid, 80) || uid('item'),
    name: cleanStr(item.name, 80),
    icon: cleanStr(item.icon, 16) || '🎁',
    price: Math.round(price),
    rarity: cleanStr(item.rarity, 24) || 'consumer',
    category: cleanStr(item.category, 24) || 'other',
    wonAt: cleanStr(item.wonAt, 40)
  };
}

/* ---------- Игроки: сервер помнит uid ↔ ник (для подарков по нику) ---------- */
/* Каждому аккаунту при первом появлении присваивается уникальный публичный
   ID (tag) вида #482913 — короткий и удобный, чтобы искать друзей в чате.
   Выдаётся автоматически и один раз, дальше живёт в базе навсегда. */
function genPlayerTag() {
  let tag;
  const used = new Set(Object.values(db.players).map(p => p.tag));
  do {
    tag = '#' + String(crypto.randomInt(100000, 1000000)); // #100000–#999999
  } while (used.has(tag));
  return tag;
}

function upsertPlayer(uidValue, nick, ip) {
  if (!uidValue) return null;
  let p = db.players[uidValue];
  const isNew = !p;
  if (!p) p = { uid: uidValue, nick: '', verified: false, firstSeen: Date.now() };
  if (typeof p.verified !== 'boolean') p.verified = false; // старые записи
  if (typeof p.banned !== 'boolean') p.banned = false;
  if (!('role' in p)) p.role = null;
  if (!('status' in p)) p.status = null;
  // Ник обновляем, только если он не занят другим игроком (уникальность ников)
  if (nick && !nickTakenBy(nick, uidValue)) p.nick = nick;
  if (!p.tag) p.tag = genPlayerTag(); // автовыдача уникального ID при входе в обновлённую версию
  p.lastSeen = Date.now();
  if (ip) p.ip = ip;
  db.players[uidValue] = p;
  return p;
}

function findPlayer(query) {
  const q = cleanStr(query, 80);
  if (!q) return null;
  if (db.players[q]) return db.players[q]; // точный uid
  const norm = q.startsWith('#') ? q : '#' + q;
  return Object.values(db.players).find(p =>
    p.tag === norm ||
    String(p.tag).replace('#', '') === q ||
    (p.nick && String(p.nick).toLowerCase() === q.toLowerCase())
  ) || null;
}

function findPlayerUidByNick(nick) {
  const n = cleanStr(nick, 24).toLowerCase();
  if (!n) return null;
  const found = Object.values(db.players).find(p => String(p.nick).toLowerCase() === n);
  return found ? found.uid : null;
}

/* ------------------------------- МАРШРУТЫ API ----------------------------- */
const routes = {

  /* PING — клиент проверяет, онлайн ли сервер */
  'GET /api/ping': (req, res) => {
    send(res, 200, {
      ok: true, server: 'shkoladrop', version: SERVER_VERSION,
      royaltyPercent: royaltyPct(), time: Date.now(),
      players: Object.keys(db.players).length,
      chat: db.chat.length
    });
  },

  /* Публичный список кодов авторов (код + владелец + имя), без балансов */
  'GET /api/author-codes': (req, res) => {
    const reg = loadRegistry();
    const out = reg.codes.map(c => ({
      code: c.code, ownerUid: c.ownerUid, ownerName: c.ownerName,
      supporters: Object.values(db.supporters).filter(x => x === normalizeCode(c.code)).length
    }));
    send(res, 200, { ok: true, royaltyPercent: royaltyPct(), codes: out });
  },

  /* Синхронизация аккаунта: сервер запоминает uid и ник игрока,
     выдаёт уникальный ID (tag) и возвращает галочку верификации */
  'POST /api/auth/sync': async (req, res, body) => {
    const pUid = cleanStr(body.uid, 80);
    const nick = cleanStr(body.nick, 24);
    if (!pUid) return send(res, 400, { ok: false, error: 'нет uid' });
    const p = upsertPlayer(pUid, nick, clientIp(req));
    dbSave();
    const ipb = ipBan(req);
    const banned = !!(p && p.banned) || !!ipb;
    send(res, 200, {
      ok: true, nick: p ? p.nick : nick, tag: p ? p.tag : null,
      verified: !!(p && p.verified), role: (p && p.role) || null, status: (p && p.status) || null,
      banned, banReason: banned ? ((p && p.banned && p.banReason) || (ipb && ipb.reason) || 'без причины') : null,
      banBy: banned ? ((p && p.banned && p.banBy) || (ipb && ipb.by) || null) : null,
      unreadDms: db.dms.filter(d => d.toUid === pUid && !d.read).length,
      email: accountEmailOf(pUid)
    });
  },

  /* Личные сообщения от администрации игроку */
  'GET /api/dms': (req, res, body, url) => {
    const pUid = cleanStr(url.searchParams.get('uid'), 80);
    const list = db.dms.filter(d => d.toUid === pUid).slice(-50);
    send(res, 200, { ok: true, dms: list, unread: list.filter(d => !d.read).length });
  },
  'POST /api/dms/read': async (req, res, body) => {
    const pUid = cleanStr(body.uid, 80);
    let n = 0;
    db.dms.forEach(d => { if (d.toUid === pUid && !d.read) { d.read = true; n++; } });
    if (n) dbSave();
    send(res, 200, { ok: true, marked: n });
  },

  /* Смена ника БЕЗ создания нового аккаунта: uid, ID, почта и прогресс остаются.
     Ник должен быть уникальным среди всех игроков сервера. */
  'POST /api/players/nick': async (req, res, body) => {
    const pUid = cleanStr(body.uid, 80);
    const nick = cleanStr(body.nick, 18);
    if (!pUid) return send(res, 400, { ok: false, error: 'нет uid' });
    if (nick.length < 2) return send(res, 400, { ok: false, error: 'Ник — минимум 2 символа' });
    const p = db.players[pUid];
    if (!p) return send(res, 404, { ok: false, error: 'аккаунт не найден на сервере' });
    if (p.banned) return send(res, 403, banPayload(p, null));
    const taken = nickTakenBy(nick, pUid);
    if (taken) return send(res, 409, { ok: false, error: `Ник «${nick}» уже занят другим игроком — придумай другой` });
    const old = p.nick;
    p.nick = nick;
    p.lastSeen = Date.now();
    // обновляем ник в старых сообщениях чата, чтобы не было «двух людей»
    db.chat.forEach(m => { if (m.uid === pUid) m.nick = nick; });
    dbSave();
    send(res, 200, { ok: true, uid: pUid, nick, oldNick: old, tag: p.tag });
  },

  /* -------------------- АККАУНТЫ: E-MAIL + ПАРОЛЬ + КОД --------------------
     Шаг 1 — /start: e-mail+пароль. Если почты нет — регистрируем аккаунт
     (при необходимости привязываем к уже выданному uid, чтобы ID не менялся).
     Если почта есть — проверяем пароль. В любом случае шлём код подтверждения.
     Шаг 2 — /verify: 6-значный код «из письма».
     ДЕМО-РЕЖИМ: настоящего SMTP нет, поэтому код возвращается прямо в ответе
     (demoCode) и показывается игроку прямо в игре. */
  'POST /api/account/start': async (req, res, body) => {
    const email = cleanStr(body.email, 80).toLowerCase();
    const password = String(body.password == null ? '' : body.password);
    const uidIn = cleanStr(body.uid, 80) || null;
    const nickIn = cleanStr(body.nick, 24) || null;
    if (!isEmail(email)) return send(res, 400, { ok: false, error: 'Некорректный e-mail — пример: player@gmail.com' });
    if (password.length < 4 || password.length > 60) return send(res, 400, { ok: false, error: 'Пароль должен быть от 4 до 60 символов' });

    let acc = db.accounts[email];
    const isNew = !acc;
    const ipb = ipBan(req);
    if (isNew && ipb) return send(res, 403, banPayload(null, ipb));
    if (acc && db.players[acc.uid] && db.players[acc.uid].banned) return send(res, 403, banPayload(db.players[acc.uid], null));
    if (acc) {
      if (acc.passHash !== hashPassword(password, acc.salt)) {
        return send(res, 403, { ok: false, mode: 'login', error: 'Неверный пароль. Если это твоя почта — проверь пароль и попробуй ещё раз.' });
      }
    } else {
      // ОДИН ЧЕЛОВЕК = ОДИН АККАУНТ НА ОДНУ ПОЧТУ: если к этому профилю уже
      // привязана другая почта — второй аккаунт не создаём, ник меняется отдельно.
      const boundEmail = uidIn ? accountEmailOf(uidIn) : null;
      if (boundEmail) {
        return send(res, 409, { ok: false, mode: 'register', error: `К этому профилю уже привязана почта ${boundEmail}. Один аккаунт = одна почта. Сменить ник можно в профиле кнопкой «Сменить ник».` });
      }
      if (nickIn && nickTakenBy(nickIn, uidIn)) {
        return send(res, 409, { ok: false, mode: 'register', error: `Ник «${nickIn}» уже занят — выбери другой` });
      }
      // Регистрация: привязываем почту к текущему игровому uid (или создаём игрока)
      const p = upsertPlayer(uidIn || uid('user'), nickIn, clientIp(req));
      const salt = crypto.randomBytes(8).toString('hex');
      acc = {
        email, salt,
        passHash: hashPassword(password, salt),
        uid: p ? p.uid : uidIn,
        createdAt: Date.now()
      };
      db.accounts[email] = acc;
    }
    acc.code = genAuthCode();
    acc.codeExp = Date.now() + AUTH_CODE_TTL;
    acc.codeTries = 0;
    dbSave();
    const p = db.players[acc.uid];
    send(res, 200, {
      ok: true,
      mode: isNew ? 'register' : 'login',
      uid: acc.uid,
      tag: p ? p.tag : null,
      nick: p && p.nick ? p.nick : null,
      verified: !!(p && p.verified),
      demoCode: acc.code, // ДЕМО: вместо настоящего письма
      email
    });
  },

  /* Шаг 2 — подтверждение кода. Возвращает uid/ник/ID — клиент принимает аккаунт. */
  'POST /api/account/verify': async (req, res, body) => {
    const email = cleanStr(body.email, 80).toLowerCase();
    const code = cleanStr(body.code, 12);
    const nickIn = cleanStr(body.nick, 24) || null;
    const acc = db.accounts[email];
    if (!acc) return send(res, 404, { ok: false, error: 'Аккаунт не найден — запроси код заново' });
    if (!acc.code || !acc.codeExp) return send(res, 400, { ok: false, error: 'Код не был запрошен — сначала нажми «Получить код»' });
    if (Date.now() > acc.codeExp) return send(res, 410, { ok: false, error: 'Код просрочен — запроси новый' });
    acc.codeTries = (acc.codeTries || 0) + 1;
    if (acc.codeTries > AUTH_CODE_TRIES) {
      acc.code = null; acc.codeExp = 0; dbSave();
      return send(res, 429, { ok: false, error: 'Слишком много попыток — запроси новый код' });
    }
    if (code !== acc.code) { dbSave(); return send(res, 403, { ok: false, error: 'Неверный код, попробуй ещё раз' }); }
    acc.code = null; acc.codeExp = 0; acc.codeTries = 0;
    const p = upsertPlayer(acc.uid, nickIn); // обновит ник, если игрок его только что придумал
    acc.verifiedAt = Date.now();
    dbSave();
    send(res, 200, {
      ok: true, uid: acc.uid,
      tag: p ? p.tag : null,
      nick: p && p.nick ? p.nick : nickIn,
      verified: !!(p && p.verified),
      email
    });
  },

  /* Подсказка клиенту: есть ли уже аккаунт на эту почту (показываем «Вход» или «Регистрация») */
  'GET /api/account/exists': (req, res, body, url) => {
    const email = cleanStr(url.searchParams.get('email'), 80).toLowerCase();
    send(res, 200, { ok: true, exists: !!(email && db.accounts[email]) });
  },

  /* Найти uid по нику (для подарков «по нику») */
  'GET /api/players/lookup': (req, res, body, url) => {
    const nick = url.searchParams.get('nick');
    const found = findPlayerUidByNick(nick);
    send(res, 200, { ok: true, found, uid: found });
  },

  /* Публичная карточка игрока по уникальному ID (#123456), нику или uid —
     то, что показывает «Сообщество» при поиске */
  'GET /api/players/public': (req, res, body, url) => {
    const p = findPlayer(url.searchParams.get('q'));
    if (!p) return send(res, 404, { ok: false, error: 'Игрок с таким ID не найден' });
    send(res, 200, {
      ok: true,
      player: {
        uid: p.uid, nick: p.nick || 'Игрок', tag: p.tag,
        verified: !!p.verified, role: p.role || null, status: p.status || null, online: isOnline(p), lastSeen: p.lastSeen
      }
    });
  },

  /* -------------------- ЧАТ СООБЩЕСТВА -------------------- */
  /* Последние сообщения; verified подставляется СВЕЖИМ из базы —
     если админ выдал галочку, она видна даже на старых сообщениях */
  'GET /api/chat': (req, res, body, url) => {
    const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit')) || 60));
    const after = Number(url.searchParams.get('after')) || 0; // дельта-запрос: только новые
    const msgs = db.chat.filter(m => m.at > after).slice(-limit).map(m => {
      const p = m.uid && db.players[m.uid];
      return Object.assign({}, m, {
        verified: m.kind === 'admin' ? true : !!(p && p.verified),
        role: (p && p.role) || null,
        status: (p && p.status) || null,
        tag: (p && p.tag) || m.tag || null
      });
    });
    send(res, 200, { ok: true, messages: msgs, players: Object.keys(db.players).length });
  },

  /* Написать в чат (нужен uid аккаунта — привязка к профилю и галочке) */
  'POST /api/chat': async (req, res, body) => {
    const pUid = cleanStr(body.uid, 80);
    const text = cleanStr(body.text, CHAT_TEXT_MAX);
    if (!pUid) return send(res, 400, { ok: false, error: 'нет uid — создай профиль' });
    if (!text) return send(res, 400, { ok: false, error: 'пустое сообщение' });
    if (db.players[pUid] && db.players[pUid].banned) return send(res, 403, banPayload(db.players[pUid], null));
    if (ipBan(req)) return send(res, 403, banPayload(null, ipBan(req)));
    const p = upsertPlayer(pUid, cleanStr(body.nick, 24), clientIp(req));
    db.chat.push({
      id: uid('msg'), uid: pUid, kind: 'player',
      nick: cleanStr(body.nick, 24) || (p && p.nick) || 'Игрок',
      tag: p ? p.tag : null,
      text, at: Date.now()
    });
    if (db.chat.length > CHAT_MAX) db.chat = db.chat.slice(-CHAT_MAX);
    dbSave();
    send(res, 200, { ok: true });
  },

  /* ---- АДМИН: официальное сообщение в чат от имени проекта ---- */
  'POST /api/admin/chat': async (req, res, body) => {
    const role = adminRole(req);
    if (!role) return send(res, 403, { ok: false, error: 'нет доступа' });
    const text = cleanStr(body.text, CHAT_TEXT_MAX);
    if (!text) return send(res, 400, { ok: false, error: 'пустое сообщение' });
    const staffNick = cleanStr(body.nick, 24);
    const nick = role === 'owner' ? 'David Lite (АДМИН)' : (staffNick ? `${staffNick} (АДМИНИСТРАЦИЯ)` : 'Администрация');
    db.chat.push({ id: uid('msg'), uid: null, kind: 'admin', adminRole: role, nick, tag: null, text, at: Date.now() });
    if (db.chat.length > CHAT_MAX) db.chat = db.chat.slice(-CHAT_MAX);
    dbSave();
    send(res, 200, { ok: true });
  },

  /* ---- АДМИН: удалить сообщение из чата (модерация) ---- */
  'POST /api/admin/chat/delete': async (req, res, body) => {
    if (!isAdmin(req)) return send(res, 403, { ok: false, error: 'нет доступа' });
    const id = cleanStr(body.id, 80);
    const before = db.chat.length;
    db.chat = db.chat.filter(m => m.id !== id);
    if (db.chat.length !== before) dbSave();
    send(res, 200, { ok: true, removed: before - db.chat.length });
  },

  /* ---- АДМИН: список зарегистрированных игроков (с ID и галочками) ---- */
  'GET /api/admin/players': (req, res) => {
    const role = adminRole(req);
    if (!role) return send(res, 403, { ok: false, error: 'нет доступа' });
    const players = Object.values(db.players)
      .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0))
      .map(p => ({
        uid: p.uid, nick: p.nick || 'Игрок', tag: p.tag || null,
        verified: !!p.verified, role: p.role || null, banned: !!p.banned,
        banReason: p.banned ? (p.banReason || 'без причины') : null, banBy: p.banned ? (p.banBy || null) : null, banAt: p.banned ? (p.banAt || 0) : null,
        status: p.status || null,
        online: isOnline(p),
        ip: role === 'owner' ? (p.ip || null) : undefined,
        firstSeen: p.firstSeen || 0, lastSeen: p.lastSeen || 0,
        // почту видит только владелец
        email: role === 'owner' ? accountEmailOf(p.uid) : undefined
      }));
    send(res, 200, { ok: true, role, players, online: players.filter(p => p.online).length });
  },

  /* ---- ВЛАДЕЛЕЦ и АДМИНИСТРАЦИЯ: бан / разбан ----
     Причина обязательна (для админов), фиксируется кто забанил. Бан и по uid, и по IP:
     с этого адреса нельзя зарегистрировать новый аккаунт. Забаненный остаётся
     в списке игроков (фильтр «Баны»), разбанить можно в любой момент. */
  'POST /api/admin/players/ban': async (req, res, body) => {
    const role = adminRole(req);
    if (!role) return send(res, 403, { ok: false, error: 'нет доступа' });
    const pUid = cleanStr(body.uid, 80);
    const p = db.players[pUid];
    if (!p) return send(res, 404, { ok: false, error: 'игрок не найден' });
    const ban = !!body.banned;
    const reason = cleanStr(body.reason, 200);
    const by = cleanStr(body.by, 24) || (role === 'owner' ? 'David Lite' : 'Администрация');
    if (ban) {
      if (!reason && role !== 'owner') return send(res, 400, { ok: false, error: 'Укажи причину бана — это обязательно' });
      if (p.role === 'admin' && role !== 'owner') return send(res, 403, { ok: false, error: 'администратора может забанить только владелец' });
      p.banned = true; p.banReason = reason || 'без причины'; p.banBy = by; p.banAt = Date.now();
      p.role = null; // забаненный не может быть админом
      if (p.ip) db.bannedIps[p.ip] = { reason: p.banReason, by, at: p.banAt, uid: pUid };
    } else {
      p.banned = false; p.banReason = null; p.banBy = null; p.banAt = null;
      for (const [ip, b] of Object.entries(db.bannedIps)) if (b.uid === pUid) delete db.bannedIps[ip];
    }
    dbSave();
    send(res, 200, { ok: true, uid: pUid, banned: p.banned, reason: p.banReason || null });
  },

  /* ---- ВЛАДЕЛЕЦ: статус игрока (скам / спам / тест / админ / владелец / ...) ---- */
  'POST /api/admin/players/status': async (req, res, body) => {
    if (!isOwner(req)) return send(res, 403, { ok: false, error: 'статусы выдаёт только владелец' });
    const pUid = cleanStr(body.uid, 80);
    const p = db.players[pUid];
    if (!p) return send(res, 404, { ok: false, error: 'игрок не найден' });
    const st = cleanStr(body.status, 16).toLowerCase();
    if (st && !PLAYER_STATUSES.includes(st)) return send(res, 400, { ok: false, error: 'неизвестный статус', allowed: PLAYER_STATUSES });
    p.status = st || null;
    dbSave();
    send(res, 200, { ok: true, uid: pUid, status: p.status });
  },

  /* ---- АДМИНКА: подробная карточка игрока (уровень, баланс, инвентарь, почта…) ---- */
  'GET /api/admin/players/detail': (req, res, body, url) => {
    const role = adminRole(req);
    if (!role) return send(res, 403, { ok: false, error: 'нет доступа' });
    const pUid = cleanStr(url.searchParams.get('uid'), 80);
    const p = db.players[pUid];
    if (!p) return send(res, 404, { ok: false, error: 'игрок не найден' });
    const sv = db.saves[pUid] && db.saves[pUid].save;
    const st = (sv && sv.stats) || {};
    const inv = Array.isArray(sv && sv.inventory) ? sv.inventory : [];
    send(res, 200, {
      ok: true,
      player: {
        uid: p.uid, nick: p.nick, tag: p.tag, verified: !!p.verified, role: p.role || null, status: p.status || null,
        banned: !!p.banned, banReason: p.banReason || null, banBy: p.banBy || null, banAt: p.banAt || null,
        online: isOnline(p), firstSeen: p.firstSeen, lastSeen: p.lastSeen,
        email: role === 'owner' ? accountEmailOf(pUid) : undefined,
        ip: role === 'owner' ? (p.ip || null) : undefined,
        authorCode: db.supporters[pUid] || null,
        chatMessages: db.chat.filter(m => m.uid === pUid).length,
        dms: db.dms.filter(d => d.toUid === pUid).slice(-10)
      },
      save: sv ? {
        updatedAt: db.saves[pUid].updatedAt,
        balance: sv.balance, level: st.level, xp: st.xp, casesOpened: st.casesOpened, upgradesWon: st.upgradesWon,
        earnedTotal: st.earnedTotal, vipActive: !!st.vipActive, catFound: !!st.catFound,
        biggestDropName: st.biggestDropName, biggestDrop: st.biggestDrop,
        inventoryCount: inv.length,
        inventoryValue: inv.reduce((a, i) => a + (Number(i.price) || 0), 0),
        inventory: inv.slice(0, 60).map(i => ({ id: i.id, name: i.name, icon: i.icon, price: i.price, rarity: i.rarity }))
      } : null
    });
  },

  /* ---- АДМИНКА: личное сообщение игроку (от себя: ник админа) ---- */
  'POST /api/admin/players/dm': async (req, res, body) => {
    const role = adminRole(req);
    if (!role) return send(res, 403, { ok: false, error: 'нет доступа' });
    const pUid = cleanStr(body.uid, 80);
    const text = cleanStr(body.text, 500);
    if (!db.players[pUid]) return send(res, 404, { ok: false, error: 'игрок не найден' });
    if (!text) return send(res, 400, { ok: false, error: 'пустое сообщение' });
    const from = cleanStr(body.from, 24) || (role === 'owner' ? 'David Lite' : 'Администрация');
    const dm = { id: uid('dm'), toUid: pUid, from, fromRole: role, text, at: Date.now(), read: false };
    db.dms.push(dm);
    if (db.dms.length > 2000) db.dms = db.dms.slice(-2000);
    dbSave();
    send(res, 200, { ok: true, dm });
  },

  /* ---- ВЛАДЕЛЕЦ: назначить / снять администратора (значок 🛡 АДМИН у игрока) ---- */
  'POST /api/admin/players/role': async (req, res, body) => {
    if (!isOwner(req)) return send(res, 403, { ok: false, error: 'только владелец назначает админов' });
    const pUid = cleanStr(body.uid, 80);
    const p = db.players[pUid];
    if (!p) return send(res, 404, { ok: false, error: 'игрок не найден' });
    const role = body.role === 'admin' ? 'admin' : null;
    if (role && p.banned) return send(res, 400, { ok: false, error: 'сначала сними бан' });
    p.role = role;
    dbSave();
    send(res, 200, { ok: true, uid: pUid, role: p.role });
  },

  /* ---- ВЛАДЕЛЕЦ: удалить аккаунт целиком (игрок, почта, облачный сейв, сообщения) ---- */
  'POST /api/admin/players/delete': async (req, res, body) => {
    if (!isOwner(req)) return send(res, 403, { ok: false, error: 'только владелец удаляет аккаунты' });
    const pUid = cleanStr(body.uid, 80);
    const p = db.players[pUid];
    if (!p) return send(res, 404, { ok: false, error: 'игрок не найден' });
    const removed = { nick: p.nick, tag: p.tag, emails: [] };
    delete db.players[pUid];
    for (const [email, acc] of Object.entries(db.accounts || {})) {
      if (acc.uid === pUid) { removed.emails.push(email); delete db.accounts[email]; }
    }
    delete db.saves[pUid];
    delete db.supporters[pUid];
    const chatBefore = db.chat.length;
    db.chat = db.chat.filter(m => m.uid !== pUid);
    removed.chatMessages = chatBefore - db.chat.length;
    db.gifts = db.gifts.filter(g => g.toUid !== pUid && g.fromUid !== pUid);
    db.trades = db.trades.filter(t => t.fromUid !== pUid && !(t.joined && t.joined.uid === pUid));
    db.deliveries = db.deliveries.filter(d => d.toUid !== pUid);
    db.dms = db.dms.filter(d => d.toUid !== pUid);
    for (const [ip, b] of Object.entries(db.bannedIps)) if (b.uid === pUid) delete db.bannedIps[ip];
    dbSave();
    send(res, 200, { ok: true, uid: pUid, removed });
  },

  /* ---- ВЛАДЕЛЕЦ: выдать / снять галочку верификации ---- */
  'POST /api/admin/players/verify': async (req, res, body) => {
    if (!isOwner(req)) return send(res, 403, { ok: false, error: 'только владелец выдаёт галочки' });
    const pUid = cleanStr(body.uid, 80);
    const p = db.players[pUid];
    if (!p) return send(res, 404, { ok: false, error: 'игрок не найден' });
    p.verified = !!body.verified;
    dbSave();
    send(res, 200, { ok: true, uid: pUid, verified: p.verified });
  },

  /* -------------------- ОБЛАЧНОЕ СОХРАНЕНИЕ ПРОГРЕССА -------------------- */
  /* Клиент периодически заливает снапшот прогресса; при входе с любого
     устройства прогресс восстанавливается с сервера автоматически. */
  'POST /api/save': async (req, res, body) => {
    const pUid = cleanStr(body.uid, 80);
    if (!pUid) return send(res, 400, { ok: false, error: 'нет uid' });
    const save = body.save;
    if (!save || typeof save !== 'object') return send(res, 400, { ok: false, error: 'нет save' });
    if (!Number.isFinite(save.balance) || !Array.isArray(save.inventory)) {
      return send(res, 400, { ok: false, error: 'save не похож на сохранение игры' });
    }
    db.saves[pUid] = { save, updatedAt: Date.now() };
    const pl = upsertPlayer(pUid, cleanStr(body.nick, 24), clientIp(req));
    dbSave();
    // Заодно отдаём уникальный ID и галочку: второй канал выдачи для клиента
    // (помогает, если стартовый /api/auth/sync не прошёл — сервер спал и т.п.)
    send(res, 200, {
      ok: true, updatedAt: db.saves[pUid].updatedAt,
      tag: pl ? pl.tag : null, verified: !!(pl && pl.verified),
      role: (pl && pl.role) || null, banned: !!(pl && pl.banned), status: (pl && pl.status) || null,
      unreadDms: db.dms.filter(d => d.toUid === pUid && !d.read).length
    });
  },

  'GET /api/save': (req, res, body, url) => {
    const pUid = cleanStr(url.searchParams.get('uid'), 80);
    const entry = db.saves[pUid];
    if (!entry) return send(res, 404, { ok: false, error: 'на сервере нет сохранения для этого аккаунта' });
    send(res, 200, { ok: true, save: entry.save, updatedAt: entry.updatedAt });
  },

  /* Игрок вводит код автора (спонсорство) */
  'POST /api/author-codes/apply': async (req, res, body) => {
    const pUid = cleanStr(body.uid, 80);
    const entry = findAuthorCode(body.code);
    if (!pUid) return send(res, 400, { ok: false, error: 'нет uid' });
    if (!entry) return send(res, 404, { ok: false, error: 'такого кода автора нет' });
    if (entry.ownerUid === pUid) return send(res, 400, { ok: false, error: 'свой собственный код вводить нельзя :)' });
    upsertPlayer(pUid, cleanStr(body.nick, 24));
    db.supporters[pUid] = normalizeCode(entry.code);
    dbSave();
    send(res, 200, { ok: true, code: normalizeCode(entry.code), ownerName: entry.ownerName, royaltyPercent: royaltyPct() });
  },

  /* Игрок отписывается от кода автора */
  'POST /api/author-codes/remove': async (req, res, body) => {
    const pUid = cleanStr(body.uid, 80);
    if (db.supporters[pUid]) { delete db.supporters[pUid]; dbSave(); }
    send(res, 200, { ok: true });
  },

  /* Репорт трат на кейсы: сервер копит долю автора кода (10%) */
  'POST /api/royalty': async (req, res, body) => {
    const pUid = cleanStr(body.uid, 80);
    const amount = Math.floor(Number(body.amount));
    if (!pUid || !Number.isFinite(amount) || amount <= 0 || amount > MAX_ITEM_PRICE) {
      return send(res, 400, { ok: false, error: 'некорректная сумма' });
    }
    const code = db.supporters[pUid];
    if (!code) return send(res, 200, { ok: true, sent: 0 }); // игрок ни от кого — просто ок
    const entry = db.earnings[code] || { earned: 0, withdrawn: 0 };
    entry.earned += amount;
    db.earnings[code] = entry;
    upsertPlayer(pUid, cleanStr(body.nick, 24));
    dbSave();
    send(res, 200, { ok: true, sent: amount, code });
  },

  /* Кабинет автора: сколько накоплено по моему коду (uid = владелец кода) */
  'GET /api/author/earnings': (req, res, body, url) => {
    const pUid = cleanStr(url.searchParams.get('uid'), 80);
    const entry = loadRegistry().codes.find(c => c.ownerUid === pUid);
    if (!entry) return send(res, 404, { ok: false, error: 'у твоего аккаунта нет кода автора' });
    const e = db.earnings[normalizeCode(entry.code)] || { earned: 0, withdrawn: 0 };
    send(res, 200, {
      ok: true, code: entry.code, ownerName: entry.ownerName,
      earned: e.earned, withdrawn: e.withdrawn,
      supporters: Object.values(db.supporters).filter(x => x === normalizeCode(entry.code)).length
    });
  },

  /* Автор забирает накопленные 10% (сервер обнуляет счётчик) */
  'POST /api/author/withdraw': async (req, res, body) => {
    const pUid = cleanStr(body.uid, 80);
    const entry = loadRegistry().codes.find(c => c.ownerUid === pUid);
    if (!entry) return send(res, 404, { ok: false, error: 'нет кода автора' });
    const key = normalizeCode(entry.code);
    const e = db.earnings[key] || { earned: 0, withdrawn: 0 };
    const payout = e.earned;
    e.earned = 0;
    e.withdrawn += payout;
    db.earnings[key] = e;
    dbSave();
    send(res, 200, { ok: true, payout });
  },

  /* ---- АДМИН: выдать код автора (только владелец проекта, по секрету) ---- */
  'POST /api/admin/author-codes': async (req, res, body) => {
    if (!isOwner(req)) return send(res, 403, { ok: false, error: 'нет доступа (нужен секрет владельца)' });
    const ownerUid = cleanStr(body.ownerUid, 80);
    const ownerName = cleanStr(body.ownerName, 60);
    let code = normalizeCode(body.code);
    if (!ownerUid || !ownerName) return send(res, 400, { ok: false, error: 'нужны ownerUid и ownerName' });
    if (!code) code = normalizeCode(ownerName).replace(/[^A-Z0-9]/g, '').slice(0, 10) || ('AUTHOR' + crypto.randomInt(1000));
    if (!/^[A-Z0-9][A-Z0-9-]{1,17}$/.test(code)) return send(res, 400, { ok: false, error: 'код: 2–18 символов, латиница/цифры' });
    if (findAuthorCode(code)) return send(res, 409, { ok: false, error: 'такой код уже есть' });

    const reg = loadRegistry();
    // у одного аккаунта — один код: заменяем старый, если был
    reg.codes = reg.codes.filter(c => c.ownerUid !== ownerUid);
    const entry = { code, ownerUid, ownerName };
    reg.codes.push(entry);
    try { saveRegistry(reg); } catch (e) { return send(res, 500, { ok: false, error: 'не смог сохранить author-codes.json: ' + e.message }); }
    send(res, 200, { ok: true, entry, registryFile: 'author-codes.json' });
  },

  /* ---- АДМИН: общая статистика ---- */
  'GET /api/admin/overview': (req, res) => {
    if (!isAdmin(req)) return send(res, 403, { ok: false, error: 'нет доступа' });
    send(res, 200, {
      ok: true,
      role: adminRole(req),
      online: Object.values(db.players).filter(isOnline).length,
      players: Object.keys(db.players).length,
      accounts: Object.keys(db.accounts || {}).length,
      supporters: Object.keys(db.supporters).length,
      earnings: db.earnings,
      giftsPending: db.gifts.filter(g => !g.claimed).length,
      tradesOpen: db.trades.filter(t => t.status === 'open').length,
      deliveriesPending: db.deliveries.filter(d => !d.claimed).length,
      seasonWipe: db.meta ? db.meta.seasonWipe : null
    });
  },

  /* -------------------- ПОДАРКИ -------------------- */
  /* Отправить подарок: предмет уходит на сервер и ждёт получателя */
  'POST /api/gifts': async (req, res, body) => {
    const fromUid = cleanStr(body.fromUid, 80);
    const fromNick = cleanStr(body.fromNick, 24) || 'Аноним';
    let item;
    try { item = cleanItem(body.item); } catch (e) { return send(res, 400, { ok: false, error: e.message }); }
    let toUid = cleanStr(body.toUid, 80);
    let toNick = cleanStr(body.toNick, 24);
    if (!toUid && toNick) { toUid = findPlayerUidByNick(toNick) || null; }
    if (!toUid) return send(res, 404, { ok: false, error: 'получатель не найден. Попроси его id из Профиля — по нику дарим только тем, кто уже заходил с запущенным сервером.' });
    if (toUid === fromUid) return send(res, 400, { ok: false, error: 'самому себе дарить не надо :)' });
    toNick = toNick || (db.players[toUid] && db.players[toUid].nick) || 'Игрок';
    upsertPlayer(fromUid, fromNick);
    db.gifts.push({ id: uid('gift'), fromUid, fromNick, toUid, toNick, item, createdAt: Date.now(), claimed: false });
    dbSave();
    send(res, 200, { ok: true, toNick });
  },

  /* Мои входящие подарки */
  'GET /api/gifts': (req, res, body, url) => {
    const pUid = cleanStr(url.searchParams.get('uid'), 80);
    const incoming = db.gifts.filter(g => !g.claimed && g.toUid === pUid)
      .map(g => ({ id: g.id, fromNick: g.fromNick, item: g.item, createdAt: g.createdAt }));
    const outgoingCount = db.gifts.filter(g => !g.claimed && g.fromUid === pUid).length;
    send(res, 200, { ok: true, incoming, outgoingCount });
  },

  /* Забрать подарок — предмет возвращается, клиент кладёт его в рюкзак */
  'POST /api/gifts/:id/claim': async (req, res, body, url, m) => {
    const gift = db.gifts.find(g => g.id === m[1]);
    const pUid = cleanStr(body.uid, 80);
    if (!gift || gift.claimed) return send(res, 404, { ok: false, error: 'подарок не найден или уже забран' });
    if (gift.toUid !== pUid) return send(res, 403, { ok: false, error: 'это не твой подарок' });
    gift.claimed = true;
    dbSave();
    send(res, 200, { ok: true, item: gift.item, fromNick: gift.fromNick });
  },

  /* -------------------- ТРЕЙДИНГ (комнаты обмена по коду) -------------------- */
  /* Создать комнату: мой предмет замораживается на сервере */
  'POST /api/trades': async (req, res, body) => {
    const fromUid = cleanStr(body.fromUid, 80);
    const fromNick = cleanStr(body.fromNick, 24) || 'Аноним';
    let offer;
    try { offer = cleanItem(body.item); } catch (e) { return send(res, 400, { ok: false, error: e.message }); }
    if (db.trades.filter(t => t.fromUid === fromUid && t.status === 'open').length >= 5) {
      return send(res, 400, { ok: false, error: 'слишком много открытых обменов (максимум 5)' });
    }
    upsertPlayer(fromUid, fromNick);
    const code = roomCode();
    db.trades.push({ code, fromUid, fromNick, offer, wantNote: cleanStr(body.wantNote, 60), createdAt: Date.now(), status: 'open' });
    dbSave();
    send(res, 200, { ok: true, code });
  },

  /* Посмотреть комнату по коду */
  'GET /api/trades': (req, res, body, url) => {
    const code = normalizeCode(url.searchParams.get('code'));
    const t = db.trades.find(x => x.code === code);
    if (!t) return send(res, 404, { ok: false, error: 'комната с таким кодом не найдена' });
    if (t.status !== 'open') return send(res, 410, { ok: false, error: 'обмен уже завершён или отменён' });
    send(res, 200, { ok: true, code: t.code, fromNick: t.fromNick, offer: t.offer, wantNote: t.wantNote, createdAt: t.createdAt });
  },

  /* Мои комнаты */
  'GET /api/trades/mine': (req, res, body, url) => {
    const pUid = cleanStr(url.searchParams.get('uid'), 80);
    const mine = db.trades.filter(t => t.fromUid === pUid && t.status === 'open')
      .map(t => ({ code: t.code, offer: t.offer, wantNote: t.wantNote, createdAt: t.createdAt }));
    send(res, 200, { ok: true, open: mine });
  },

  /* Вступить в обмен: прикладываю свой предмет → сервер мгновенно и атомарно
     рассылает оба предмета в «выдачу» обоим участникам. Либо всё, либо ничего. */
  'POST /api/trades/:code/join': async (req, res, body, url, m) => {
    const t = db.trades.find(x => x.code === normalizeCode(m[1]));
    if (!t) return send(res, 404, { ok: false, error: 'комната не найдена' });
    if (t.status !== 'open') return send(res, 410, { ok: false, error: 'обмен уже завершён или отменён' });
    const joinUid = cleanStr(body.uid, 80);
    const joinNick = cleanStr(body.nick, 24) || 'Аноним';
    if (joinUid === t.fromUid) return send(res, 400, { ok: false, error: 'это твоя собственная комната' });
    let myItem;
    try { myItem = cleanItem(body.item); } catch (e) { return send(res, 400, { ok: false, error: e.message }); }

    t.status = 'done';
    t.joined = { uid: joinUid, nick: joinNick, item: myItem, at: Date.now() };
    upsertPlayer(joinUid, joinNick);
    // Атомарная раздача обоих предметов через очередь выдачи
    db.deliveries.push(
      { id: uid('dlv'), toUid: t.fromUid, toNick: t.fromNick, item: myItem, source: 'trade', createdAt: Date.now(), claimed: false },
      { id: uid('dlv'), toUid: joinUid, toNick: joinNick, item: t.offer, source: 'trade', createdAt: Date.now(), claimed: false }
    );
    dbSave();
    send(res, 200, { ok: true, got: t.offer });
  },

  /* Отменить свою комнату — предмет возвращается в выдачу */
  'POST /api/trades/:code/cancel': async (req, res, body, url, m) => {
    const t = db.trades.find(x => x.code === normalizeCode(m[1]));
    const pUid = cleanStr(body.uid, 80);
    if (!t) return send(res, 404, { ok: false, error: 'комната не найдена' });
    if (t.fromUid !== pUid) return send(res, 403, { ok: false, error: 'не твоя комната' });
    if (t.status !== 'open') return send(res, 410, { ok: false, error: 'уже завершено' });
    t.status = 'cancelled';
    db.deliveries.push({ id: uid('dlv'), toUid: t.fromUid, toNick: t.fromNick, item: t.offer, source: 'trade-cancel', createdAt: Date.now(), claimed: false });
    dbSave();
    send(res, 200, { ok: true });
  },

  /* Очередь выдачи: предметы с обменов/возвратов */
  'GET /api/deliveries': (req, res, body, url) => {
    const pUid = cleanStr(url.searchParams.get('uid'), 80);
    const list = db.deliveries.filter(d => !d.claimed && d.toUid === pUid)
      .map(d => ({ id: d.id, item: d.item, source: d.source, createdAt: d.createdAt }));
    send(res, 200, { ok: true, deliveries: list });
  },

  'POST /api/deliveries/:id/claim': async (req, res, body, url, m) => {
    const d = db.deliveries.find(x => x.id === m[1]);
    const pUid = cleanStr(body.uid, 80);
    if (!d || d.claimed) return send(res, 404, { ok: false, error: 'выдача не найдена или уже забрана' });
    if (d.toUid !== pUid) return send(res, 403, { ok: false, error: 'это не твоя выдача' });
    d.claimed = true;
    dbSave();
    send(res, 200, { ok: true, item: d.item });
  }
};

/* ------------------------------- СТАТИКА ИГРЫ ------------------------------ */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8'
};

function serveStatic(req, res, pathname) {
  let filePath = path.normalize(path.join(REPO_ROOT, pathname === '/' ? 'index.html' : pathname));
  if (!filePath.startsWith(REPO_ROOT)) { res.writeHead(403); return res.end(); } // защита от ../
  if (filePath.startsWith(DATA_DIR)) { res.writeHead(403); return res.end(); }   // база сервера не раздаётся
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('404 — не найдено'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(buf);
  });
}

/* -------------------------------- ЗАПУСК ---------------------------------- */
dbLoad();

/* ---------- ОДНОРАЗОВЫЙ ВАЙП ЭКОНОМИКИ СЕЗОНА 3.7 ----------
   Удаляем облачные сейвы, подарки, трейды и очередь выдачи — это старый
   прогресс. БЕРЕЖНО СОХРАНЯЕМ аккаунты: players (ник + уникальный ID + галочка),
   accounts (e-mail + пароль), supporters, earnings, chat. Выполняется один раз —
   флаг meta.seasonWipe не даёт повторному запуску стереть новый прогресс. */
if (!db.meta) db.meta = {};
if (db.meta.seasonWipe !== '3.7') {
  const wipedCount =
    Object.keys(db.saves || {}).length +
    (db.gifts || []).filter(g => !g.claimed).length +
    (db.trades || []).filter(t => t.status === 'open').length +
    (db.deliveries || []).filter(d => !d.claimed).length;
  db.saves = {};
  db.gifts = [];
  db.trades = [];
  db.deliveries = [];
  db.meta.seasonWipe = '3.7';
  dbSave();
  console.log(`[вайп 3.7] прогресс сезона обнулён (${wipedCount} записей). Аккаунты, ники, ID и галочки сохранены.`);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const pathname = decodeURIComponent(url.pathname);

  if (req.method === 'OPTIONS') return send(res, 200, { ok: true }); // CORS preflight

  if (pathname.startsWith('/api/')) {
    try {
      const key = `${req.method} ${pathname}`;
      let handler = routes[key];
      let match = null;
      if (!handler) {
        for (const [route, fn] of Object.entries(routes)) {
          if (!route.includes(':')) continue;
          const [m2, ...pattern] = route.split(' ');
          const rx = new RegExp('^' + pattern.join(' ').replace(/:[^/]+/g, '([^/]+)') + '$');
          const mm = pathname.match(rx);
          if (mm && req.method === m2) { handler = fn; match = mm; break; }
        }
      }
      if (!handler) return send(res, 404, { ok: false, error: 'нет такого метода API' });
      const body = req.method === 'POST' ? await readBody(req) : {};
      return await handler(req, res, body, url, match);
    } catch (e) {
      return send(res, 400, { ok: false, error: e.message });
    }
  }

  if (req.method === 'GET') return serveStatic(req, res, pathname);
  res.writeHead(405); res.end();
});

server.listen(PORT, HOST, () => {
  console.log('==================================================');
  console.log('  🎒 ШКОЛА ДРОП — игровой сервер запущен!');
  console.log(`  Игра и API:   http://localhost:${PORT}`);
  console.log(`  Коды авторов: ${REGISTRY_FILE}`);
  console.log(`  База данных:  ${DB_FILE}`);
  console.log(`  Секрет владельца: ${ADMIN_SECRET === 'david-admin-1337' ? 'ДЕФОЛТНЫЙ — поменяй через ADMIN_SECRET!' : 'установлен из переменной окружения ✔'}`);
  console.log(`  Секрет администрации: ${STAFF_SECRET === 'david-staff-7331' ? 'ДЕФОЛТНЫЙ — поменяй через STAFF_SECRET!' : 'установлен из переменной окружения ✔'}`);
  console.log('==================================================');
});

module.exports = { server, db, loadRegistry };
