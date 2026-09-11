/* ==========================================================================
   ШКОЛА ДРОП — js/netplay.js
   Онлайн-функции: спонсорство (код автора + 10% автору), подарки и трейдинг.

   Реестр кодов авторов — файл author-codes.json в корне репозитория (GitHub):
   сайт читает его напрямую, сервер тоже (и админка умеет в него дописывать).
   Сервер — лёгкий server/index.js (Node без зависимостей). Если сервер не
   запущен, спонсорство работает локально, а подарки/трейдинг показывают
   подсказку, как его запустить (docs/SERVER_START.md).
   ========================================================================== */

/* --------------------------------------------------------------------------
   БАЗОВЫЙ СЛОЙ: адрес сервера, пинг, запросы
   -------------------------------------------------------------------------- */
const ServerAPI = {
  _online: null,
  _onlineAt: 0,

  /* Адрес API: ручной из настроек админа (localStorage) → текущий origin */
  base() {
    try {
      const manual = localStorage.getItem('shkola_server_url');
      if (manual) return manual.replace(/\/+$/, '');
    } catch (e) {}
    return location.origin;
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
    } catch (e) {
      this._online = false;
    }
    this._onlineAt = Date.now();
    if (this._online) NetAuthor.flushPending();
    renderServerStatus();
    return this._online;
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
   ПОДАРКИ И ТРЕЙДИНГ (нужен запущенный server/index.js)
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
    if (!target) { Toast.error('Укажи id аккаунта или ник получателя'); return; }
    if (!(await this._needOnline())) return;

    const body = { fromUid: state.user.id, fromNick: state.user.nick, item: this._wireItem(item) };
    if (/^player-/.test(target)) body.toUid = target; else body.toNick = target;

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
      Toast.error('Сервер оффлайн! Подарки и обмен работают только с запущенным server/index.js — гайд: меню ⋮ → «Как запустить сервер» (или docs/SERVER_START.md).');
      renderServerStatus();
    }
    return on;
  }
};

/* --------------------------------------------------------------------------
   ИНДИКАТОРЫ И ЗАГРУЗКА
   -------------------------------------------------------------------------- */
function renderServerStatus() {
  const el = $('netServerStatus');
  if (!el) return;
  const online = ServerAPI.isOnline();
  el.innerHTML = online
    ? `<span class="text-emerald-400">●</span> Сервер онлайн — подарки и обмен работают`
    : `<span class="text-rose-400">●</span> Сервер оффлайн — спонсорство работает локально, а для подарков/обмена запусти server/index.js (гайд в <b>docs/SERVER_START.md</b>)`;
  const chip = $('netServerChip');
  if (chip) {
    chip.textContent = online ? 'ОНЛАЙН' : 'ОФФЛАЙН';
    chip.className = 'text-[8px] font-black px-1.5 py-0.5 rounded uppercase ' + (online
      ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/40'
      : 'bg-rose-500/15 text-rose-300 border border-rose-500/40');
  }
}

function updateNetBadge(count) {
  const dot = $('netplayDot');
  if (!dot) return;
  dot.classList.toggle('hidden', !count);
  dot.textContent = count > 9 ? '9+' : count;
}

/* Админка: адрес сервера + выдача кодов авторов */
function adminSaveServerUrl() {
  const input = $('adminServerUrl');
  ServerAPI.setManual(input ? input.value : '');
  Toast.info('Адрес сервера сохранён. Проверяю связь...');
  ServerAPI.ping(true).then(on => {
    Toast[on ? 'gold' : 'error'](on ? 'Сервер отвечает! Онлайн-функции активны 🚀' : 'Не отвечает. Проверь: сервер запущен? адрес верный?');
    renderServerStatus();
  });
}

async function adminIssueAuthorCode() {
  const ownerUid = ($('adminCodeOwnerUid').value || '').trim();
  const ownerName = ($('adminCodeOwnerName').value || '').trim();
  const code = ($('adminCodeValue').value || '').trim().toUpperCase();
  if (!ownerUid || !ownerName) { Toast.error('Заполни id аккаунта и ник владельца кода'); return; }

  if (await ServerAPI.ping(true)) {
    const secret = localStorage.getItem('shkola_admin_secret') || 'david-admin-1337';
    const { status, data } = await ServerAPI.req('POST', '/api/admin/author-codes', { ownerUid, ownerName, code }, { 'x-admin-secret': secret });
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
  if (urlInput && ServerAPI.base() !== location.origin) urlInput.value = ServerAPI.base();
  renderAdminAuthorList();

  ServerAPI.ping(true).then(async on => {
    if (!on) return;
    if (state.user) ServerAPI.req('POST', '/api/auth/sync', { uid: state.user.id, nick: state.user.nick }).catch(() => {});
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
