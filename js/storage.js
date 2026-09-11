/* ==========================================================================
   ШКОЛА ДРОП 2.0 — js/storage.js
   Файлы cookie (согласие, категории, настройки, метаданные, бэкап прогресса),
   localStorage-сохранение и ВАЙП СЕЗОНА 3.7 (прогресс обнуляется,
   ник и уникальный ID аккаунта переносятся).
   ========================================================================== */

/* --------------------------------------------------------------------------
   1. СХЕМА СОХРАНЕНИЯ
   -------------------------------------------------------------------------- */
const SAVE_KEY = 'shkola_drop_save_v12';
const LEGACY_KEYS = ['shkola_drop_save_v10', 'shkola_drop_save_v9', 'shkola_drop_save_v8', 'shkola_drop_save_v7', 'shkola_drop_save_v6'];
/* Все ключи предыдущих версий — из них вайп 3.7 вытаскивает только ник/ID */
const OLD_SAVE_KEYS = ['shkola_drop_save_v11'].concat(LEGACY_KEYS);

const DEFAULT_STATS = {
  casesOpened: 0,
  secretCases: 0,
  upgradesWon: 0,
  upgradesLost: 0,
  riskyWins: 0,
  itemsSold: 0,
  earnedTotal: 0,
  idleCollected: 0,
  miniBest: 0,
  miniCaught: 0,
  biggestDrop: 0,
  biggestDropName: '',
  bestWinChance: 0,
  balanceMax: 0,
  level: 1,
  xp: 0,
  dailyStreak: 0,
  lastDailyClaim: 0,
  promosUsed: [],
  usedVipCodes: [],   // Использованные VIP-коды (чтобы один код не сработал дважды)
  vipActive: false,   // Активирован ли вечный VIP (отключает налог миллионера)
  vipActivatedAt: 0,  // Дата активации VIP
  vipCode: '',        // Какой именно код был активирован
  betaTester: false,  // Активирован ли доступ к закрытому бета-тесту
  betaActivatedAt: 0, // Дата активации бета-доступа
  betaMode: false,    // Включена ли тестовая ветка 3.6 Beta
  betaSavedNick: '',  // Бэкап настоящего ника на время беты (в бете ник — «Тест»)
  // Спонсорство (код автора): кого поддерживаю, сколько сгенерировал автору и очередь на сервер
  authorCode: null,           // { code, ownerUid, ownerName } | null
  authorRoyaltyLocal: 0,      // сколько ₽ мои открытия принесли автору (локальный счётчик)
  authorRoyaltyPending: 0,    // очередь репортов на сервер (придётся, когда сервер появится онлайн)
  netGiftsSent: 0,
  netGiftsReceived: 0,
  netTradesDone: 0,
  achievements: [],
  unlockedTitles: [],
  catFound: false,
  idle: { level: 0, pending: 0, lastCollect: 0 },
  createdAt: 0,
  lastSeen: 0,
  sessions: 0,
  hardModeNotified: false,
  richTaxNotified: false,
  tapLimitClosed: false
};

function freshStats() {
  return JSON.parse(JSON.stringify(DEFAULT_STATS));
}

/* --------------------------------------------------------------------------
   2. COOKIE-ХРАНИЛИЩЕ
   -------------------------------------------------------------------------- */
const CookieStore = {
  supported() {
    try {
      if (typeof document === 'undefined' || !document.cookie === undefined) return false;
      document.cookie = 'shkola_test=1;path=/;SameSite=Lax';
      const ok = document.cookie.indexOf('shkola_test=1') !== -1;
      document.cookie = 'shkola_test=;path=/;max-age=0;SameSite=Lax';
      return ok;
    } catch (e) {
      return false;
    }
  },

  set(name, value, days = 365) {
    try {
      const secure = location.protocol === 'https:' ? ';Secure' : '';
      document.cookie = `${name}=${encodeURIComponent(value)};path=/;max-age=${Math.floor(days * 86400)};SameSite=Lax${secure}`;
      return true;
    } catch (e) {
      return false;
    }
  },

  get(name) {
    try {
      const target = name + '=';
      const parts = document.cookie ? document.cookie.split(';') : [];
      for (let i = 0; i < parts.length; i++) {
        const c = parts[i].trim();
        if (c.indexOf(target) === 0) return decodeURIComponent(c.slice(target.length));
      }
    } catch (e) {}
    return null;
  },

  remove(name) {
    try {
      document.cookie = `${name}=;path=/;max-age=0;SameSite=Lax`;
    } catch (e) {}
  },

  getJSON(name, fallback = null) {
    const raw = this.get(name);
    if (!raw) return fallback;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  },

  setJSON(name, obj, days = 365) {
    try {
      return this.set(name, JSON.stringify(obj), days);
    } catch (e) {
      return false;
    }
  },

  names(prefix = 'shkola') {
    const out = [];
    try {
      (document.cookie ? document.cookie.split(';') : []).forEach(c => {
        const name = c.trim().split('=')[0];
        if (name.indexOf(prefix) === 0) out.push(name);
      });
    } catch (e) {}
    return out;
  },

  totalSizeKB() {
    let bytes = 0;
    try {
      bytes = (document.cookie || '').length;
    } catch (e) {}
    return bytes / 1024;
  },

  clearAll() {
    this.names().forEach(n => this.remove(n));
  }
};

/* --------------------------------------------------------------------------
   3. СОГЛАСИЕ НА COOKIE
   -------------------------------------------------------------------------- */
const Consent = {
  LOCAL: 'shkola_consent_local',
  COOKIE: 'shkola_consent',
  VERSION: 1,

  get() {
    let data = CookieStore.getJSON(this.COOKIE, null);
    if (!data) { try { data = JSON.parse(localStorage.getItem(this.LOCAL) || 'null'); } catch (e) {} }
    if (!data || typeof data !== 'object') return null;
    return {
      version: data.version || 0,
      ts: data.ts || 0,
      cats: Object.assign({ save: true, functional: true, analytics: true }, data.cats || {})
    };
  },

  isSet() {
    const c = this.get();
    return !!(c && c.version === this.VERSION);
  },

  set(cats) {
    const payload = {
      version: this.VERSION,
      ts: Date.now(),
      cats: Object.assign({ save: true, functional: true, analytics: true }, cats || {})
    };
    CookieStore.setJSON(this.COOKIE, payload, 365);
    try { localStorage.setItem(this.LOCAL, JSON.stringify(payload)); } catch (e) {}
    return payload;
  },

  saveAllowed() {
    const c = this.get();
    return !c || c.cats.save !== false;
  },

  functionalAllowed() {
    const c = this.get();
    return !c || c.cats.functional !== false;
  },

  analyticsAllowed() {
    const c = this.get();
    return !c || c.cats.analytics !== false;
  }
};

/* --------------------------------------------------------------------------
   4. НАСТРОЙКИ (cookie + зеркало в сохранении)
   -------------------------------------------------------------------------- */
const SettingsStore = {
  COOKIE: 'shkola_settings',

  normalize(raw) {
    const out = Object.assign({}, DEFAULT_SETTINGS);
    if (raw && typeof raw === 'object') {
      if (typeof raw.sound === 'boolean') out.sound = raw.sound;
      if (typeof raw.volume === 'number') out.volume = Math.max(0, Math.min(100, raw.volume));
      if (typeof raw.fastOpen === 'boolean') out.fastOpen = raw.fastOpen;
      if (typeof raw.reduceMotion === 'boolean') out.reduceMotion = raw.reduceMotion;
      if (typeof raw.accent === 'string' && ['orange', 'cyan', 'violet', 'emerald'].includes(raw.accent)) out.accent = raw.accent;
      if (typeof raw.quality === 'string' && ['auto', 'high', 'low'].includes(raw.quality)) out.quality = raw.quality;
    }
    return out;
  },

  fromCookie() {
    if (!Consent.functionalAllowed()) return null;
    const raw = CookieStore.getJSON(this.COOKIE, null);
    return raw ? this.normalize(raw) : null;
  },

  toCookie(settings) {
    if (!Consent.functionalAllowed()) {
      CookieStore.remove(this.COOKIE);
      return;
    }
    CookieStore.setJSON(this.COOKIE, this.normalize(settings), 365);
  }
};

/* --------------------------------------------------------------------------
   5. МЕТАДАННЫЕ И ЛОКАЛЬНАЯ СТАТИСТИКА В COOKIE
   -------------------------------------------------------------------------- */
const MetaStore = {
  COOKIE_META: 'shkola_meta',
  COOKIE_STATS: 'shkola_stats',

  read() {
    return CookieStore.getJSON(this.COOKIE_META, {}) || {};
  },

  write(meta) {
    CookieStore.setJSON(this.COOKIE_META, meta, 365);
  },

  bumpSession() {
    if (!Consent.analyticsAllowed()) return { sessions: 0, firstSeen: 0 };
    const prev = CookieStore.getJSON(this.COOKIE_STATS, null) || { sessions: 0, firstSeen: Date.now(), opens: 0 };
    prev.sessions = (prev.sessions || 0) + 1;
    prev.lastSeen = Date.now();
    CookieStore.setJSON(this.COOKIE_STATS, prev, 90);
    return prev;
  },

  readStats() {
    return CookieStore.getJSON(this.COOKIE_STATS, null) || null;
  }
};

/* --------------------------------------------------------------------------
   6. МЕНЕДЖЕР СОХРАНЕНИЙ
   -------------------------------------------------------------------------- */
const SaveManager = {
  chunkPrefix: 'shkola_save_',

  defaultData() {
    return {
      version: SAVE_VERSION,
      balance: 2000,
      inventory: [],
      user: null,
      stats: freshStats(),
      settings: Object.assign({}, DEFAULT_SETTINGS),
      createdAt: Date.now(),
      lastSeen: Date.now()
    };
  },

  /** Приводит любой загруженный объект к актуальной схеме */
  normalize(raw) {
    const base = this.defaultData();
    if (!raw || typeof raw !== 'object') return base;

    const data = Object.assign({}, base);
    data.balance = Number.isFinite(raw.balance) ? raw.balance : base.balance;
    data.inventory = Array.isArray(raw.inventory) ? raw.inventory.filter(i => i && i.id) : [];
    data.user = raw.user && raw.user.nick ? raw.user : null;
    data.settings = SettingsStore.normalize(raw.settings);

    const stats = Object.assign(freshStats(), raw.stats || {});
    stats.promosUsed = Array.isArray(stats.promosUsed) ? stats.promosUsed : [];
    stats.usedVipCodes = Array.isArray(stats.usedVipCodes) ? stats.usedVipCodes : [];
    stats.achievements = Array.isArray(stats.achievements) ? stats.achievements : [];
    stats.unlockedTitles = Array.isArray(stats.unlockedTitles) ? stats.unlockedTitles : [];
    stats.idle = Object.assign({ level: 0, pending: 0, lastCollect: 0 }, stats.idle || {});
    // Признак VIP-статуса — булево на случай если в старом сохранении его вообще не было
    if (typeof stats.vipActive !== 'boolean') stats.vipActive = false;
    if (typeof stats.vipActivatedAt !== 'number') stats.vipActivatedAt = 0;
    if (typeof stats.vipCode !== 'string') stats.vipCode = '';
    // То же для бета-доступа и тестовой ветки 3.6
    if (typeof stats.betaTester !== 'boolean') stats.betaTester = false;
    if (typeof stats.betaActivatedAt !== 'number') stats.betaActivatedAt = 0;
    if (typeof stats.betaMode !== 'boolean') stats.betaMode = false;
    if (typeof stats.betaSavedNick !== 'string') stats.betaSavedNick = '';
    // Спонсорство и сеть
    if (!stats.authorCode || typeof stats.authorCode !== 'object' || !stats.authorCode.code) stats.authorCode = null;
    ['authorRoyaltyLocal', 'authorRoyaltyPending', 'netGiftsSent', 'netGiftsReceived', 'netTradesDone'].forEach(k => {
      if (!Number.isFinite(stats[k])) stats[k] = 0;
    });
    data.stats = stats;

    data.createdAt = raw.createdAt || base.createdAt;
    data.lastSeen = raw.lastSeen || Date.now();
    data.version = SAVE_VERSION;

    // Предметы из старых версий без нужных полей — достраиваем из каталога
    data.inventory = data.inventory.map(inv => {
      const proto = ITEMS_BY_ID[inv.id];
      return Object.assign({}, proto || {}, inv, { uid: inv.uid || 'legacy_' + inv.id + '_' + Math.random().toString(36).slice(2, 7) });
    });

    return data;
  },

  /** Чтение: localStorage (v12) → cookie-бэкап v12 → ВАЙП СЕЗОНА 3.7.
      Старые версии (v11 и ниже) НЕ переносим: инвентарь и баланс сбрасываются
      до стартовых, а ник и уникальный ID аккаунта сохраняются. */
  load() {
    let raw = null;

    try {
      const ls = localStorage.getItem(SAVE_KEY);
      if (ls) raw = JSON.parse(ls);
    } catch (e) {}

    if (!raw) {
      // cookie-бэкап принимается ТОЛЬКО текущей версии (см. readCookieBackup),
      // чтобы бэкап v11 не воскресил вайпнутый прогресс
      const cookieBackup = this.readCookieBackup();
      if (cookieBackup) raw = cookieBackup;
    }

    if (raw) return { data: this.normalize(raw), migrated: false, fresh: false, wiped: false };

    // ---------- ВАЙП СЕЗОНА 3.7 ----------
    // Переносим только личность (ник + ID + галочка). Всё остальное — с нуля.
    const carriedUser = this.readCarriedUser();
    const data = this.defaultData();
    if (carriedUser) data.user = carriedUser;
    return { data: data, migrated: false, fresh: true, wiped: true, carriedUser: !!carriedUser };
  },

  /** Вытащить личность (ник/id/галочку) из сохранений старых версий — для вайпа 3.7.
      Возвращает профиль в актуальном виде: обязательно с полем .id (боевой uid аккаунта). */
  _carriedFrom(u) {
    if (!u || !u.nick) return null;
    const out = Object.assign({}, u);
    out.id = u.id || u.uid || null;
    delete out.uid;
    out.tag = u.tag || null;
    out.verified = !!u.verified;
    out.email = u.email || null;
    return out;
  },

  readCarriedUser() {
    for (const key of OLD_SAVE_KEYS) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        const carried = this._carriedFrom(parsed && parsed.user);
        if (carried) return carried;
      } catch (e) {}
    }
    // Проверим ещё и старый cookie-бэкап v11 — вдруг там сохранились ник/ID
    try {
      const compact = this.readCookieJson();
      const carried = this._carriedFrom(compact && compact.u);
      if (carried) return carried;
    } catch (e) {}
    return null;
  },

  /** Данные старой версии (используется кнопкой «восстановить старое сохранение», если она ещё присутствует) */
  readLegacy() {
    for (const key of LEGACY_KEYS) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') continue;
        return {
          balance: parsed.balance,
          inventory: parsed.inventory,
          user: parsed.user,
          stats: { level: 1 }
        };
      } catch (e) {}
    }
    return null;
  },

  /** Основная запись: localStorage + компактная копия в cookie */
  save(data) {
    if (!Consent.saveAllowed()) return false;

    data.lastSeen = Date.now();
    data.version = SAVE_VERSION;
    data.stats.lastSeen = Date.now();

    let lsOk = false;
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
      lsOk = true;
    } catch (e) {
      lsOk = false;
    }

    this.writeCookieBackup(data);

    // Метаданные — всегда, они крошечные и относятся к обязательным.
    // ВАЖНО: пишем поверх уже сохранённого, иначе теряются флаги вроде welcomeSeen
    // (из-за этого приветственное окно показывалось каждый заход и блокировало прокрутку).
    MetaStore.write(Object.assign(MetaStore.read(), {
      version: APP_VERSION,
      saveVersion: SAVE_VERSION,
      lastSeen: Date.now(),
      level: data.stats.level,
      xp: data.stats.xp,
      dailyStreak: data.stats.dailyStreak,
      lastDailyClaim: data.stats.lastDailyClaim,
      promosUsed: data.stats.promosUsed,
      catFound: !!data.stats.catFound,
      balanceHint: data.balance
    }));

    return lsOk;
  },

  /** Компактная резервная копия прогресса в cookie (до 3 блоков) */
  writeCookieBackup(data) {
    this.clearCookieBackup();
    if (!Consent.saveAllowed()) return false;

    const compact = {
      v: SAVE_VERSION,
      b: data.balance,
      u: data.user,
      s: {
        lvl: data.stats.level, xp: data.stats.xp, co: data.stats.casesOpened,
        uw: data.stats.upgradesWon, ul: data.stats.upgradesLost,
        it: data.stats.itemsSold, et: data.stats.earnedTotal,
        bd: data.stats.biggestDrop, bdn: data.stats.biggestDropName,
        ds: data.stats.dailyStreak, ldc: data.stats.lastDailyClaim,
        pu: data.stats.promosUsed, ach: data.stats.achievements,
        cf: data.stats.catFound, ib: data.stats.miniBest, ic: data.stats.idleCollected,
        bwc: data.stats.bestWinChance, bmax: data.stats.balanceMax,
        idle: data.stats.idle, cz: data.stats.secretCases, sc: data.stats.sessions
      },
      i: data.inventory.slice(0, 40).map(i => ({ id: i.id, uid: i.uid, price: i.price, wonAt: i.wonAt || null })),
      truncated: data.inventory.length > 40
    };

    const json = JSON.stringify(compact);
    if (json.length > COOKIE_MAX_CHUNK * COOKIE_MAX_CHUNKS) {
      this.clearCookieBackup();
      return false;
    }

    const chunks = [];
    for (let i = 0; i < json.length; i += COOKIE_MAX_CHUNK) chunks.push(json.slice(i, i + COOKIE_MAX_CHUNK));
    chunks.forEach((chunk, idx) => CookieStore.set(this.chunkPrefix + idx, chunk, 365));
    CookieStore.set(this.chunkPrefix + 'count', String(chunks.length), 365);
    return true;
  },

  /** Сырой JSON cookie-бэкапа (любой версии) — для вайп-переноса ника/ID */
  readCookieJson() {
    const count = parseInt(CookieStore.get(this.chunkPrefix + 'count') || '0', 10);
    if (!count || count < 1 || count > COOKIE_MAX_CHUNKS) return null;
    let json = '';
    for (let i = 0; i < count; i++) {
      const part = CookieStore.get(this.chunkPrefix + i);
      if (!part) return null;
      json += part;
    }
    try {
      return JSON.parse(json);
    } catch (e) {
      return null;
    }
  },

  readCookieBackup() {
    const compact = this.readCookieJson();
    if (!compact) return null;
    // Принимаем бэкап ТОЛЬКО актуальной версии — иначе после вайпа
    // старый бэкап вернёт игроку весь сброшенный прогресс
    if (compact.v !== SAVE_VERSION) return null;
    try {
      return {
        version: compact.v || SAVE_VERSION,
        balance: compact.b,
        inventory: (compact.i || []).map(x => {
          const proto = ITEMS_BY_ID[x.id] || {};
          return Object.assign({}, proto, { uid: x.uid, wonAt: x.wonAt });
        }),
        user: compact.u || null,
        stats: {
          level: compact.s && compact.s.lvl, xp: compact.s && compact.s.xp,
          casesOpened: compact.s && compact.s.co, upgradesWon: compact.s && compact.s.uw,
          upgradesLost: compact.s && compact.s.ul, itemsSold: compact.s && compact.s.it,
          earnedTotal: compact.s && compact.s.et, biggestDrop: compact.s && compact.s.bd,
          biggestDropName: compact.s && compact.s.bdn, dailyStreak: compact.s && compact.s.ds,
          lastDailyClaim: compact.s && compact.s.ldc, promosUsed: compact.s && compact.s.pu,
          achievements: compact.s && compact.s.ach, catFound: compact.s && compact.s.cf,
          miniBest: compact.s && compact.s.ib, idleCollected: compact.s && compact.s.ic,
          bestWinChance: compact.s && compact.s.bwc, balanceMax: compact.s && compact.s.bmax,
          idle: compact.s && compact.s.idle, secretCases: compact.s && compact.s.cz,
          sessions: compact.s && compact.s.sc
        }
      };
    } catch (e) {
      return null;
    }
  },

  clearCookieBackup() {
    for (let i = 0; i < COOKIE_MAX_CHUNKS + 1; i++) CookieStore.remove(this.chunkPrefix + i);
    CookieStore.remove(this.chunkPrefix + 'count');
  },

  clearAll() {
    try {
      localStorage.removeItem(SAVE_KEY);
      OLD_SAVE_KEYS.forEach(k => localStorage.removeItem(k));
    } catch (e) {}
    this.clearCookieBackup();
    CookieStore.remove(MetaStore.COOKIE_META);
  },

  /** Текстовая резервная копия для ручного бэкапа */
  exportString(data) {
    return JSON.stringify({
      app: 'shkola-drop',
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      data: data
    });
  },

  parseImport(text) {
    try {
      const parsed = JSON.parse(String(text).trim());
      const payload = parsed && parsed.data ? parsed.data : parsed;
      if (!payload || typeof payload !== 'object') return null;
      return this.normalize(payload);
    } catch (e) {
      return null;
    }
  }
};
