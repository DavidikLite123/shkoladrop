/* ==========================================================================
   ШКОЛА ДРОП — server/vault.js
   ВНЕШНИЙ «СЕЙФ» ДЛЯ БАЗЫ (чтобы данные пережили сон и редеплой Render).

   Проблема: на бесплатном Render диск эфемерный — server/data/db.json
   стирается при каждом spin-down, рестарте и редеплое. Именно поэтому
   случались «вайпы» прогресса.

   Решение: держим базу ещё и снаружи и восстанавливаем её при старте.
   Режимы (env SHKOLA_VAULT):
     • не задан — сейф выключен, всё как раньше (данные только на диске);
     • fs      — сейф = файл по пути SHKOLA_VAULT_PATH (например, на другом диске);
     • github  — сейф = файл в приватном GitHub-репозитории (рекомендуется);
     • http    — сейф = любой HTTP-сервис: GET отдаёт JSON, PUT сохраняет JSON.

   Переменные окружения:
     SHKOLA_VAULT=github
     SHKOLA_VAULT_REPO=DavidikLite123/shkoladrop-vault   (приватный репозиторий!)
     SHKOLA_VAULT_TOKEN=github_pat_...                   (fine-grained, только Contents: R/W)
     SHKOLA_VAULT_PATH=shkola-db.json                    (необязательно)
     SHKOLA_VAULT_BRANCH=main                            (необязательно)
     SHKOLA_VAULT_API=https://api.github.com             (необязательно; только для тестов)
   или:
     SHKOLA_VAULT=fs
     SHKOLA_VAULT_PATH=/mnt/disk/shkola-db.json       (обязателен)
   или:
     SHKOLA_VAULT=http
     SHKOLA_VAULT_URL=https://example.com/bucket/shkola-db
     SHKOLA_VAULT_TOKEN=...                              (необязательно → Authorization: Bearer)
   Общее:
     SHKOLA_VAULT_MIN_SEC=20   — как часто максимум пушим базу наверх (по умолчанию 20 с)

   Ноль зависимостей: только встроенные http/https.
   ========================================================================== */
'use strict';

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { URL } = require('url');

function httpJson(urlStr, { method = 'GET', headers = {}, body = null, timeout = 20000 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try { u = new URL(urlStr); } catch (e) { return reject(new Error('плохой URL хранилища: ' + urlStr)); }
    const lib = u.protocol === 'http:' ? http : https;
    const payload = body == null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'http:' ? 80 : 443),
      path: u.pathname + u.search,
      method,
      headers: Object.assign(
        { 'User-Agent': 'shkoladrop-vault', 'Accept': 'application/json' },
        payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
        headers
      )
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.setTimeout(timeout, () => { req.destroy(new Error('таймаут хранилища')); });
    if (payload) req.write(payload);
    req.end();
  });
}

/* Разбираем ответ сейфа в объект базы: принимаем и «сырой» JSON,
   и обёртки {value: "..."} / {result: "..."} (формат Upstash и подобных). */
function parseStored(text) {
  if (!text) return null;
  let obj;
  try { obj = JSON.parse(text); } catch (e) { return null; }
  if (obj && typeof obj === 'object') {
    const inner = typeof obj.value === 'string' ? obj.value : (typeof obj.result === 'string' ? obj.result : null);
    if (inner) { try { obj = JSON.parse(inner); } catch (e) { return null; } }
  }
  return obj && typeof obj === 'object' && obj.players ? obj : null;
}

/* Есть ли в базе живые данные. Пустую базу в сейф НЕ отправляем: иначе
   сервер, поднявшийся на стёртом диске (и не сумевший прочитать сейф из-за
   сети), затрёт хорошую копию пустышкой. */
function hasContent(db) {
  if (!db) return false;
  const count = o => (o && typeof o === 'object') ? Object.keys(o).length : 0;
  return count(db.players) > 0 || count(db.saves) > 0 || count(db.accounts) > 0 ||
    count(db.supporters) > 0 || count(db.earnings) > 0 ||
    (Array.isArray(db.chat) && db.chat.length > 0) ||
    (Array.isArray(db.dms) && db.dms.length > 0) ||
    (Array.isArray(db.gifts) && db.gifts.length > 0) ||
    (Array.isArray(db.trades) && db.trades.length > 0) ||
    (Array.isArray(db.deliveries) && db.deliveries.length > 0);
}

const Vault = {
  kind: String(process.env.SHKOLA_VAULT || '').toLowerCase() || 'off',
  minSec: Math.max(2, Number(process.env.SHKOLA_VAULT_MIN_SEC) || 20),

  get enabled() {
    if (this.kind === 'github' || this.kind === 'http') return true;
    if (this.kind === 'fs') return !!String(process.env.SHKOLA_VAULT_PATH || '').trim();
    return false;
  },

  _lastPushAt: 0,
  _timer: null,
  _pushing: false,
  _stats: { pushes: 0, fails: 0, skippedEmpty: 0, lastError: '', lastPushAt: 0, pulledAt: 0, restored: false },

  describe() {
    if (this.kind === 'github') return `github:${process.env.SHKOLA_VAULT_REPO || '(нет SHKOLA_VAULT_REPO)'}/${process.env.SHKOLA_VAULT_PATH || 'shkola-db.json'}`;
    if (this.kind === 'http') return `http:${process.env.SHKOLA_VAULT_URL ? 'настроен' : '(нет SHKOLA_VAULT_URL)'}`;
    if (this.kind === 'fs') return `файл:${process.env.SHKOLA_VAULT_PATH || '(нет SHKOLA_VAULT_PATH)'}`;
    return 'выключен (резервных копий базы нет)';
  },

  status() {
    return Object.assign({ enabled: this.enabled, kind: this.kind, target: this.describe() }, this._stats);
  },

  /* ---------------- GITHUB ---------------- */
  _gh() {
    const repo = String(process.env.SHKOLA_VAULT_REPO || '').trim();
    const token = String(process.env.SHKOLA_VAULT_TOKEN || '').trim();
    const file = String(process.env.SHKOLA_VAULT_PATH || 'shkola-db.json').trim();
    const branch = String(process.env.SHKOLA_VAULT_BRANCH || '').trim();
    if (!repo || !token || !/^[^/]+\/[^/]+$/.test(repo)) throw new Error('нужны SHKOLA_VAULT_REPO=owner/repo и SHKOLA_VAULT_TOKEN');
    const headers = {
      'Authorization': 'Bearer ' + token,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    // SHKOLA_VAULT_API — только для автотестов (поддельный GitHub); по умолчанию настоящий API.
    const apiBase = String(process.env.SHKOLA_VAULT_API || 'https://api.github.com').replace(/\/+$/, '');
    const api = `${apiBase}/repos/${repo}/contents/${encodeURIComponent(file).replace(/%2F/g, '/')}`;
    return { api, branch, headers };
  },

  async _ghPull() {
    const { api, branch, headers } = this._gh();
    const res = await httpJson(branch ? `${api}?ref=${encodeURIComponent(branch)}` : api, { headers });
    if (res.status === 404) return null; // сейф ещё пустой — это нормально
    if (res.status !== 200) throw new Error(`GitHub ${res.status}: ${res.text.slice(0, 140)}`);
    const meta = JSON.parse(res.text);
    const text = Buffer.from(String(meta.content || '').replace(/\n/g, ''), 'base64').toString('utf8');
    return parseStored(text);
  },

  async _ghPush(db) {
    const { api, branch, headers } = this._gh();
    let sha = null;
    const cur = await httpJson(branch ? `${api}?ref=${encodeURIComponent(branch)}` : api, { headers });
    if (cur.status === 200) { try { sha = JSON.parse(cur.text).sha || null; } catch (e) {} }
    const body = {
      message: `vault: автосейв базы ${new Date().toISOString()}`,
      content: Buffer.from(JSON.stringify(db), 'utf8').toString('base64')
    };
    if (sha) body.sha = sha;
    if (branch) body.branch = branch;
    const put = await httpJson(api, { method: 'PUT', headers, body });
    if (put.status !== 200 && put.status !== 201) throw new Error(`GitHub ${put.status}: ${put.text.slice(0, 140)}`);
  },

  /* ---------------- FILESYSTEM ---------------- */
  _fsPath() {
    const p = String(process.env.SHKOLA_VAULT_PATH || '').trim();
    if (!p) throw new Error('нужен SHKOLA_VAULT_PATH — путь к файлу-сейфу');
    return p;
  },

  async _fsPull() {
    const p = this._fsPath();
    if (!fs.existsSync(p)) return null;
    return parseStored(fs.readFileSync(p, 'utf8'));
  },

  async _fsPush(db) {
    const p = this._fsPath();
    const tmp = p + '.tmp';
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, p); // атомарно: сейф никогда не бывает битым
  },

  /* ---------------- HTTP ---------------- */
  _httpCfg() {
    const url = String(process.env.SHKOLA_VAULT_URL || '').trim();
    if (!url) throw new Error('нужен SHKOLA_VAULT_URL');
    const token = String(process.env.SHKOLA_VAULT_TOKEN || '').trim();
    return { url, headers: token ? { 'Authorization': 'Bearer ' + token } : {} };
  },

  async _httpPull() {
    const { url, headers } = this._httpCfg();
    const res = await httpJson(url, { headers });
    if (res.status === 404) return null;
    if (res.status !== 200) throw new Error(`хранилище ${res.status}: ${res.text.slice(0, 140)}`);
    return parseStored(res.text);
  },

  async _httpPush(db) {
    const { url, headers } = this._httpCfg();
    const res = await httpJson(url, { method: 'PUT', headers, body: JSON.stringify(db) });
    if (res.status !== 200 && res.status !== 201 && res.status !== 204) {
      throw new Error(`хранилище ${res.status}: ${res.text.slice(0, 140)}`);
    }
  },

  /* ---------------- ПУБЛИЧНОЕ ---------------- */

  /* Забрать базу из сейфа. null — сейфа нет/пусто/ошибка (сервер продолжит на локальной). */
  async pull() {
    if (!this.enabled) return null;
    try {
      const data = this.kind === 'github' ? await this._ghPull()
        : (this.kind === 'fs' ? await this._fsPull() : await this._httpPull());
      this._stats.pulledAt = Date.now();
      if (data && hasContent(data)) {
        this._stats.restored = true;
        console.log(`[vault] база восстановлена из сейфа (${this.describe()}); игроков: ${Object.keys(data.players || {}).length}`);
        return data;
      }
      return null;
    } catch (e) {
      this._stats.lastError = e.message;
      console.warn('[vault] не смог прочитать сейф:', e.message);
      return null;
    }
  },

  /* Отправить базу в сейф прямо сейчас */
  async push(db) {
    if (!this.enabled || !db || this._pushing) return false;
    if (!hasContent(db)) { this._stats.skippedEmpty++; return false; } // пустышкой сейф не затираем
    this._pushing = true;
    try {
      const snapshot = JSON.parse(JSON.stringify(db));
      if (this.kind === 'github') await this._ghPush(snapshot);
      else if (this.kind === 'fs') await this._fsPush(snapshot);
      else await this._httpPush(snapshot);
      this._stats.pushes++;
      this._stats.lastPushAt = Date.now();
      this._lastPushAt = Date.now();
      this._stats.lastError = '';
      return true;
    } catch (e) {
      this._stats.fails++;
      this._stats.lastError = e.message;
      console.warn('[vault] не смог сохранить в сейф:', e.message);
      return false;
    } finally {
      this._pushing = false;
    }
  },

  /* Отложенный пуш: не чаще SHKOLA_VAULT_MIN_SEC, но не теряет последнее изменение */
  schedulePush(getDb) {
    if (!this.enabled) return;
    const wait = Math.max(0, this.minSec * 1000 - (Date.now() - this._lastPushAt));
    if (this._timer) return; // уже запланировано
    this._timer = setTimeout(async () => {
      this._timer = null;
      await this.push(getDb());
    }, wait);
    if (this._timer.unref) this._timer.unref();
  },

  /* При выходе процесса — дописать базу в сейф, не теряя последние секунды */
  async flush(getDb) {
    if (!this.enabled) return false;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    return this.push(getDb());
  }
};

module.exports = Vault;
