/* ==========================================================================
   ШКОЛА ДРОП 2.0 — js/ui.js
   Утилиты интерфейса: звук, уведомления, модалки, рендер предметов,
   анимации чисел, безопасный рандом, фоновые эффекты.
   ========================================================================== */

/* ---------- Короткие хелперы ---------- */
function $(id) { return document.getElementById(id); }
function fmt(n) { return Math.round(Number(n) || 0).toLocaleString('ru-RU'); }

const MONEY_SHORT_UNITS = ['', 'к', 'млн', 'млрд', 'трлн', 'квдр', 'квинт', 'секст', 'септ', 'окт', 'нонил', 'децил'];

function trimMoneyDecimals(text) {
  return String(text)
    .replace(/\.(\d*?[1-9])0+$/, '.$1')
    .replace(/\.0+$/, '')
    .replace('.', ',');
}

function shortMoney(n) {
  const v = Number(n) || 0;
  const abs = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (abs < 1000) return `${sign}${fmt(abs)}`;

  let unitIndex = Math.min(Math.floor(Math.log10(abs) / 3), MONEY_SHORT_UNITS.length - 1);
  let scaled = abs / Math.pow(1000, unitIndex);

  if (scaled >= 999.5 && unitIndex < MONEY_SHORT_UNITS.length - 1) {
    unitIndex += 1;
    scaled /= 1000;
  }

  const decimals = scaled >= 100 ? 0 : (scaled >= 10 ? 1 : 2);
  return `${sign}${trimMoneyDecimals(scaled.toFixed(decimals))}${MONEY_SHORT_UNITS[unitIndex]}`;
}

function moneyText(n, compact = false) {
  return `${compact ? shortMoney(n) : fmt(n)} ₽`;
}

function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function clamp(v, min, max) { return Math.min(Math.max(v, min), max); }

function timeToText(ts) {
  const diff = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diff < 60) return `${diff} сек назад`;
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`;
  return `${Math.floor(diff / 86400)} дн назад`;
}

function nowTimeLabel() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function haptic(ms = 12) {
  try {
    if (navigator.vibrate && !document.body.classList.contains('no-motion')) navigator.vibrate(ms);
  } catch (e) {}
}

/* ---------- Безопасный рандом (crypto) ---------- */
const RNG = {
  float() {
    try {
      if (window.crypto && window.crypto.getRandomValues) {
        const arr = new Uint32Array(1);
        window.crypto.getRandomValues(arr);
        return arr[0] / 4294967296;
      }
    } catch (e) {}
    return Math.random();
  },
  int(max) {
    return Math.floor(this.float() * max);
  },
  /** Честный выбор предмета по весам (шансам) */
  weighted(entries) {
    const total = entries.reduce((sum, e) => sum + e.weight, 0);
    if (total <= 0) return entries.length ? entries[0].item : null;
    let roll = this.float() * total;
    for (let i = 0; i < entries.length; i++) {
      roll -= entries[i].weight;
      if (roll <= 0) return entries[i].item;
    }
    return entries[entries.length - 1].item;
  },
  uid(prefix = 'uid') {
    return `${prefix}_${Date.now().toString(36)}_${Math.floor(this.float() * 1e6).toString(36)}`;
  }
};

/* ---------- Буфер обмена ---------- */
async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) {}
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (e) {
    return false;
  }
}

/* ---------- Звуковой движок ---------- */
class SoundEngine {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.volume = 0.7;
    this.master = null;
  }

  init() {
    if (!this.enabled) return;
    try {
      if (!this.ctx) {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return;
        this.ctx = new Ctx();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        this.master.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
    } catch (e) {}
  }

  applySettings(settings) {
    this.enabled = settings.sound !== false;
    this.volume = clamp((settings.volume == null ? 70 : settings.volume) / 100, 0, 1);
    try {
      if (this.master) this.master.gain.value = this.volume;
    } catch (e) {}
  }

  tone(freq, duration, type = 'triangle', gain = 0.14, delay = 0, freqEnd = null) {
    if (!this.enabled || !this.ctx || !this.master) return;
    try {
      const t0 = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (freqEnd) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), t0 + duration);
      g.gain.setValueAtTime(gain, t0);
      g.gain.linearRampToValueAtTime(0.0001, t0 + duration);
      osc.connect(g);
      g.connect(this.master);
      osc.start(t0);
      osc.stop(t0 + duration + 0.02);
    } catch (e) {}
  }

  playTick() { this.tone(440, 0.025, 'triangle', 0.08, 0, 120); }
  playCaseTick(speed = 1) { this.tone(520 + speed * 120, 0.02, 'square', 0.045, 0, 200); }
  playCoin() {
    this.tone(987, 0.06, 'sine', 0.11);
    this.tone(1318, 0.14, 'sine', 0.1, 0.05);
  }
  playWin() {
    [523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.16, i * 0.07));
  }
  playLoss() { this.tone(260, 0.4, 'sawtooth', 0.16, 0, 55); }
  playLevelUp() {
    [392, 523.25, 659.25, 783.99, 1046.5, 1318.51].forEach((f, i) => this.tone(f, 0.4, 'sine', 0.15, i * 0.09));
  }
  playSecret() {
    [1046.5, 1318.51, 1567.98, 2093].forEach((f, i) => this.tone(f, 0.5, 'sine', 0.13, i * 0.12));
    this.tone(174.61, 1.2, 'triangle', 0.1, 0.1);
    this.tone(261.63, 1.4, 'sine', 0.08, 0.2);
  }
  playAchievement() {
    this.tone(659.25, 0.2, 'triangle', 0.14);
    this.tone(987.77, 0.3, 'triangle', 0.12, 0.12);
  }
}

const audio = new SoundEngine();

/* ---------- Уведомления (тосты) ---------- */
const Toast = {
  MAX: 3,
  show(message, type = 'info', ms = 3200) {
    const box = $('toastContainer');
    if (!box) { console.log(message); return; }
    const icons = { success: '✅', error: '⛔', info: 'ℹ️', gold: '🏆', secret: '🐱' };
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.innerHTML = `<span class="text-base leading-none">${icons[type] || 'ℹ️'}</span><span class="flex-1">${message}</span>`;
    box.appendChild(el);
    while (box.children.length > this.MAX) box.removeChild(box.firstChild);
    setTimeout(() => {
      el.classList.add('toast-out');
      setTimeout(() => el.remove(), 250);
    }, ms);
    return el;
  },
  success(m, ms) { return this.show(m, 'success', ms); },
  error(m, ms) { return this.show(m, 'error', ms); },
  info(m, ms) { return this.show(m, 'info', ms); },
  gold(m, ms) { return this.show(m, 'gold', ms); },
  secret(m, ms) { return this.show(m, 'secret', ms); }
};

/* ---------- Модалки ---------- */
/* Оверлей считается открытым, только если он реально в DOM и не скрыт классом .hidden
   (а приветствие — ещё и пока не начало гаснуть через .pointer-events-none). */
function anyOverlayOpen() {
  return !!document.querySelector(
    '.app-modal:not(.hidden), #itemModal:not(.hidden), #resultOverlay:not(.hidden), ' +
    '#welcomeDisclaimerModal:not(.hidden):not(.pointer-events-none)'
  );
}

/** Единая точка правды: пока открыт любой оверлей — фон не прокручивается.
    Блокируем через <html>, поэтому обычная прокрутка документа продолжает работать.
    Мемоизация важна двояко: и как экономия, и как страховка от цикла в MutationObserver. */
let _modalLockCache = null;
function syncModalState() {
  const open = anyOverlayOpen();
  if (open === _modalLockCache) return;   // состояние не изменилось — DOM не трогаем
  _modalLockCache = open;
  document.body.classList.toggle('modal-open', open);
  document.documentElement.classList.toggle('scroll-locked', open);
}

/** Принудительно пересчитать блокировку (после удаления оверлея из DOM). */
function resyncModalState() {
  _modalLockCache = null;
  syncModalState();
}

/** Страховка от «залипшего» скролла: все оверлеи — прямые дети <body>, поэтому
    любое их появление/исчезновение/смена класса сама пересобирает блокировку.
    Прокрутку больше нельзя заблокировать навсегда, даже если код забыл syncModalState(). */
function watchOverlayLock() {
  if (typeof MutationObserver !== 'function' || !document || !document.body) return;
  if (document.body.dataset.overlayWatch) return;
  document.body.dataset.overlayWatch = '1';
  try {
    new MutationObserver(() => syncModalState())
      .observe(document.body, { childList: true, attributes: true, attributeFilter: ['class'] });
  } catch (e) {}
}

const Modal = {
  open(id) {
    const el = $(id);
    if (!el) return;
    el.classList.remove('hidden');
    syncModalState();
  },
  close(id) {
    const el = $(id);
    if (!el) return;
    el.classList.add('hidden');
    syncModalState();
  },
  isOpen(id) {
    const el = $(id);
    return !!(el && !el.classList.contains('hidden'));
  }
};

/* ---------- Диалог подтверждения ---------- */
const ConfirmDialog = {
  _resolver: null,
  ask({ title = 'Подтверждение', text = 'Ты уверен?', okText = 'Да, точно', icon = '❓', danger = true } = {}) {
    $('confirmTitle').textContent = title;
    $('confirmText').innerHTML = text;
    $('confirmIcon').textContent = icon;
    const ok = $('btnConfirmOk');
    ok.textContent = okText;
    ok.className = danger
      ? 'py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-[11px] transition'
      : 'py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] transition';
    Modal.open('confirmModal');
    audio.playTick();
    return new Promise(resolve => { this._resolver = resolve; });
  }
};

function resolveConfirm(value) {
  Modal.close('confirmModal');
  if (ConfirmDialog._resolver) {
    const r = ConfirmDialog._resolver;
    ConfirmDialog._resolver = null;
    r(!!value);
  }
}

/* ---------- Рендер медиа предмета ---------- */
function renderItemMedia(item, sizeClass = 'w-12 h-12 text-3xl') {
  const rarity = rarityOf(item);
  const inner = item.img
    ? `<img src="${escapeHtml(item.img)}" alt="${escapeHtml(item.name)}" loading="lazy" decoding="async"
         onerror="this.style.display='none'; if(this.nextElementSibling) this.nextElementSibling.style.display='flex';">
       <div style="display:none;" class="w-full h-full items-center justify-center text-2xl font-bold">${item.icon || '❓'}</div>`
    : `<span class="filter drop-shadow-[0_2px_8px_rgba(0,0,0,0.7)] select-none">${item.icon || '❓'}</span>`;

  const gradient = item.badgeBg ? `bg-gradient-to-br ${item.badgeBg}` : 'bg-gradient-to-br from-slate-700 to-slate-900';

  return `<div class="itm-box ${sizeClass} ${gradient}" data-rarity="${item.rarity || 'consumer'}"
      style="border:1.5px solid ${rarity.color}99; box-shadow: inset 0 0 12px ${rarity.color}33;">${inner}</div>`;
}

/* ---------- Анимация чисел ---------- */
function animateNumber(el, to, duration = 420, formatter = fmt) {
  if (!el) return;
  const from = Number(el.dataset.value != null ? el.dataset.value : 0) || 0;
  const target = Number(to) || 0;
  el.dataset.value = String(target);
  if (document.body.classList.contains('no-motion') || Math.abs(target - from) < 1) {
    el.textContent = formatter(target);
    return;
  }
  const start = performance.now();
  function step(now) {
    const p = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = formatter(from + (target - from) * eased);
    if (p < 1) requestAnimationFrame(step);
    else el.textContent = formatter(target);
  }
  requestAnimationFrame(step);
}

/* ---------- Всплывающие +₽ ---------- */
function floatMoney(x, y, text, color = '#fbbf24') {
  if (document.body.classList.contains('no-motion')) return;
  const el = document.createElement('span');
  el.className = 'float-money';
  el.style.left = `${x - 12}px`;
  el.style.top = `${y - 24}px`;
  el.style.color = color;
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 820);
}

/* ---------- Баннер нового уровня ---------- */
const LevelUpBanner = {
  timer: null,
  show(level, rankName, reward) {
    const banner = $('levelUpBanner');
    if (!banner) return;
    $('levelUpTitle').textContent = `Уровень ${level} — ${rankName}!`;
    $('levelUpText').textContent = reward > 0 ? `Награда за уровень: +${fmt(reward)} ₽` : 'Новый титул в профиле!';
    banner.classList.remove('hidden');
    clearTimeout(this.timer);
    this.timer = setTimeout(() => banner.classList.add('hidden'), 4200);
  }
};

/* ---------- Конфетти ---------- */
const Fx = {
  scaled(count) { return Math.max(12, Math.round(count * Quality.particleScale())); },
  burst(count = 80, colors = null) {
    if (document.body.classList.contains('no-motion')) return;
    count = this.scaled(count);
    try {
      confetti({
        particleCount: count,
        spread: 72,
        origin: { y: 0.55 },
        colors: colors || ['#ff5500', '#fbbf24', '#22d3ee', '#a855f7']
      });
    } catch (e) {}
  },
  gold(count = 260) {
    if (document.body.classList.contains('no-motion')) return;
    try {
      const end = Date.now() + (Quality.isLow() ? 700 : 1400);
      const colors = ['#ffd700', '#fde047', '#ffb703', '#fff7cc'];
      (function frame() {
        confetti({ particleCount: Quality.isLow() ? 3 : 7, angle: 60, spread: 70, origin: { x: 0, y: 0.7 }, colors });
        confetti({ particleCount: Quality.isLow() ? 3 : 7, angle: 120, spread: 70, origin: { x: 1, y: 0.7 }, colors });
        if (Date.now() < end) requestAnimationFrame(frame);
      })();
    } catch (e) {}
    this.burst(count, ['#ffd700', '#fff7cc', '#ffb703']);
  },
  secretRain() {
    if (document.body.classList.contains('no-motion')) return;
    try {
      const end = Date.now() + (Quality.isLow() ? 1200 : 2600);
      const colors = ['#00f0ff', '#a855f7', '#ec4899', '#ffd700'];
      (function frame() {
        confetti({ particleCount: Quality.isLow() ? 3 : 6, startVelocity: 42, spread: 360, ticks: 90, origin: { x: Math.random(), y: Math.random() * 0.4 }, colors });
        if (Date.now() < end) requestAnimationFrame(frame);
      })();
    } catch (e) {}
    this.burst(160, ['#00f0ff', '#a855f7']);
  },
  thunder() {
    try {
      const flash = document.createElement('div');
      flash.style.cssText = 'position:fixed;inset:0;background:radial-gradient(circle,#fff,transparent 70%);opacity:0.55;pointer-events:none;z-index:95;transition:opacity .5s ease-out';
      document.body.appendChild(flash);
      setTimeout(() => { flash.style.opacity = '0'; }, 60);
      setTimeout(() => flash.remove(), 700);
    } catch (e) {}
  }
};

/* --------------------------------------------------------------------------
   АДАПТАЦИЯ ПОД УСТРОЙСТВО («аппаратная часть»)
   Автоматически подбирает качество графики: ядра, память, режим экономии,
   prefers-reduced-motion и живой замер FPS. Слабые устройства получают
   лёгкую тему без дорогих blur/анимаций — игра не тормозит и не греется.
   -------------------------------------------------------------------------- */
const Quality = {
  setting: 'auto',
  tier: 'high',
  fps: 0,
  device: {},

  detect() {
    const nav = (typeof navigator !== 'undefined') ? navigator : {};
    const cores = nav.hardwareConcurrency || 0;
    const mem = nav.deviceMemory || 0;
    const saveData = !!(nav.connection && nav.connection.saveData);
    const reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    this.device = {
      cores, mem, saveData, reduced,
      dpr: window.devicePixelRatio || 1,
      w: window.innerWidth, h: window.innerHeight
    };

    let tier = 'high';
    if (reduced || saveData || (cores && cores <= 4) || (mem && mem <= 4)) tier = 'low';
    return tier;
  },

  init(setting) {
    this.setting = ['auto', 'high', 'low'].includes(setting) ? setting : 'auto';
    const detected = this.detect();
    this.tier = this.setting === 'auto' ? detected : this.setting;
    this.apply();
  },

  set(setting) {
    this.init(setting);
  },

  apply() {
    const low = this.tier === 'low';
    document.body.classList.toggle('quality-low', low);
    const reduce = (typeof state !== 'undefined' && state.settings) ? !!state.settings.reduceMotion : false;
    BackgroundFx.toggleByMotionSetting(low || reduce);
    this.renderLabel();
  },

  /** Замер реального FPS: если устройство не тянет — тихо снижаем качество (режим «Авто») */
  probe(onDone) {
    if (this.setting !== 'auto') return;
    let frames = 0;
    const t0 = performance.now();
    const step = () => {
      frames += 1;
      const elapsed = performance.now() - t0;
      if (elapsed < 1500) { requestAnimationFrame(step); return; }
      this.fps = Math.max(1, Math.round(frames / (elapsed / 1000)));
      if (this.fps < 45 && this.tier !== 'low') {
        this.tier = 'low';
        this.apply();
        try { Toast.info(`Устройство выдаёт ${this.fps} FPS — включил облегчённую графику. Можно сменить в настройках ⚙️`, 5000); } catch (e) {}
      }
      if (typeof onDone === 'function') onDone(this.fps);
    };
    requestAnimationFrame(step);
  },

  renderLabel() {
    const label = $('qualityLabel');
    if (label) {
      const settingName = { auto: 'АВТО', high: 'ВЫСОКОЕ', low: 'НИЗКОЕ' }[this.setting] || 'АВТО';
      label.textContent = this.setting === 'auto'
        ? `${settingName} · сейчас ${this.tier === 'low' ? 'низкое' : 'высокое'}`
        : settingName;
      label.className = this.tier === 'low'
        ? 'text-[10px] font-mono text-amber-300'
        : 'text-[10px] font-mono text-emerald-300';
    }

    const info = $('deviceInfo');
    if (info) {
      const d = this.device || {};
      const parts = [];
      if (d.cores) parts.push(`${d.cores} ядер`);
      if (d.mem) parts.push(`${d.mem} ГБ ОЗУ`);
      if (this.fps) parts.push(`${this.fps} FPS`);
      parts.push(`${window.innerWidth}×${window.innerHeight}`);
      const notes = [];
      if (d.saveData) notes.push('экономный режим сети');
      if (d.reduced) notes.push('система просит меньше анимаций');
      info.textContent = `Устройство: ${parts.join(' · ')} — выбрано ${this.tier === 'low' ? 'низкое' : 'высокое'} качество${notes.length ? ' (' + notes.join(', ') + ')' : ''}`;
    }
  },

  isLow() { return this.tier === 'low'; },
  particleScale() { return this.isLow() ? 0.4 : 1; },
  canvasDpr() { return this.isLow() ? 1 : Math.min(window.devicePixelRatio || 1, 2); }
};

/* ---------- Фоновые эффекты (звёздное поле) ---------- */
const BackgroundFx = {
  canvas: null,
  ctx: null,
  stars: [],
  raf: null,
  running: false,

  init() {
    this.canvas = $('fxCanvas');
    if (!this.canvas || typeof this.canvas.getContext !== 'function') return;
    try {
      this.ctx = this.canvas.getContext('2d');
    } catch (e) {
      this.ctx = null;
    }
    if (!this.ctx) return;   // среда без canvas — просто играем без звёздного фона
    this.resize();
    window.addEventListener('resize', () => this.resize(), { passive: true });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.stop();
      else this.start();
    });
    this.start();
  },

  resize() {
    if (!this.canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const base = (typeof Quality !== 'undefined' && Quality.isLow()) ? 42000 : 22000;
    const count = clamp(Math.round((w * h) / base), 18, 90);
    this.stars = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      r: Math.random() * 1.6 + 0.4,
      s: Math.random() * 0.22 + 0.05,
      a: Math.random() * 0.5 + 0.2
    }));
  },

  start() {
    if (this.running || !this.ctx || !this.canvas) return;
    if (document.body.classList.contains('no-motion')) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      const w = window.innerWidth;
      const h = window.innerHeight;
      this.ctx.clearRect(0, 0, w, h);
      this.stars.forEach(st => {
        st.y += st.s;
        if (st.y > h) { st.y = -4; st.x = Math.random() * w; }
        this.ctx.globalAlpha = st.a;
        this.ctx.fillStyle = '#cbd5e1';
        this.ctx.beginPath();
        this.ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2);
        this.ctx.fill();
      });
      this.ctx.globalAlpha = 1;
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  },

  stop() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
  },

  toggleByMotionSetting(reduceMotion) {
    if (reduceMotion) this.stop();
    else this.start();
  }
};

/* ---------- Кнопки-переключатели в настройках ---------- */
function setTogglePill(el, on) {
  if (!el) return;
  el.textContent = on ? 'ВКЛ' : 'ВЫКЛ';
  el.classList.toggle('toggle-on', !!on);
}
