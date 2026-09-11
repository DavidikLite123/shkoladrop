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

   Запуск:  node server/index.js        (порт 3377, сменить: PORT=xxxx)
   Секрет админки:  ADMIN_SECRET=мой-секрет node server/index.js
   ========================================================================== */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* --------------------------------- КОНФИГ -------------------------------- */
const PORT = Number(process.env.PORT) || 3377;
const HOST = process.env.HOST || '0.0.0.0';
const ADMIN_SECRET = process.env.ADMIN_SECRET || 'david-admin-1337'; // ПОМЕНЯЙ через env!
const REPO_ROOT = path.resolve(__dirname, '..');
const REGISTRY_FILE = process.env.SHKOLA_REGISTRY_FILE || path.join(REPO_ROOT, 'author-codes.json'); // список кодов авторов (в GitHub)
const DATA_DIR = process.env.SHKOLA_DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const SERVER_VERSION = '1.1.0'; // +сообщество: уникальные ID, галочки, чат, облачные сейвы
const MAX_BODY = 512 * 1024; // 512 КБ на запрос
const MAX_ITEM_PRICE = 100000000000; // защита от абсурдных предметов (100 млрд)

/* ------------------------------- БАЗА ДАННЫХ ------------------------------ */
/* Всё хранится в одном JSON-файле server/data/db.json.
   Структура — простая и чинится руками при необходимости. */
const dbEmpty = () => ({
  players: {},      // uid -> { uid, nick, tag, verified, firstSeen, lastSeen }
  supporters: {},   // uid игрока -> код автора, который он ввёл
  earnings: {},     // код автора -> { earned, withdrawn }
  gifts: [],        // { id, fromUid, fromNick, toUid, toNick, item, createdAt, claimed }
  trades: [],       // { code, fromUid, fromNick, offer, wantNote, createdAt, status, joined? }
  deliveries: [],   // { id, toUid, toNick, item, source, createdAt, claimed }
  chat: [],         // { id, uid, nick, tag, text, at, kind } — общий чат сообщества
  saves: {}         // uid -> { save, updatedAt } — облачный бэкап прогресса
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

function isAdmin(req) {
  return req.headers['x-admin-secret'] === ADMIN_SECRET;
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

function upsertPlayer(uidValue, nick) {
  if (!uidValue) return null;
  let p = db.players[uidValue];
  const isNew = !p;
  if (!p) p = { uid: uidValue, nick: '', verified: false, firstSeen: Date.now() };
  if (typeof p.verified !== 'boolean') p.verified = false; // старые записи
  if (nick) p.nick = nick;
  if (!p.tag) p.tag = genPlayerTag(); // автовыдача уникального ID при входе в обновлённую версию
  p.lastSeen = Date.now();
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
    const p = upsertPlayer(pUid, nick);
    dbSave();
    send(res, 200, { ok: true, nick, tag: p ? p.tag : null, verified: !!(p && p.verified) });
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
        verified: !!p.verified, lastSeen: p.lastSeen
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
    const p = upsertPlayer(pUid, cleanStr(body.nick, 24));
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
    if (!isAdmin(req)) return send(res, 403, { ok: false, error: 'нет доступа' });
    const text = cleanStr(body.text, CHAT_TEXT_MAX);
    if (!text) return send(res, 400, { ok: false, error: 'пустое сообщение' });
    db.chat.push({ id: uid('msg'), uid: null, kind: 'admin', nick: 'David Lite (АДМИН)', tag: null, text, at: Date.now() });
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
    if (!isAdmin(req)) return send(res, 403, { ok: false, error: 'нет доступа' });
    const players = Object.values(db.players)
      .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0))
      .map(p => ({
        uid: p.uid, nick: p.nick || 'Игрок', tag: p.tag || null,
        verified: !!p.verified, firstSeen: p.firstSeen || 0, lastSeen: p.lastSeen || 0
      }));
    send(res, 200, { ok: true, players });
  },

  /* ---- АДМИН: выдать / снять галочку верификации ---- */
  'POST /api/admin/players/verify': async (req, res, body) => {
    if (!isAdmin(req)) return send(res, 403, { ok: false, error: 'нет доступа' });
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
    upsertPlayer(pUid, cleanStr(body.nick, 24));
    dbSave();
    send(res, 200, { ok: true, updatedAt: db.saves[pUid].updatedAt });
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
    if (!isAdmin(req)) return send(res, 403, { ok: false, error: 'нет доступа (нужен секрет админа)' });
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
      players: Object.keys(db.players).length,
      supporters: Object.keys(db.supporters).length,
      earnings: db.earnings,
      giftsPending: db.gifts.filter(g => !g.claimed).length,
      tradesOpen: db.trades.filter(t => t.status === 'open').length,
      deliveriesPending: db.deliveries.filter(d => !d.claimed).length
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
  console.log(`  Секрет админки: ${ADMIN_SECRET === 'david-admin-1337' ? 'ДЕФОЛТНЫЙ — поменяй через ADMIN_SECRET!' : 'установлен из переменной окружения ✔'}`);
  console.log('==================================================');
});

module.exports = { server, db, loadRegistry };
