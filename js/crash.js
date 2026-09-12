/* ==========================================================================
   ШКОЛА ДРОП — js/crash.js
   Мини-игра «Ракета» (Crash): ставка → ракета растёт по экспоненте → успей
   забрать выигрыш до взрыва.

   Как это встроено в проект:
     • математика (CRASH_CONFIG, crashPointFromRoll, crashMultiplierAt,
       crashPayout) лежит в js/config.js — чистая, без DOM, её гоняют тесты;
     • рандом — общий криптографический RNG.float() из js/ui.js (не Math.random);
     • деньги — только через spendMoney()/addMoney() из ядра, статистика и
       достижения — через state.stats / checkAchievements();
     • звуки — методы SoundEngine (playRocketLaunch/playCrashBoom/playCashout);
     • игра сама регистрируется в меню «Игры» реестром MINI_GAMES (js/config.js).

   Фазы раунда: idle → flying → (cashed | crashed) → idle.
   Все переключения фаз — только через setPhase(), ввод блокируется на время
   полёта, повторный старт из flying невозможен (защита от двойного списания).
   ========================================================================== */

const CrashGame = {
  /* ---------- Состояние раунда ---------- */
  phase: 'idle',        // 'idle' | 'flying' | 'cashed' | 'crashed'
  bet: 0,               // ставка текущего раунда (уже списана с баланса)
  autoX: 0,             // автовывод: 0 = выключен
  crashAt: 0,           // точка краша (определяется на старте, до полёта)
  mult: 1,              // текущий множитель
  startWall: 0,         // время старта (Date.now — раунд честно идёт в фоне)
  lastTickSound: 0,     // когда последний раз пищали (тик полёта)
  resetTimer: 0,        // таймаут возврата кнопок после раунда

  /* ---------- Канвас ---------- */
  canvas: null,
  ctx: null,
  dpr: 1,
  stars: [],
  particles: [],
  _raf: 0,
  _frame: null,
  _resizeBound: false,

  /* ======================================================================
     ИНИЦИАЛИЗАЦИЯ
     ====================================================================== */
  init() {
    this.canvas = $('crashCanvas');
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this._frame = ts => this.frame(ts);

    this.bindInputs();
    this.buildQuickButtons();
    this.resize();
    this.renderStats();
    this.renderHistory();
    this.render();
    this.draw();

    if (!this._resizeBound) {
      this._resizeBound = true;
      window.addEventListener('resize', () => {
        if (this.isVisible()) { this.resize(); this.draw(); }
      });
      // Панель может появиться уже после инициализации — следим за её видимостью
      if (typeof MutationObserver === 'function' && this.canvas.parentElement) {
        new MutationObserver(() => {
          if (this.isVisible()) { this.resize(); this.draw(); }
        }).observe($('viewCrash') || this.canvas.parentElement, { attributes: true, attributeFilter: ['class'] });
      }
    }
  },

  /** Панель ракеты сейчас на экране? */
  isVisible() {
    const v = $('viewCrash');
    return !!(v && !v.classList.contains('hidden'));
  },

  /** Вызывается из switchTab при переходе на вкладку ракеты */
  onShow() {
    if (!this.ctx) this.init();
    else { this.resize(); this.render(); this.draw(); }
  },

  bindInputs() {
    const bet = $('crashBetInput');
    const auto = $('crashAutoInput');
    if (bet) {
      bet.addEventListener('input', () => this.render());
      bet.addEventListener('keydown', e => { if (e.key === 'Enter') this.start(); });
    }
    if (auto) {
      auto.addEventListener('input', () => this.render());
      auto.addEventListener('keydown', e => { if (e.key === 'Enter') this.start(); });
    }
  },

  /** Кнопки быстрой ставки и быстрого автовывода — из конфига */
  buildQuickButtons() {
    const bets = $('crashQuickBets');
    if (bets && CRASH_CONFIG.quickBets) {
      bets.innerHTML = CRASH_CONFIG.quickBets.map(v =>
        `<button type="button" data-bet="${v}" class="filter-chip">${shortMoney(v)} ₽</button>`
      ).join('') + `<button type="button" data-bet="half" class="filter-chip">½</button>` +
        `<button type="button" data-bet="x2" class="filter-chip">×2</button>` +
        `<button type="button" data-bet="max" class="filter-chip">MAX</button>`;
      bets.querySelectorAll('[data-bet]').forEach(btn => {
        btn.addEventListener('click', () => this.applyQuickBet(btn.dataset.bet));
      });
    }
    const autos = $('crashQuickAuto');
    if (autos && CRASH_CONFIG.quickAuto) {
      autos.innerHTML = CRASH_CONFIG.quickAuto.map(v =>
        `<button type="button" data-auto="${v}" class="filter-chip">${v}×</button>`
      ).join('') + `<button type="button" data-auto="0" class="filter-chip">выкл</button>`;
      autos.querySelectorAll('[data-auto]').forEach(btn => {
        btn.addEventListener('click', () => this.setAuto(Number(btn.dataset.auto)));
      });
    }
  },

  /* ======================================================================
     ГЕОМЕТРИЯ КАНВАСА
     ====================================================================== */
  resize() {
    const cv = this.canvas;
    if (!cv) return;
    const rect = cv.getBoundingClientRect();
    const w = Math.max(220, Math.round(rect.width || 320));
    const h = Math.max(150, Math.round(rect.height || 200));
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(w * this.dpr);
    cv.height = Math.round(h * this.dpr);
    this.w = w;
    this.h = h;
    if (this.ctx) this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.makeStars();
  },

  makeStars() {
    const n = typeof Quality !== 'undefined' && Quality.isLow() ? 22 : 48;
    this.stars = [];
    for (let i = 0; i < n; i++) {
      this.stars.push({
        x: Math.random(), y: Math.random(),
        r: 0.6 + Math.random() * 1.2,
        a: 0.25 + Math.random() * 0.6
      });
    }
  },

  /** Множитель → вертикаль (логарифмическая шкала: 50× = потолок) */
  yFor(mult, h, pad) {
    const top = 50;
    const norm = Math.log(Math.max(1, mult)) / Math.log(top);
    return h - pad - Math.min(1, norm) * (h - pad * 2);
  },

  /** Время полёта → горизонталь (окно в 9 секунд, потом график «едет») */
  xFor(t, now, w, pad) {
    const win = 9;
    const from = Math.max(0, now - win);
    const span = Math.min(win, now || win);
    return pad + ((t - from) / span) * (w - pad * 2);
  },

  /* ======================================================================
     ВВОД ИГРОКА
     ====================================================================== */
  parseNum(input) {
    return Number(String((input || {}).value || '').replace(/\s/g, '').replace(',', '.'));
  },

  applyQuickBet(kind) {
    const betEl = $('crashBetInput');
    if (!betEl) return;
    const cur = this.parseNum(betEl) || 0;
    let next = cur;
    if (kind === 'max') next = Math.floor(state.balance);
    else if (kind === 'half') next = Math.floor(cur > 0 ? cur / 2 : state.balance / 2);
    else if (kind === 'x2') next = Math.floor(cur > 0 ? cur * 2 : CRASH_CONFIG.minBet);
    else next = Number(kind) || 0;
    next = Math.max(0, Math.min(next, Math.floor(state.balance), CRASH_CONFIG.maxBet));
    betEl.value = next > 0 ? String(next) : '';
    audio.init(); audio.playTick();
    this.render();
  },

  setAuto(x) {
    const el = $('crashAutoInput');
    if (!el) return;
    el.value = x ? String(x) : '';
    audio.init(); audio.playTick();
    this.render();
  },

  /** Читает и проверяет поля. Ничего не списывает. */
  readInputs() {
    const bet = Math.floor(this.parseNum($('crashBetInput')));
    const auto = Number(this.parseNum($('crashAutoInput')));

    if (!isFinite(bet) || bet <= 0) return { ok: false, error: 'Введи ставку — сколько ставишь на ракету?' };
    if (bet < CRASH_CONFIG.minBet) return { ok: false, error: `Минимальная ставка — ${fmt(CRASH_CONFIG.minBet)} ₽` };
    if (bet > CRASH_CONFIG.maxBet) return { ok: false, error: `Максимальная ставка — ${shortMoney(CRASH_CONFIG.maxBet)} ₽` };
    if (bet > state.balance) return { ok: false, error: `Не хватает денег: на балансе ${fmt(state.balance)} ₽` };

    if (isFinite(auto) && auto > 0) {
      if (auto < CRASH_CONFIG.minAutoCashout) return { ok: false, error: `Автовывод — минимум ${CRASH_CONFIG.minAutoCashout.toFixed(2)}×` };
      if (auto > CRASH_CONFIG.maxAutoCashout) return { ok: false, error: 'Автовывод слишком большой — поставь меньше' };
    }
    return { ok: true, bet, autoX: (isFinite(auto) && auto > 0) ? auto : 0 };
  },

  /* ======================================================================
     РАУНД
     ====================================================================== */
  start() {
    if (this.phase === 'flying') return;                 // уже летим — игнорим двойной тап
    if (this.phase !== 'idle') return;                   // ждём, пока отыграет прошлый раунд
    if (typeof state === 'undefined' || !state.stats) return;

    const parsed = this.readInputs();
    if (!parsed.ok) {
      audio.init(); audio.playTick();
      Toast.error(parsed.error);
      return;
    }

    audio.init();

    // 1. Фиксируем параметры раунда
    this.bet = parsed.bet;
    this.autoX = parsed.autoX;
    this.crashAt = crashPointFromRoll(RNG.float());      // точка краша — ДО старта
    this.mult = 1;
    this.startWall = Date.now();
    this.lastTickSound = 0;
    this.particles = [];
    clearTimeout(this.resetTimer);

    // 2. Списание ставки — ровно один раз за раунд
    spendMoney(this.bet);
    state.stats.crashRounds = (state.stats.crashRounds || 0) + 1;
    state.stats.crashWagered = (state.stats.crashWagered || 0) + this.bet;
    if (typeof addXp === 'function') addXp(XP_REWARDS.crashRound || 4, { silent: true });

    // 3. Полетели
    this.setPhase('flying');
    audio.playRocketLaunch();
    haptic(18);
    this.render();
    this.startLoop();
  },

  /** Забрать выигрыш (auto = сработал автовывод). */
  cashout(auto = false) {
    if (this.phase !== 'flying') return;

    // Автовывод срабатывает ровно на целевом множителе
    const mult = this.autoX && auto ? this.autoX : this.mult;
    const payout = crashPayout(this.bet, mult);
    const profit = payout - this.bet;

    this.mult = mult;
    this.setPhase('cashed');

    addMoney(payout, { countEarned: true });
    state.stats.crashWins = (state.stats.crashWins || 0) + 1;
    state.stats.crashWon = (state.stats.crashWon || 0) + payout;
    state.stats.crashBestMult = Math.max(state.stats.crashBestMult || 0, mult);
    state.stats.crashBestWin = Math.max(state.stats.crashBestWin || 0, payout);
    if (typeof addXp === 'function') addXp(XP_REWARDS.crashWin || 12, { silent: true });

    audio.playCashout();
    haptic(24);
    if (mult >= 10) Fx.gold(180); else Fx.burst(70, ['#22c55e', '#a3e635', '#facc15']);

    Toast.success(
      `🚀 Забрал на <b>${mult.toFixed(2)}×</b>: +${fmt(payout)} ₽` +
      `${profit > 0 ? ` (чистыми +${fmt(profit)} ₽)` : ''}${auto ? ' · автовывод' : ''}`, 4200
    );
    this.pushHistory(mult, true);
    this.finishRound();
  },

  /** Ракета взорвалась — ставка сгорела. */
  explode() {
    this.mult = this.crashAt;
    this.setPhase('crashed');

    state.stats.crashLosses = (state.stats.crashLosses || 0) + 1;
    audio.playCrashBoom();
    haptic([30, 40, 60]);
    this.spawnParticles();
    Fx.thunder();

    Toast.error(`💥 <b>ВЗРЫВ на ${this.crashAt.toFixed(2)}×</b> — ставка ${fmt(this.bet)} ₽ сгорела. Попробуй ещё раз!`, 4200);
    this.pushHistory(this.crashAt, false);
    this.finishRound();
  },

  /** Общий хвост раунда: достижения, сохранение, возврат кнопок. */
  finishRound() {
    if (typeof checkAchievements === 'function') checkAchievements();
    this.renderStats();
    this.renderHistory();
    this.render();
    persist(true);

    // Небольшая пауза, чтобы игрок увидел результат, потом — новая ставка
    clearTimeout(this.resetTimer);
    this.resetTimer = setTimeout(() => {
      if (this.phase === 'flying') return;     // на всякий случай
      this.phase = 'idle';
      this.mult = 1;
      this.render();
      this.draw();
    }, 1800);
  },

  setPhase(phase) {
    this.phase = phase;
    const stage = $('crashStage');
    if (stage) {
      stage.classList.toggle('crash-stage-flying', phase === 'flying');
      stage.classList.toggle('crash-stage-win', phase === 'cashed');
      stage.classList.toggle('crash-stage-boom', phase === 'crashed');
    }
  },

  pushHistory(x, win) {
    if (!state.stats.crashHistory) state.stats.crashHistory = [];
    state.stats.crashHistory.unshift({ x: Number(x.toFixed(2)), win: !!win });
    state.stats.crashHistory = state.stats.crashHistory.slice(0, CRASH_CONFIG.historySize);
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
    const now = (Date.now() - this.startWall) / 1000;   // реальное время: раунд честно идёт и в фоне

    if (this.phase === 'flying') {
      const m = crashMultiplierAt(now);

      // Автовывод срабатывает первым: он «забирает» на своём множителе
      if (this.autoX && m >= this.autoX) {
        this.mult = m;
        this.draw();
        this.cashout(true);
        return;
      }
      if (m >= this.crashAt) {
        this.explode();
        return;
      }
      this.mult = m;

      // Тик высоты: раз в ~130 мс, чтобы не превращать полёт в трещотку
      const t = Date.now();
      if (t - this.lastTickSound > 130) {
        this.lastTickSound = t;
        audio.playCrashTick(this.mult);
      }
      this.updateHud();
    }

    this.updateParticles();
    this.draw();

    // Крутимся, пока летим или пока не догорят частицы взрыва
    if (this.phase === 'flying' || this.particles.length) {
      this._raf = requestAnimationFrame(this._frame);
    } else {
      this._raf = 0;
    }
  },

  /* ======================================================================
     ЧАСТИЦЫ ВЗРЫВА
     ====================================================================== */
  spawnParticles() {
    const low = typeof Quality !== 'undefined' && Quality.isLow();
    const n = low ? 16 : 40;
    if (document.body.classList.contains('no-motion')) return;
    const pad = 26;
    const x = this.xFor(crashTimeToMultiplier(this.crashAt), crashTimeToMultiplier(this.crashAt), this.w, pad);
    const y = this.yFor(this.crashAt, this.h, pad);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * (low ? 90 : 180);
      this.particles.push({
        x, y,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 30,
        life: 1, size: 1.5 + Math.random() * 3.2,
        color: ['#ff4d4d', '#ff8c1a', '#ffd166', '#94a3b8'][Math.floor(Math.random() * 4)]
      });
    }
  },

  updateParticles() {
    if (!this.particles.length) return;
    const dt = 1 / 60;
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 210 * dt;      // gravity
      p.life -= dt * 1.15;
    }
    this.particles = this.particles.filter(p => p.life > 0);
  },

  /* ======================================================================
     ОТРИСОВКА
     ====================================================================== */
  draw() {
    const ctx = this.ctx;
    if (!ctx) return;
    const w = this.w || 300, h = this.h || 200, pad = 26;
    const crashed = this.phase === 'crashed';
    const won = this.phase === 'cashed';

    ctx.clearRect(0, 0, w, h);

    /* Небо */
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    if (crashed) { sky.addColorStop(0, '#2a0a12'); sky.addColorStop(1, '#12060a'); }
    else if (won) { sky.addColorStop(0, '#04160f'); sky.addColorStop(1, '#07110c'); }
    else { sky.addColorStop(0, '#070d1c'); sky.addColorStop(1, '#04060e'); }
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    /* Звёзды */
    for (const s of this.stars) {
      ctx.globalAlpha = crashed ? s.a * 0.4 : s.a;
      ctx.fillStyle = '#cbd5e1';
      ctx.beginPath();
      ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    /* Сетка высот: 2× / 5× / 10× / 50× */
    ctx.font = '9px Chakra Petch, sans-serif';
    ctx.textBaseline = 'middle';
    for (const mark of [2, 5, 10, 50]) {
      const y = this.yFor(mark, h, pad);
      if (y < pad - 8 || y > h - pad + 8) continue;
      ctx.strokeStyle = 'rgba(148,163,184,0.16)';
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(pad - 12, y);
      ctx.lineTo(w - pad + 12, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(148,163,184,0.55)';
      ctx.textAlign = 'right';
      ctx.fillText(`${mark}×`, pad - 15, y);
    }

    /* Траектория полёта */
    const tNow = Math.max(0, (Date.now() - this.startWall) / 1000);
    const tEnd = this.phase === 'idle' ? 0 : (this.phase === 'flying' ? tNow : crashTimeToMultiplier(this.mult));
    if (this.phase !== 'idle' && tEnd > 0) {
      const steps = 64;
      const from = Math.max(0, tEnd - 9);
      const color = crashed ? '#ef4444' : (won ? '#22c55e' : '#38bdf8');

      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const t = from + (tEnd - from) * (i / steps);
        const m = crashMultiplierAt(t);
        const px = this.xFor(t, tEnd, w, pad);
        const py = this.yFor(m, h, pad);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.shadowBlur = 0;

      /* Заливка под кривой */
      ctx.lineTo(this.xFor(tEnd, tEnd, w, pad), h - pad);
      ctx.lineTo(this.xFor(from, tEnd, w, pad), h - pad);
      ctx.closePath();
      const fill = ctx.createLinearGradient(0, pad, 0, h);
      fill.addColorStop(0, crashed ? 'rgba(239,68,68,0.22)' : (won ? 'rgba(34,197,94,0.22)' : 'rgba(56,189,248,0.20)'));
      fill.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = fill;
      ctx.fill();
    }

    /* Ракета */
    if (this.phase !== 'idle' && !crashed) {
      const px = this.xFor(tEnd, tEnd, w, pad);
      const py = this.yFor(this.mult, h, pad);

      // Пламя
      if (this.phase === 'flying') {
        const flick = 6 + Math.random() * 8;
        const fl = ctx.createLinearGradient(px, py + 10, px, py + 10 + flick);
        fl.addColorStop(0, 'rgba(255,196,0,0.95)');
        fl.addColorStop(1, 'rgba(255,80,0,0)');
        ctx.fillStyle = fl;
        ctx.beginPath();
        ctx.moveTo(px - 5, py + 8);
        ctx.lineTo(px, py + 10 + flick);
        ctx.lineTo(px + 5, py + 8);
        ctx.closePath();
        ctx.fill();
      }
      ctx.font = '22px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🚀', px, py);
    }

    /* Частицы взрыва */
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * Math.max(0.2, p.life), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    /* Земля */
    ctx.strokeStyle = 'rgba(148,163,184,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad - 12, h - pad);
    ctx.lineTo(w - pad + 12, h - pad);
    ctx.stroke();
  },

  /* ======================================================================
     ИНТЕРФЕЙС
     ====================================================================== */
  updateHud() {
    const mEl = $('crashMultiplier');
    if (mEl) {
      mEl.textContent = `${this.mult.toFixed(2)}×`;
      mEl.className = 'crash-mult ' + (
        this.phase === 'crashed' ? 'crash-mult-boom'
          : this.phase === 'cashed' ? 'crash-mult-win'
            : this.phase === 'flying' ? 'crash-mult-fly' : ''
      );
    }
    const payout = crashPayout(this.bet, this.mult);
    const cashBtn = $('btnCrashCashout');
    const cashLabel = $('crashCashoutLabel');
    if (cashLabel) cashLabel.textContent = `ЗАБРАТЬ ${fmt(payout)} ₽`;
    if (cashBtn) cashBtn.disabled = this.phase !== 'flying';
    const profitEl = $('crashLiveWin');
    if (profitEl) {
      profitEl.textContent = `Выигрыш сейчас: ${fmt(payout)} ₽ (чистыми +${fmt(payout - this.bet)} ₽)`;
    }
  },

  render() {
    const flying = this.phase === 'flying';
    const betEl = $('crashBetInput');
    const autoEl = $('crashAutoInput');
    if (betEl) betEl.disabled = flying;
    if (autoEl) autoEl.disabled = flying;

    const startBtn = $('btnCrashStart');
    if (startBtn) {
      startBtn.disabled = flying || this.phase === 'cashed' || this.phase === 'crashed';
      const label = $('crashStartLabel');
      if (label) {
        label.textContent = flying ? 'В ПОЛЁТЕ...' : (this.phase === 'idle' ? 'ЗАПУСТИТЬ РАКЕТУ' : 'РАУНД ЗАВЕРШЁН');
      }
    }

    const status = $('crashStatusText');
    if (status) {
      if (this.phase === 'idle') {
        status.textContent = this.autoXText()
          ? `Готов к запуску · автовывод на ${this.autoXText()}`
          : 'Готов к запуску';
        status.className = 'text-[10px] text-slate-400';
      } else if (this.phase === 'flying') {
        status.textContent = this.autoX
          ? `Полетели! Заберу автоматически на ${this.autoX.toFixed(2)}×`
          : 'Полетели! Успей забрать до взрыва';
        status.className = 'text-[10px] text-sky-300';
      } else if (this.phase === 'cashed') {
        status.textContent = `✅ Забрал на ${this.mult.toFixed(2)}× · +${fmt(crashPayout(this.bet, this.mult))} ₽`;
        status.className = 'text-[10px] text-emerald-300 font-bold';
      } else {
        status.textContent = `💥 Взрыв на ${this.crashAt.toFixed(2)}× · ставка сгорела`;
        status.className = 'text-[10px] text-rose-300 font-bold';
      }
    }

    const boom = $('crashBoom');
    if (boom) boom.classList.toggle('hidden', this.phase !== 'crashed');

    this.updateHud();
  },

  autoXText() {
    const el = $('crashAutoInput');
    const v = el ? Number(this.parseNum(el)) : 0;
    return isFinite(v) && v > 0 ? `${v}` : '';
  },

  renderStats() {
    const s = state.stats;
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    set('crashRoundsStat', fmt(s.crashRounds || 0));
    set('crashWinsStat', fmt(s.crashWins || 0));
    set('crashLossesStat', fmt(s.crashLosses || 0));
    set('crashBestMultStat', `${(s.crashBestMult || 0).toFixed(2)}×`);
    set('crashBestWinStat', `${shortMoney(s.crashBestWin || 0)} ₽`);
    const wagered = s.crashWagered || 0, won = s.crashWon || 0;
    const net = won - wagered;
    const netEl = $('crashNetStat');
    if (netEl) {
      netEl.textContent = `${net >= 0 ? '+' : ''}${shortMoney(net)} ₽`;
      netEl.className = 'stat-tile-value ' + (net >= 0 ? 'text-emerald-400' : 'text-rose-400');
    }
  },

  renderHistory() {
    const box = $('crashHistoryList');
    if (!box) return;
    const list = state.stats.crashHistory || [];
    if (!list.length) {
      box.innerHTML = '<span class="text-[10px] text-slate-500">История пуста — запусти первую ракету 🚀</span>';
      return;
    }
    box.innerHTML = list.map(h => {
      const x = Number(h && h.x ? h.x : 1);
      const win = !!(h && h.win);
      return `<span class="crash-history-chip ${win ? 'crash-history-win' : 'crash-history-boom'}">${x.toFixed(2)}×</span>`;
    }).join('');
  }
};

/* Глобальные обёртки для onclick в HTML */
function crashStart() { CrashGame.start(); }
function crashCashout() { CrashGame.cashout(false); }
function crashApplyQuickBet(kind) { CrashGame.applyQuickBet(kind); }
function crashSetAuto(x) { CrashGame.setAuto(x); }
