/* ==========================================================================
   ШКОЛА ДРОП — js/bottle.js
   Мини-игра «Бутылочка» (Bottle spin): выложи скины на стол, отметь ставку,
   крути бутылочку — если она укажет на скин дороже ставки, забираешь выигрыш.

   Как это встроено в проект:
     • конфиг (BOTTLE_CONFIG) и запись в MINI_GAMES лежат в js/config.js;
     • рандом — общий криптографический RNG.float() из js/ui.js. Точка
       остановки (угол) считается ДО запуска вращения, как точка краша в
       «Ракете»: подкрутить по ходу нельзя, остановка равновероятна (1/K);
     • инвентарь меняется ровно так же, как в ядре (splice по uid — как в
       апгрейдере/продаже), деньги — только через addMoney() из ядра;
     • иконка бутылочки — встроенный SVG из js/icons.js (никаких системных
       эмодзи в интерфейсе);
     • звуки — SoundEngine (playTick/playWin/playLoss).

   Механика:
     • выложи 2–6 предметов (они снимаются с рюкзака на время вращения);
     • отметь один из них СТАВКОЙ;
     • бутылочка равновероятно останавливается на одном из предметов:
         цена выпавшего > цена ставки → ВЫИГРЫШ: всё возвращается, а разница
         цен начисляется деньгами;
         иначе (в т.ч. на самой ставке) → ПРОИГРЫШ: ставка сгорает.
   Фазы: idle → spinning → (won | lost) → idle.
   ========================================================================== */

const BottleGame = {
  /* ---------- Состояние раунда ---------- */
  phase: 'idle',        // 'idle' | 'spinning' | 'won' | 'lost'
  spinning: false,
  table: [],            // выложенные предметы (ссылки на объекты из рюкзака)
  betUid: '',           // uid предмета-ставки
  landedIndex: -1,      // на какой сектор указала бутылочка (определяется на старте)
  landedAngle: 0,       // угол остановки (0..360, по часовой от «12 часов»)
  landed: null,         // предмет, на который указала бутылочка
  bonus: 0,             // денежный выигрыш последнего вращения
  angle: 0,             // текущий угол поворота бутылочки
  startWall: 0,         // время старта (Date.now — вращение честно идёт и в фоне)
  lastTick: 0,          // когда последний раз «тикала» бутылочка
  resetTimer: 0,        // таймаут возврата в idle после результата
  _raf: 0,
  _frame: null,
  _bound: false,
  _inited: false,

  /* ======================================================================
     ИНИЦИАЛИЗАЦИЯ
     ====================================================================== */
  init() {
    if (this._inited) return;
    this._inited = true;
    this._frame = () => this.frame();

    const pick = $('bottlePick');
    if (pick) pick.addEventListener('click', e => {
      const row = e.target.closest('[data-uid]');
      if (!row || this.spinning) return;
      this.toggleItem(row.getAttribute('data-uid'));
    });

    const table = $('bottleTable');
    if (table) table.addEventListener('click', e => {
      const slot = e.target.closest('.bottle-slot[data-uid]');
      if (!slot || this.spinning) return;
      this.setBet(slot.getAttribute('data-uid'));
    });

    if (typeof Icons !== 'undefined') {
      Icons.hydrate($('viewBottle'));
      Icons.hydrate($('gamesModal'));
    }

    if (!this._bound) {
      this._bound = true;
      const onResize = () => { if (this.isVisible()) this.layout(); };
      window.addEventListener('resize', onResize);
      window.addEventListener('orientationchange', onResize);
      try {
        if (typeof ResizeObserver === 'function') {
          new ResizeObserver(onResize).observe($('bottleTable') || document.body);
        }
      } catch (e) {}
      try {
        if (typeof MutationObserver === 'function' && $('viewBottle')) {
          new MutationObserver(() => { if (this.isVisible()) { this.layout(); this.render(); } })
            .observe($('viewBottle'), { attributes: true, attributeFilter: ['class'] });
        }
      } catch (e) {}
    }

    this.layout();
    this.renderStats();
    this.renderHistory();
    this.render();
  },

  isVisible() {
    const v = $('viewBottle');
    return !!(v && !v.classList.contains('hidden'));
  },

  /** Вызывается из switchTab при переходе на вкладку бутылочки */
  onShow() {
    if (!this._inited) this.init();
    else { this.layout(); this.renderStats(); this.render(); }
  },

  /* ======================================================================
     ГЕОМЕТРИЯ СТОЛА
     ====================================================================== */
  radius() {
    const table = $('bottleTable');
    const w = table ? (table.clientWidth || table.getBoundingClientRect().width || 320) : 320;
    return Math.max(90, Math.round(w / 2 - 48));
  },

  layout() {
    const table = $('bottleTable');
    if (!table) return;
    const r = this.radius();
    table.style.setProperty('--r', `${r}px`);
    const len = Math.round(r * 1.7);
    const b = $('bottleBottle');
    if (b && typeof Icons !== 'undefined') {
      b.style.width = `${len}px`;
      b.style.height = `${len}px`;
      b.style.margin = `${-Math.round(len / 2)}px 0 0 ${-Math.round(len / 2)}px`;
      b.innerHTML = Icons.svg('bottle', { size: len, stroke: 0.55 });
    }
    this._applyAngle();
  },

  _applyAngle() {
    const b = $('bottleBottle');
    if (b) b.style.transform = `rotate(${this.angle.toFixed(2)}deg)`;
  },

  /* ======================================================================
     ВЫБОР ПРЕДМЕТОВ И СТАВКИ
     ====================================================================== */
  /** Предмет из рюкзака по uid */
  findInInventory(uid) {
    return state.inventory.find(it => it && it.uid === uid) || null;
  },

  itemOnTable(uid) {
    return this.table.some(it => it && it.uid === uid);
  },

  /** Добавить/убрать предмет со стола */
  toggleItem(uid) {
    if (this.spinning || this.phase === 'spinning') return;
    if (this.itemOnTable(uid)) {
      this.table = this.table.filter(it => it.uid !== uid);
      if (this.betUid === uid) this.betUid = '';
      audio.init(); audio.playTick();
    } else {
      if (this.table.length >= BOTTLE_CONFIG.maxItems) {
        Toast.error(`На стол помещается не больше ${BOTTLE_CONFIG.maxItems} предметов`);
        return;
      }
      const item = this.findInInventory(uid);
      if (!item) { this.render(); return; }
      this.table.push(item);
      audio.init(); audio.playTick();
    }
    this.autoBet();
    this.render();
  },

  /** Назначить ставку (коснулись слота на столе) */
  setBet(uid) {
    if (this.spinning || this.phase === 'spinning') return;
    if (!this.itemOnTable(uid)) return;
    this.betUid = uid;
    audio.init(); audio.playTick();
    this.render();
  },

  /** Если ставка не выбрана/исчезла — ставим самый дешёвый предмет (по умолчанию) */
  autoBet() {
    if (!this.table.length) { this.betUid = ''; return; }
    if (this.betUid && this.itemOnTable(this.betUid)) return;
    let cheapest = this.table[0];
    for (const it of this.table) if (it.price < cheapest.price) cheapest = it;
    this.betUid = cheapest.uid;
  },

  /** Очистить стол */
  clearTable() {
    if (this.spinning) return;
    this.table = [];
    this.betUid = '';
    this.landedIndex = -1;
    this.landed = null;
    this.render();
  },

  /* ======================================================================
     ПРОВЕРКА ПЕРЕД ВРАЩЕНИЕМ
     ====================================================================== */
  betItem() {
    return this.table.find(it => it.uid === this.betUid) || null;
  },

  /** Есть ли на столе предмет дороже ставки (иначе выиграть невозможно) */
  winPossible() {
    const bet = this.betItem();
    if (!bet) return false;
    return this.table.some(it => it.price > bet.price);
  },

  readTable() {
    if (this.table.length < BOTTLE_CONFIG.minItems) {
      return { ok: false, error: `Выложи на стол хотя бы ${BOTTLE_CONFIG.minItems} предмета` };
    }
    if (this.table.length > BOTTLE_CONFIG.maxItems) {
      return { ok: false, error: `На столе не больше ${BOTTLE_CONFIG.maxItems} предметов` };
    }
    const bet = this.betItem();
    if (!bet) {
      return { ok: false, error: 'Отметь ставку — коснись предмета на столе' };
    }
    if (!this.winPossible()) {
      return { ok: false, error: 'Ставка — самый дорогой предмет на столе: выиграть невозможно. Отметь ставкой предмет подешевле' };
    }
    // Все предметы ещё должны лежать в рюкзаке (могли продать в другой вкладке)
    for (const it of this.table) {
      if (!this.findInInventory(it.uid)) {
        return { ok: false, error: 'Один из предметов уже не в рюкзаке — собери стол заново' };
      }
    }
    return { ok: true };
  },

  /* ======================================================================
     ВРАЩЕНИЕ
     ====================================================================== */
  spin() {
    if (this.spinning) return;                          // уже крутим — игнорим двойной тап
    if (this.phase !== 'idle') return;
    if (typeof state === 'undefined' || !state.stats) return;

    const parsed = this.readTable();
    if (!parsed.ok) {
      audio.init(); audio.playTick();
      Toast.error(parsed.error);
      return;
    }

    audio.init();

    // 1. Фиксируем точку остановки ДО запуска (честно, как точка краша в «Ракете»)
    const seg = 360 / this.table.length;
    this.landedAngle = RNG.float() * 360;               // равновероятная остановка
    this.landedIndex = Math.min(this.table.length - 1, Math.floor(this.landedAngle / seg));
    this.landed = this.table[this.landedIndex];
    this.bonus = 0;
    this.angle = 0;
    this.startWall = Date.now();
    this.lastTick = 0;
    clearTimeout(this.resetTimer);

    // 2. Снимаем выложенные предметы с рюкзака (ставка) — ровно один раз
    for (const it of this.table) {
      const idx = state.inventory.findIndex(x => x && x.uid === it.uid);
      if (idx !== -1) state.inventory.splice(idx, 1);
    }

    // 3. Статистика и опыт
    state.stats.bottleSpins = (state.stats.bottleSpins || 0) + 1;
    if (typeof addXp === 'function') addXp(XP_REWARDS.bottleSpin || 4, { silent: true });

    // 4. Поехали
    this.phase = 'spinning';
    this.spinning = true;
    audio.playTick();
    haptic(16);
    this.render();
    persist(true);
    this.startLoop();
  },

  /** Завершение вращения (вызывается из frame, когда бутылочка доехала) */
  resolve() {
    if (!this.spinning) return;
    this.spinning = false;
    this.stopLoop();

    const bet = this.betItem();
    const landed = this.landed || this.table[this.landedIndex] || null;
    const won = !!(landed && bet && landed.price > bet.price);
    this.bonus = won ? (landed.price - bet.price) : 0;
    this.phase = won ? 'won' : 'lost';
    this.angle = BOTTLE_CONFIG.fullSpins * 360 + this.landedAngle;
    this._applyAngle();

    const s = state.stats;
    if (won) {
      addMoney(this.bonus, { countEarned: true });
      s.bottleWins = (s.bottleWins || 0) + 1;
      s.bottleWon = (s.bottleWon || 0) + this.bonus;
      s.bottleBestWin = Math.max(s.bottleBestWin || 0, this.bonus);
      if (typeof addXp === 'function') addXp(XP_REWARDS.bottleWin || 12, { silent: true });
      audio.playWin();
      haptic([20, 30, 20]);
      Fx.burst(70, ['#34d399', '#a7f3d0', '#facc15']);
      Toast.success(`Бутылочка указала на «${escapeHtml(landed.name)}» — дороже ставки! Все предметы вернулись, +${fmt(this.bonus)} ₽`, 4400);
      this.returnTable(null);                          // возвращаем всё
    } else {
      s.bottleLosses = (s.bottleLosses || 0) + 1;
      audio.playLoss();
      haptic([30, 40, 60]);
      Toast.error(`Бутылочка указала на «${escapeHtml(landed ? landed.name : '?')}» — не дороже ставки. Ставка «${escapeHtml(bet ? bet.name : '?')}» сгорела.`, 4400);
      this.returnTable(bet ? bet.uid : null);          // возвращаем всё, кроме ставки
      // Ставка сгорела — убираем её со стола
      if (bet) this.table = this.table.filter(it => it.uid !== bet.uid);
      this.betUid = '';
    }

    this.pushHistory(landed ? landed.price : 0, won);
    if (typeof checkAchievements === 'function') checkAchievements();
    this.renderStats();
    this.renderHistory();
    this.render();
    persist(true);

    clearTimeout(this.resetTimer);
    this.resetTimer = setTimeout(() => {
      if (this.spinning) return;
      this.phase = 'idle';
      this.landedIndex = -1;
      this.landed = null;
      this.bonus = 0;
      this.autoBet();
      this.render();
    }, 2400);
  },

  /** Вернуть выложенные предметы в рюкзак (кроме exceptUid — сгоревшей ставки) */
  returnTable(exceptUid) {
    for (const it of this.table) {
      if (!it || it.uid === exceptUid) continue;
      if (!this.findInInventory(it.uid)) state.inventory.push(it);
    }
  },

  pushHistory(price, win) {
    if (!state.stats.bottleHistory) state.stats.bottleHistory = [];
    state.stats.bottleHistory.unshift({ price: Math.floor(Number(price) || 0), win: !!win });
    state.stats.bottleHistory = state.stats.bottleHistory.slice(0, BOTTLE_CONFIG.historySize);
  },

  /* ======================================================================
     ИГРОВОЙ ЦИКЛ
     ====================================================================== */
  startLoop() {
    this.stopLoop();
    this._raf = requestAnimationFrame(this._frame);
  },

  stopLoop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  },

  frame() {
    if (!this.spinning) return;
    const elapsed = (Date.now() - this.startWall) / 1000;
    const p = clamp(elapsed / BOTTLE_CONFIG.spinDurationSec, 0, 1);
    const eased = 1 - Math.pow(1 - p, 4);              // плавное замедление к остановке
    const total = BOTTLE_CONFIG.fullSpins * 360 + this.landedAngle;
    this.angle = eased * total;
    this._applyAngle();

    const now = Date.now();
    if (now - this.lastTick > BOTTLE_CONFIG.tickMs) {
      this.lastTick = now;
      audio.playTick();
    }

    if (p >= 1) { this.resolve(); return; }
    this._raf = requestAnimationFrame(this._frame);
  },

  /* ======================================================================
     ИНТЕРФЕЙС
     ====================================================================== */
  render() {
    this.renderPicker();
    this.renderWheel();

    const btn = $('btnBottleSpin');
    if (btn) {
      btn.disabled = this.spinning || this.phase !== 'idle';
      const label = $('bottleSpinLabel');
      if (label) {
        label.textContent = this.spinning ? 'КРУТИМ...'
          : this.phase === 'won' ? 'ВЫИГРЫШ!'
            : this.phase === 'lost' ? 'ПРОИГРЫШ'
              : 'КРУТИТЬ БУТЫЛОЧКУ';
      }
    }

    const status = $('bottleStatusText');
    if (status) {
      if (this.spinning) {
        status.textContent = 'Бутылочка крутится… точка остановки уже определена честно';
        status.className = 'text-[10px] text-emerald-300';
      } else if (this.phase === 'won') {
        status.textContent = `Указала на «${escapeHtml(this.landed ? this.landed.name : '')}» · +${fmt(this.bonus)} ₽`;
        status.className = 'text-[10px] text-emerald-300 font-bold';
      } else if (this.phase === 'lost') {
        status.textContent = 'Указала не на дороже ставки — ставка сгорела';
        status.className = 'text-[10px] text-rose-300 font-bold';
      } else {
        status.textContent = this.table.length < BOTTLE_CONFIG.minItems
          ? `Выбери ${BOTTLE_CONFIG.minItems}–${BOTTLE_CONFIG.maxItems} предметов и отметь ставку`
          : 'Готово! Крути бутылочку';
        status.className = 'text-[10px] text-slate-400';
      }
    }

    const betInfo = $('bottleBetInfo');
    if (betInfo) {
      const bet = this.betItem();
      if (bet) {
        const canWin = this.winPossible();
        betInfo.innerHTML = canWin
          ? `Ставка: <b class="text-amber-300">${escapeHtml(bet.name)}</b> · ${fmt(bet.price)} ₽ · выиграешь, если бутылочка укажет на предмет дороже`
          : `Ставка: <b class="text-rose-300">${escapeHtml(bet.name)}</b> · ${fmt(bet.price)} ₽ · дороже на столе нет — выигрыш невозможен`;
      } else {
        betInfo.textContent = this.table.length
          ? 'Ставка не выбрана — коснись предмета на столе, чтобы назначить его ставкой.'
          : 'Ставка не выбрана — сначала выложи предметы на стол.';
      }
    }
  },

  renderPicker() {
    const box = $('bottlePick');
    if (!box) return;
    const placed = this.table.map(it => it.uid);
    if (!state.inventory.length) {
      box.innerHTML = '<div class="text-[10px] text-slate-500 text-center py-3">Рюкзак пуст — открой пару кейсов, чтобы было что ставить</div>';
    } else {
      box.innerHTML = state.inventory.map(it => {
        const on = placed.indexOf(it.uid) !== -1;
        const rarity = rarityOf(it);
        return `<button type="button" data-uid="${escapeHtml(it.uid)}"
                  class="bottle-pick-row ${on ? 'bottle-pick-row-on' : ''}" style="--rc:${rarity.color}">
          ${renderItemMedia(it, 'w-9 h-9 text-xl')}
          <span class="flex-1 min-w-0 text-left">
            <b class="block text-[10px] text-slate-200 truncate">${escapeHtml(it.name)}</b>
            <small class="block text-[9px]" style="color:${rarity.color}">${shortMoney(it.price)} ₽ · ${escapeHtml(rarity.short)}</small>
          </span>
          <span class="bottle-pick-mark">${on ? 'на столе' : '+'}</span>
        </button>`;
      }).join('');
    }
    const info = $('bottleCountInfo');
    if (info) info.textContent = `выбрано ${this.table.length} / ${BOTTLE_CONFIG.maxItems}`;
  },

  renderWheel() {
    const slots = $('bottleSlots');
    if (!slots) return;
    const K = this.table.length;
    if (!K) {
      slots.innerHTML = '<div class="bottle-table-empty">Стол пуст — выбери предметы ниже</div>';
      return;
    }
    const seg = 360 / K;
    slots.innerHTML = this.table.map((it, i) => {
      const a = (i + 0.5) * seg;
      const isBet = this.betUid === it.uid;
      const isLanded = (this.phase === 'won' || this.phase === 'lost') && i === this.landedIndex;
      const rarity = rarityOf(it);
      const cls = [
        'bottle-slot',
        isBet ? 'bottle-slot-bet' : '',
        isLanded && this.phase === 'won' ? 'bottle-slot-win' : '',
        isLanded && this.phase === 'lost' ? 'bottle-slot-lose' : ''
      ].filter(Boolean).join(' ');
      return `<div class="${cls}" data-uid="${escapeHtml(it.uid)}" style="--a:${a.toFixed(2)}deg; --rc:${rarity.color}">
        ${renderItemMedia(it, 'w-8 h-8 text-lg')}
        <span class="bottle-slot-name">${escapeHtml(it.name)}</span>
        <span class="bottle-slot-price">${shortMoney(it.price)} ₽</span>
        ${isBet ? '<span class="bottle-slot-badge">СТАВКА</span>' : ''}
      </div>`;
    }).join('');
  },

  renderStats() {
    const s = state.stats;
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set('bottleSpinsStat', fmt(s.bottleSpins || 0));
    set('bottleWinsStat', fmt(s.bottleWins || 0));
    set('bottleLossesStat', fmt(s.bottleLosses || 0));
    set('bottleBestWinStat', `${shortMoney(s.bottleBestWin || 0)} ₽`);
    const totalEl = $('bottleWonStat');
    if (totalEl) {
      const v = s.bottleWon || 0;
      totalEl.textContent = `${v >= 0 ? '+' : ''}${shortMoney(v)} ₽`;
      totalEl.className = 'stat-tile-value ' + (v >= 0 ? 'text-emerald-400' : 'text-rose-400');
    }
  },

  renderHistory() {
    const box = $('bottleHistoryList');
    if (!box) return;
    const list = state.stats.bottleHistory || [];
    if (!list.length) {
      box.innerHTML = '<span class="text-[10px] text-slate-500">История пуста — крутни бутылочку</span>';
      return;
    }
    box.innerHTML = list.map(h => {
      const win = !!(h && h.win);
      const price = Number(h && h.price ? h.price : 0);
      return `<span class="crash-history-chip ${win ? 'crash-history-win' : 'crash-history-boom'}">${shortMoney(price)} ₽</span>`;
    }).join('');
  }
};

/* Глобальные обёртки для onclick в HTML */
function bottleSpin() { BottleGame.spin(); }
function bottleClearTable() { BottleGame.clearTable(); }
