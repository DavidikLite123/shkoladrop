/* ==========================================================================
   ШКОЛА ДРОП 2.0 — js/storage.js
   Файлы cookie (согласие, категории, настройки, метаданные, бэкап прогресса),
   localStorage-сохранение и ВАЙП СЕЗОНА 3.7 (прогресс обнуляется,
   ник и уникальный ID аккаунта переносятся).
   + RESILIENT VAULT 4.0: двойное сохранение в localStorage + сервер,
     UID-lock, ledger статусов, админ-бэкап всех игроков.
   ========================================================================== */

/* --------------------------------------------------------------------------
   1. СХЕМА СОХРАНЕНИЯ
   -------------------------------------------------------------------------- */
const SAVE_KEY = 'shkola_drop_save_v14';
const LEGACY_KEYS = ['shkola_drop_save_v10', 'shkola_drop_save_v9', 'shkola_drop_save_v8', 'shkola_drop_save_v7', 'shkola_drop_save_v6'];
/* Все ключи предыдущих версий — из них вайп 3.9/3.5 пытается вытащить ник/ID, но теперь вайп ПОЛНЫЙ: прогресс всё равно сбрасывается */
const OLD_SAVE_KEYS = ['shkola_drop_save_v13', 'shkola_drop_save_v12', 'shkola_drop_save_v11'].concat(LEGACY_KEYS);

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
  idle: { level: 0, pending: 0, lastCollect: 0, lastTick: 0 },
  createdAt: 0,
  lastSeen: 0,
  sessions: 0,
  hardModeNotified: false,
  richTaxNotified: false,
  tapLimitClosed: false,
  apologyGiftClaimed: false, // сезон 3.5 — подарок-извинение за вайп 3.9
  // 4.1 — перерождение и кредит
  rebirth: 0,                 // 0..10 уровень перерождения
  creditDebt: 0,              // сколько должен банку
  creditBorrowAt: 0,          // когда взял последний кредит (ms)
  creditHistory: 0,           // всего взято в кредит за всё время
  bankruptUntil: 0,           // до какого времени титул банкрота/воздухана
  bankruptType: '',           // 'bankrupt' | 'vozduhan' | ''
  rebirthNotified: false
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
      if (typeof raw.autoWake === 'boolean') out.autoWake = raw.autoWake;
      if (typeof raw.chatNotify === 'boolean') out.chatNotify = raw.chatNotify;
      if (typeof raw.beta41 === 'boolean') out.beta41 = raw.beta41;
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
   5.5 RESILIENT VAULT — двойное сохранение: localStorage + сервер
   --------------------------------------------------------------------------
   Идея: все критичные данные (id, tag, статусы, галочки, роли, vip, автор-код,
   баланс, инвентарь) дублируются в отдельные ключи localStorage, которые
   переживают даже полный вайп сейва. Если сервер стёрся — при следующем
   входе игра берёт данные из vault и сама перезаливает их на сервер.
   Телефон админа может сохранить ВСЕХ игроков в один бэкап и потом
   восстановить их на чистый сервер одной кнопкой.
   -------------------------------------------------------------------------- */
const IdentityVault = {
  UID_LOCK: 'shkola_uid_lock_v1',
  VAULT: 'shkola_identity_vault_v1',
  PLAYERS: 'shkola_players_vault_v1',
  STATUS_LEDGER: 'shkola_status_ledger_v1',
  ADMIN_BACKUP: 'shkola_admin_full_backup_v1',
  AUTHOR_CODES: 'shkola_author_codes_vault_v1',

  /* ---- UID lock: id никогда не меняется случайно ---- */
  getUidLock() {
    try { return localStorage.getItem(this.UID_LOCK) || null; } catch (e) { return null; }
  },
  setUidLock(uid) {
    if (!uid) return;
    try { localStorage.setItem(this.UID_LOCK, String(uid)); } catch (e) {}
  },
  clearUidLock() {
    try { localStorage.removeItem(this.UID_LOCK); } catch (e) {}
  },

  /* ---- Основной vault: мой профиль + баланс + инвентарь + статусы ---- */
  loadVault() {
    try {
      const raw = localStorage.getItem(this.VAULT);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  },
  saveVault(obj) {
    try {
      const prev = this.loadVault() || {};
      const merged = Object.assign({}, prev, obj, { at: Date.now() });
      localStorage.setItem(this.VAULT, JSON.stringify(merged));
      if (obj && obj.user && obj.user.id) this.setUidLock(obj.user.id);
      if (obj && obj.uid) this.setUidLock(obj.uid);
      return true;
    } catch (e) { return false; }
  },
  saveFromSnapshot(snap) {
    if (!snap || typeof snap !== 'object') return;
    const u = snap.user || null;
    const s = snap.stats || {};
    const payload = {
      uid: u ? u.id : (s ? s.uid : null) || this.getUidLock(),
      user: u ? Object.assign({}, u) : null,
      balance: snap.balance,
      inventory: Array.isArray(snap.inventory) ? snap.inventory.slice(0, 200) : [],
      stats: {
        level: s.level, xp: s.xp, vipActive: !!s.vipActive, vipCode: s.vipCode || '',
        authorCode: s.authorCode || null, promosUsed: s.promosUsed || [],
        betaTester: !!s.betaTester, achievements: s.achievements || [],
        biggestDrop: s.biggestDrop, biggestDropName: s.biggestDropName,
        rebirth: s.rebirth||0, creditDebt: s.creditDebt||0, creditBorrowAt: s.creditBorrowAt||0,
        creditHistory: s.creditHistory||0, bankruptUntil: s.bankruptUntil||0, bankruptType: s.bankruptType||''
      },
      settings: snap.settings || null,
      at: Date.now()
    };
    if (u) {
      payload.tag = u.tag || null;
      payload.nick = u.nick || null;
      payload.verified = !!u.verified;
      payload.role = u.role || null;
      payload.status = u.status || null;
      payload.email = u.email || null;
      payload.rebirth = s.rebirth||0;
      payload.creditDebt = s.creditDebt||0;
      payload.bankruptType = s.bankruptType||null;
    }
    this.saveVault(payload);
    if (u && u.id) this.setUidLock(u.id);
    // также сохраняем игрока в общий vault
    if (u && u.id) this.savePlayer(u);
  },

  /* ---- Vault игроков: все известные игроки (для админ-бэкапа) ---- */
  loadPlayersVault() {
    try {
      const raw = localStorage.getItem(this.PLAYERS);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) { return {}; }
  },
  savePlayer(player) {
    if (!player || !player.uid) return;
    try {
      const all = this.loadPlayersVault();
      all[player.uid] = Object.assign({}, all[player.uid] || {}, player, { _vaultAt: Date.now() });
      localStorage.setItem(this.PLAYERS, JSON.stringify(all));
    } catch (e) {}
  },
  savePlayersBulk(playersArray) {
    if (!Array.isArray(playersArray)) return;
    try {
      const all = this.loadPlayersVault();
      playersArray.forEach(p => {
        if (!p || !p.uid) return;
        all[p.uid] = Object.assign({}, all[p.uid] || {}, p, { _vaultAt: Date.now() });
      });
      localStorage.setItem(this.PLAYERS, JSON.stringify(all));
    } catch (e) {}
  },
  clearPlayersVault() {
    try { localStorage.removeItem(this.PLAYERS); } catch (e) {}
  },

  /* ---- Ledger статусов: кто кому когда выдал статус/галочку/роль ---- */
  loadStatusLedger() {
    try {
      const raw = localStorage.getItem(this.STATUS_LEDGER);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  },
  logStatus(entry) {
    if (!entry || !entry.uid) return;
    try {
      const ledger = this.loadStatusLedger();
      ledger.push(Object.assign({ at: Date.now() }, entry));
      const trimmed = ledger.slice(-500);
      localStorage.setItem(this.STATUS_LEDGER, JSON.stringify(trimmed));
    } catch (e) {}
    this.savePlayer({
      uid: entry.uid, tag: entry.tag || null, nick: entry.nick || null,
      status: entry.status !== undefined ? entry.status : null,
      verified: entry.verified !== undefined ? !!entry.verified : undefined,
      role: entry.role !== undefined ? entry.role : undefined
    });
  },

  /* ---- Автор-коды vault: чтобы id-код авторов можно было менять локально ---- */
  loadAuthorCodesVault() {
    try {
      const raw = localStorage.getItem(this.AUTHOR_CODES);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  },
  saveAuthorCodesVault(data) {
    try { localStorage.setItem(this.AUTHOR_CODES, JSON.stringify(data)); return true; } catch (e) { return false; }
  },

  /* ---- Админ-бэкап всего сервера ---- */
  loadAdminBackup() {
    try {
      const raw = localStorage.getItem(this.ADMIN_BACKUP);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) { return null; }
  },
  saveAdminBackup(backup) {
    try {
      const payload = Object.assign({ at: Date.now(), version: (typeof SAVE_VERSION !== 'undefined' ? SAVE_VERSION : 14) }, backup);
      localStorage.setItem(this.ADMIN_BACKUP, JSON.stringify(payload));
      return true;
    } catch (e) { return false; }
  },
  clearAdminBackup() {
    try { localStorage.removeItem(this.ADMIN_BACKUP); } catch (e) {}
  },
  hasAdminBackup() {
    return !!this.loadAdminBackup();
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
    stats.idle = Object.assign({ level: 0, pending: 0, lastCollect: 0, lastTick: 0 }, stats.idle || {});
    stats.idle.level = Math.max(0, Math.floor(Number(stats.idle.level) || 0));
    stats.idle.pending = Math.max(0, Number(stats.idle.pending) || 0);
    stats.idle.lastCollect = Number(stats.idle.lastCollect) || 0;
    stats.idle.lastTick = Number(stats.idle.lastTick) || 0;
    if (typeof stats.vipActive !== 'boolean') stats.vipActive = false;
    if (typeof stats.vipActivatedAt !== 'number') stats.vipActivatedAt = 0;
    if (typeof stats.vipCode !== 'string') stats.vipCode = '';
    if (typeof stats.betaTester !== 'boolean') stats.betaTester = false;
    if (typeof stats.betaActivatedAt !== 'number') stats.betaActivatedAt = 0;
    if (typeof stats.betaMode !== 'boolean') stats.betaMode = false;
    if (typeof stats.betaSavedNick !== 'string') stats.betaSavedNick = '';
    if (!stats.authorCode || typeof stats.authorCode !== 'object' || !stats.authorCode.code) stats.authorCode = null;
    ['authorRoyaltyLocal', 'authorRoyaltyPending', 'netGiftsSent', 'netGiftsReceived', 'netTradesDone'].forEach(k => {
      if (!Number.isFinite(stats[k])) stats[k] = 0;
    });
    // 4.1 rebirth
    if (!Number.isFinite(stats.rebirth)) stats.rebirth = 0;
    stats.rebirth = Math.max(0, Math.min(10, Math.floor(stats.rebirth)));
    if (!Number.isFinite(stats.creditDebt)) stats.creditDebt = 0;
    if (!Number.isFinite(stats.creditBorrowAt)) stats.creditBorrowAt = 0;
    if (!Number.isFinite(stats.creditHistory)) stats.creditHistory = 0;
    if (!Number.isFinite(stats.bankruptUntil)) stats.bankruptUntil = 0;
    if (typeof stats.bankruptType !== 'string') stats.bankruptType = '';
    if (typeof stats.rebirthNotified !== 'boolean') stats.rebirthNotified = false;
    data.stats = stats;

    data.createdAt = raw.createdAt || base.createdAt;
    data.lastSeen = raw.lastSeen || Date.now();
    data.version = SAVE_VERSION;

    data.inventory = data.inventory.map(inv => {
      const proto = (typeof ITEMS_BY_ID !== 'undefined' && ITEMS_BY_ID[inv.id]) ? ITEMS_BY_ID[inv.id] : null;
      return Object.assign({}, proto || {}, inv, { uid: inv.uid || 'legacy_' + inv.id + '_' + Math.random().toString(36).slice(2, 7) });
    });

    return data;
  },

  /** Чтение: localStorage (v14) → cookie-бэкап v14 → vault → вайп */
  load() {
    let raw = null;

    try {
      const ls = localStorage.getItem(SAVE_KEY);
      if (ls) raw = JSON.parse(ls);
    } catch (e) {}

    if (!raw) {
      const cookieBackup = this.readCookieBackup();
      if (cookieBackup) raw = cookieBackup;
    }

    // ---- Если есть основной сейв — применяем vault поверх для защиты от случайной смены id ----
    if (raw) {
      let data = this.normalize(raw);
      try {
        const uidLock = IdentityVault.getUidLock();
        const vault = IdentityVault.loadVault();
        // UID-lock: id никогда не меняется случайно
        if (uidLock) {
          if (data.user && data.user.id && data.user.id !== uidLock) {
            // если в сейве новый id, а в lock старый — оставляем старый (защита)
            // но если сейв явно новее и vault подтверждает новый id — обновим lock
            if (vault && vault.uid && vault.uid === data.user.id) {
              IdentityVault.setUidLock(data.user.id);
            } else if (vault && vault.user && vault.user.id === uidLock) {
              data.user.id = uidLock;
            } else {
              // по умолчанию доверяем lock, если vault старше
              data.user.id = uidLock;
            }
          }
          if (!data.user && vault && vault.user && vault.user.id === uidLock) {
            data.user = vault.user;
          }
        }
        // Vault восстанавливает критичные поля если они пропали
        if (vault && vault.user) {
          if (!data.user) {
            data.user = vault.user;
          } else {
            if (vault.user.tag && !data.user.tag) data.user.tag = vault.user.tag;
            if (vault.user.verified && !data.user.verified) data.user.verified = true;
            if (vault.user.role && !data.user.role) data.user.role = vault.user.role;
            if (vault.user.status && !data.user.status) data.user.status = vault.user.status;
            if (vault.user.email && !data.user.email) data.user.email = vault.user.email;
            if (vault.tag && !data.user.tag) data.user.tag = vault.tag;
          }
          // баланс/инвентарь из vault если локальный пустой
          if (vault.balance && data.balance < 2000 && vault.balance > data.balance) data.balance = vault.balance;
          if (vault.inventory && vault.inventory.length && !data.inventory.length) data.inventory = vault.inventory;
          if (vault.stats) {
            if (vault.stats.vipActive && !data.stats.vipActive) data.stats.vipActive = true;
            if (vault.stats.authorCode && !data.stats.authorCode) data.stats.authorCode = vault.stats.authorCode;
            if (Number.isFinite(vault.stats.rebirth) && (data.stats.rebirth||0) < vault.stats.rebirth) data.stats.rebirth = vault.stats.rebirth;
            if (Number.isFinite(vault.stats.creditDebt) && vault.stats.creditDebt > 0 && (data.stats.creditDebt||0) === 0) {
              data.stats.creditDebt = vault.stats.creditDebt;
              data.stats.creditBorrowAt = vault.stats.creditBorrowAt||0;
              data.stats.bankruptType = vault.stats.bankruptType||'';
              data.stats.bankruptUntil = vault.stats.bankruptUntil||0;
            }
          }
        }
      } catch (e) {}
      return { data, migrated: false, fresh: false, wiped: false, carriedUser: false, hadOldSave: false };
    }

    // ---- Нет основного сейва — пробуем восстановить из vault (сервер стёрся, но localStorage жив) ----
    try {
      const vault = IdentityVault.loadVault();
      if (vault && vault.user && vault.uid) {
        const fromVault = {
          version: SAVE_VERSION,
          balance: vault.balance || 2000,
          inventory: vault.inventory || [],
          user: vault.user,
          stats: Object.assign(freshStats(), vault.stats || {}),
          settings: vault.settings || Object.assign({}, (typeof DEFAULT_SETTINGS !== 'undefined' ? DEFAULT_SETTINGS : {})),
          createdAt: vault.at || Date.now(),
          lastSeen: Date.now()
        };
        const data = this.normalize(fromVault);
        // помечаем что это восстановление из vault
        return { data, migrated: false, fresh: false, wiped: false, carriedUser: true, hadOldSave: true, oldUser: null, fromVault: true };
      }
    } catch (e) {}

    // ---------- ПОЛНЫЙ ВАЙП СЕЗОНА 3.9 ----------
    let hadOldSave = false;
    let carriedUser = null;
    try {
      carriedUser = this.readCarriedUser();
      if (carriedUser) hadOldSave = true;
      if (!hadOldSave) {
        for (const key of OLD_SAVE_KEYS) {
          try {
            const v = localStorage.getItem(key);
            if (v) { hadOldSave = true; break; }
          } catch (e) {}
        }
      }
      if (!hadOldSave) {
        const cj = this.readCookieJson();
        if (cj) hadOldSave = true;
      }
    } catch (e) {}

    const data = this.defaultData();
    return { data: data, migrated: false, fresh: true, wiped: true, carriedUser: !!carriedUser, hadOldSave: !!hadOldSave, oldUser: carriedUser || null };
  },

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
    try {
      const compact = this.readCookieJson();
      const carried = this._carriedFrom(compact && compact.u);
      if (carried) return carried;
    } catch (e) {}
    return null;
  },

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

  /** Основная запись: localStorage + компактная копия в cookie + vault */
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

    MetaStore.write(Object.assign(MetaStore.read(), {
      version: (typeof APP_VERSION !== 'undefined' ? APP_VERSION : '4.0'),
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

    // ---- Двойное сохранение: vault + uid-lock ----
    try {
      IdentityVault.saveFromSnapshot(data);
      if (data.user && data.user.id) IdentityVault.setUidLock(data.user.id);
      if (data.user) IdentityVault.savePlayer(data.user);
    } catch (e) {}

    return lsOk;
  },

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
    if (compact.v !== SAVE_VERSION) return null;
    try {
      return {
        version: compact.v || SAVE_VERSION,
        balance: compact.b,
        inventory: (compact.i || []).map(x => {
          const proto = (typeof ITEMS_BY_ID !== 'undefined' && ITEMS_BY_ID[x.id]) ? ITEMS_BY_ID[x.id] : {};
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
    // ВАЖНО: vault НЕ чистим — он должен пережить вайп, чтобы восстановить данные с сервера
    // IdentityVault остаётся для автовосстановления
  },

  clearAllIncludingVault() {
    this.clearAll();
    try {
      localStorage.removeItem(IdentityVault.UID_LOCK);
      localStorage.removeItem(IdentityVault.VAULT);
      // PLAYERS и STATUS_LEDGER и ADMIN_BACKUP тоже можно очистить по желанию, но по умолчанию оставляем
    } catch (e) {}
  },

  exportString(data) {
    return JSON.stringify({
      app: 'shkola-drop',
      version: (typeof APP_VERSION !== 'undefined' ? APP_VERSION : '4.0'),
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
