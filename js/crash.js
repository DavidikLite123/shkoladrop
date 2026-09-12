/* ==========================================================================
   ШКОЛА ДРОП — js/crash.js
   Мини-игра «Ракета» (Crash): ставка → ракета набирает высоту → успей
   забрать выигрыш до взрыва.

   Как это встроено в проект:
     • математика (CRASH_CONFIG, crashPointFromRoll, crashMultiplierAt,
       crashPayout) лежит в js/config.js — чистая, без DOM, её гоняют тесты;
     • рандом — общий криптографический RNG.float() из js/ui.js (не Math.random);
     • деньги — только через spendMoney()/addMoney() из ядра; ставка списывается
       в момент нажатия «Запустить» и проверяется трижды (лимиты, баланс,
       финальный предохранитель), поэтому баланс не может уйти в минус;
     • иконки — встроенные SVG из js/icons.js (никаких системных эмодзи:
       на части ОС они не грузятся и выглядят пустыми квадратами);
     • ракета рисуется вектором на <canvas> (не эмодзи!) — одинаково на всех
       платформах, координаты считаются от текущего множителя;
     • звуки — методы SoundEngine (playRocketLaunch/playCrashBoom/playCashout).

   Тайминг раунда:
     takeoffSec (1.2 c) — гарантированный разгон, множитель 1.00×, краш невозможен;
     дальше              — рост exp(k1·τ + k2·τ²) до точки краша.

   Фазы: idle → flying → (cashed | crashed) → idle.
   Все переходы — через setPhase(); ввод и повторный старт на время полёта
   заблокированы (защита от двойного списания).
   ========================================================================== */

const CrashGame = {
  /* ---------- Состояние раунда ---------- */
  phase: 'idle',        // 'idle' | 'flying' | 'cashed' | 'crashed'
  bet: 0,               // ставка текущего раунда (уже списана с баланса)
  autoX: 0,             // автовывод: 0 = выключен
  crashAt: 0,           // точка краша (определяется на старте, до полёта)
  mult: 1,              // текущий множитель
  startWall: 0,         // время старта (Date.now — раунд честно идёт и в фоне)
  lastTickSound: 0,     // когда последний раз пищали (тик полёта)
  resetTimer: 0,        // таймаут возврата кнопок после раунда

  /* ---------- Канвас ---------- */
  canvas: null,
  ctx: null,
  dpr: 1,
  w: 320,
  h: 210,
  stars: [],
  particles: [],
  _raf: 0,
  _frame: null,
  _bound: false,

  /* ======================================================================
     ИНИЦИАЛИЗАЦИЯ
     ====================================================================== */
  init() {
    this.canvas = $('crashCanvas');
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext && this.canvas.getContext('2d');
    this._frame = () => this.frame();

    this.bindInputs();
    this.buildQuickButtons();
    if (typeof Icons !== 'undefined') {
      Icons.hydrate($('viewCrash'));      // наполняем <i data-icon="..."> вектором
      Icons.hydrate($('gamesModal'));
    }
    this.resize();
    this.renderStats();
    this.renderHistory();
    this.render();
    this.draw();

    if (!this._bound) {
      this._bound = true;
      const onResize = () => {
        if (!this.isVisible()) return;
        this.resize();
        this.draw();
      };
      window.addEventListener('resize', onResize);
      window.addEventListener('orientationchange', onResize);

      // Размер поля меняется и при смене вкладки, и на резиновой вёрстке —
      // следим за самим контейнером (ResizeObserver есть во всех современных браузерах)
      try {
        if (typeof ResizeObserver === 'function') {
          new ResizeObserver(onResize).observe(this.canvas.parentElement || this.canvas);
        }
      } catch (e) {}

      // Панель может появиться после инициализации — пересчитываем геометрию
      if (typeof MutationObserver === 'function' && $('viewCrash')) {
        new MutationObserver(() => {
          if (this.isVisible()) { this.resize(); this.draw(); }
        }).observe($('viewCrash'), { attributes: true, attributeFilter: ['class'] });
      }
    }
  },

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
      ).join('') +
        `<button type="button" data-bet="half" class="filter-chip">½</button>` +
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
     ГЕОМЕТРИЯ КАНВАСА (резиновая: подстраивается под вёрстку и DPR)
     ====================================================================== */
  resize() {
    const cv = this.canvas;
    if (!cv) return;
    const rect = cv.getBoundingClientRect();
    const w = Math.max(240, Math.round(rect.width || cv.clientWidth || 320));
    const h = Math.max(150, Math.round(rect.height || cv.clientHeight || 210));
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = Math.round(w * this.dpr);
    cv.height = Math.round(h * this.dpr);
    this.w = w;
    this.h = h;
    if (this.ctx) this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.makeStars();
  },

  makeStars() {
    const n = (typeof Quality !== 'undefined' && Quality.isLow()) ? 22 : 48;
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

  /** Время полёта → горизонталь (окно 9 секунд, потом график «едет») */
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
    const cur = Math.floor(this.parseNum(betEl)) || 0;
    const balance = Math.floor(state.balance);
    let next = cur;
    if (kind === 'max') next = balance;
    else if (kind === 'half') next = cur > 0 ? Math.floor(cur / 2) : Math.floor(balance / 2);
    else if (kind === 'x2') next = cur > 0 ? cur * 2 : CRASH_CONFIG.minBet;
    else next = Math.floor(Number(kind)) || 0;
    // Быстрые кнопки никогда не предлагают сумму больше баланса и больше лимита
    next = Math.max(0, Math.min(next, balance, CRASH_CONFIG.maxBet));
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

  /**
   * Читает и проверяет поля ввода. Ничего не списывает.
   * Порядок проверок важен: сначала «это вообще число», потом лимиты,
   * потом — хватает ли денег. Любая ошибка → явное сообщение игроку.
   */
  readInputs() {
    const rawBet = this.parseNum($('crashBetInput'));
    const rawAuto = this.parseNum($('crashAutoInput'));
    const cfg = CRASH_CONFIG;

    if (!isFinite(rawBet) || rawBet <= 0) {
      return { ok: false, error: 'Введи ставку — сколько ставишь на ракету?' };
    }
    const bet = Math.floor(rawBet);
    if (bet < cfg.minBet) {
      return { ok: false, error: `Минимальная ставка — ${fmt(cfg.minBet)} ₽` };
    }
    if (bet > cfg.maxBet) {
      return { ok: false, error: `Максимальная ставка — ${shortMoney(cfg.maxBet)} ₽` };
    }
    if (bet > state.balance) {
      return { ok: false, error: `Не хватает денег: ставка ${fmt(bet)} ₽, а на балансе ${fmt(state.balance)} ₽` };
    }

    let autoX = 0;
    if (isFinite(rawAuto) && rawAuto > 0) {
      if (rawAuto < cfg.minAutoCashout) {
        return { ok: false, error: `Автовывод — минимум ${cfg.minAutoCashout.toFixed(2)}×` };
      }
      if (rawAuto > cfg.maxAutoCashout) {
        return { ok: false, error: 'Автовывод слишком большой — поставь меньше' };
      }
      autoX = rawAuto;
    }
    return { ok: true, bet, autoX };
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

    /* Финальный предохранитель: даже если что-то пошло не так выше —
       списываем не больше остатка и никогда не уводим баланс в минус. */
    const bet = Math.max(CRASH_CONFIG.minBet, Math.min(parsed.bet, CRASH_CONFIG.maxBet, Math.floor(state.balance)));
    if (bet < parsed.bet || bet <= 0) {
      Toast.error(`Нельзя поставить ${fmt(parsed.bet)} ₽ — на балансе ${fmt(state.balance)} ₽`);
      return;
    }

    audio.init();

    // 1. Фиксируем параметры раунда
    this.bet = bet;
    this.autoX = parsed.autoX;
    this.crashAt = crashPointFromRoll(RNG.float());      // точка краша — ДО старта
    this.mult = 1;
    this.startWall = Date.now();
    this.lastTickSound = 0;
    this.particles = [];
    clearTimeout(this.resetTimer);

    // 2. Списание ставки — мгновенно, в момент нажатия, ровно один раз
    spendMoney(bet);
    if (state.balance < 0) state.balance = 0;           // баланс никогда не уходит в минус
    state.stats.crashRounds = (state.stats.crashRounds || 0) + 1;
    state.stats.crashWagered = (state.stats.crashWagered || 0) + bet;
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

    // Автовывод забирает ровно на целевом множителе
    const mult = (auto && this.autoX) ? this.autoX : this.mult;
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
      `Забрал на <b>${mult.toFixed(2)}×</b>: +${fmt(payout)} ₽` +
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

    Toast.error(`ВЗРЫВ на <b>${this.crashAt.toFixed(2)}×</b> — ставка ${fmt(this.bet)} ₽ сгорела. Попробуй ещё раз!`, 4200);
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

  /** Сколько секунд прошло с нажатия «Запустить» */
  elapsed() {
    return Math.max(0, (Date.now() - this.startWall) / 1000);
  },

  /** Идёт гарантированный разгон (краш в этой фазе невозможен) */
  isTakeoff() {
    return this.phase === 'flying' && this.elapsed() < CRASH_CONFIG.takeoffSec;
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
    if (this.phase === 'flying') {
      const t = this.elapsed();                 // реальное время: раунд честно идёт и в фоне
      const m = crashMultiplierAt(t);

      // Во время разгона множитель держится 1.00× и краш проверять нельзя
      if (t >= CRASH_CONFIG.takeoffSec) {
        if (this.autoX && m >= this.autoX) {
          this.mult = m;
          this.updateHud();
          this.draw();
          this.cashout(true);
          return;
        }
        if (m >= this.crashAt) {
          this.explode();
          return;
        }
        this.mult = m;
      } else {
        this.mult = 1;
      }

      // Тик высоты: раз в ~130 мс, чтобы не превращать полёт в трещотку
      const nowMs = Date.now();
      if (!this.isTakeoff() && nowMs - this.lastTickSound > 130) {
        this.lastTickSound = nowMs;
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
    if (document.body.classList.contains('no-motion')) return;
    const low = typeof Quality !== 'undefined' && Quality.isLow();
    const n = low ? 16 : 40;
    const pad = 26;
    const tCrash = crashTimeToMultiplier(this.crashAt);
    const x = this.xFor(tCrash, tCrash, this.w, pad);
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
      p.vy += 210 * dt;      // гравитация
      p.life -= dt * 1.15;
    }
    this.particles = this.particles.filter(p => p.life > 0);
  },

  /* ======================================================================
     РАКЕТА: вектор, а не эмодзи (эмодзи на части ОС не рисуются)
     ====================================================================== */
  drawRocket(x, y, opts = {}) {
    const ctx = this.ctx;
    if (!ctx) return;
    const scale = opts.scale || 1;
    const tilt = Math.max(-0.7, Math.min(0.7, opts.tilt || 0));

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(tilt);
    ctx.scale(scale, scale);

    // Пламя
    if (opts.flame) {
      const f = 9 + Math.random() * 9;
      const grad = ctx.createLinearGradient(0, 6, 0, 6 + f);
      grad.addColorStop(0, 'rgba(255,225,140,0.95)');
      grad.addColorStop(0.45, 'rgba(255,138,20,0.75)');
      grad.addColorStop(1, 'rgba(255,70,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(-3.6, 5.5);
      ctx.quadraticCurveTo(0, 6 + f + 4, 3.6, 5.5);
      ctx.quadraticCurveTo(0, 6 + f * 0.45, -3.6, 5.5);
      ctx.closePath();
      ctx.fill();
    }

    // Стабилизаторы
    ctx.fillStyle = '#ef4444';
    ctx.beginPath();
    ctx.moveTo(-6.2, 1.2); ctx.lineTo(-11, 8.6); ctx.lineTo(-6.2, 6.6);
    ctx.closePath(); ctx.fill();
    ctx.beginPath();
    ctx.moveTo(6.2, 1.2); ctx.lineTo(11, 8.6); ctx.lineTo(6.2, 6.6);
    ctx.closePath(); ctx.fill();

    // Корпус
    ctx.beginPath();
    ctx.moveTo(0, -13.5);
    ctx.quadraticCurveTo(6.8, -6.5, 6.8, 1.6);
    ctx.lineTo(6.8, 6);
    ctx.lineTo(-6.8, 6);
    ctx.lineTo(-6.8, 1.6);
    ctx.quadraticCurveTo(-6.8, -6.5, 0, -13.5);
    ctx.closePath();
    const body = ctx.createLinearGradient(-6.8, -13.5, 6.8, 6);
    body.addColorStop(0, '#f8fafc');
    body.addColorStop(1, '#8fa3bb');
    ctx.fillStyle = body;
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(15,23,42,0.65)';
    ctx.stroke();

    // Иллюминатор
    ctx.beginPath();
    ctx.arc(0, -2.4, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#0ea5e9';
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(248,250,252,0.92)';
    ctx.stroke();

    ctx.restore();
  },

  /* ======================================================================
     ОТРИСОВКА ПОЛЯ ПОЛЁТА
     ====================================================================== */
  draw() {
    const ctx = this.ctx;
    if (!ctx) return;
    const w = this.w || 320, h = this.h || 210, pad = 26;
    const crashed = this.phase === 'crashed';
    const won = this.phase === 'cashed';
    const flying = this.phase === 'flying';
    const takeoff = this.isTakeoff();

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
    const tNow = this.elapsed();
    const tEnd = this.phase === 'idle' ? 0 : (flying ? tNow : crashTimeToMultiplier(this.mult));
    const curveColor = crashed ? '#ef4444' : (won ? '#22c55e' : '#38bdf8');

    if (this.phase !== 'idle' && tEnd > 0) {
      const steps = 64;
      const from = Math.max(0, tEnd - 9);

      ctx.beginPath();
      for (let i = 0; i <= steps; i++) {
        const t = from + (tEnd - from) * (i / steps);
        const m = crashMultiplierAt(t);
        const px = this.xFor(t, tEnd, w, pad);
        const py = this.yFor(m, h, pad);
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = curveColor;
      ctx.shadowColor = curveColor;
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

    /* Ракета — векторная, с наклоном по направлению полёта */
    if (this.phase !== 'idle' && !crashed) {
      const px = this.xFor(tEnd, tEnd, w, pad);
      const py = this.yFor(this.mult, h, pad);

      let tilt = 0;
      if (tEnd > 0.3) {
        const tA = Math.max(0, tEnd - 0.35);
        const dx = this.xFor(tEnd, tEnd, w, pad) - this.xFor(tA, tEnd, w, pad);
        const dy = this.yFor(crashMultiplierAt(tEnd), h, pad) - this.yFor(crashMultiplierAt(tA), h, pad);
        if (dx) tilt = Math.atan2(dy, dx) + Math.PI / 2;
      }
      // На разгоне ракета стоит ровно, дальше — по касательной
      this.drawRocket(px, py, {
        scale: Math.max(0.75, Math.min(1.15, w / 340)),
        tilt: takeoff ? 0 : tilt,
        flame: flying && !takeoff
      });
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

    /* Стартовая площадка */
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
        const auto = this.autoXText();
        status.textContent = auto
          ? `Готов к запуску · автовывод на ${auto}× · мин. ${fmt(CRASH_CONFIG.minBet)} ₽`
          : `Готов к запуску · мин. ${fmt(CRASH_CONFIG.minBet)} ₽`;
        status.className = 'text-[10px] text-slate-400';
      } else if (this.isTakeoff()) {
        status.textContent = 'Разгон: ракета на старте, краш невозможен';
        status.className = 'text-[10px] text-amber-300';
      } else if (flying) {
        status.textContent = this.autoX
          ? `Полетели! Заберу автоматически на ${this.autoX.toFixed(2)}×`
          : 'Полетели! Успей забрать до взрыва';
        status.className = 'text-[10px] text-sky-300';
      } else if (this.phase === 'cashed') {
        status.textContent = `Забрал на ${this.mult.toFixed(2)}× · +${fmt(crashPayout(this.bet, this.mult))} ₽`;
        status.className = 'text-[10px] text-emerald-300 font-bold';
      } else {
        status.textContent = `Взрыв на ${this.crashAt.toFixed(2)}× · ставка сгорела`;
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
      box.innerHTML = '<span class="text-[10px] text-slate-500">История пуста — запусти первую ракету</span>';
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
