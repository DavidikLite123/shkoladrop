/* ==========================================================================
   ШКОЛА ДРОП — js/netplay.js
   Онлайн-функции: сообщество (чат + уникальные ID + галочки верификации),
   облачные сохранения, спонсорство (код автора + 10% автору),
   подарки и трейдинг.

   СЕРВЕР СООБЩЕСТВА ЗАШИТ В ИГРУ: https://shkoladrop.onrender.com
   (лёгкий server/index.js, Node без зависимостей). Если сервер не отвечает,
   спонсорство работает локально, а чат/подарки/обмен и облако ждут онлайна.

   Реестр кодов авторов — файл author-codes.json в корне репозитория (GitHub):
   сайт читает его напрямую, сервер тоже (и админка умеет в него дописывать).
   ========================================================================== */

/* --------------------------------------------------------------------------
   БАЗОВЫЙ СЛОЙ: адрес сервера, пинг, запросы
   -------------------------------------------------------------------------- */
const COMMUNITY_SERVER_URL = 'https://shkoladrop.onrender.com'; // сервер сообщества — зашит

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
    try {
      const { status, data } = await this.req('GET', '/api/ping', null, {}, 4000);
      this._online = status === 200 && data.ok === true;
      if (this._online && data.players != null) this._playersCount = data.players;
    } catch (e) {
      this._online = false;
    }
    this._onlineAt = Date.now();
    if (this._online) NetAuthor.flushPending();
    renderServerStatus();
    return this._online;
  }
};

/* Секрет админки для серверных запросов (совпадает с ADMIN_SECRET на сервере) */
function adminSecret() {
  try { return localStorage.getItem('shkola_admin_secret') || 'david-admin-1337'; }
  catch (e) { return 'david-admin-1337'; }
}

/* Галочка верификации — единый вид по всей игре (чат, профиль, списки) */
function verifiedBadgeHtml(title) {
  const t = title || 'Верифицированный аккаунт — галочка выдана администрацией проекта';
  return `<span title="${t}" class="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-gradient-to-br from-sky-400 to-cyan-500 text-slate-950 align-middle flex-shrink-0" style="font-size:9px;line-height:1">✔</span>`;
}

function adminChipHtml() {
  return `<span title="Официальное сообщение администрации" class="inline-flex items-center px-1 py-px rounded bg-amber-500/20 border border-amber-500/50 text-amber-300 font-black align-middle" style="font-size:8px">🛠 АДМИН</span>`;
}

/* --------------------------------------------------------------------------
   ЛИЧНОСТЬ ИГРОКА: уникальный ID с сервера + галочка верификации
   Уникальный ID (#123456) присваивается АВТОМАТИЧЕСКИ при первой
   синхронизации с обновлённой версией и хранится на сервере навсегда.
   -------------------------------------------------------------------------- */
const NetIdentity = {
  _syncing: false,

  async sync() {
    if (!state.user || this._syncing) return null;
    this._syncing = true;
    try {
      if (!(await ServerAPI.ping())) return null;
      const { data } = await ServerAPI.req('POST', '/api/auth/sync', {
        uid: state.user.id, nick: state.user.nick
      });
      if (data && data.ok) {
        const hadTag = !!state.user.tag;
        if (data.tag) state.user.tag = data.tag;
        state.user.verified = !!data.verified;
        if (!hadTag && state.user.tag) {
          // Первая выдача ID после входа в обновлённую версию
          Toast.gold(`🆔 Твоему аккаунту присвоен уникальный ID: <b class="font-mono">${escapeHtml(state.user.tag)}</b>. По нему тебя найдут друзья в «💬 Сообществе»!`, 9000);
        } else if (state.user.verified) {
          Toast.info('✔ Твой аккаунт верифицирован администрацией — галочка видна всем в чате и профиле!', 7000);
        }
        persist(true);
        this.renderEverywhere();
      }
      return data;
    } catch (e) {
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

  /* Карточка «Спонсорство» в разделе промокодов (фарм-экран) */
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
    NetIdentity.sync(); // подхватить свежую галочку/ID, если сервер что-то поменял
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

  /* Мой уникальный ID во всех местах */
  renderMyId() {
    const hasUser = !!state.user;
    const tag = hasUser && state.user.tag;
    const el = $('commMyTag');
    if (el) el.textContent = tag || (hasUser ? 'выдаётся…' : '#…');
    const badge = $('commMyVerified');
    if (badge) {
      badge.classList.toggle('hidden', !(hasUser && state.user.verified));
      if (hasUser && state.user.verified) badge.innerHTML = verifiedBadgeHtml();
    }
    const cnt = $('commPlayersCount');
    if (cnt && ServerAPI._playersCount != null) cnt.textContent = fmt(ServerAPI._playersCount);
  },

  async copyMyTag() {
    if (!state.user || !state.user.tag) { Toast.info('ID ещё выдаётся сервером — подожди пару секунд'); return; }
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
          <div class="text-[10.5px] font-bold text-slate-200 truncate flex items-center gap-1">${escapeHtml(p.nick)}${p.verified ? verifiedBadgeHtml() : ''}</div>
          <div class="text-[10px] text-slate-400 truncate">ID <span class="font-mono text-amber-300">${escapeHtml(p.tag || '—')}</span>${seenText ? ' · ' + seenText : ''}</div>
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
    const canModerate = !!state.rigReady; // админ видит крестики удаления
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
        : `<span class="font-bold ${isMe ? 'text-cyan-300' : 'text-slate-200'}">${escapeHtml(m.nick)}</span>${m.verified ? ' ' + verifiedBadgeHtml() : ''}${m.tag ? ` <span class="font-mono text-[8.5px] text-slate-500">${escapeHtml(m.tag)}</span>` : ''}`;
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
    if (!data.ok) { Toast.error(data.error || 'Сообщение не отправлено'); return; }
    if (input) input.value = '';
    audio.playCoin();
    this._lastSignature = ''; // принудительно перерисуем
    this.refreshChat(true);
  },

  /* Модерация: админ удаляет сообщение (кнопка ✕ видна только при rigReady) */
  async adminDeleteMessage(id) {
    if (!state.rigReady) return;
    const { data } = await ServerAPI.req('POST', '/api/admin/chat/delete', { id }, { 'x-admin-secret': adminSecret() });
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
      Toast.error('Сервер оффлайн! Подарки и обмен работают через сервер сообщества: ' + COMMUNITY_SERVER_URL);
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
    : `<span class="text-rose-400">●</span> Сервер оффлайн — сообщество временно недоступно (${COMMUNITY_SERVER_URL.replace('https://', '')})`;
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
  CloudSave._renderStatus();
}

function updateNetBadge(count) {
  const dot = $('netplayDot');
  if (!dot) return;
  dot.classList.toggle('hidden', !count);
  dot.textContent = count > 9 ? '9+' : count;
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

/* Список зарегистрированных игроков + выдача галочек */
async function adminLoadPlayers(manual = false) {
  const box = $('adminPlayersList');
  if (!box) return;
  if (manual) box.innerHTML = '<div class="net-empty">Загружаю список игроков…</div>';
  if (!(await ServerAPI.ping())) {
    box.innerHTML = '<div class="net-empty">Сервер оффлайн — список игроков недоступен.</div>';
    return;
  }
  const { data } = await ServerAPI.req('GET', '/api/admin/players', null, { 'x-admin-secret': adminSecret() });
  if (!data.ok) {
    box.innerHTML = `<div class="net-empty">${escapeHtml(data.error || 'Не удалось загрузить игроков')}</div>`;
    return;
  }
  const players = data.players || [];
  if (ServerAPI._playersCount !== players.length) {
    ServerAPI._playersCount = players.length;
    Community.renderMyId();
  }
  box.innerHTML = players.map(p => {
    const agoMin = p.lastSeen ? Math.max(0, Math.round((Date.now() - p.lastSeen) / 60000)) : null;
    const ago = agoMin == null ? '' : (agoMin < 1 ? 'онлайн сейчас' : agoMin < 60 ? `${agoMin} мин назад` : agoMin < 60 * 24 ? `${Math.round(agoMin / 60)} ч назад` : `${Math.round(agoMin / 60 / 24)} дн назад`);
    const btn = p.verified
      ? `<button onclick="adminToggleVerify('${p.uid}', false)" class="net-btn" style="background:linear-gradient(135deg,#f59e0b,#d97706)" title="Снять галочку">✔ убрать</button>`
      : `<button onclick="adminToggleVerify('${p.uid}', true)" class="net-btn" title="Выдать галочку верификации">✔ выдать</button>`;
    return `<div class="net-row">
      <div class="min-w-0">
        <div class="text-[10.5px] font-bold text-slate-200 truncate flex items-center gap-1">${escapeHtml(p.nick)}${p.verified ? verifiedBadgeHtml() : ''}</div>
        <div class="text-[9px] text-slate-500 truncate">ID <span class="font-mono text-amber-300">${escapeHtml(p.tag || '—')}</span> · <span class="font-mono">${escapeHtml(p.uid)}</span>${ago ? ' · ' + ago : ''}</div>
      </div>${btn}
    </div>`;
  }).join('') || '<div class="net-empty">Пока никто не заходил с онлайн-сервером.</div>';
}

async function adminToggleVerify(uid, grant) {
  const { data } = await ServerAPI.req('POST', '/api/admin/players/verify', { uid, verified: grant }, { 'x-admin-secret': adminSecret() });
  if (!data.ok) { Toast.error(data.error || 'Сервер отклонил запрос'); return; }
  audio.playSecret();
  Toast.gold(grant ? '✔ Галочка верификации выдана! Игрок увидит её в профиле и чате.' : 'Галочка снята с аккаунта.');
  adminLoadPlayers();
}

/* Официальное сообщение в общий чат от имени администрации */
async function adminSendChat() {
  const input = $('adminChatInput');
  const text = ((input && input.value) || '').trim();
  if (!text) { Toast.error('Напиши текст сообщения'); return; }
  if (!(await ServerAPI.ping())) { Toast.error('Сервер оффлайн — чат недоступен'); return; }
  const { data } = await ServerAPI.req('POST', '/api/admin/chat', { text }, { 'x-admin-secret': adminSecret() });
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
    const { status, data } = await ServerAPI.req('POST', '/api/admin/author-codes', { ownerUid, ownerName, code }, { 'x-admin-secret': adminSecret() });
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
   ЗАГРУЗКА МОДУЛЯ ПРИ СТАРТЕ ИГРЫ
   -------------------------------------------------------------------------- */
function NetBoot() {
  AuthorRegistry.load().then(() => NetAuthor.renderCard());
  NetAuthor.renderCard();
  renderServerStatus();
  const urlInput = $('adminServerUrl');
  if (urlInput) urlInput.value = ServerAPI.base(); // показываем зашитый сервер сообщества
  renderAdminAuthorList();

  ServerAPI.ping(true).then(async on => {
    renderServerStatus();
    if (!on) return;
    if (state.user) {
      // Уникальный ID и галочка (автовыдача ID при входе в обновлённую версию)
      await NetIdentity.sync();
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
