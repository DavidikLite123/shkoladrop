/* ==========================================================================
   ШКОЛА ДРОП — js/netplay.js
   Онлайн-функции: вход по e-mail+паролю+коду (шлагбаум «введите аккаунт»),
   сообщество (чат + уникальные ID + галочки верификации),
   облачные сохранения, спонсорство (код автора + 10% автору),
   подарки и трейдинг, кнопка «разбудить сервер».

   СЕРВЕР СООБЩЕСТВА ЗАШИТ В ИГРУ: https://shkoladrop.onrender.com
   (лёгкий server/index.js, Node без зависимостей). Если сервер не отвечает —
   жёлтая плашка с кнопкой «Включить сервер» и почтой ${SERVER_CONTACT_EMAIL}.

   Реестр кодов авторов — файл author-codes.json в корне репозитория (GitHub):
   сайт читает его напрямую, сервер тоже (и админка умеет в него дописывать).
   ========================================================================== */

/* --------------------------------------------------------------------------
   БАЗОВЫЙ СЛОЙ: адрес сервера, пинг, запросы
   -------------------------------------------------------------------------- */
const COMMUNITY_SERVER_URL = 'https://shkoladrop.onrender.com'; // сервер сообщества — зашит
const SERVER_CONTACT_EMAIL = 'shkoladrop.contact@gmail.com';    // куда писать, если сервер спит

const ServerAPI = {
  _online: null,
  _onlineAt: 0,

  /* Адрес API: зашитый сервер сообщества. Ручной адрес из админки — только
     для отладки другого сервера (localStorage shkola_server_url). */
  base() {
    try {
      const manual = localStorage.getItem('shkola_server_url');
      if (manual) return manual.replace(/\/+$/, '');
    } catch (e) {}
    return COMMUNITY_SERVER_URL;
  },

  setManual(url) {
    try {
      if (url) localStorage.setItem('shkola_server_url', String(url).trim().replace(/\/+$/, ''));
      else localStorage.removeItem('shkola_server_url');
    } catch (e) {}
    this._online = null; // моментальная перепроверка
  },

  async req(method, path, body, headers = {}, timeoutMs = 6000) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(this.base() + path, {
        method,
        headers: Object.assign({ 'Content-Type': 'application/json' }, headers),
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal
      });
      const data = await res.json().catch(() => ({}));
      return { status: res.status, data };
    } finally {
      clearTimeout(timer);
    }
  },

  /* Онлайн ли сервер. Кэш 20 секунд, force — проверить сейчас */
  isOnline() {
    return this._online === true && (Date.now() - this._onlineAt < 20000);
  },
  async ping(force = false) {
    if (!force && this._online !== null && Date.now() - this._onlineAt < 20000) return this._online;
    const wasOnline = this._online === true;
    try {
      const { status, data } = await this.req('GET', '/api/ping', null, {}, 4000);
      this._online = status === 200 && data.ok === true;
      if (this._online && data.players != null) this._playersCount = data.players;
    } catch (e) {
      this._online = false;
    }
    this._onlineAt = Date.now();
    if (this._online) {
      NetAuthor.flushPending();
      // Переход «оффлайн → онлайн»: именно здесь доигрываются всё,
      // что не удалось, пока сервер спал (выдача уникального ID и т.п.)
      if (!wasOnline) onServerJustCameOnline();
    }
    renderServerStatus();
    return this._online;
  }
};

/* Сервер «ожил» — добиваем то, что не удалось на оффлайн-старте:
   без этого хука игрок, зашедший пока Render спал, видел бы зелёное
   «ОНЛАЙН», но уникальный ID так и не получил (sync запускался ровно
   один раз при загрузке и больше никогда). */
function onServerJustCameOnline() {
  if (typeof NetIdentity === 'undefined' || typeof CloudSave === 'undefined') return;
  if (!state.user) return;
  if (!state.user.tag) NetIdentity.sync(true); // добрать уникальный ID / галочку
  CloudSave.startAutoPush();                    // на оффлайн-старте автопуш не стартовал
}

/* Секрет админки для серверных запросов: подбирается под роль, с которой
   открыта панель (owner → ADMIN_SECRET, admin → STAFF_SECRET на сервере) */
function adminSecret() {
  const role = (typeof state !== 'undefined' && state.adminRole) || null;
  const fallback = role === 'admin'
    ? (typeof ADMIN_SERVER_SECRET !== 'undefined' ? ADMIN_SERVER_SECRET : 'david-staff-7331')
    : (typeof OWNER_SERVER_SECRET !== 'undefined' ? OWNER_SERVER_SECRET : 'david-admin-1337');
  try { return localStorage.getItem('shkola_admin_secret') || fallback; }
  catch (e) { return fallback; }
}
function adminHeaders() { return { 'x-admin-secret': adminSecret() }; }

/* Галочка верификации — единый вид по всей игре (чат, профиль, списки) */
function verifiedBadgeHtml(title) {
  const t = title || 'Верифицированный аккаунт — галочка выдана администрацией проекта';
  return `<span title="${t}" class="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-gradient-to-br from-sky-400 to-cyan-500 text-slate-950 align-middle flex-shrink-0" style="font-size:9px;line-height:1">✔</span>`;
}

function adminChipHtml() {
  return `<span title="Официальное сообщение администрации" class="inline-flex items-center px-1 py-px rounded bg-amber-500/20 border border-amber-500/50 text-amber-300 font-black align-middle" style="font-size:8px">🛠 АДМИН</span>`;
}

/* Значок назначенного администратора (выдаёт владелец в панели) */
function staffChipHtml() {
  return `<span title="Администратор проекта — назначен владельцем" class="inline-flex items-center px-1 py-px rounded bg-sky-500/20 border border-sky-500/50 text-sky-300 font-black align-middle" style="font-size:8px">🛡 АДМИН</span>`;
}

/* Плашка статуса игрока (выдаёт владелец: скам / спам / тест / админ / владелец…) */
function statusLabel(st) {
  const m = typeof PLAYER_STATUS_META !== 'undefined' && PLAYER_STATUS_META[st];
  return m ? m.label : String(st || '').toUpperCase();
}
function statusChipHtml(st) {
  if (!st) return '';
  const m = (typeof PLAYER_STATUS_META !== 'undefined' && PLAYER_STATUS_META[st]) || { label: st.toUpperCase(), cls: 'bg-slate-500/20 border-slate-500/60 text-slate-300' };
  return `<span class="status-chip ${m.cls}" title="Статус выдан владельцем проекта">${m.label}</span>`;
}

/* Показать игроку экран «ты забанен» с причиной */
function showBannedScreen(reason, by) {
  const r = $('bannedReason'); if (r) r.textContent = reason || 'без причины';
  const b = $('bannedBy'); if (b) b.textContent = by ? `Забанил: ${by}` : '';
  Modal.open('bannedModal');
}

/* Человекочитаемый «последний раз заходил» */
function lastSeenText(ts, online) {
  if (online) return 'онлайн сейчас';
  if (!ts) return 'не заходил';
  const min = Math.max(0, Math.round((Date.now() - ts) / 60000));
  if (min < 1) return 'только что';
  if (min < 60) return `${min} мин назад`;
  if (min < 60 * 24) return `${Math.round(min / 60)} ч назад`;
  const d = new Date(ts);
  return `${Math.round(min / 60 / 24)} дн назад (${d.toLocaleDateString('ru-RU')} ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })})`;
}

/* --------------------------------------------------------------------------
   ЛИЧНОСТЬ ИГРОКА: уникальный ID с сервера + галочка верификации
   Уникальный ID (#123456) присваивается АВТОМАТИЧЕСКИ при первой
   синхронизации с обновлённой версией и хранится на сервере навсегда.

   ВАЖНО: бесплатный Render засыпает без трафика, поэтому sync() больше не
   «одна попытка при загрузке»: при неудаче он сам повторяет запрос с растущей
   паузой, пока сервер не проснётся. Раньше из-за одной попытки при оффлайн-
   старте индикатор показывал «ОНЛАЙН», а ID так и не выдавался никогда.
   -------------------------------------------------------------------------- */
const NetIdentity = {
  _syncing: false,
  _retryTimer: null,
  _retryN: 0,
  _gaveUp: false,
  MAX_RETRIES: 12,

  stopRetry() {
    if (this._retryTimer) { clearTimeout(this._retryTimer); this._retryTimer = null; }
    this._retryN = 0;
    this._gaveUp = false;
  },

  /* Не удалось получить ID — повторить позже (Render просыпается 30–90 секунд).
     Задержки >= 21с заодно гарантируют, что 20-секундный кэш пинга протухнет. */
  armRetry() {
    if (this._retryTimer || !state.user || state.user.tag) return;
    if (this._retryN >= this.MAX_RETRIES) {
      if (!this._gaveUp) {
        this._gaveUp = true;
        Toast.info('⏳ Сервер сообщества пока молчит (скорее всего, спит). Уникальный ID выдаётся автоматически, как только он оживёт — или нажми «⚡ Включить сервер».', 9000);
      }
      return;
    }
    const mult = (typeof document !== 'undefined' && document.hidden) ? 3 : 1;
    const delay = mult * Math.min(60000, 21000 + this._retryN * 12000);
    this._retryN++;
    clearTimeout(this._retryTimer);
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      if (!state.user || state.user.tag) { this.stopRetry(); return; }
      this.sync();
    }, delay);
  },

  /* Аккаунты из старых сейвов (до 3.7) иногда переносились без uid — с ним
     сервер отвечает 400 «нет uid», и ID не выдался бы НИКОГДА. Чиним на лету. */
  ensureUid() {
    if (!state.user) return false;
    if (state.user.id) return true;
    state.user.id = RNG.uid('player');
    persist(true);
    return true;
  },

  async sync(force = false) {
    if (!state.user || this._syncing) return null;
    this._syncing = true;
    if (force) { this._retryN = 0; this._gaveUp = false; }
    try {
      if (!this.ensureUid()) return null;
      let res = null;
      if (await ServerAPI.ping(force)) {
        const { data } = await ServerAPI.req('POST', '/api/auth/sync', {
          uid: state.user.id, nick: state.user.nick
        }, {}, 15000);
        res = data;
      }
      if (res && res.ok) {
        this.stopRetry();
        const hadTag = !!state.user.tag;
        const hadVerified = !!state.user.verified;
        if (res.tag) state.user.tag = res.tag;
        state.user.verified = !!res.verified;
        const hadRole = state.user.role || null;
        state.user.role = res.role || null;
        state.user.status = res.status || null;
        const wasBanned = !!state.user.banned;
        state.user.banned = !!res.banned;
        state.user.banReason = res.banReason || null;
        if (res.unreadDms != null && typeof DmInbox !== 'undefined') DmInbox.setUnread(res.unreadDms);
        if (res.email && !state.user.email) state.user.email = res.email;
        if (res.nick && res.nick !== state.user.nick) state.user.nick = res.nick; // ник — как на сервере (уникальность)
        if (state.user.role === 'admin' && hadRole !== 'admin') {
          Toast.gold('🛡 Владелец назначил тебя АДМИНИСТРАТОРОМ проекта! Значок виден в чате и профиле.', 8000);
        }
        if (state.user.banned && !wasBanned) showBannedScreen(res.banReason, res.banBy);
        if (!hadTag && state.user.tag) {
          // Первая выдача ID после входа в обновлённую версию
          Toast.gold(`🆔 Твоему аккаунту присвоен уникальный ID: <b class="font-mono">${escapeHtml(state.user.tag)}</b>. По нему тебя найдут друзья в «💬 Сообществе»!`, 9000);
        } else if (state.user.verified && !hadVerified) {
          Toast.info('✔ Твой аккаунт верифицирован администрацией — галочка видна всем в чате и профиле!', 7000);
        }
        persist(true);
        this.renderEverywhere();
      } else {
        this.armRetry();
      }
      return res;
    } catch (e) {
      this.armRetry();
      return null;
    } finally {
      this._syncing = false;
    }
  },

  /* Обновить все места, где видны ID и галочка */
  renderEverywhere() {
    if (typeof renderProfile === 'function') {
      try { renderProfile(); } catch (e) {}
    }
    Community.renderMyId();
    renderServerStatus();
  }
};

/* --------------------------------------------------------------------------
   РЕЕСТР КОДОВ АВТОРОВ: читаем author-codes.json прямо с сайта (файл в GitHub)
   -------------------------------------------------------------------------- */
const AuthorRegistry = {
  _data: null,

  async load(force = false) {
    if (this._data && !force) return this._data;
    try {
      const res = await fetch('author-codes.json?v=' + Date.now(), { cache: 'no-store' });
      if (res.ok) {
        this._data = await res.json();
        try { localStorage.setItem('shkola_author_codes_cache', JSON.stringify(this._data)); } catch (e) {}
        return this._data;
      }
    } catch (e) {}
    // офлайн-запас: последний скачанный реестр
    try {
      const cached = localStorage.getItem('shkola_author_codes_cache');
      if (cached) this._data = JSON.parse(cached);
    } catch (e) {}
    if (!this._data) this._data = { royaltyPercent: 10, codes: [] };
    return this._data;
  },

  async find(code) {
    const norm = String(code || '').replace(/\s+/g, '').toUpperCase();
    const data = await this.load();
    return (data.codes || []).find(c => String(c.code).toUpperCase() === norm) || null;
  },

  royaltyPercent() {
    const pct = this._data && Number(this._data.royaltyPercent);
    return Number.isFinite(pct) && pct > 0 && pct <= 100 ? pct : 10;
  }
};

/* --------------------------------------------------------------------------
   СПОНСОРСТВО: код автора + 10% от трат на кейсы автору кода
   -------------------------------------------------------------------------- */
const NetAuthor = {

  active() { return state.stats && state.stats.authorCode ? state.stats.authorCode : null; },

  /* Ввод кода автора (раздел «Спонсорство») */
  async apply(inputId = 'authorCodeInput') {
    const input = $(inputId);
    const raw = ((input && input.value) || '').replace(/\s+/g, '').toUpperCase();
    if (!raw) { Toast.error('Введи код автора'); return; }

    const entry = await AuthorRegistry.find(raw);
    if (!entry) {
      Toast.error('Такого кода автора нет. Коды выдают David Lite и ютуберы-партнёры!');
      if (input) input.select();
      return;
    }
    if (state.user && entry.ownerUid === state.user.id) {
      Toast.error('Свой собственный код вводить нельзя — он уже работает на тебя 😄');
      return;
    }

    state.stats.authorCode = { code: String(entry.code).toUpperCase(), ownerUid: entry.ownerUid, ownerName: entry.ownerName };
    if (input) input.value = '';
    audio.init();
    audio.playWin();
    Fx.burst(80, ['#c084fc', '#f472b6', '#fbbf24']);
    Toast.gold(`💜 Ты поддерживаешь автора: <b>${escapeHtml(entry.ownerName)}</b>! ${AuthorRegistry.royaltyPercent()}% от стоимости твоих кейсов идёт ему (у тебя ничего не отнимается).`, 7000);

    // Если сервер онлайн — регистрируем спонсорство и там
    if (await ServerAPI.ping()) {
      ServerAPI.req('POST', '/api/author-codes/apply', {
        uid: this._uid(), nick: this._nick(), code: state.stats.authorCode.code
      }).catch(() => {});
    }

    NetAuthor.renderCard();
    persist(true);
  },

  async remove() {
    const was = this.active();
    state.stats.authorCode = null;
    if (await ServerAPI.ping()) {
      ServerAPI.req('POST', '/api/author-codes/remove', { uid: this._uid() }).catch(() => {});
    }
    audio.playTick();
    Toast.info(was ? `Спонсорство отключено (автор: ${escapeHtml(was.ownerName)}). Можно ввести код другого автора.` : 'Спонсорство отключено.');
    this.renderCard();
    persist(true);
  },

  /* Вызывается после КАЖДОГО списания за кейс (x1 и x5).
     10% от стоимости — автору кода. С игрока сумма НЕ списывается:
     это доля «от платформы», как в фортнайт-поддержке авторов. */
  trackCaseSpend(price, caseId) {
    const link = this.active();
    if (!link || !price || price <= 0) return;
    const amount = Math.max(1, Math.round(price * AuthorRegistry.royaltyPercent() / 100));
    state.stats.authorRoyaltyLocal = (state.stats.authorRoyaltyLocal || 0) + amount;

    if (ServerAPI.isOnline()) {
      ServerAPI.req('POST', '/api/royalty', { uid: this._uid(), nick: this._nick(), amount, caseId })
        .catch(() => { state.stats.authorRoyaltyPending = (state.stats.authorRoyaltyPending || 0) + amount; });
    } else {
      // сервер оффлайн — копим в очередь, отправим при появлении связи
      state.stats.authorRoyaltyPending = (state.stats.authorRoyaltyPending || 0) + amount;
    }
  },

  flushPending() {
    const pending = state.stats && state.stats.authorRoyaltyPending;
    if (!pending || !this.active()) return;
    state.stats.authorRoyaltyPending = 0;
    ServerAPI.req('POST', '/api/royalty', { uid: this._uid(), nick: this._nick(), amount: pending })
      .catch(() => { state.stats.authorRoyaltyPending = pending; });
  },

  /* Карточка «Спонсорство» в разделе промокодов (вкладка «Сообщество») */
  renderCard() {
    const form = $('authorCodeForm');
    const activeBox = $('authorCodeActive');
    if (!form || !activeBox) return;
    const link = this.active();
    form.classList.toggle('hidden', !!link);
    activeBox.classList.toggle('hidden', !link);
    if (link) {
      $('authorActiveName').textContent = link.ownerName;
      $('authorActiveCode').textContent = link.code;
      $('authorRoyaltyStat').textContent = fmt(state.stats.authorRoyaltyLocal || 0);
      const pctEl = $('authorRoyaltyPercentLabel');
      if (pctEl) pctEl.textContent = AuthorRegistry.royaltyPercent();
    }
  },

  _uid() { return state.user ? state.user.id : null; },
  _nick() { return state.user ? state.user.nick : ''; }
};

/* --------------------------------------------------------------------------
   КАБИНЕТ АВТОРА КОДА: свои накопленные 10% (работает при запущенном сервере)
   -------------------------------------------------------------------------- */
const AuthorCabinet = {
  async refresh() {
    const box = $('authorCabinet');
    if (!box) return;
    const uid = state.user ? state.user.id : null;
    if (!uid) { box.classList.add('hidden'); return; }

    const reg = await AuthorRegistry.load();
    const mine = (reg.codes || []).find(c => c.ownerUid === uid);
    box.classList.toggle('hidden', !mine);
    if (!mine) return;

    $('authorCabinetCode').textContent = mine.code;
    if (await ServerAPI.ping()) {
      const { data } = await ServerAPI.req('GET', `/api/author/earnings?uid=${encodeURIComponent(uid)}`);
      if (data.ok) {
        $('authorCabinetEarned').textContent = fmt(data.earned);
        $('authorCabinetSupporters').textContent = fmt(data.supporters);
        $('authorCabinetWithdrawn').textContent = fmt(data.withdrawn);
        return;
      }
    }
    $('authorCabinetEarned').textContent = 'офлайн';
    $('authorCabinetSupporters').textContent = '—';
    $('authorCabinetWithdrawn').textContent = '—';
  },

  async withdraw() {
    const uid = state.user ? state.user.id : null;
    if (!uid) return;
    const { data } = await ServerAPI.req('POST', '/api/author/withdraw', { uid });
    if (!data.ok) { Toast.error(data.error || 'Не вышло забрать спонсорство'); return; }
    if (data.payout > 0) {
      addMoney(data.payout, { silent: true, countEarned: true });
      audio.init();
      audio.playSecret();
      Fx.gold(150);
      Toast.gold(`💜 Спонсорство собрано: +${fmt(data.payout)} ₽ от игроков с твоим кодом автора!`);
    } else {
      Toast.info('Пока накоплений нет — игроки с твоим кодом ещё не открывали кейсы со включённым сервером.');
    }
    this.refresh();
    uiUpdate();
  }
};

/* --------------------------------------------------------------------------
   СООБЩЕСТВО: статус сервера, мой уникальный ID, поиск игроков, общий чат
   -------------------------------------------------------------------------- */
const Community = {
  _pollTimer: null,
  _lastSignature: '',
  _found: null,

  open() {
    if (!state.user) {
      Toast.info('Сначала создай профиль — сервер выдаст тебе уникальный ID, и можно общаться!');
      if (typeof openProfileModal === 'function') openProfileModal();
      return;
    }
    audio.init();
    audio.playTick();
    Modal.open('communityModal');
    renderServerStatus();
    this.renderMyId();
    this.refreshChat(true);
    NetIdentity.sync(true); // подхватить свежую галочку/ID, если сервер что-то поменял
    ServerAPI.ping(true).then(() => this.refreshChat(true));
    // Живое обновление чата, пока окно открыто
    clearInterval(this._pollTimer);
    this._pollTimer = setInterval(() => {
      if (Modal.isOpen('communityModal') && ServerAPI.isOnline()) this.refreshChat(false);
    }, 6000);
  },

  close() {
    clearInterval(this._pollTimer);
    this._pollTimer = null;
    Modal.close('communityModal');
  },

  /* Развернуть чат на весь экран / свернуть обратно */
  toggleExpand() {
    const card = $('communityCard');
    if (!card) return;
    const on = card.classList.toggle('modal-card-expanded');
    const btn = $('commExpandBtn');
    if (btn) btn.textContent = on ? '⤡ Свернуть' : '⛶ Развернуть';
    audio.playTick();
    const list = $('commChatList');
    if (list) list.scrollTop = list.scrollHeight;
  },

  /* Мой уникальный ID во всех местах */
  renderMyId() {
    const hasUser = !!state.user;
    const tag = hasUser && state.user.tag;
    const el = $('commMyTag');
    if (el) el.textContent = tag || (hasUser ? 'выдаётся…' : '#…');
    const communityTag = $('communityMyTag');
    if (communityTag) communityTag.textContent = tag || (hasUser ? 'ID выдаётся сервером…' : 'войди в аккаунт');
    const badge = $('commMyVerified');
    if (badge) {
      badge.classList.toggle('hidden', !(hasUser && state.user.verified));
      if (hasUser && state.user.verified) badge.innerHTML = verifiedBadgeHtml();
    }
    const cnt = $('commPlayersCount');
    if (cnt && ServerAPI._playersCount != null) cnt.textContent = fmt(ServerAPI._playersCount);
  },

  async copyMyTag() {
    if (!state.user) { Toast.error('Сначала создай профиль — сервер выдаст тебе уникальный ID'); return; }
    if (!state.user.tag) {
      // ID ещё не получен — не ждём «пару секунд», а добиваемся его прямо сейчас
      Toast.info('Запрашиваю ID у сервера заново… Если он спит — нажми «⚡ Включить сервер».', 6000);
      NetIdentity.sync(true);
      return;
    }
    const ok = await copyText(state.user.tag);
    Toast[ok ? 'success' : 'info'](ok ? `Уникальный ID скопирован: ${state.user.tag}` : `Твой ID: ${state.user.tag}`);
  },

  /* -------- ПОИСК ИГРОКА ПО УНИКАЛЬНОМУ ID / НИКУ -------- */
  async findPlayer() {
    const input = $('commFindInput');
    const q = ((input && input.value) || '').trim();
    if (!q) { Toast.error('Введи уникальный ID (#123456), ник или id аккаунта'); return; }
    if (!(await this._needOnline())) return;

    const box = $('commFindResult');
    if (box) box.innerHTML = '<div class="net-empty">Ищем игрока…</div>';
    const { data } = await ServerAPI.req('GET', `/api/players/public?q=${encodeURIComponent(q)}`);
    if (!data.ok || !data.player) {
      this._found = null;
      if (box) box.innerHTML = `<div class="net-empty">${escapeHtml(data.error || 'Игрок не найден')} (поиск работает среди тех, кто уже заходил с онлайн-сервером)</div>`;
      return;
    }
    const p = data.player;
    this._found = p;
    const seenAgo = p.lastSeen ? Math.max(1, Math.round((Date.now() - p.lastSeen) / 60000)) : null;
    const seenText = seenAgo == null ? '' : (seenAgo < 60 ? `был(а) ${seenAgo} мин назад` : seenAgo < 60 * 24 ? `был(а) ${Math.round(seenAgo / 60)} ч назад` : `был(а) ${Math.round(seenAgo / 60 / 24)} дн назад`);
    if (box) box.innerHTML = `
      <div class="net-row">
        <div class="min-w-0">
          <div class="text-[10.5px] font-bold text-slate-200 truncate flex items-center gap-1">${escapeHtml(p.nick)}${p.verified ? verifiedBadgeHtml() : ''}${p.role === 'admin' ? staffChipHtml() : ''}${p.status ? statusChipHtml(p.status) : ''}</div>
          <div class="text-[10px] text-slate-400 truncate">ID <span class="font-mono text-amber-300">${escapeHtml(p.tag || '—')}</span>${p.online ? ' · <span class="text-emerald-400">● онлайн</span>' : (seenText ? ' · ' + seenText : '')}</div>
        </div>
        <button onclick="Community.giftToFound()" class="net-btn">🎁 Подарить</button>
      </div>`;
    audio.playWin();
  },

  giftToFound() {
    if (!this._found) return;
    const uid = this._found.uid;
    this.close();
    NetPlay.open();
    NetPlay.switchTab('gifts');
    setTimeout(() => {
      const t = $('netGiftTarget');
      if (t) { t.value = uid; t.focus(); }
      Toast.info(`Дарим игроку ${escapeHtml(this._found.nick)} — осталось выбрать предмет 🎁`);
    }, 250);
  },

  /* -------- ОБЩИЙ ЧАТ -------- */
  async refreshChat(force = false) {
    const list = $('commChatList');
    if (!list) return;
    if (!ServerAPI.isOnline() && !(await ServerAPI.ping())) {
      list.innerHTML = '<div class="net-empty">Сервер оффлайн — чат появится, как только связь восстановится.</div>';
      return;
    }
    const { data } = await ServerAPI.req('GET', '/api/chat?limit=60');
    if (!data.ok) return;
    if (ServerAPI._playersCount != null || data.players != null) {
      ServerAPI._playersCount = data.players != null ? data.players : ServerAPI._playersCount;
      const cnt = $('commPlayersCount');
      if (cnt) cnt.textContent = fmt(ServerAPI._playersCount || 0);
    }
    const msgs = data.messages || [];
    if (typeof ChatNotify !== 'undefined') ChatNotify.observe(msgs);
    const signature = msgs.length + '|' + (msgs.length ? msgs[msgs.length - 1].id : 'x') + '|' + msgs.map(m => (m.verified ? 1 : 0)).join('');
    if (signature === this._lastSignature && !force) return; // ничего нового — не мельтешим
    this._lastSignature = signature;
    this._renderMessages(msgs, force);
  },

  _renderMessages(msgs, scrollHard = false) {
    const list = $('commChatList');
    if (!list) return;
    const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 70;
    if (!msgs.length) {
      list.innerHTML = '<div class="net-empty">Пока тихо. Напиши первым — школа ждёт! 🏫</div>';
      return;
    }
    const canModerate = !!state.rigReady && (typeof adminHas !== 'function' || adminHas('chat')); // админ/владелец видит крестики удаления
    list.innerHTML = msgs.map(m => {
      const time = new Date(m.at).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      const isAdmin = m.kind === 'admin';
      const isMe = state.user && m.uid === state.user.id;
      const cls = isAdmin
        ? 'bg-amber-950/40 border-amber-600/50'
        : isMe
          ? 'bg-cyan-950/40 border-cyan-800/50'
          : 'bg-slate-900/70 border-slate-800/70';
      const head = isAdmin
        ? `<span class="font-bold text-amber-300">${escapeHtml(m.nick)}</span> ${adminChipHtml()}`
        : `<span class="font-bold ${isMe ? 'text-cyan-300' : 'text-slate-200'}">${escapeHtml(m.nick)}</span>${m.verified ? ' ' + verifiedBadgeHtml() : ''}${m.role === 'admin' ? ' ' + staffChipHtml() : ''}${m.status ? ' ' + statusChipHtml(m.status) : ''}${m.tag ? ` <span class="font-mono text-[8.5px] text-slate-500">${escapeHtml(m.tag)}</span>` : ''}`;
      const del = canModerate && m.id
        ? `<button onclick="Community.adminDeleteMessage('${m.id}')" title="Удалить сообщение (админ)" class="text-slate-500 hover:text-rose-400 transition text-[10px] leading-none flex-shrink-0">✕</button>`
        : '';
      return `<div class="border rounded-lg px-2 py-1 ${cls}">
        <div class="flex items-center gap-1 min-w-0">
          <div class="text-[9.5px] truncate flex-1">${head}</div>
          <span class="text-[8px] text-slate-500 font-mono flex-shrink-0">${time}</span>${del}
        </div>
        <div class="text-[10.5px] text-slate-200 break-words leading-snug">${escapeHtml(m.text)}</div>
      </div>`;
    }).join('');
    if (scrollHard || nearBottom) list.scrollTop = list.scrollHeight;
  },

  async send() {
    const input = $('commChatInput');
    const text = ((input && input.value) || '').trim();
    if (!text) { Toast.error('Напиши что-нибудь 🙂'); return; }
    if (!state.user) { Toast.error('Создай профиль, чтобы писать в чат'); return; }
    if (!(await this._needOnline())) return;
    const { data } = await ServerAPI.req('POST', '/api/chat', { uid: state.user.id, nick: state.user.nick, text });
    if (!data.ok) { if (data.banned) { state.user.banned = true; showBannedScreen(data.reason, data.by); return; } Toast.error(data.error || 'Сообщение не отправлено'); return; }
    if (input) input.value = '';
    audio.playCoin();
    this._lastSignature = ''; // принудительно перерисуем
    this.refreshChat(true);
  },

  /* Модерация: админ удаляет сообщение (кнопка ✕ видна только при rigReady) */
  async adminDeleteMessage(id) {
    if (!state.rigReady) return;
    const { data } = await ServerAPI.req('POST', '/api/admin/chat/delete', { id }, adminHeaders());
    if (!data.ok) { Toast.error(data.error || 'Не удалось удалить'); return; }
    Toast.info('Сообщение удалено из чата');
    this._lastSignature = '';
    this.refreshChat(true);
  },

  openTrading() {
    this.close();
    NetPlay.open();
  },

  async _needOnline() {
    const on = await ServerAPI.ping(true);
    if (!on) {
      Toast.error('Сервер оффлайн! Сообщество работает, когда сервер доступен: ' + COMMUNITY_SERVER_URL);
      renderServerStatus();
    }
    return on;
  }
};

/* --------------------------------------------------------------------------
   ОБЛАЧНОЕ СОХРАНЕНИЕ ПРОГРЕССА
   Прогресс САМ восстанавливается через сервер: клиент регулярно заливает
   снапшот на сервер сообщества, а при входе подтягивает копию, если она
   свежее локальной. Ручной JSON-бэкап из настроек больше не нужен.
   -------------------------------------------------------------------------- */
const CloudSave = {
  _pushTimer: null,
  _restored: false,
  _lastPushOk: 0,

  startAutoPush() {
    if (this._pushTimer) return;
    this._pushTimer = setInterval(() => {
      if (ServerAPI.isOnline() && state.user) this.push(false);
    }, 45000);
    // На выходе со страницы — мгновенный снапшот через sendBeacon
    window.addEventListener('pagehide', () => this._beacon());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this._beacon();
    });
  },

  _beacon() {
    try {
      if (!state.user || !ServerAPI.isOnline() || typeof navigator === 'undefined' || !navigator.sendBeacon) return;
      const payload = JSON.stringify({ uid: state.user.id, nick: state.user.nick, save: snapshot() });
      navigator.sendBeacon(ServerAPI.base() + '/api/save', new Blob([payload], { type: 'text/plain' }));
    } catch (e) {}
  },

  /* Залить прогресс на сервер */
  async push(toast = false) {
    if (!state.user) return false;
    if (!(await ServerAPI.ping())) {
      if (toast) Toast.error('Сервер оффлайн — синхронизация подождёт');
      this._renderStatus();
      return false;
    }
    try {
      const { data } = await ServerAPI.req('POST', '/api/save', {
        uid: state.user.id, nick: state.user.nick, save: snapshot()
      }, {}, 15000);
      if (data.ok) {
        this._lastPushOk = Date.now();
        // Запасной канал: сервер возвращает уникальный ID в ответе на залив
        // сейва — игрок получит ID даже если sync() ни разу не прошёл
        if (data.tag && state.user && !state.user.tag) {
          state.user.tag = data.tag;
          if (typeof data.verified === 'boolean') state.user.verified = data.verified;
          persist(true);
          NetIdentity.stopRetry();
          NetIdentity.renderEverywhere();
          Toast.gold(`🆔 Твоему аккаунту присвоен уникальный ID: <b class="font-mono">${escapeHtml(data.tag)}</b>. По нему тебя найдут друзья в «💬 Сообществе»!`, 9000);
        }
        if (toast) Toast.success('☁️ Прогресс залит на сервер сообщества!');
        this._renderStatus();
        return true;
      }
    } catch (e) {}
    if (toast) Toast.error('Не удалось залить прогресс на сервер');
    this._renderStatus();
    return false;
  },

  /* Подтянуть прогресс с сервера и восстановить.
     manual=true — из настроек, с подсказками; false — тихое автовосстановление на входе. */
  async pullAndRestore(manual = false) {
    if (!state.user) {
      if (manual) Toast.error('Сначала создай профиль — сервер узнает тебя по аккаунту');
      return false;
    }
    if (!(await ServerAPI.ping(manual))) {
      if (manual) Toast.error('Сервер оффлайн — облачное восстановление сейчас недоступно');
      return false;
    }
    const { status, data } = await ServerAPI.req('GET', `/api/save?uid=${encodeURIComponent(state.user.id)}`, null, {}, 15000);
    if (status !== 200 || !data.ok || !data.save) {
      if (manual) Toast.info('На сервере пока нет твоей копии — она появится после первой синхронизации (залью прямо сейчас).');
      this.push(false);
      return false;
    }

    const serverSeen = Number(data.save.lastSeen) || Number(data.updatedAt) || 0;
    const localSeen = state.stats.lastSeen || 0;
    const invLen = Array.isArray(data.save.inventory) ? data.save.inventory.length : 0;
    const differs =
      (Number.isFinite(data.save.balance) && data.save.balance !== state.balance) ||
      invLen !== state.inventory.length ||
      ((data.save.stats && data.save.stats.level) || 1) !== (state.stats.level || 1);

    if (!differs) {
      if (manual) Toast.success('Локальный прогресс совпадает с сервером — всё актуально! ☁️');
      return false;
    }
    // Серверная копия заметно старше — не откатываем игрока назад без спроса
    if (!manual && serverSeen && localSeen && serverSeen < localSeen - 60000) return false;

    let proceed = true;
    if (manual) {
      proceed = await ConfirmDialog.ask({
        icon: '☁️',
        title: 'Восстановить прогресс?',
        text: `На сервере копия от <b>${new Date(serverSeen || Date.now()).toLocaleString('ru-RU')}</b>: баланс <b class="text-amber-300">${fmt(data.save.balance || 0)} ₽</b>, предметов <b>${invLen}</b>.<br>Текущий локальный прогресс будет заменён.`,
        okText: 'Восстановить',
        danger: false
      });
    }
    if (!proceed) return false;

    const parsed = SaveManager.normalize(data.save);
    state.balance = parsed.balance;
    state.inventory = parsed.inventory;
    state.stats = parsed.stats;
    // Профиль подменяем ТОЛЬКО если локального ещё нет и id совпадает — аккаунт не потеряется
    if (!state.user && parsed.user && !state.user) state.user = parsed.user;
    if (state.user && parsed.user && parsed.user.id === state.user.id) {
      state.user = Object.assign({}, parsed.user, { tag: state.user.tag, verified: state.user.verified });
    }
    state.selectedDeposit = state.inventory[0] || null;
    auditInventory();
    persist(true);
    uiUpdate();
    if (typeof renderProfile === 'function') renderProfile();
    this._restored = true;
    audio.playSecret();
    Fx.burst(120, ['#22d3ee', '#10b981']);
    Toast.gold('☁️ Прогресс автоматически восстановлен с сервера сообщества!', 7000);
    if (manual && Modal.isOpen('settingsModal')) Modal.close('settingsModal');
    return true;
  },

  /* Строка состояния в настройках */
  _renderStatus() {
    const el = $('cloudSaveStatus');
    if (!el) return;
    const online = ServerAPI.isOnline();
    if (!state.user) {
      el.textContent = 'Синхронизация: будет включена после создания профиля';
      el.className = 'text-[9.5px] font-mono text-slate-500';
    } else if (this._lastPushOk) {
      el.textContent = `Синхронизация: АКТИВНА · копия на сервере от ${new Date(this._lastPushOk).toLocaleTimeString('ru-RU')}`;
      el.className = 'text-[9.5px] font-mono text-emerald-400';
    } else {
      el.textContent = online ? 'Синхронизация: готовится первый залив…' : 'Синхронизация: ждёт онлайн-сервер';
      el.className = 'text-[9.5px] font-mono ' + (online ? 'text-amber-300' : 'text-rose-400');
    }
  }
};

/* --------------------------------------------------------------------------
   ПОДАРКИ И ТРЕЙДИНГ (нужен онлайн-сервер сообщества)
   -------------------------------------------------------------------------- */
const NetPlay = {
  tab: 'gifts',

  open() {
    renderServerStatus();
    if (state.user && !state.user.tag) NetIdentity.sync(true); // без ID подарки не найти — добиваемся сразу
    ServerAPI.ping(true).then(() => this.refreshAll());
    Modal.open('netplayModal');
    this.switchTab(this.tab);
  },
  close() { Modal.close('netplayModal'); },

  switchTab(tab) {
    this.tab = tab;
    ['gifts', 'incoming', 'trades'].forEach(name => {
      const btn = $('netTab' + name.charAt(0).toUpperCase() + name.slice(1));
      const panel = $('netPanel' + name.charAt(0).toUpperCase() + name.slice(1));
      if (btn) btn.classList.toggle('net-tab-active', name === tab);
      if (panel) panel.classList.toggle('hidden', name !== tab);
    });
    this.refreshAll();
  },

  /* Селект с моими предметами (для подарка/обмена) */
  _fillItemSelect(selectId) {
    const sel = $(selectId);
    if (!sel) return;
    if (!state.inventory.length) {
      sel.innerHTML = '<option value="">Рюкзак пуст — открой пару кейсов</option>';
      return;
    }
    sel.innerHTML = state.inventory
      .map((it, i) => `<option value="${i}">${escapeHtml(it.icon || '🎁')} ${escapeHtml(it.name)} — ${fmt(it.price)} ₽</option>`)
      .join('');
  },

  _takeItem(selectId) {
    const sel = $(selectId);
    const idx = sel ? parseInt(sel.value, 10) : NaN;
    if (isNaN(idx) || !state.inventory[idx]) return null;
    return state.inventory[idx];
  },

  _removeItem(item) {
    const idx = state.inventory.indexOf(item);
    if (idx >= 0) state.inventory.splice(idx, 1);
  },

  /* -------- ПОДАРОК -------- */
  async sendGift() {
    const item = this._takeItem('netGiftItem');
    const target = ($('netGiftTarget').value || '').trim();
    if (!state.user) { Toast.error('Сначала создай профиль — нужен ник и id аккаунта'); return; }
    if (!item) { Toast.error('Выбери предмет из рюкзака'); return; }
    if (!target) { Toast.error('Укажи уникальный ID, ник или id аккаунта получателя'); return; }
    if (!(await this._needOnline())) return;

    const body = { fromUid: state.user.id, fromNick: state.user.nick, item: this._wireItem(item) };
    // Уникальный ID вида #123456 (или 123456) — сначала находим игрока на сервере
    if (/^#\d{4,8}$/.test(target) || /^\d{6}$/.test(target)) {
      const res = await ServerAPI.req('GET', `/api/players/public?q=${encodeURIComponent(target)}`);
      if (!res.data.ok || !res.data.player) { Toast.error('Игрок с таким ID не найден'); return; }
      if (res.data.player.uid === state.user.id) { Toast.error('Это же твой ID 😄'); return; }
      body.toUid = res.data.player.uid;
    } else if (/^player-/.test(target)) {
      body.toUid = target;
    } else {
      body.toNick = target;
    }

    const { status, data } = await ServerAPI.req('POST', '/api/gifts', body);
    if (status !== 200 || !data.ok) { Toast.error(data.error || 'Не удалось отправить подарок'); return; }

    this._removeItem(item);
    state.stats.netGiftsSent = (state.stats.netGiftsSent || 0) + 1;
    audio.playWin();
    Fx.burst(70, ['#f472b6', '#c084fc']);
    Toast.gold(`🎁 Подарок «${escapeHtml(item.name)}» отправлен игроку <b>${escapeHtml(data.toNick)}</b>! Ему придёт уведомление во «Входящих».`, 6000);
    $('netGiftTarget').value = '';
    this.refreshAll();
    renderCasesUI(); uiUpdate(); persist(true);
  },

  /* -------- ОБМЕН -------- */
  async createTrade() {
    const item = this._takeItem('netTradeItem');
    const want = ($('netTradeWant').value || '').trim();
    if (!state.user) { Toast.error('Сначала создай профиль'); return; }
    if (!item) { Toast.error('Выбери предмет для обмена'); return; }
    if (!(await this._needOnline())) return;

    const { status, data } = await ServerAPI.req('POST', '/api/trades', {
      fromUid: state.user.id, fromNick: state.user.nick,
      item: this._wireItem(item), wantNote: want
    });
    if (status !== 200 || !data.ok) { Toast.error(data.error || 'Не удалось создать обмен'); return; }

    this._removeItem(item);
    audio.playWin();
    Toast.gold(`🤝 Комната обмена создана! Отправь другу код комнаты: <b class="font-mono">${data.code}</b>. Предмет вернётся при отмене.`, 9000);
    $('netTradeWant').value = '';
    this.refreshAll();
    renderCasesUI(); uiUpdate(); persist(true);
  },

  async joinTrade() {
    const code = (($('netTradeCode').value || '').replace(/\s+/g, '')).toUpperCase();
    const item = this._takeItem('netTradeJoinItem');
    if (!state.user) { Toast.error('Сначала создай профиль'); return; }
    if (code.length !== 6) { Toast.error('Введи код комнаты из 6 символов'); return; }
    if (!item) { Toast.error('Выбери свой предмет для обмена'); return; }
    if (!(await this._needOnline())) return;

    // Сначала покажем, что предлагают в комнате
    const peek = await ServerAPI.req('GET', `/api/trades?code=${encodeURIComponent(code)}`);
    if (!peek.data.ok) { Toast.error(peek.data.error || 'Комната не найдена'); return; }
    const ok = await ConfirmDialog.ask({
      icon: '🤝',
      title: 'Подтверди обмен',
      text: `Ты отдаёшь <b>${escapeHtml(item.name)}</b> (${fmt(item.price)} ₽)<br>и получаешь <b>${escapeHtml(peek.data.offer.name)}</b> (${fmt(peek.data.offer.price)} ₽) от <b>${escapeHtml(peek.data.fromNick)}</b>${peek.data.wantNote ? '<br><span class="text-slate-400">Просьба: ' + escapeHtml(peek.data.wantNote) + '</span>' : ''}`,
      okText: 'Меняемся!',
      danger: false
    });
    if (!ok) return;

    const { status, data } = await ServerAPI.req('POST', `/api/trades/${code}/join`, {
      uid: state.user.id, nick: state.user.nick, item: this._wireItem(item)
    });
    if (status !== 200 || !data.ok) { Toast.error(data.error || 'Обмен не состоялся'); return; }

    this._removeItem(item);
    state.stats.netTradesDone = (state.stats.netTradesDone || 0) + 1;
    audio.playSecret();
    Fx.gold(120);
    Toast.gold(`🤝 Обмен исполнен! «${escapeHtml(data.got.name)}» ждёт тебя во вкладке «Входящие».`, 8000);
    $('netTradeCode').value = '';
    this.refreshAll();
    renderCasesUI(); uiUpdate(); persist(true);
  },

  async cancelTrade(code) {
    const { data } = await ServerAPI.req('POST', `/api/trades/${code}/cancel`, { uid: state.user.id });
    if (!data.ok) { Toast.error(data.error || 'Не отменить'); return; }
    Toast.info('Комната закрыта — предмет вернулся во «Входящие».');
    this.refreshAll();
  },

  /* -------- ЗАБРАТЬ (подарки + выдача с обменов) -------- */
  async claimGift(id, el) {
    const { data } = await ServerAPI.req('POST', `/api/gifts/${id}/claim`, { uid: state.user.id });
    if (!data.ok) { Toast.error(data.error || 'Не забрать подарок'); return; }
    this._acceptItem(data.item, `🎁 Подарок от <b>${escapeHtml(data.fromNick)}</b>: ${escapeHtml(data.item.name)}!`);
    state.stats.netGiftsReceived = (state.stats.netGiftsReceived || 0) + 1;
    if (el) el.closest('.net-row') && el.closest('.net-row').remove();
    this.refreshAll();
  },

  async claimDelivery(id) {
    const { data } = await ServerAPI.req('POST', `/api/deliveries/${id}/claim`, { uid: state.user.id });
    if (!data.ok) { Toast.error(data.error || 'Не забрать выдачу'); return; }
    this._acceptItem(data.item, `🤝 С обмена получено: ${escapeHtml(data.item.name)}!`);
    state.stats.netTradesDone = (state.stats.netTradesDone || 0) + 1;
    this.refreshAll();
  },

  _acceptItem(wireItem, toastHtml) {
    // Освежаем предмет из каталога (веса/иконки), uid — новый, чтобы не конфликтовал
    const proto = (typeof ITEMS_BY_ID !== 'undefined' && ITEMS_BY_ID[wireItem.id]) || wireItem;
    const item = Object.assign({}, proto, { uid: RNG.uid('net'), wonAt: nowTimeLabel(), price: wireItem.price });
    state.inventory.unshift(item);
    if (typeof trackBiggestDrop === 'function') trackBiggestDrop(item);
    audio.playSecret();
    Fx.burst(100, ['#22d3ee', '#fbbf24']);
    Toast.gold(toastHtml, 7000);
    renderCasesUI(); uiUpdate(); persist(true);
  },

  /* -------- РЕНДЕРЫ -------- */
  async refreshAll() {
    renderServerStatus();
    this._fillItemSelect('netGiftItem');
    this._fillItemSelect('netTradeItem');
    this._fillItemSelect('netTradeJoinItem');
    const myIdEl = $('netMyUid');
    if (myIdEl) myIdEl.textContent = state.user ? state.user.id : 'создай профиль';
    const myTagEl = $('netMyTag');
    if (myTagEl) myTagEl.textContent = state.user && state.user.tag ? state.user.tag : '—';
    if (!state.user || !(await ServerAPI.ping())) {
      this._setList('netIncomingList', '<div class="net-empty">Сервер оффлайн — см. подсказку выше ☝️</div>');
      this._setList('netMyTradesList', '');
      return;
    }
    const uid = state.user.id;
    await ServerAPI.req('POST', '/api/auth/sync', { uid, nick: state.user.nick }).catch(() => {});

    // Входящие: подарки + выдача
    const [gifts, dlv, mine] = await Promise.all([
      ServerAPI.req('GET', `/api/gifts?uid=${encodeURIComponent(uid)}`),
      ServerAPI.req('GET', `/api/deliveries?uid=${encodeURIComponent(uid)}`),
      ServerAPI.req('GET', `/api/trades/mine?uid=${encodeURIComponent(uid)}`)
    ]);

    let rows = '';
    (gifts.data.incoming || []).forEach(g => {
      rows += this._row(`🎁 от <b>${escapeHtml(g.fromNick)}</b>`, `${escapeHtml(g.item.icon)} ${escapeHtml(g.item.name)} · ${fmt(g.item.price)} ₽`,
        `<button onclick="NetPlay.claimGift('${g.id}', this)" class="net-btn">Забрать</button>`);
    });
    (dlv.data.deliveries || []).forEach(d => {
      rows += this._row(d.source === 'trade-cancel' ? '↩️ возврат с отменённого обмена' : '🤝 предмет с обмена',
        `${escapeHtml(d.item.icon)} ${escapeHtml(d.item.name)} · ${fmt(d.item.price)} ₽`,
        `<button onclick="NetPlay.claimDelivery('${d.id}')" class="net-btn">Забрать</button>`);
    });
    this._setList('netIncomingList', rows || '<div class="net-empty">Пока пусто. Как только друг отправит подарок или обмен — появится здесь.</div>');

    // Мои открытые комнаты
    let tr = '';
    (mine.data.open || []).forEach(t => {
      tr += this._row(`🤝 комната <b class="font-mono">${t.code}</b>`,
        `${escapeHtml(t.offer.icon)} ${escapeHtml(t.offer.name)} · ${fmt(t.offer.price)} ₽${t.wantNote ? ' · просит: ' + escapeHtml(t.wantNote) : ''}`,
        `<button onclick="NetPlay.cancelTrade('${t.code}')" class="net-btn net-btn-danger">Отменить</button>`);
    });
    this._setList('netMyTradesList', tr || '<div class="net-empty">Открытых комнат нет — создай выше и отправь код другу.</div>');

    updateNetBadge((gifts.data.incoming || []).length + (dlv.data.deliveries || []).length);
  },

  _row(title, sub, btnHtml) {
    return `<div class="net-row"><div class="min-w-0"><div class="text-[10.5px] font-bold text-slate-200 truncate">${title}</div><div class="text-[10px] text-slate-400 truncate">${sub}</div></div>${btnHtml}</div>`;
  },

  _setList(id, inner) { const el = $(id); if (el) el.innerHTML = inner; },

  _wireItem(item) {
    return { id: item.id, uid: item.uid, name: item.name, icon: item.icon, price: item.price, rarity: item.rarity, category: item.category, wonAt: item.wonAt };
  },

  async _needOnline() {
    const on = await ServerAPI.ping(true);
    if (!on) {
      Toast.error('Сервер оффлайн! Нажми «Включить сервер» и подожди, пока он оживёт: ' + COMMUNITY_SERVER_URL);
      renderServerStatus();
    }
    return on;
  }
};

/* --------------------------------------------------------------------------
   ИНДИКАТОРЫ И ЗАГРУЗКА
   -------------------------------------------------------------------------- */
function renderServerStatus() {
  const online = ServerAPI.isOnline();
  const statusText = online
    ? `<span class="text-emerald-400">●</span> Сервер онлайн — чат, подарки и обмен работают`
    : `<span class="text-rose-400">●</span> Сервер не работает — нажми «Включить сервер» и подожди, пока сервер оживёт (~минуту), или напиши нам на <b class="text-rose-200">${SERVER_CONTACT_EMAIL}</b> — решим проблему!`;
  const chipCls = online
    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/40'
    : 'bg-rose-500/15 text-rose-300 border border-rose-500/40';
  const chipText = online ? 'ОНЛАЙН' : 'ОФФЛАЙН';

  // Модалка трейдинга
  const el = $('netServerStatus');
  if (el) el.innerHTML = statusText;
  const chip = $('netServerChip');
  if (chip) {
    chip.textContent = chipText;
    chip.className = 'text-[8px] font-black px-1.5 py-0.5 rounded uppercase ' + chipCls;
  }
  // Модалка сообщества
  const el2 = $('commServerStatus');
  if (el2) el2.innerHTML = statusText;
  const chip2 = $('commServerChip');
  if (chip2) {
    chip2.textContent = chipText;
    chip2.className = 'text-[8px] font-black px-1.5 py-0.5 rounded uppercase ' + chipCls;
  }
  // Карточка на экране «Фарм»
  const mini = $('communityMiniStatus');
  if (mini) {
    mini.textContent = chipText;
    mini.className = 'text-[8px] font-black px-1.5 py-0.5 rounded uppercase border flex-shrink-0 ' + chipCls;
  }
  // Блоки «сервер спит» с кнопкой пробуждения и почтой поддержки
  const autoWaking = typeof AutoWake !== 'undefined' && AutoWake._timer;
  ['commOfflineHelp', 'netOfflineHelp'].forEach(id => {
    const box = $(id);
    if (box) box.classList.toggle('hidden', online || !!autoWaking);
  });
  const aw = $('autoWakeHint');
  if (aw) aw.classList.toggle('hidden', online || !autoWaking);
  CloudSave._renderStatus();
}

function updateNetBadge(count) {
  const dot = $('netplayDot');
  if (!dot) return;
  dot.classList.toggle('hidden', !count);
  dot.textContent = count > 9 ? '9+' : count;
}

/* --------------------------------------------------------------------------
   БУДИМ СЕРВЕР: бесплатный Render «засыпает», первый запрос поднимает его
   за 30–90 секунд. Одна кнопка — во всех окнах сообщества.
   -------------------------------------------------------------------------- */
async function wakeCommunityServer(btn) {
  const orig = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.classList.add('opacity-60'); }
  Toast.info('☕ Бужу сервер сообщества… Render просыпается 30–90 секунд — не закрывай страницу!', 7000);
  const started = Date.now();
  while (Date.now() - started < 130000) {
    try {
      const on = await ServerAPI.ping(true);
      renderServerStatus();
      if (on) {
        if (btn) { btn.disabled = false; btn.classList.remove('opacity-60'); btn.innerHTML = orig; }
        Toast.gold('🚀 Сервер проснулся! Аккаунты, чат, подарки и облачные сейвы снова работают — жми дальше!', 8000);
        if (typeof Community !== 'undefined') Community.refreshChat(true);
        return true;
      }
    } catch (e) {}
    const sec = Math.round((Date.now() - started) / 1000);
    if (btn) btn.innerHTML = `☕ Бужу… ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    await new Promise(r => setTimeout(r, 5000));
  }
  if (btn) { btn.disabled = false; btn.classList.remove('opacity-60'); btn.innerHTML = orig; }
  Toast.error(`Сервер пока не поднялся. Зайди через пару минут или напиши нам: ${SERVER_CONTACT_EMAIL} — решим проблему!`, 10000);
  renderServerStatus();
  return false;
}

/* --------------------------------------------------------------------------
   АККАУНТ: E-MAIL + ПАРОЛЬ + КОД (сезон 3.7)
   Клиентская обёртка над /api/account/*. Код «из письма» в демо-режиме
   приходит прямо в ответе API и показывается игроку.
   -------------------------------------------------------------------------- */
const Account = {
  /* Шаг 1: e-mail + пароль → режим (login/register) + uid + демо-код */
  start(email, password) {
    return ServerAPI.req('POST', '/api/account/start', {
      email, password,
      uid: state.user ? state.user.id : null,
      nick: state.user ? state.user.nick : null
    }, {}, 15000);
  },
  /* Шаг 2: 6-значный код из письма */
  verify(email, code) {
    return ServerAPI.req('POST', '/api/account/verify', {
      email, code,
      nick: state.user ? state.user.nick : null
    }, {}, 15000);
  }
};

/* --------------------------------------------------------------------------
   ШЛАГБАУМ ВХОДА «ВВЕДИТЕ АККАУНТ»
   Показывается при входе, если локального профиля нет. Старые игроки входят
   по e-mail+паролю+коду, новые регистрируются — тоже через код. Можно отказаться
   от e-mail, но с честным предупреждением: выйдешь — мы не виноваты.
   -------------------------------------------------------------------------- */
const AuthGate = {
  _locked: false,
  _email: '',
  _password: '',
  _mode: 'login',

  onBoot() {
    if (state.user) return; // аккаунт уже есть — просто приветствуем
    this.open(true);
  },

  onUserRegistered() {
    if (Modal.isOpen('authModal')) this._finish();
  },

  open(locked) {
    this._locked = !!locked;
    const x = $('authClose');
    if (x) x.classList.toggle('hidden', !!locked);
    // Приветственный дисклеймер временно прячем — не наслаиваем окна
    const wd = $('welcomeDisclaimerModal');
    if (wd && wd.style.display !== 'none' && !wd.classList.contains('opacity-0')) {
      wd.style.display = 'none';
      this._welcomeHidden = true;
    }
    Modal.open('authModal');
    this.showStep('home');
    this.refreshNetworkState(true);
  },

  _releaseWelcome() {
    if (!this._welcomeHidden) return;
    this._welcomeHidden = false;
    const wd = $('welcomeDisclaimerModal');
    if (wd) wd.style.display = '';
  },

  /* Все пути закрытия шлагбаума идут через это: вернуть приветствие новичку */
  _finish() {
    this._locked = false;
    Modal.close('authModal');
    this._releaseWelcome();
  },

  /* Из настроек: «Привязать e-mail» — окно можно закрыть */
  openLink() {
    if (!state.user) return;
    this.open(false);
    this.showStep('login');
    setTimeout(() => { const e = $('authEmailInput'); if (e) e.focus(); }, 150);
  },

  close() {
    if (this._locked && !state.user) {
      Toast.error('Сначала введи аккаунт — без профиля прогресс не сохранить! 🎒');
      return;
    }
    this._finish();
  },

  showStep(step) {
    [['home', 'authStepHome'], ['login', 'authStepLogin'], ['code', 'authStepCode']].forEach(([s, id]) => {
      const el = $(id);
      if (el) el.classList.toggle('hidden', s !== step);
    });
    this._err('');
    if (step === 'login') setTimeout(() => { const e = $('authEmailInput'); if (e) e.focus(); }, 150);
    if (step === 'code') setTimeout(() => { const c = $('authCodeInput'); if (c) c.focus(); }, 150);
  },

  async refreshNetworkState(pingIt) {
    const online = pingIt ? await ServerAPI.ping(true) : ServerAPI.isOnline();
    const off = $('authOffline');
    const autoWaking = typeof AutoWake !== 'undefined' && AutoWake._timer;
    if (off) off.classList.toggle('hidden', !!online || !!autoWaking);
    if (!online && !autoWaking && AutoWake.enabled()) AutoWake.start();
    renderServerStatus();
    return online;
  },

  _err(text) {
    const e = $('authError');
    if (!e) return;
    e.textContent = text || '';
    e.classList.toggle('hidden', !text);
  },

  _status(text) {
    const e = $('authStatusLine');
    if (e) e.textContent = text || '';
  },

  /* Шаг 1: e-mail + пароль → запрашиваем код */
  async requestCode() {
    const email = String((($('authEmailInput') || {}).value) || '').trim().toLowerCase();
    const password = String((($('authPasswordInput') || {}).value) || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return this._err('Похоже, в e-mail опечатка. Пример: player@gmail.com');
    if (password.length < 4) return this._err('Пароль — минимум 4 символа');

    const btn = $('authGetCodeBtn');
    if (btn) btn.disabled = true;
    this._status('Связываюсь с сервером…');
    try {
      if (!(await this.refreshNetworkState(true))) {
        this._status('');
        return this._err('Сервер сейчас оффлайн. Нажми «ВКЛЮЧИТЬ СЕРВЕР» в жёлтой полоске, подожди минутку и повтори.');
      }
      const { data } = await Account.start(email, password);
      if (!data.ok) {
        this._status('');
        return this._err(data.error || 'Сервер отклонил запрос — попробуй ещё раз');
      }
      this._email = email;
      this._password = password;
      this._mode = data.mode || 'login';
      this._pending = { uid: data.uid, tag: data.tag, nick: data.nick, verified: data.verified, email: data.email || email };

      const ml = $('authModeLabel');
      if (ml) ml.textContent = this._mode === 'register'
        ? '✨ Такой e-mail у нас впервые — создаём новый аккаунт'
        : '👋 Такой аккаунт уже есть — входим обратно';
      const dm = $('authDemoCode');
      if (dm) dm.textContent = data.demoCode || '••••••';
      const em = $('authCodeEmail');
      if (em) em.textContent = email;
      this._status('');
      this.showStep('code');
      Toast.info('📨 Код «из письма» отправлен! В демо-режиме он показан прямо в жёлтой рамке под полем 🙂', 7000);
      audio.playCoin();
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  /* Отправить код повторно (тот же e-mail и пароль) */
  resendCode() {
    if (!this._email || !this._password) return this.showStep('login');
    const e = $('authEmailInput'), p = $('authPasswordInput');
    if (e) e.value = this._email;
    if (p) p.value = this._password;
    this.requestCode();
  },

  /* Шаг 2: вводим код из письма */
  async confirmCode() {
    const code = String((($('authCodeInput') || {}).value) || '').replace(/\D/g, '');
    if (code.length !== 6) return this._err('Код — это 6 цифр из письма');
    const btn = $('authConfirmBtn');
    if (btn) btn.disabled = true;
    this._status('Проверяю код…');
    try {
      const { data } = await Account.verify(this._email, code);
      if (!data.ok) {
        this._status('');
        return this._err(data.error || 'Неверный код — глянь внимательнее и попробуй ещё');
      }
      this._status('');
      this._acceptAccount(data);
    } finally {
      if (btn) btn.disabled = false;
    }
  },

  /* Код подтверждён: принимаем аккаунт с серверным uid/ID */
  _acceptAccount(data) {
    const email = data.email || this._email;

    // РЕЖИМ ПРИВЯЗКИ (из настроек): профиль уже существует
    if (state.user) {
      state.user.email = email;
      if (data.tag && !state.user.tag) state.user.tag = data.tag;
      if (data.verified) state.user.verified = true;
      persist(true);
      if (typeof renderProfile === 'function') renderProfile();
      NetIdentity.renderEverywhere();
      this._finish();
      audio.playSecret();
      Toast.gold(`🔒 E-mail <b>${escapeHtml(email)}</b> привязан к аккаунту! Теперь прогресс восстановится с любого устройства.`, 8000);
      NetIdentity.sync();
      return;
    }

    // ВОЗВРАЩАЮЩИЙСЯ ИГРОК: сервер знает ник — входим целиком
    if (data.nick) {
      state.user = {
        id: data.uid,
        nick: data.nick,
        avatar: '🎒',
        grade: 'Ученик школы',
        joinedAt: new Date().toLocaleDateString('ru-RU'),
        email, tag: data.tag || null, verified: !!data.verified
      };
      persist(true);
      if (typeof renderProfile === 'function') renderProfile();
      uiUpdate();
      this._finish();
      audio.playSecret();
      Fx.burst(120, ['#22d3ee', '#f59e0b']);
      Toast.gold(`👋 С возвращением, <b>${escapeHtml(data.nick)}</b>! Почта подтверждена${data.tag ? `, твой ID <b class="font-mono text-amber-300">${escapeHtml(data.tag)}</b> на месте` : ''}. Спрашиваю у облака твой прогресс…`, 9000);
      NetIdentity.sync();
      CloudSave.startAutoPush();
      CloudSave.pullAndRestore(false).then(ok => { if (!ok) CloudSave.push(false); });
      return;
    }

    // НОВЫЙ АККАУНТ: ника ещё нет — отдаём серверный uid регистрации
    state.pendingAuthUid = data.uid;
    state.pendingAuthEmail = email;
    state.pendingAuthTag = data.tag || null;
    state.pendingAuthVerified = !!data.verified;
    this._finish();
    audio.playWin();
    Toast.success('✅ Почта подтверждена и привязана! Осталось придумать ник — пара секунд 🎒', 7000);
    if (typeof openProfileModal === 'function') openProfileModal();
  },

  /* Отказ от e-mail: регистрируем локально, но с честным предупреждением */
  skipEmail() {
    ConfirmDialog.ask({
      icon: '⚠️',
      title: 'Точно без e-mail?',
      text: 'Аккаунт с e-mail <b class="text-emerald-300">в разы лучше</b>: восстановится с любого устройства за 2 минуты. <b class="text-rose-300">Без e-mail, если выйдешь из аккаунта или очистишь браузер, мы уже не виноваты</b> — прогресс и ID исчезнут навсегда.',
      okText: 'Всё равно без e-mail',
      danger: true
    }).then(ok => {
      if (!ok) return;
      state.pendingAuthUid = null;
      state.pendingAuthEmail = null;
      state.pendingAuthTag = null;
      state.pendingAuthVerified = false;
      this._finish();
      Toast.info('Ладно 🙂 Придумай ник — а привязать e-mail можно потом: ⚙️ Настройки → «Привязать e-mail».', 8000);
      if (typeof openProfileModal === 'function') openProfileModal();
    });
  }
};

/* --------------------------------------------------------------------------
   ПРИВЕТСТВИЕ ПРИ ВХОДЕ (сезон 3.7)
   «Привет! Загляни в аккаунт — вдруг тебе выдали галочку либо код автора…»
   Показывается раз в 12 часов (+ сразу после глобального вайпа).
   -------------------------------------------------------------------------- */
function maybeShowEntryGreeting() {
  if (!state.user) return;
  let last = 0;
  try { last = Number(localStorage.getItem('shkola_greet_at')) || 0; } catch (e) {}
  const hadWipe = !!state.seasonWipeToast;
  if (Date.now() - last < 12 * 3600 * 1000 && !hadWipe) return;
  try { localStorage.setItem('shkola_greet_at', String(Date.now())); } catch (e) {}
  state.seasonWipeToast = false;
  setTimeout(() => {
    if (hadWipe) {
      Toast.gold('🧹 <b>СЕЗОН 3.7 — БОЛЬШОЙ ВАЙП!</b> Баланс и рюкзак у всех обнулены до стартовых — честный новый сезон. Ник и уникальный ID остались нетронуты. Жёсткие кейсы, лавка из 4 вещиц и ⚡ 10 предметов, что добываются ТОЛЬКО апгрейдом. Вперёд!', 13000);
    }
    setTimeout(() => {
      if (!state.user) return;
      const tag = state.user.tag;
      Toast.info(`👋 Привет, <b>${escapeHtml(state.user.nick)}</b>! Загляни в свой аккаунт (кнопка 👤 снизу): вдруг тебе уже выдали ✔ галочку верификации или 🎁 код автора? ${tag ? `Твой уникальный ID: <b class="font-mono text-amber-300">${escapeHtml(tag)}</b> — он же висит в «💬 Сообществе» и копируется нажатием.` : 'Кнопка «💬 Сообщество» откроет общий чат и твой уникальный ID (копируется нажатием).'}`, 12000);
    }, hadWipe ? 900 : 400);
  }, 1000);
}

/* --------------------------------------------------------------------------
   АДМИНКА: игроки сообщества, галочки, чат, адрес сервера, коды авторов
   -------------------------------------------------------------------------- */
function adminSaveServerUrl() {
  const input = $('adminServerUrl');
  ServerAPI.setManual(input ? input.value : '');
  Toast.info(input && input.value.trim() ? 'Адрес сервера сохранён. Проверяю связь...' : 'Возвращаю зашитый сервер сообщества. Проверяю связь...');
  ServerAPI.ping(true).then(on => {
    Toast[on ? 'gold' : 'error'](on ? 'Сервер отвечает! Онлайн-функции активны 🚀' : 'Не отвечает. Проверь: сервер запущен? адрес верный?');
    renderServerStatus();
  });
}

/* Список зарегистрированных игроков: онлайн, последний вход, действия по роли */
let _adminPlayersCache = [];
let _adminPlayersFilter = 'all'; // all | online | admins | banned

function adminSetPlayersFilter(f) {
  _adminPlayersFilter = f;
  ['all', 'online', 'admins', 'banned'].forEach(k => {
    const btn = $('adminFilter' + k.charAt(0).toUpperCase() + k.slice(1));
    if (btn) btn.classList.toggle('bg-slate-600', k === f);
  });
  adminRenderPlayers();
}

async function adminLoadPlayers(manual = false) {
  const box = $('adminPlayersList');
  if (!box) return;
  if (manual) box.innerHTML = '<div class="net-empty">Загружаю список игроков…</div>';
  if (!(await ServerAPI.ping())) {
    box.innerHTML = '<div class="net-empty">Сервер оффлайн — список игроков недоступен.</div>';
    return;
  }
  const { data } = await ServerAPI.req('GET', '/api/admin/players', null, adminHeaders());
  if (!data.ok) {
    box.innerHTML = `<div class="net-empty">${escapeHtml(data.error || 'Не удалось загрузить игроков')}</div>`;
    return;
  }
  _adminPlayersCache = data.players || [];
  if (ServerAPI._playersCount !== _adminPlayersCache.length) {
    ServerAPI._playersCount = _adminPlayersCache.length;
    Community.renderMyId();
  }
  const onlineEl = $('adminOnlineCount');
  if (onlineEl) onlineEl.textContent = `${data.online || 0} онлайн · ${_adminPlayersCache.length} всего`;
  adminRenderPlayers();
}

function adminRenderPlayers() {
  const box = $('adminPlayersList');
  if (!box) return;
  const q = (($('adminPlayersSearch') || {}).value || '').trim().toLowerCase();
  const has = (perm) => typeof adminHas === 'function' && adminHas(perm);
  let players = _adminPlayersCache;
  if (_adminPlayersFilter === 'online') players = players.filter(p => p.online);
  if (_adminPlayersFilter === 'admins') players = players.filter(p => p.role === 'admin');
  if (_adminPlayersFilter === 'banned') players = players.filter(p => p.banned);
  if (q) players = players.filter(p => [p.nick, p.tag, p.uid, p.email].some(v => v && String(v).toLowerCase().includes(q)));

  box.innerHTML = players.map(p => {
    const btns = [];
    if (has('verify')) btns.push(p.verified
      ? `<button onclick="adminToggleVerify('${p.uid}', false)" class="adm-act" style="background:linear-gradient(135deg,#f59e0b,#d97706)" title="Снять галочку">✔ снять</button>`
      : `<button onclick="adminToggleVerify('${p.uid}', true)" class="adm-act" title="Выдать галочку верификации">✔ галочка</button>`);
    if (has('role')) btns.push(p.role === 'admin'
      ? `<button onclick="adminSetRole('${p.uid}', null)" class="adm-act" style="background:linear-gradient(135deg,#0ea5e9,#0369a1)" title="Снять права администратора">🛡 снять</button>`
      : `<button onclick="adminSetRole('${p.uid}', 'admin')" class="adm-act" style="background:linear-gradient(135deg,#38bdf8,#6366f1)" title="Назначить администратором (значок 🛡 АДМИН)">🛡 админ</button>`);
    if (has('dm')) btns.push(`<button onclick="adminOpenDm('${p.uid}', '${escapeHtml(p.nick).replace(/'/g, '')}')" class="adm-act" style="background:linear-gradient(135deg,#0ea5e9,#2563eb)" title="Написать игроку личное сообщение">✉ написать</button>`);
    if (has('ban')) btns.push(p.banned
      ? `<button onclick="adminToggleBan('${p.uid}', false)" class="adm-act" style="background:linear-gradient(135deg,#22c55e,#15803d)" title="Разбанить">✅ разбан</button>`
      : `<button onclick="adminOpenBan('${p.uid}', '${escapeHtml(p.nick).replace(/'/g, '')}')" class="adm-act" style="background:linear-gradient(135deg,#f43f5e,#be123c)" title="Забанить (с причиной; чат, смена ника и новые аккаунты с этого IP закрыты)">⛔ бан</button>`);
    if (has('status')) btns.push(`<select onchange="adminSetStatus('${p.uid}', this.value)" class="adm-act" style="background:#1e293b;border:1px solid #334155" title="Статус игрока (плашка у ника)">
        <option value="" ${!p.status ? 'selected' : ''}>статус: нет</option>
        ${Object.keys(PLAYER_STATUS_META).map(k => `<option value="${k}" ${p.status === k ? 'selected' : ''}>${PLAYER_STATUS_META[k].label}</option>`).join('')}
      </select>`);
    if (has('delete')) btns.push(`<button onclick="adminDeleteAccount('${p.uid}', '${escapeHtml(p.nick).replace(/'/g, '')}')" class="adm-act" style="background:linear-gradient(135deg,#7f1d1d,#450a0a)" title="Удалить аккаунт навсегда">🗑 удалить</button>`);

    const status = p.online
      ? '<span class="text-emerald-400 font-bold">● онлайн</span>'
      : `<span class="text-slate-500">○ ${escapeHtml(lastSeenText(p.lastSeen, false))}</span>`;
    const chips = `${p.verified ? verifiedBadgeHtml() : ''}${p.role === 'admin' ? staffChipHtml() : ''}${p.status ? statusChipHtml(p.status) : ''}${p.banned ? `<span class="text-[8px] font-black px-1 rounded bg-rose-500/20 border border-rose-500/50 text-rose-300" title="${escapeHtml(p.banReason || 'без причины')}">⛔ БАН</span>` : ''}`;
    const banInfo = p.banned ? `<div class="text-[8.5px] text-rose-300/80 truncate">Причина: ${escapeHtml(p.banReason || 'без причины')}${p.banBy ? ` · забанил ${escapeHtml(p.banBy)}` : ''}</div>` : '';
    const email = has('emails') && p.email ? `<div class="text-[8.5px] text-slate-500 truncate">✉ ${escapeHtml(p.email)}</div>` : '';
    const first = p.firstSeen ? `рег. ${new Date(p.firstSeen).toLocaleDateString('ru-RU')}` : '';
    return `<div class="bg-slate-900/70 border border-slate-800 rounded-lg px-2 py-1.5 space-y-1">
      <div class="min-w-0 cursor-pointer hover:bg-slate-800/50 rounded -mx-1 px-1 transition" onclick="adminOpenPlayer('${p.uid}')" title="Открыть подробную карточку">
        <div class="text-[10.5px] font-bold text-slate-200 truncate flex items-center gap-1 flex-wrap">${escapeHtml(p.nick)} ${chips}<span class="ml-auto text-slate-600 text-[9px]">›</span></div>
        <div class="text-[9px] text-slate-500 truncate">ID <span class="font-mono text-amber-300">${escapeHtml(p.tag || '—')}</span> · <span class="font-mono">${escapeHtml(p.uid)}</span></div>
        ${email}${banInfo}
        <div class="text-[9px] truncate">${status}${first ? ` <span class="text-slate-600">· ${first}</span>` : ''}</div>
      </div>
      ${btns.length ? `<div class="flex flex-wrap gap-1">${btns.join('')}</div>` : ''}
    </div>`;
  }).join('') || '<div class="net-empty">Никого не найдено.</div>';
}

async function adminToggleVerify(uid, grant) {
  const { data } = await ServerAPI.req('POST', '/api/admin/players/verify', { uid, verified: grant }, adminHeaders());
  if (!data.ok) { Toast.error(data.error || 'Сервер отклонил запрос'); return; }
  audio.playSecret();
  Toast.gold(grant ? '✔ Галочка верификации выдана! Игрок увидит её в профиле и чате.' : 'Галочка снята с аккаунта.');
  adminLoadPlayers();
}

async function adminSetRole(uid, role) {
  const { data } = await ServerAPI.req('POST', '/api/admin/players/role', { uid, role }, adminHeaders());
  if (!data.ok) { Toast.error(data.error || 'Сервер отклонил запрос'); return; }
  audio.playSecret();
  Toast.gold(role === 'admin' ? '🛡 Игрок назначен администратором — у него появился значок АДМИН. Код панели администрации передай ему лично.' : 'Права администратора сняты.');
  adminLoadPlayers();
}

let _banTarget = null;
function adminOpenBan(uid, nick) {
  _banTarget = { uid, nick };
  const who = $('banReasonWho'); if (who) who.textContent = `${nick} · ${uid}`;
  const inp = $('banReasonInput'); if (inp) inp.value = '';
  const err = $('banReasonError'); if (err) err.classList.add('hidden');
  Modal.open('banReasonModal');
  setTimeout(() => { if (inp) inp.focus(); }, 80);
}
async function adminConfirmBan() {
  if (!_banTarget) return;
  const reason = (($('banReasonInput') || {}).value || '').trim();
  const err = $('banReasonError');
  if (!reason) { if (err) { err.textContent = 'Причина обязательна — напиши, за что бан.'; err.classList.remove('hidden'); } return; }
  await adminToggleBan(_banTarget.uid, true, reason);
  Modal.close('banReasonModal');
  _banTarget = null;
}
async function adminToggleBan(uid, ban, reason) {
  const { data } = await ServerAPI.req('POST', '/api/admin/players/ban', { uid, banned: ban, reason: reason || '', by: state.user ? state.user.nick : '' }, adminHeaders());
  if (!data.ok) { Toast.error(data.error || 'Сервер отклонил запрос'); return; }
  Toast[ban ? 'error' : 'gold'](ban ? `⛔ Игрок забанен. Причина: ${escapeHtml(reason || 'без причины')}` : '✅ Бан снят.');
  adminLoadPlayers();
  if (Modal.isOpen('adminPlayerModal')) adminOpenPlayer(uid);
}

async function adminSetStatus(uid, status) {
  const { data } = await ServerAPI.req('POST', '/api/admin/players/status', { uid, status }, adminHeaders());
  if (!data.ok) { Toast.error(data.error || 'Сервер отклонил запрос'); return; }
  audio.playSecret();
  Toast.gold(status ? `Статус ${statusLabel(status)} выдан — плашка видна у ника в чате и профиле.` : 'Статус снят.');
  adminLoadPlayers();
}

/* ---- Личное сообщение игроку от админа/владельца ---- */
let _dmTarget = null;
function adminOpenDm(uid, nick) {
  _dmTarget = { uid, nick };
  const who = $('adminDmWho'); if (who) who.textContent = `Кому: ${nick} · ${uid}`;
  const inp = $('adminDmInput'); if (inp) inp.value = '';
  Modal.open('adminDmModal');
  setTimeout(() => { if (inp) inp.focus(); }, 80);
}
async function adminSendDm() {
  if (!_dmTarget) return;
  const text = (($('adminDmInput') || {}).value || '').trim();
  if (!text) { Toast.error('Напиши текст сообщения'); return; }
  const { data } = await ServerAPI.req('POST', '/api/admin/players/dm', { uid: _dmTarget.uid, text, from: state.user ? state.user.nick : '' }, adminHeaders());
  if (!data.ok) { Toast.error(data.error || 'Не отправлено'); return; }
  Modal.close('adminDmModal');
  audio.playCoin();
  Toast.gold(`✉ Сообщение отправлено игроку ${escapeHtml(_dmTarget.nick)}.`);
  _dmTarget = null;
}

/* ---- Подробная карточка игрока ---- */
async function adminOpenPlayer(uid) {
  const body = $('adminPlayerBody');
  const title = $('adminPlayerTitle');
  if (!body) return;
  body.innerHTML = '<div class="net-empty">Загружаю…</div>';
  Modal.open('adminPlayerModal');
  const { data } = await ServerAPI.req('GET', `/api/admin/players/detail?uid=${encodeURIComponent(uid)}`, null, adminHeaders());
  if (!data.ok) { body.innerHTML = `<div class="net-empty">${escapeHtml(data.error || 'Ошибка')}</div>`; return; }
  const p = data.player, sv = data.save;
  const has = (perm) => typeof adminHas === 'function' && adminHas(perm);
  if (title) title.innerHTML = `👤 ${escapeHtml(p.nick)} ${p.verified ? verifiedBadgeHtml() : ''}${p.role === 'admin' ? staffChipHtml() : ''}${p.status ? statusChipHtml(p.status) : ''}`;
  const tile = (l, v, cls = 'text-slate-200') => `<div class="stat-tile"><div class="stat-tile-label">${l}</div><div class="stat-tile-value text-xs ${cls}">${v}</div></div>`;
  const nm = (typeof fmt === 'function') ? fmt : (x => x);
  const actions = [];
  if (has('dm')) actions.push(`<button onclick="adminOpenDm('${p.uid}', '${escapeHtml(p.nick).replace(/'/g, '')}')" class="py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-[11px]">✉ Написать ему</button>`);
  if (has('ban')) actions.push(p.banned
    ? `<button onclick="adminToggleBan('${p.uid}', false)" class="py-2 rounded-xl bg-emerald-700 hover:bg-emerald-600 text-white font-bold text-[11px]">✅ Разбанить</button>`
    : `<button onclick="adminOpenBan('${p.uid}', '${escapeHtml(p.nick).replace(/'/g, '')}')" class="py-2 rounded-xl bg-rose-700 hover:bg-rose-600 text-white font-bold text-[11px]">⛔ Забанить</button>`);
  if (has('verify')) actions.push(`<button onclick="adminToggleVerify('${p.uid}', ${!p.verified}).then(()=>adminOpenPlayer('${p.uid}'))" class="py-2 rounded-xl bg-cyan-800 hover:bg-cyan-700 text-white font-bold text-[11px]">${p.verified ? '✔ Снять галочку' : '✔ Выдать галочку'}</button>`);
  if (has('role')) actions.push(`<button onclick="adminSetRole('${p.uid}', ${p.role === 'admin' ? 'null' : "'admin'"}).then(()=>adminOpenPlayer('${p.uid}'))" class="py-2 rounded-xl bg-indigo-700 hover:bg-indigo-600 text-white font-bold text-[11px]">${p.role === 'admin' ? '🛡 Снять админа' : '🛡 Назначить админом'}</button>`);
  if (has('delete')) actions.push(`<button onclick="adminDeleteAccount('${p.uid}', '${escapeHtml(p.nick).replace(/'/g, '')}').then(()=>Modal.close('adminPlayerModal'))" class="py-2 rounded-xl bg-red-950 hover:bg-red-900 border border-red-800 text-red-300 font-bold text-[11px]">🗑 Удалить аккаунт</button>`);
  const inv = sv && sv.inventory ? sv.inventory : [];
  body.innerHTML = `
    <div class="bg-slate-950/70 border border-slate-800 rounded-xl p-2.5 space-y-1 text-[10px]">
      <div>ID <span class="font-mono text-amber-300">${escapeHtml(p.tag || '—')}</span> · uid <span class="font-mono text-cyan-300">${escapeHtml(p.uid)}</span></div>
      ${p.email !== undefined ? `<div>✉ Почта: <span class="font-mono text-slate-200">${escapeHtml(p.email || 'не привязана')}</span></div>` : ''}
      ${p.ip !== undefined ? `<div>🌐 IP: <span class="font-mono text-slate-400">${escapeHtml(p.ip || '—')}</span></div>` : ''}
      <div>${p.online ? '<span class="text-emerald-400 font-bold">● онлайн сейчас</span>' : `○ ${escapeHtml(lastSeenText(p.lastSeen, false))}`} · рег. ${p.firstSeen ? new Date(p.firstSeen).toLocaleDateString('ru-RU') : '—'}</div>
      ${p.authorCode ? `<div>💜 Код автора: <span class="font-mono text-purple-300">${escapeHtml(p.authorCode)}</span></div>` : ''}
      <div>💬 Сообщений в чате: ${p.chatMessages}</div>
      ${p.banned ? `<div class="text-rose-300">⛔ ЗАБАНЕН · причина: <b>${escapeHtml(p.banReason || 'без причины')}</b>${p.banBy ? ` · забанил ${escapeHtml(p.banBy)}` : ''}${p.banAt ? ` · ${new Date(p.banAt).toLocaleString('ru-RU')}` : ''}</div>` : ''}
    </div>
    ${sv ? `<div class="grid grid-cols-2 gap-1.5">
      ${tile('Уровень', sv.level != null ? sv.level : '—', 'text-emerald-300')}
      ${tile('Баланс', (sv.balance != null ? nm(Math.round(sv.balance)) : '—') + ' ₽', 'text-amber-300')}
      ${tile('Опыт', sv.xp != null ? nm(sv.xp) : '—', 'text-cyan-300')}
      ${tile('Кейсов открыто', nm(sv.casesOpened || 0))}
      ${tile('Апгрейдов выиграно', nm(sv.upgradesWon || 0))}
      ${tile('Всего заработано', nm(Math.round(sv.earnedTotal || 0)) + ' ₽')}
      ${tile('Предметов', `${sv.inventoryCount} · ${nm(sv.inventoryValue)} ₽`, 'text-fuchsia-300')}
      ${tile('VIP / Кот', `${sv.vipActive ? '👑 VIP' : '—'} / ${sv.catFound ? '🐱' : '—'}`)}
    </div>
    ${sv.biggestDropName ? `<div class="text-[10px] text-slate-400">🏆 Лучший дроп: <b class="text-slate-200">${escapeHtml(sv.biggestDropName)}</b> (${nm(sv.biggestDrop || 0)} ₽)</div>` : ''}
    <div class="text-[9px] text-slate-500">Сейв обновлён: ${new Date(sv.updatedAt).toLocaleString('ru-RU')}</div>
    <div class="bg-slate-950/70 border border-slate-800 rounded-xl p-2 max-h-[180px] overflow-y-auto space-y-0.5">
      <div class="text-[9px] uppercase tracking-wider text-slate-500 font-bold mb-1">🎒 Рюкзак (${sv.inventoryCount})</div>
      ${inv.length ? inv.map(i => `<div class="flex justify-between text-[10px]"><span class="truncate">${escapeHtml(i.icon || '')} ${escapeHtml(i.name || i.id)}</span><span class="font-mono text-amber-300 flex-shrink-0 ml-2">${nm(i.price || 0)} ₽</span></div>`).join('') : '<div class="net-empty">пусто</div>'}
    </div>` : '<div class="net-empty">Облачного сохранения ещё нет — игрок не синхронизировался.</div>'}
    ${p.dms && p.dms.length ? `<div class="bg-slate-950/70 border border-slate-800 rounded-xl p-2 space-y-1 max-h-[120px] overflow-y-auto">
      <div class="text-[9px] uppercase tracking-wider text-slate-500 font-bold">✉ Последние сообщения ему</div>
      ${p.dms.map(d => `<div class="text-[9.5px] text-slate-300"><span class="text-sky-300 font-bold">${escapeHtml(d.from)}</span> <span class="text-slate-600">${new Date(d.at).toLocaleString('ru-RU')}${d.read ? ' · прочитано' : ''}</span><br>${escapeHtml(d.text)}</div>`).join('')}
    </div>` : ''}
    ${actions.length ? `<div class="grid grid-cols-2 gap-1.5 pt-1">${actions.join('')}</div>` : ''}`;
}

async function adminDeleteAccount(uid, nick) {
  const ok = await ConfirmDialog.ask({
    icon: '🗑', title: `Удалить аккаунт «${nick}»?`,
    text: 'Удалятся <b class="text-rose-300">навсегда</b>: игрок, его уникальный ID, привязанная почта, облачный сейв и сообщения в чате. Отменить нельзя.',
    okText: 'Удалить навсегда', danger: true
  });
  if (!ok) return;
  const { data } = await ServerAPI.req('POST', '/api/admin/players/delete', { uid }, adminHeaders());
  if (!data.ok) { Toast.error(data.error || 'Сервер отклонил запрос'); return; }
  const r = data.removed || {};
  Toast.info(`🗑 Аккаунт удалён${r.emails && r.emails.length ? ` (почта: ${escapeHtml(r.emails.join(', '))})` : ''}${r.chatMessages ? `, сообщений в чате стёрто: ${r.chatMessages}` : ''}.`, 7000);
  adminLoadPlayers();
}

/* Официальное сообщение в общий чат от имени администрации */
async function adminSendChat() {
  const input = $('adminChatInput');
  const text = ((input && input.value) || '').trim();
  if (!text) { Toast.error('Напиши текст сообщения'); return; }
  if (!(await ServerAPI.ping())) { Toast.error('Сервер оффлайн — чат недоступен'); return; }
  const { data } = await ServerAPI.req('POST', '/api/admin/chat', { text, nick: state.user ? state.user.nick : '' }, adminHeaders());
  if (!data.ok) { Toast.error(data.error || 'Не отправлено'); return; }
  if (input) input.value = '';
  audio.playSecret();
  Toast.gold('📢 Официальное сообщение отправлено в общий чат!');
}

async function adminIssueAuthorCode() {
  const ownerUid = ($('adminCodeOwnerUid').value || '').trim();
  const ownerName = ($('adminCodeOwnerName').value || '').trim();
  const code = ($('adminCodeValue').value || '').trim().toUpperCase();
  if (!ownerUid || !ownerName) { Toast.error('Заполни id аккаунта и ник владельца кода'); return; }

  if (await ServerAPI.ping(true)) {
    const { status, data } = await ServerAPI.req('POST', '/api/admin/author-codes', { ownerUid, ownerName, code }, adminHeaders());
    if (!data.ok) { Toast.error(data.error || 'Сервер отклонил выдачу кода'); return; }
    Toast.gold(`✅ Код автора <b class="font-mono">${escapeHtml(data.entry.code)}</b> выдан для ${escapeHtml(data.entry.ownerName)} и записан в author-codes.json на сервере!`, 8000);
  } else {
    // Оффлайн-режим: отдаём строку для ручной вставки в файл на GitHub
    const finalCode = code || ownerName.replace(/[^A-Za-z0-9]/g, '').slice(0, 10).toUpperCase() || 'AUTHOR' + Math.floor(Math.random() * 900 + 100);
    const snippet = JSON.stringify({ code: finalCode, ownerUid, ownerName });
    const area = $('adminCodeSnippet');
    if (area) {
      area.classList.remove('hidden');
      area.value = snippet + ',';
      area.select();
    }
    Toast.info('Сервер оффлайн — скопируй строку ниже и вставь её в массив "codes" файла author-codes.json на GitHub.', 9000);
  }
  $('adminCodeOwnerUid').value = '';
  $('adminCodeOwnerName').value = '';
  $('adminCodeValue').value = '';
  AuthorRegistry.load(true);
  renderAdminAuthorList();
}

async function renderAdminAuthorList() {
  const box = $('adminAuthorList');
  if (!box) return;
  const reg = await AuthorRegistry.load();
  const rows = (reg.codes || []).map(c =>
    `<div class="net-row"><div class="min-w-0"><div class="text-[10.5px] font-bold font-mono text-purple-300 truncate">${escapeHtml(c.code)}</div><div class="text-[10px] text-slate-400 truncate">${escapeHtml(c.ownerName || '')} · ${escapeHtml(c.ownerUid || '')}</div></div></div>`
  ).join('');
  box.innerHTML = rows || '<div class="net-empty">Пока нет ни одного кода автора.</div>';
}

/* --------------------------------------------------------------------------
   ЭКСПЕРИМЕНТ: АВТОПРОБУЖДЕНИЕ СЕРВЕРА
   Вместо плашки «Включить сервер» игра сама тихо пингует сервер в фоне,
   пока он не проснётся (как будто ты нажал кнопку сам).
   -------------------------------------------------------------------------- */
const AutoWake = {
  _timer: null,
  _started: 0,
  enabled() { return !!(state.settings && state.settings.autoWake); },
  start() {
    if (!this.enabled() || this._timer) return;
    this._started = Date.now();
    document.body.classList.add('auto-wake-on');
    const tick = async () => {
      if (!this.enabled()) return this.stop();
      const on = await ServerAPI.ping(true).catch(() => false);
      if (on) {
        this.stop();
        Toast.gold('⚡ Сервер проснулся автоматически (эксперимент). Онлайн-функции активны!', 6000);
        if (typeof Community !== 'undefined' && Modal.isOpen('communityModal')) Community.refreshChat(true);
        if (typeof AuthGate !== 'undefined') AuthGate.refreshNetworkState(false);
        return;
      }
      if (Date.now() - this._started > 4 * 60 * 1000) { this.stop(); return; } // 4 минуты — хватит
      this._timer = setTimeout(tick, 6000);
    };
    this._timer = setTimeout(tick, 100);
  },
  stop() {
    clearTimeout(this._timer); this._timer = null;
    document.body.classList.remove('auto-wake-on');
  }
};

/* --------------------------------------------------------------------------
   ЭКСПЕРИМЕНТ: УВЕДОМЛЕНИЯ ИЗ ОБЩЕГО ЧАТА
   Фоновый опрос чата (только когда сервер онлайн); новые чужие сообщения
   всплывают тостом с кнопкой-переходом в сообщество.
   -------------------------------------------------------------------------- */
const ChatNotify = {
  _timer: null,
  _lastAt: 0,
  enabled() { return !!(state.settings && state.settings.chatNotify); },
  start() {
    if (!this.enabled() || this._timer) return;
    this._lastAt = Date.now(); // старые сообщения не показываем
    this._timer = setInterval(() => this.poll(), 8000);
  },
  stop() { clearInterval(this._timer); this._timer = null; },
  async poll() {
    if (!this.enabled()) return this.stop();
    if (!ServerAPI.isOnline() || Modal.isOpen('communityModal')) return;
    try {
      const { data } = await ServerAPI.req('GET', `/api/chat?limit=10&after=${this._lastAt}`, null, {}, 5000);
      if (data.ok) this.observe(data.messages || []);
    } catch (e) {}
  },
  /* Вызывается и из Community.refreshChat — чтобы не пропустить, пока окно открыто */
  observe(msgs) {
    if (!msgs.length) return;
    const fresh = msgs.filter(m => m.at > this._lastAt);
    this._lastAt = Math.max(this._lastAt, msgs[msgs.length - 1].at);
    if (!this.enabled() || Modal.isOpen('communityModal') || !fresh.length) return;
    const mine = state.user ? state.user.id : null;
    const other = fresh.filter(m => m.uid !== mine);
    if (!other.length) return;
    const last = other[other.length - 1];
    const more = other.length > 1 ? ` (+${other.length - 1})` : '';
    Toast.info(`💬 <b>${escapeHtml(last.nick)}</b>${more}: ${escapeHtml(last.text.slice(0, 80))}${last.text.length > 80 ? '…' : ''} <button onclick="Community.open()" class="underline text-cyan-300 ml-1">открыть чат</button>`, 6000);
    try { audio.playTick(); } catch (e) {}
  }
};

/* --------------------------------------------------------------------------
   ВХОДЯЩИЕ ОТ АДМИНИСТРАЦИИ (личные сообщения игроку)
   -------------------------------------------------------------------------- */
const DmInbox = {
  _unread: 0,
  _shownIds: new Set(),
  setUnread(n) {
    const prev = this._unread;
    this._unread = n || 0;
    this.renderDot();
    if (this._unread > prev) this.fetchAndToast();
  },
  renderDot() {
    const dot = $('dmDot');
    if (!dot) return;
    dot.classList.toggle('hidden', !this._unread);
    dot.textContent = this._unread > 9 ? '9+' : this._unread;
  },
  async fetchAndToast() {
    if (!state.user) return;
    const { data } = await ServerAPI.req('GET', `/api/dms?uid=${encodeURIComponent(state.user.id)}`).catch(() => ({ data: {} }));
    if (!data || !data.ok) return;
    const unread = (data.dms || []).filter(d => !d.read && !this._shownIds.has(d.id));
    if (!unread.length) return;
    const d = unread[unread.length - 1];
    unread.forEach(x => this._shownIds.add(x.id));
    audio.playSecret();
    Toast.gold(`✉ Сообщение от <b>${escapeHtml(d.from)}</b>${d.fromRole === 'owner' ? ' 👑' : ' 🛡'}: ${escapeHtml(d.text.slice(0, 100))}${d.text.length > 100 ? '…' : ''} <button onclick="DmInbox.open()" class="underline text-amber-200 ml-1">открыть</button>`, 10000);
  },
  async open() {
    if (!state.user) { Toast.info('Сначала создай профиль'); return; }
    const list = $('dmInboxList');
    if (list) list.innerHTML = '<div class="net-empty">Загружаю…</div>';
    Modal.open('dmInboxModal');
    if (!(await ServerAPI.ping())) { if (list) list.innerHTML = '<div class="net-empty">Сервер оффлайн.</div>'; return; }
    const { data } = await ServerAPI.req('GET', `/api/dms?uid=${encodeURIComponent(state.user.id)}`);
    if (!data.ok) return;
    const dms = (data.dms || []).slice().reverse();
    if (list) list.innerHTML = dms.length ? dms.map(d => `<div class="border rounded-lg px-2.5 py-2 ${d.read ? 'bg-slate-900/70 border-slate-800' : 'bg-sky-950/40 border-sky-700/60'}">
        <div class="flex items-center justify-between gap-2 text-[9.5px]"><span class="font-bold text-sky-300">${escapeHtml(d.from)} ${d.fromRole === 'owner' ? '👑' : staffChipHtml()}</span><span class="text-slate-500 font-mono text-[8.5px]">${new Date(d.at).toLocaleString('ru-RU')}</span></div>
        <div class="text-[11px] text-slate-200 mt-0.5 break-words">${escapeHtml(d.text)}</div>
      </div>`).join('') : '<div class="net-empty">Сообщений от администрации пока нет.</div>';
    if (data.unread) {
      await ServerAPI.req('POST', '/api/dms/read', { uid: state.user.id }).catch(() => {});
      this._unread = 0; this.renderDot();
    }
  },
  /* Фоновая проверка раз в минуту (когда сервер онлайн) */
  startPolling() {
    if (this._timer) return;
    this._timer = setInterval(async () => {
      if (!state.user || !ServerAPI.isOnline()) return;
      const { data } = await ServerAPI.req('GET', `/api/dms?uid=${encodeURIComponent(state.user.id)}`, null, {}, 5000).catch(() => ({ data: {} }));
      if (data && data.ok) this.setUnread(data.unread);
    }, 60000);
  }
};

/* --------------------------------------------------------------------------
   ЗАГРУЗКА МОДУЛЯ ПРИ СТАРТЕ ИГРЫ
   -------------------------------------------------------------------------- */
function NetBoot() {
  AuthorRegistry.load().then(() => NetAuthor.renderCard());
  NetAuthor.renderCard();
  renderServerStatus();
  const urlInput = $('adminServerUrl');
  if (urlInput) urlInput.value = ServerAPI.base(); // показываем зашитый сервер сообщества
  renderAdminAuthorList();
  // Приветствие при входе: «загляни в аккаунт — галочка или код автора, твой ID тут»
  maybeShowEntryGreeting();

  ServerAPI.ping(true).then(async on => {
    renderServerStatus();
    // Эксперименты
    if (!on && AutoWake.enabled()) AutoWake.start();
    ChatNotify.start();
    DmInbox.startPolling();
    // Уникальный ID запрашиваем ВСЕГДА (даже если сейчас оффлайн): sync() сам
    // повторит попытку, как только сервер оживёт. Без этого ID не выдавался,
    // если при загрузке страницы бесплатный Render спал.
    if (state.user) NetIdentity.sync();
    if (!on) return;
    if (state.user) {
      // Облачные сейвы: автовосстановление прогресса + фоновая синхронизация
      CloudSave.startAutoPush();
      CloudSave.pullAndRestore(false).then(restored => {
        if (!restored) CloudSave.push(false); // свежая локальная копия — сразу в облако
      });
    }
    NetAuthor.flushPending();
    AuthorCabinet.refresh();
    // Тихая проверка входящих — точка на кнопке меню
    if (state.user) {
      const uid = state.user.id;
      const [g, d] = await Promise.all([
        ServerAPI.req('GET', `/api/gifts?uid=${encodeURIComponent(uid)}`).catch(() => ({ data: {} })),
        ServerAPI.req('GET', `/api/deliveries?uid=${encodeURIComponent(uid)}`).catch(() => ({ data: {} }))
      ]);
      updateNetBadge(((g.data && g.data.incoming) || []).length + ((d.data && d.data.deliveries) || []).length);
      if (((g.data && g.data.incoming) || []).length) Toast.gold('🎁 У тебя есть незабранные подарки! ⋮ → «Трейдинг и подарки» → «Входящие»', 7000);
    }
  }).catch(() => {});
}
