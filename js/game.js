/* ==========================================================================
   ШКОЛА ДРОП 2.0 — js/game.js
   Ядро игры: апгрейдер, кейсы, рюкзак, магазин, мини-игра, дежурство (idle),
   ежедневные награды, промокоды, опыт, уровни, достижения, настройки, cookie.
   ========================================================================== */

/* Геометрия ленты кейсов: заранее выбранный предмет ставим на эту позицию */
const CASE_WIN_INDEX = 38;
const CASE_TAPE_LENGTH = 60;
const CASE_CARD_WIDTH = 88;

/* --------------------------------------------------------------------------
   СОСТОЯНИЕ
   -------------------------------------------------------------------------- */
const state = {
  // Сохраняемые данные
  balance: 2000,
  inventory: [],
  user: null,
  stats: freshStats(),
  settings: Object.assign({}, DEFAULT_SETTINGS),

  // Рантайм (не сохраняется)
  selectedDeposit: null,
  selectedTarget: null,
  rollDirection: 'under',
  isRolling: false,
  currentAngle: 0,
  activeModalType: null,
  invFilter: 'all',
  targetFilter: 'all',
  rigMode: 'fair',
  adminClicks: 0,
  tempRegAvatar: '🎒',
  selectedCase: null,
  caseFilter: 'all',
  isOpeningCase: false,
  lastResultItem: null,
  lastResultIsWin: false,
  dropHistory: [],
  profileTab: 'profile',
  rigReady: false,
  betaArchiveOpen: false
};

/* --------------------------------------------------------------------------
   ЗАГРУЗКА / СОХРАНЕНИЕ
   -------------------------------------------------------------------------- */
function loadGame() {
  const { data, migrated, fresh } = SaveManager.load();

  state.balance = data.balance;
  state.inventory = data.inventory;
  state.user = data.user;
  state.stats = data.stats;
  state.settings = Object.assign({}, DEFAULT_SETTINGS, data.settings || {});

  const cookieSettings = SettingsStore.fromCookie();
  if (cookieSettings) state.settings = cookieSettings;

  // Первый запуск: выдаём стартовый набор школьника
  if (fresh && !state.inventory.length) {
    state.inventory = START_ITEMS.map(id => ({
      ...(ITEMS_BY_ID[id] || {}),
      uid: RNG.uid('start')
    }));
  }

  if (!state.stats.createdAt) state.stats.createdAt = Date.now();
  state.stats.sessions = (state.stats.sessions || 0) + 1;
  state.prevLastSeen = state.stats.lastSeen || 0;   // до перезаписи — для оффлайн-дохода
  state.stats.lastSeen = Date.now();
  state.stats.balanceMax = Math.max(state.stats.balanceMax || 0, state.balance);

  auditInventory();

  state.selectedCase = CASES_LIST.find(c => !c.secret && !c.beta) || CASES_LIST[0];
  state.selectedDeposit = state.inventory[0] || null;
  state.selectedTarget = ITEMS_BY_ID['cs_usp_torque'] || CS2_CATALOG[1];

  audio.applySettings(state.settings);

  MetaStore.bumpSession();

  if (migrated) {
    Toast.success('Старый прогресс из версии 1.0 перенесён — привет в Сезоне 2! 🎒', 5000);
  }
  return data;
}

/** Проверяем целостность рюкзака (предметы могли появиться в новых версиях) */
function auditInventory() {
  state.inventory = state.inventory.filter(it => it && it.id).map(it => {
    const proto = ITEMS_BY_ID[it.id];
    if (!proto) return it;
    return Object.assign({}, proto, { uid: it.uid || RNG.uid('fix'), wonAt: it.wonAt || null });
  });
}

function snapshot() {
  return {
    version: SAVE_VERSION,
    balance: state.balance,
    inventory: state.inventory,
    user: state.user,
    stats: state.stats,
    settings: state.settings,
    createdAt: state.stats.createdAt,
    lastSeen: Date.now()
  };
}

function persist(immediate = false) {
  if (immediate) {
    SaveManager.save(snapshot());
    SettingsStore.toCookie(state.settings);
    return;
  }
  schedulePersist();
}

let persistTimer = null;
function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    SaveManager.save(snapshot());
    SettingsStore.toCookie(state.settings);
  }, 400);
}

/* --------------------------------------------------------------------------
   ДЕНЬГИ, ОПЫТ, УРОВНИ
   -------------------------------------------------------------------------- */
function addMoney(amount, { silent = false, x = null, y = null, countEarned = true } = {}) {
  if (!amount) return;
  state.balance += amount;
  if (countEarned && amount > 0) state.stats.earnedTotal = (state.stats.earnedTotal || 0) + amount;
  state.stats.balanceMax = Math.max(state.stats.balanceMax || 0, state.balance);

  if (x != null && y != null) floatMoney(x, y, `+${fmt(amount)}₽`);
  else if (amount > 0 && !silent) floatMoney(window.innerWidth / 2, 120, `+${fmt(amount)}₽`);

  uiUpdate();
  persist();
}

function spendMoney(amount) {
  state.balance -= amount;
  uiUpdate();
  persist();
}

function rankForLevel(level) {
  return RANKS.find(r => r.level === level) || RANKS[RANKS.length - 1];
}

function nextRankForLevel(level) {
  return RANKS.find(r => r.level === level + 1) || null;
}

function addXp(amount, { silent = false } = {}) {
  if (!amount) return;
  state.stats.xp += amount;
  let leveled = false;

  while (true) {
    const next = nextRankForLevel(state.stats.level);
    if (!next || state.stats.xp < next.xp) break;
    state.stats.level += 1;
    leveled = true;

    const rank = rankForLevel(state.stats.level);
    const reward = rank.reward || 0;
    if (reward > 0) {
      state.balance += reward;
      state.stats.earnedTotal = (state.stats.earnedTotal || 0) + reward;
      state.stats.balanceMax = Math.max(state.stats.balanceMax || 0, state.balance);
    }
    if (!state.stats.unlockedTitles.includes(rank.name)) state.stats.unlockedTitles.push(rank.name);

    LevelUpBanner.show(state.stats.level, rank.name, reward);
    audio.init();
    audio.playLevelUp();
    Fx.burst(70, ['#10b981', '#fbbf24', '#22d3ee']);
    Toast.success(`Новый уровень ${state.stats.level}: <b>${rank.name}</b>${reward ? ` и +${fmt(reward)} ₽` : ''}!`, 4500);
  }

  if (!silent && !leveled) {
    // тихий прирост опыта без спама
  }
  checkAchievements();
  uiUpdate();
}

/* --------------------------------------------------------------------------
   ДОСТИЖЕНИЯ
   -------------------------------------------------------------------------- */
function achievementValue(metric) {
  if (metric === 'balanceMax') return Math.max(state.stats.balanceMax || 0, state.balance);
  if (metric === 'catFound') return state.stats.catFound ? 1 : 0;
  const v = state.stats[metric];
  return typeof v === 'number' ? v : 0;
}

function isAchievementUnlocked(id) {
  return state.stats.achievements.includes(id);
}

function checkAchievements() {
  let unlockedAny = false;
  ACHIEVEMENTS.forEach(ach => {
    if (isAchievementUnlocked(ach.id)) return;
    if (achievementValue(ach.metric) >= ach.target) {
      state.stats.achievements.push(ach.id);
      unlockedAny = true;
      if (ach.money) {
        state.balance += ach.money;
        state.stats.earnedTotal = (state.stats.earnedTotal || 0) + ach.money;
      }
      if (ach.xp) state.stats.xp += ach.xp;
      audio.init();
      audio.playAchievement();
      Toast.gold(`Достижение: <b>${ach.name}</b> · +${fmt(ach.money)} ₽`, 5000);
      if (Modal.isOpen('profileModal') && state.profileTab === 'ach') renderAchievements();
    }
  });
  if (unlockedAny) {
    // После выдачи награды за достижение снова проверяем уровни (но без рекурсии по достижениям)
    let leveled = false;
    while (true) {
      const next = nextRankForLevel(state.stats.level);
      if (!next || state.stats.xp < next.xp) break;
      state.stats.level += 1;
      leveled = true;
      const rank = rankForLevel(state.stats.level);
      if (rank.reward) {
        state.balance += rank.reward;
        state.stats.earnedTotal = (state.stats.earnedTotal || 0) + rank.reward;
      }
      if (!state.stats.unlockedTitles.includes(rank.name)) state.stats.unlockedTitles.push(rank.name);
      LevelUpBanner.show(state.stats.level, rank.name, rank.reward || 0);
      audio.playLevelUp();
    }
    if (leveled) Fx.burst(60);
    persist();
  }
  return unlockedAny;
}

function renderAchievements() {
  const grid = $('achievementsGrid');
  if (!grid) return;
  grid.innerHTML = '';

  ACHIEVEMENTS.forEach(ach => {
    const unlocked = isAchievementUnlocked(ach.id);
    const value = achievementValue(ach.metric);
    const percent = clamp((value / ach.target) * 100, 0, 100);
    const hidden = ach.secret && !unlocked;

    const card = document.createElement('div');
    card.className = `ach-card ${unlocked ? 'ach-done' : 'ach-locked'}`;
    card.innerHTML = `
      <div class="text-xl w-7 text-center flex-shrink-0">${hidden ? '❔' : ach.icon}</div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center justify-between gap-2">
          <span class="text-[11px] font-bold ${unlocked ? 'text-emerald-300' : 'text-slate-200'} truncate">${hidden ? 'Секретное достижение' : ach.name}</span>
          <span class="text-[9px] font-mono ${unlocked ? 'text-emerald-400' : 'text-slate-500'}">${unlocked ? 'получено' : Math.min(100, Math.floor(percent)) + '%'}</span>
        </div>
        <div class="text-[9.5px] text-slate-400 leading-tight">${hidden ? 'Найди легенду школы, чтобы открыть' : ach.desc}</div>
        ${unlocked ? '' : `<div class="ach-mini-bar"><div class="ach-mini-fill" style="width:${percent}%"></div></div>`}
        <div class="text-[9px] text-amber-400/90 mt-0.5">Награда: ${fmt(ach.money)} ₽ · ${ach.xp} XP</div>
      </div>
    `;
    grid.appendChild(card);
  });

  $('achProgressLabel').textContent = `${state.stats.achievements.length} / ${ACHIEVEMENTS.length}`;
}

/* --------------------------------------------------------------------------
   ОБНОВЛЕНИЕ ИНТЕРФЕЙСА
   -------------------------------------------------------------------------- */
let uiFrame = null;
function uiUpdate() {
  if (uiFrame) return;
  uiFrame = requestAnimationFrame(() => {
    uiFrame = null;
    renderAll();
  });
}

function viewVisible(id) {
  const el = $(id);
  return !!el && !el.classList.contains('hidden');
}

function renderAll() {
  checkHardModeNotice();
  // Баланс и шапка
  const headerBalanceEl = $('headerBalance');
  animateNumber(headerBalanceEl, state.balance, 420, v => moneyText(v, true));
  if (headerBalanceEl) headerBalanceEl.title = moneyText(state.balance, false);

  // VIP badge в шапке + видимость VIP карточек
  const vipBadge = $('headerVipBadge');
  if (vipBadge) vipBadge.classList.toggle('hidden', !state.stats.vipActive);
  updateVipCardVisibility();

  if (!$('invCountBadge').dataset.value || Number($('invCountBadge').dataset.value) !== state.inventory.length) {
    $('invCountBadge').dataset.value = String(state.inventory.length);
    $('invCountBadge').textContent = state.inventory.length;
  }

  if (state.user) {
    $('headerUserAvatar').textContent = state.user.avatar || '🎒';
    $('headerUserName').textContent = state.user.nick;
  } else {
    $('headerUserAvatar').textContent = '👤';
    $('headerUserName').textContent = 'Вход';
  }

  renderUpgradeHud();
  renderSlots();
  renderUpgradeStats();

  if (viewVisible('viewCases')) renderCasesUI();
  if (viewVisible('viewInventory')) renderInventory();
  if (viewVisible('viewShop')) renderShop();
  if (viewVisible('viewFarm')) renderFarm();

  if (Modal.isOpen('profileModal')) renderProfile();

  updateDailyIndicator();
}

function renderUpgradeHud() {
  const chance = calculateChance();
  const mult = calculateMultiplier();

  $('hudChance').textContent = `${chance.toFixed(2)}%`;
  $('hudMultiplier').textContent = `x${mult}`;
  $('chancePercentLabel').textContent = `${chance.toFixed(2)}%`;
  $('chanceBar').style.width = `${clamp(chance, 0, 100)}%`;

  const statusBadge = $('statusBadge');
  const btn = $('btnUpgrade');
  const btnText = $('btnUpgradeText');

  if (!state.selectedDeposit) {
    statusBadge.textContent = 'Депни предмет';
    statusBadge.className = 'mt-0.5 text-[9px] px-2 py-0.5 rounded-full bg-rose-950/70 text-rose-300 border border-rose-800/40';
    btn.disabled = true;
    btnText.textContent = 'ВЫБЕРИ ДЕПОЗИТ ИЗ РЮКЗАКА';
  } else if (!state.selectedTarget) {
    statusBadge.textContent = 'Выбери цель';
    statusBadge.className = 'mt-0.5 text-[9px] px-2 py-0.5 rounded-full bg-amber-950/70 text-amber-300 border border-amber-800/40';
    btn.disabled = true;
    btnText.textContent = 'ВЫБЕРИ ЖЕЛАННУЮ ЦЕЛЬ';
  } else {
    const tax = richTaxLabel('wheel');
    statusBadge.textContent = (chance >= 60 ? 'Высокий занос' : (chance >= 20 ? 'Хороший шанс' : 'Рисковый занос')) + tax;
    statusBadge.className = tax
      ? 'mt-0.5 text-[9px] px-2 py-0.5 rounded-full bg-rose-950/60 text-rose-300 border border-rose-800/40'
      : 'mt-0.5 text-[9px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 border border-slate-700';
    btn.disabled = state.isRolling;
    btnText.textContent = state.isRolling ? 'КРУТИМ БАРАБАН...' : `АПГРЕЙД (${chance.toFixed(2)}%)`;
  }

  drawWheel(state.currentAngle);
}

function renderUpgradeStats() {
  const won = state.stats.upgradesWon || 0;
  const lost = state.stats.upgradesLost || 0;
  const total = won + lost;
  $('upgWon').textContent = fmt(won);
  $('upgLost').textContent = fmt(lost);
  $('upgWinrate').textContent = total ? `${Math.round((won / total) * 100)}%` : '0%';
}

function renderSlots() {
  renderSlot('depositSlotContent', state.selectedDeposit);
  renderSlot('targetSlotContent', state.selectedTarget);
}

function renderSlot(containerId, item) {
  const container = $(containerId);
  if (!container) return;
  if (!item) {
    container.innerHTML = `
      <div class="text-3xl mb-1">❓</div>
      <span class="text-xs font-bold text-slate-300">Нажми выбрать</span>
    `;
    return;
  }
  const rarity = rarityOf(item);
  container.innerHTML = `
    <div class="mb-1">${renderItemMedia(item, 'w-12 h-12 text-2xl')}</div>
    <span class="text-xs font-bold text-white line-clamp-1 max-w-[130px]">${escapeHtml(item.name)}</span>
    <span class="text-[11px] font-cs font-bold mt-0.5" style="color:${rarity.color}">${fmt(item.price)} ₽</span>
    <span class="text-[9px] text-orange-400 font-bold">${escapeHtml(itemDisplayCategory(item))}</span>
  `;
}

/* --------------------------------------------------------------------------
   АПГРЕЙДЕР: КОЛЕСО
   -------------------------------------------------------------------------- */
const rouletteCanvas = $('rouletteCanvas');
const rouletteCtx = rouletteCanvas ? rouletteCanvas.getContext('2d') : null;

function calculateChance() {
  if (!state.selectedDeposit || !state.selectedTarget) return 0;
  const raw = (state.selectedDeposit.price / state.selectedTarget.price) * 100;
  // Чем больше баланс — тем сильнее «налог миллионера» режет шанс заноса в колесе
  const nerfed = raw * richTaxWheelFactor();
  return clamp(nerfed, 0.05, 95);
}

function calculateMultiplier() {
  const chance = calculateChance();
  if (chance <= 0) return '0.00';
  return (100 / chance).toFixed(2);
}

function normalizeAngle(a) {
  const twoPi = Math.PI * 2;
  return ((a % twoPi) + twoPi) % twoPi;
}

function drawWheel(currentAngle = 0) {
  if (!rouletteCtx) return;
  const canvas = rouletteCanvas;
  const ctx = rouletteCtx;
  const w = canvas.width;
  const h = canvas.height;
  const centerX = w / 2;
  const centerY = h / 2;
  const radius = w / 2 - 12;
  const innerRadius = radius - 24;

  ctx.clearRect(0, 0, w, h);

  const chance = calculateChance();
  const winSpan = (chance / 100) * (Math.PI * 2);
  const topAngle = -Math.PI / 2;

  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.arc(centerX, centerY, innerRadius, Math.PI * 2, 0, true);
  ctx.fillStyle = '#111723';
  ctx.fill();

  let winStart, winEnd;
  if (state.rollDirection === 'under') {
    winStart = topAngle;
    winEnd = topAngle + winSpan;
  } else {
    winEnd = topAngle;
    winStart = topAngle - winSpan;
  }

  ctx.save();
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, winStart, winEnd);
  ctx.arc(centerX, centerY, innerRadius, winEnd, winStart, true);
  ctx.closePath();
  const winGrad = ctx.createLinearGradient(0, 0, w, h);
  winGrad.addColorStop(0, '#10b981');
  winGrad.addColorStop(1, '#059669');
  ctx.fillStyle = winGrad;
  ctx.shadowColor = 'rgba(16, 185, 129, 0.7)';
  ctx.shadowBlur = 16;
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(centerX, centerY, radius + 1.5, 0, Math.PI * 2);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#2d3748';
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(centerX, centerY, innerRadius - 1.5, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#1e293b';
  ctx.stroke();

  ctx.save();
  ctx.translate(centerX, centerY);
  ctx.rotate(currentAngle);
  ctx.beginPath();
  ctx.moveTo(0, -innerRadius + 4);
  ctx.lineTo(0, -radius - 4);
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = '#ffffff';
  ctx.shadowColor = '#ff5500';
  ctx.shadowBlur = 12;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, -radius - 4, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = '#ff5500';
  ctx.shadowColor = '#ff5500';
  ctx.shadowBlur = 14;
  ctx.fill();
  ctx.restore();
}

function setRollDirection(dir) {
  if (state.isRolling) return;
  audio.init();
  audio.playTick();
  state.rollDirection = dir;
  const under = $('btnDirUnder');
  const over = $('btnDirOver');
  const on = 'px-2.5 py-1 rounded-lg bg-orange-500/20 text-orange-400 border border-orange-500/40 font-bold transition text-[11px]';
  const off = 'px-2.5 py-1 rounded-lg bg-slate-800 text-slate-400 border border-slate-700 font-bold transition text-[11px]';
  under.className = dir === 'under' ? on : off;
  over.className = dir === 'over' ? on : off;
  renderUpgradeHud();
}

function closestItemByPrice(targetPrice, excludeId) {
  let best = null;
  let bestDelta = Infinity;
  ALL_MASTER_ITEMS.forEach(it => {
    if (it.id === excludeId) return;
    const delta = Math.abs(it.price - targetPrice);
    if (delta < bestDelta) { bestDelta = delta; best = it; }
  });
  return best;
}

function applyTargetPreset(multiplier) {
  if (state.isRolling) return;
  if (!state.selectedDeposit) {
    Toast.error('Сначала выбери депозит из рюкзака!');
    return;
  }
  const wanted = state.selectedDeposit.price * multiplier;
  const found = closestItemByPrice(wanted, state.selectedDeposit.id);
  if (!found) {
    Toast.error('Не нашёл подходящую цель');
    return;
  }
  state.selectedTarget = found;
  audio.playTick();
  Toast.info(`Цель: <b>${escapeHtml(found.name)}</b> · шанс ${calculateChance().toFixed(2)}%`);
  uiUpdate();
}

function autoPickDeposit() {
  if (state.isRolling) return;
  if (!state.inventory.length) {
    Toast.error('Рюкзак пуст — крути кейсы или заработай монет!');
    return;
  }
  const best = state.inventory.reduce((acc, it) => (it.price > acc.price ? it : acc), state.inventory[0]);
  state.selectedDeposit = best;
  audio.playTick();
  Toast.info(`Депозит: <b>${escapeHtml(best.name)}</b> за ${fmt(best.price)} ₽`);
  uiUpdate();
}

/* --------------------------------------------------------------------------
   АПГРЕЙДЕР: ЗАПУСК
   -------------------------------------------------------------------------- */
function startUpgradeRoll() {
  if (state.isRolling) return;
  if (!state.selectedDeposit || !state.selectedTarget) return;

  const wagered = state.selectedDeposit;
  const wagerIndex = state.inventory.findIndex(it => it.uid === wagered.uid);
  if (wagerIndex === -1) {
    Toast.error('Этот предмет уже не в рюкзаке');
    state.selectedDeposit = state.inventory[0] || null;
    uiUpdate();
    return;
  }

  audio.init();
  state.isRolling = true;
  state.inventory.splice(wagerIndex, 1);
  addXp(XP_REWARDS.upgradeAttempt);
  uiUpdate();
  persist();

  const winChance = calculateChance();
  const winFraction = winChance / 100;
  const twoPi = Math.PI * 2;
  const winSpan = winFraction * twoPi;

  let isWin = false;
  let isNearMiss = false;

  if (state.rigMode === 'win') isWin = true;
  else if (state.rigMode === 'near') { isWin = false; isNearMiss = true; }
  else if (state.rigMode === 'lose') isWin = false;
  else {
    isWin = RNG.float() < winFraction;
    if (!isWin && RNG.float() < 0.25) isNearMiss = true;
  }

  let targetLocalAngle = 0;

  if (isWin) {
    const marginFactor = winChance < 1 ? 0.5 : (0.15 + RNG.float() * 0.7);
    const landingOffset = winSpan * marginFactor;
    targetLocalAngle = state.rollDirection === 'under' ? landingOffset : (twoPi - landingOffset) % twoPi;
  } else if (isNearMiss) {
    const ultraClose = (0.0006 + RNG.float() * 0.0007) * twoPi;
    targetLocalAngle = state.rollDirection === 'under'
      ? (winSpan + ultraClose) % twoPi
      : (twoPi - winSpan - ultraClose + twoPi) % twoPi;
  } else {
    const closeCall = 0.005 + RNG.float() * 0.04;
    targetLocalAngle = state.rollDirection === 'under'
      ? Math.min(twoPi - 0.05, winSpan + closeCall * twoPi)
      : Math.max(0.05, (twoPi - winSpan) - closeCall * twoPi);
  }

  const currentNorm = normalizeAngle(state.currentAngle);
  const forwardDelta = normalizeAngle(targetLocalAngle - currentNorm);
  const fullSpins = (5 + RNG.int(2)) * twoPi;
  const totalAngularDistance = fullSpins + forwardDelta;

  const startAngle = state.currentAngle;
  const duration = state.settings.reduceMotion ? 700 : (Quality.isLow() ? 3600 : 5200);
  const startTime = performance.now();
  let lastTickAngle = startAngle;

  function animateSpin(now) {
    const progress = Math.min((now - startTime) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 5);
    state.currentAngle = startAngle + totalAngularDistance * eased;

    if (state.currentAngle - lastTickAngle > Math.PI / 12) {
      audio.playTick();
      lastTickAngle = state.currentAngle;
    }
    drawWheel(state.currentAngle);

    if (progress < 1) {
      requestAnimationFrame(animateSpin);
    } else {
      state.currentAngle = startAngle + totalAngularDistance;
      drawWheel(state.currentAngle);

      const finalNorm = normalizeAngle(state.currentAngle);
      const physicalWin = state.rollDirection === 'under'
        ? finalNorm >= 0 && finalNorm <= winSpan + 0.0001
        : finalNorm >= twoPi - winSpan - 0.0001 && finalNorm <= twoPi;

      let missPercent = 0;
      if (!physicalWin) {
        let distRad = state.rollDirection === 'under'
          ? Math.min(finalNorm - winSpan, twoPi - finalNorm)
          : Math.min(twoPi - winSpan - finalNorm, finalNorm);
        if (distRad < 0) distRad = Math.abs(distRad);
        missPercent = Math.max(0.01, (distRad / twoPi) * 100);
      }

      finishRoll(physicalWin, wagered, state.selectedTarget, winChance, missPercent);
    }
  }

  requestAnimationFrame(animateSpin);
}

function finishRoll(isWin, wagered, target, nominalChance, missPercent = 0) {
  state.isRolling = false;

  if (isWin) {
    audio.playWin();
    const wonItem = Object.assign({}, target, { uid: RNG.uid('won'), wonAt: nowTimeLabel() });
    state.inventory.unshift(wonItem);
    state.lastResultItem = wonItem;
    state.lastResultIsWin = true;
    state.stats.upgradesWon = (state.stats.upgradesWon || 0) + 1;
    if (nominalChance < 5) state.stats.riskyWins = (state.stats.riskyWins || 0) + 1;
    state.stats.bestWinChance = Math.max(state.stats.bestWinChance || 0, target.price / Math.max(1, wagered.price));
    trackBiggestDrop(wonItem);

    addXp(XP_REWARDS.upgradeWin);
    Fx.burst(target.price > 200000 ? 140 : 90);
    showResult(true, wonItem, `Стрелка чётко зашла в зелёный сектор ${nominalChance.toFixed(2)}%!`);
    addFeedItem(true, wagered, target);
    Toast.success(`Занос! ${escapeHtml(target.name)} в рюкзаке 🎉`);
  } else {
    audio.playLoss();
    state.lastResultItem = target;
    state.lastResultIsWin = false;
    state.stats.upgradesLost = (state.stats.upgradesLost || 0) + 1;
    const missText = `До заноса не хватило всего ${missPercent < 0.2 ? 'каких-то ' : ''}${missPercent.toFixed(2)}% — буквально миллиметр до зелёного сектора!`;
    showResult(false, target, missText, missPercent);
    addFeedItem(false, wagered, target);
  }

  state.selectedDeposit = state.inventory[0] || null;
  checkAchievements();
  uiUpdate();
  persist(true);
}

function trackBiggestDrop(item) {
  if (!item) return;
  if ((item.price || 0) > (state.stats.biggestDrop || 0)) {
    state.stats.biggestDrop = item.price;
    state.stats.biggestDropName = item.name;
  }
}

/* --------------------------------------------------------------------------
   РЕЗУЛЬТАТ / ЛЕНТА
   -------------------------------------------------------------------------- */
function showResult(isWin, item, meta, missPercent = 0) {
  const overlay = $('resultOverlay');
  const card = $('resultCard');
  const iconBox = $('resultIconBox');
  const heading = $('resultHeading');
  const text = $('resultText');
  const box = $('resultItemBox');
  const glow = $('resultGlow');
  const rarity = rarityOf(item);
  const isSecret = item.rarity === 'secret';

  if (isWin) {
    card.className = `relative w-full max-w-sm rounded-3xl p-6 text-center shadow-2xl border bg-slate-900/95 backdrop-blur-xl pointer-events-auto flex flex-col items-center ${isSecret ? 'border-cyan-400/70 glow-secret' : (item.rarity === 'gold' ? 'border-amber-400/60 glow-gold' : 'border-emerald-500/40')}`;
    iconBox.innerHTML = renderItemMedia(item, 'w-16 h-16 text-4xl');
    heading.textContent = isSecret ? 'КОТ-ХРАНИТЕЛЬ НАЙДЕН!' : (item.rarity === 'gold' ? 'ЗОЛОТОЙ ДРОП!' : 'АПГРЕЙД ЗАЛЕТЕЛ!');
    heading.className = `font-cs text-2xl font-bold uppercase tracking-wider mb-1 ${isSecret ? 'secret-shine' : (item.rarity === 'gold' ? 'text-amber-400' : 'text-emerald-400')}`;
    text.textContent = `Предмет уже в твоём рюкзаке! ${meta}`;
    glow.style.background = `radial-gradient(circle, ${rarity.color}, transparent 70%)`;
  } else {
    card.className = 'relative w-full max-w-sm rounded-3xl p-6 text-center shadow-2xl border border-rose-500/40 bg-slate-900/95 backdrop-blur-xl pointer-events-auto flex flex-col items-center';
    iconBox.innerHTML = '<span class="text-5xl">💔</span>';
    heading.textContent = missPercent < 0.25 ? 'ПОЧТИ ЗАНОС!' : 'ПРЕДМЕТ СГОРЕЛ!';
    heading.className = `font-cs text-2xl font-bold uppercase tracking-wider mb-1 ${missPercent < 0.25 ? 'text-amber-400' : 'text-rose-400'}`;
    text.innerHTML = `
      <div class="mb-2 text-slate-300 text-xs">${meta}</div>
      ${missPercent > 0 ? `
        <div class="inline-block bg-rose-950/70 border border-rose-500/50 rounded-lg px-2.5 py-1 text-[11px] font-cs font-bold text-rose-300 mb-1">
          Не хватило: <span class="text-amber-300 font-extrabold">${missPercent.toFixed(2)}%</span>
        </div>` : ''}
    `;
    glow.style.background = 'radial-gradient(circle, #ef4444, transparent 70%)';
  }

  box.innerHTML = `
    <div class="flex-shrink-0">${renderItemMedia(item, 'w-12 h-12 text-2xl')}</div>
    <div class="text-left flex-1 min-w-0">
      <div class="text-xs font-bold text-white truncate">${escapeHtml(item.name)}</div>
      <div class="text-[11px] font-cs font-bold" style="color:${rarity.color}">${fmt(item.price)} ₽</div>
    </div>
  `;

  const sellBtn = $('btnSellResult');
  const inInventory = state.inventory.some(it => it.uid === state.lastResultItem?.uid);
  const isNoSell = !!state.lastResultItem?.noSell;
  const canSell = inInventory && !isNoSell;
  sellBtn.disabled = !canSell;
  sellBtn.className = canSell
    ? 'py-3 rounded-xl font-cs font-bold text-xs uppercase tracking-wider bg-slate-800 border border-slate-700 text-slate-200 hover:bg-slate-700 active:scale-95 transition'
    : 'py-3 rounded-xl font-cs font-bold text-xs uppercase tracking-wider bg-slate-900 border border-slate-800 text-slate-600 cursor-not-allowed';
  if (isNoSell) sellBtn.textContent = 'НЕЛЬЗЯ ПРОДАТЬ';

  overlay.classList.remove('hidden');
  overlay.classList.add('pointer-events-auto');
  syncModalState();
  requestAnimationFrame(() => {
    overlay.classList.remove('opacity-0');
    overlay.classList.add('opacity-100');
  });

  if (isSecret) {
    Fx.secretRain();
    Fx.thunder();
  }
}

function closeResultOverlay() {
  const overlay = $('resultOverlay');
  overlay.classList.add('opacity-0');
  overlay.classList.remove('pointer-events-auto');
  setTimeout(() => { overlay.classList.add('hidden'); syncModalState(); }, 200);
}

function sellResultItem() {
  const item = state.lastResultItem;
  if (!item) return;
  if (item.noSell) {
    Toast.info(`«${escapeHtml(item.name)}» нельзя продать — это легендарный предмет! Его можно только апгрейднуть ⚡`);
    return;
  }
  const idx = state.inventory.findIndex(it => it.uid === item.uid);
  if (idx === -1) return;
  const inv = state.inventory[idx];
  state.inventory.splice(idx, 1);
  state.stats.itemsSold = (state.stats.itemsSold || 0) + 1;
  addMoney(inv.price);
  addXp(XP_REWARDS.sell);
  audio.playCoin();
  Toast.success(`Продано: ${escapeHtml(inv.name)} за ${fmt(inv.price)} ₽`);
  closeResultOverlay();
  uiUpdate();
  persist(true);
}

function addFeedItem(isWin, depositItem, targetItem) {
  const feed = $('feedList');
  if (!feed) return;
  const div = document.createElement('div');
  div.className = `flex-shrink-0 flex items-center space-x-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] ${
    isWin ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-300' : 'bg-rose-950/30 border-rose-500/30 text-rose-300'
  }`;
  div.innerHTML = `
    <span>${depositItem.icon || '❓'}</span>
    <span class="text-[9px] text-slate-400">➔</span>
    <span>${targetItem.icon || '❓'}</span>
    <span class="font-bold">${isWin ? '+' : '✕'} ${shortMoney(targetItem.price)}₽</span>
  `;
  feed.prepend(div);
  while (feed.children.length > 10) feed.removeChild(feed.lastChild);
}

/* --------------------------------------------------------------------------
   КЕЙСЫ
   -------------------------------------------------------------------------- */
function casePrice(caseObj) {
  if (!caseObj) return 0;
  return state.balance >= HARD_MODE_THRESHOLD ? Math.ceil(caseObj.price * HARD_MODE_CASE_DISCOUNT) : caseObj.price;
}

function checkHardModeNotice() {
  // VIP-игрокам налог не страшен — не спамим им уведомлениями
  if (state.stats.vipActive) return;

  if (state.balance >= HARD_MODE_THRESHOLD && !state.stats.hardModeNotified) {
    state.stats.hardModeNotified = true;
    Toast.gold('🔥 Сезон 3: режим миллионера активирован! Цены кейсов снижены на 10%, но дропы стали сложнее. Отключить налог навсегда можно VIP-статусом (кнопка ⋮ → Промокоды).', 8000);
    persist(true);
    return;
  }
  // Одноразовое предупреждение, как только включается «налог миллионера»
  if (richTaxFactor() < 0.995 && !state.stats.richTaxNotified) {
    state.stats.richTaxNotified = true;
    Toast.info(`💰 Баланс большой — рандом злится: шансы топовых предметов снижены (налог ×${richTaxFactor().toFixed(2)}). Отключить налог навсегда можно VIP-статусом (кнопка ⋮ → Промокоды).`, 8000);
    persist(true);
  }
}

/** Короткая плашка штрафа для UI — пустая строка, если «налога миллионера» нет, или VIP-метка если VIP активен */
function richTaxLabel(kind) {
  if (state.stats.vipActive) return ' · 👑 VIP';
  const factor = kind === 'wheel' ? richTaxWheelFactor() : richTaxFactor();
  if (factor >= 0.995) return '';
  return ` · 🧱 налог ×${factor.toFixed(2)}`;
}

/** Процент шанса: мелкие значения показываем точно, а не «0.00%» */
function fmtChance(pct) {
  if (!Number.isFinite(pct) || pct <= 0) return '0%';
  if (pct >= 1) return `${pct.toFixed(2)}%`;
  if (pct >= 0.01) return `${pct.toFixed(3)}%`;
  return `${pct.toFixed(5)}%`;
}

/** «1 из N» — удобно для крошечных шансов */
function chanceToOne(pct) {
  if (!Number.isFinite(pct) || pct <= 0) return '—';
  const n = 100 / pct;
  return `1 из ${n >= 100 ? Math.round(n).toLocaleString('ru-RU') : n.toFixed(1)}`;
}

/* Список кейсов с учётом тестовой ветки 3.6: бета-кейсы видны только в бете */
function activeCasesList() {
  const beta = typeof BetaMode !== 'undefined' && BetaMode.isActive();
  return CASES_LIST.filter(c => !c.beta || beta);
}

/* Карточка кейса на витрине */
function buildCaseCard(c) {
  const selected = c.id === state.selectedCase.id;
  const affordable = state.balance >= casePrice(c);
  const card = document.createElement('div');
  card.className = `case-card ${selected ? 'case-card-selected' : ''} ${c.secret ? 'case-card-secret' : ''} ${!affordable && c.secret ? 'case-card-locked' : ''} ${c.beta ? 'case-card-beta' : ''}`;
  card.innerHTML = `
    <div class="text-3xl mb-1 relative z-10">${c.image ? `<img src="${escapeHtml(c.image)}" alt="${escapeHtml(c.name)}" class="case-cover" onerror="this.style.display='none';this.nextElementSibling.style.display='block';"><span style="display:none">${c.icon}</span>` : (c.secret && !affordable ? '🔒' : c.icon)}</div>
    <div class="text-xs font-bold font-cs ${c.secret ? 'secret-shine' : 'text-white'} leading-tight relative z-10">${escapeHtml(c.name)}</div>
    <div class="text-[10px] text-slate-400 line-clamp-1 my-1 relative z-10">${escapeHtml(c.desc)}</div>
    <div class="text-xs font-cs font-bold relative z-10" style="color:${c.color}">${fmt(casePrice(c))} ₽</div>
    ${c.beta ? '<div class="beta-case-flag">🧪 ЭКСПЕРИМЕНТАЛЬНО</div>' : ''}
    ${c.secret ? `<div class="text-[9px] text-fuchsia-300 mt-0.5 relative z-10">${affordable ? 'ДОСТУПЕН! ТЫ ЛЕГЕНДА' : 'секретный · нужен 10 000 000 ₽'}</div>` : ''}
  `;
  card.onclick = () => selectCase(c.id);
  return card;
}

function renderCasesUI() {
  const grid = $('casesGrid');
  if (!grid) return;

  const betaActive = typeof BetaMode !== 'undefined' && BetaMode.isActive();
  const allCases = activeCasesList();

  // Панель «Лаборатория 3.6 — в разработке» видна только в бете
  const devPanel = $('betaDevPanel');
  if (devPanel) devPanel.classList.toggle('hidden', !betaActive);

  $('currentCaseTitle').textContent = `${state.selectedCase.beta ? '🧪 3.6 · ' : (state.selectedCase.season === 3 ? 'Сезон 3 · ' : '')}Кейс: ${state.selectedCase.name}`;
  const selectedPrice = casePrice(state.selectedCase);
  $('currentCasePrice').textContent = moneyText(selectedPrice, true);
  $('currentCasePrice').title = moneyText(selectedPrice, false);
  $('casesCountLabel').textContent = `${allCases.length} кейсов · ${ALL_MASTER_ITEMS.length} предметов`;
  $('casesOpenedLabel').textContent = `всего: ${fmt(state.stats.casesOpened || 0)}`;

  const enoughMoney = state.balance >= selectedPrice;
  const openBtn = $('btnOpenCase');
  const openText = $('btnOpenCaseText');
  const openX5 = $('btnOpenCaseX5');

  if (state.isOpeningCase) {
    openBtn.disabled = true;
    openText.textContent = 'ОТКРЫВАЕМ...';
    openX5.disabled = true;
    openX5.classList.add('opacity-50');
  } else {
    openBtn.disabled = !enoughMoney;
    openText.textContent = enoughMoney
      ? `ОТКРЫТЬ ЗА ${shortMoney(selectedPrice)} ₽`
      : `НУЖНО ${shortMoney(selectedPrice)} ₽`;
    const x5Cost = selectedPrice * 5;
    openX5.disabled = state.balance < x5Cost;
    openX5.classList.toggle('opacity-50', state.balance < x5Cost);
    openX5.textContent = state.selectedCase.secret ? 'x5 🔒' : `x5 · ${shortMoney(x5Cost)}₽`;
  }

  const affordableList = allCases.filter(c => state.balance >= casePrice(c));
  const topList = allCases.filter(c => !c.secret && !c.beta && c.price >= 45000);
  const secretList = allCases.filter(c => c.secret);

  let visibleCases = allCases;
  if (state.caseFilter === 'affordable') visibleCases = affordableList;
  else if (state.caseFilter === 'top') visibleCases = topList;
  else if (state.caseFilter === 'secret') visibleCases = secretList;

  $('caseCountAll').textContent = allCases.length;
  $('caseCountAffordable').textContent = affordableList.length;

  // если выбранный кейс скрыт фильтром — переключаемся на первый доступный
  if (visibleCases.length && !visibleCases.some(c => c.id === state.selectedCase.id)) {
    state.selectedCase = visibleCases[0];
    setupCaseTape();
  }

  grid.innerHTML = '';

  if (!visibleCases.length) {
    grid.innerHTML = `
      <div class="col-span-2 py-8 text-center text-xs text-slate-500">
        Здесь пока пусто — копи монеты, и кейсы появятся! 🪙
      </div>`;
  }

  // В бете на вид «Все»: сначала бета-кейсы, стандартные сворачиваются в «Архив 3.5»
  let archiveCases = [];
  if (betaActive && state.caseFilter === 'all') {
    archiveCases = visibleCases.filter(c => !c.beta);
    visibleCases = visibleCases.filter(c => c.beta);
  }

  visibleCases.forEach(c => grid.appendChild(buildCaseCard(c)));

  if (archiveCases.length) {
    const wrap = document.createElement('div');
    wrap.className = 'beta-archive col-span-2';
    const opened = !!state.betaArchiveOpen;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'beta-archive-btn';
    btn.innerHTML = `📦 Архив стабильной ветки ${APP_VERSION} · ${archiveCases.length} кейсов <span>${opened ? '▴ свернуть' : '▾ показать'}</span>`;
    btn.onclick = toggleBetaArchive;
    wrap.appendChild(btn);
    if (opened) {
      const inner = document.createElement('div');
      inner.className = 'beta-archive-grid';
      archiveCases.forEach(c => inner.appendChild(buildCaseCard(c)));
      wrap.appendChild(inner);
    }
    grid.appendChild(wrap);
  }

  const secret = SECRET_CASE;
  const progress = clamp((state.balance / secret.price) * 100, 0, 100);
  $('secretCaseBar').style.width = `${progress}%`;
  $('secretCasePercent').textContent = `${progress.toFixed(1)}%`;
  $('secretCaseHint').innerHTML = state.stats.catFound
    ? '🐱 Кот-Хранитель уже живёт в твоём рюкзаке. Ты — легенда школы!'
    : (progress >= 100
      ? 'Баланс готов! Открывай секретный кейс — Кот ждёт.'
      : `Секретный кейс стоит 10 000 000 ₽ · не хватает ${fmt(Math.max(0, secret.price - state.balance))} ₽`);

  renderDropHistory();
}

function setCaseFilter(filter) {
  state.caseFilter = filter;
  const map = { all: 'caseFltAll', affordable: 'caseFltAffordable', top: 'caseFltTop', secret: 'caseFltSecret' };
  Object.values(map).forEach(id => { const el = $(id); if (el) el.className = 'filter-chip'; });
  const active = $(map[filter]);
  if (active) active.className = 'filter-chip filter-chip-active';
  audio.playTick();
  renderCasesUI();
}

/** Возвращаем страницу к началу при смене вкладки (мгновенно, без плавного «полёта») */
function scrollViewportTop() {
  const doc = document.documentElement;
  const prevBehavior = doc.style.scrollBehavior;
  doc.style.scrollBehavior = 'auto';   // обходим html { scroll-behavior: smooth }
  try { window.scrollTo(0, 0); } catch (e) {}
  try { doc.scrollTop = 0; } catch (e) {}
  try { document.body.scrollTop = 0; } catch (e) {}
  const vp = $('appViewport');
  if (vp) vp.scrollTop = 0;
  if (prevBehavior) doc.style.scrollBehavior = prevBehavior;
  else doc.style.removeProperty('scroll-behavior');
}

function renderDropHistory() {
  const box = $('dropHistoryList');
  if (!box) return;
  if (!state.dropHistory.length) {
    box.innerHTML = '<span class="text-[11px] text-slate-500">Пока пусто — открой первый кейс!</span>';
    return;
  }
  box.innerHTML = state.dropHistory.map(d => {
    const rarity = rarityOf(d);
    return `
      <div class="flex-shrink-0 w-20 bg-slate-950/80 border border-slate-800 rounded-xl p-1.5 text-center"
           style="border-color:${rarity.color}55">
        <div class="flex justify-center mb-1">${renderItemMedia(d, 'w-9 h-9 text-xl')}</div>
        <div class="text-[9px] text-white line-clamp-1">${escapeHtml(d.name)}</div>
        <div class="text-[9px] font-cs font-bold" style="color:${rarity.color}">${shortMoney(d.price)}₽</div>
      </div>
    `;
  }).join('');
}

function selectCase(id) {
  if (state.isOpeningCase) return;
  const found = CASES_LIST.find(c => c.id === id);
  if (!found) return;
  audio.init();
  audio.playTick();
  state.selectedCase = found;
  renderCasesUI();
  setupCaseTape();
  if (found.secret && state.balance < found.price) {
    Toast.info(`Секретный кейс «${escapeHtml(found.name)}» требует ${fmt(found.price)} ₽. Копи монеты! 🐱`, 4200);
  }
}


/** Смещение ленты, при котором карточка-победитель встаёт ровно под стрелку */
function computeTapeTranslate(winIndex = CASE_WIN_INDEX) {
  const track = $('caseRouletteTrack');
  const wrapper = $('caseTapeWrapper');
  if (!track || !wrapper) return 0;

  const card = track.children[winIndex];
  const fallbackWidth = 80;
  const cardW = card && card.offsetWidth ? card.offsetWidth : fallbackWidth;
  const cardLeft = card && card.offsetLeft
    ? card.offsetLeft
    : (winIndex * (fallbackWidth + 8));

  const centerInWrapper = wrapper.clientWidth / 2;
  const jitter = (RNG.float() - 0.5) * (cardW * 0.6); // лёгкий разброс, чтобы не всегда «в яблочко»
  return centerInWrapper - (cardLeft + cardW / 2) + jitter;
}

function setupCaseTape(forcedWinner = null) {
  const track = $('caseRouletteTrack');
  if (!track) return;
  track.style.transition = 'none';
  track.style.transform = 'translateX(0px)';

  const pool = casePool(state.selectedCase);
  if (!pool.length) return;

  const WIN_INDEX = CASE_WIN_INDEX;
  const CARD_WIDTH = 88;
  const winner = forcedWinner || RNG.weighted(pool); // заранее выбранный честный дроп
  track.dataset.winner = winner.id;
  track.dataset.caseId = state.selectedCase.id;

  track.innerHTML = '';
  for (let i = 0; i < CASE_TAPE_LENGTH; i++) {
    const it = i === WIN_INDEX ? winner : RNG.weighted(pool);
    const card = document.createElement('div');
    card.className = 'case-item-card';
    card.setAttribute('data-item-id', it.id);
    card.setAttribute('data-rarity', it.rarity || 'consumer');
    card.style.setProperty('--rc', rarityOf(it).color);
    card.style.width = `${CARD_WIDTH - 8}px`;
    card.innerHTML = `
      <div class="w-10 h-10 flex items-center justify-center pointer-events-none mt-0.5">
        ${renderItemMedia(it, 'w-10 h-10 text-xl')}
      </div>
      <div class="text-[9px] font-bold text-white line-clamp-1 w-full pointer-events-none px-0.5">${escapeHtml(it.name)}</div>
      <div class="text-[9px] font-cs font-bold pointer-events-none" style="color:${rarityOf(it).color}">${shortMoney(it.price)}₽</div>
    `;
    track.appendChild(card);
  }
}

/** Победитель ленты, привязанный к текущему кейсу (защита от устаревшей ленты) */
function currentCaseWinner() {
  const track = $('caseRouletteTrack');
  if (!track || track.dataset.caseId !== state.selectedCase.id) return null;
  const id = track.dataset.winner;
  const item = ITEMS_BY_ID[id];
  if (!item) return null;
  const inPool = casePool(state.selectedCase).some(e => e.item.id === id);
  return inPool ? item : null;
}

function openSelectedCase() {
  if (state.isOpeningCase) return;
  const caseObj = state.selectedCase;
  const price = casePrice(caseObj);
  if (state.balance < price) {
    Toast.error(`Не хватает монет: нужно ${fmt(price)} ₽`);
    return;
  }

  const isSecret = !!caseObj.secret;
  const fast = state.settings.fastOpen || state.settings.reduceMotion;
  // Дроп всегда определяется честным розыгрышем по весам текущего кейса
  const winner = RNG.weighted(casePool(caseObj));

  audio.init();
  audio.playCoin();
  state.isOpeningCase = true;
  spendMoney(price);
  // Спонсорство: 10% от стоимости кейса — владельцу введённого кода автора
  if (typeof NetAuthor !== 'undefined') NetAuthor.trackCaseSpend(price, caseObj.id);
  state.stats.casesOpened = (state.stats.casesOpened || 0) + 1;
  if (isSecret) state.stats.secretCases = (state.stats.secretCases || 0) + 1;
  addXp(XP_REWARDS.caseOpen, { silent: true });

  if (isSecret) FXcaseAura(true);

  if (fast) {
    setupCaseTape(winner);
    setTimeout(() => awardCaseDrop(winner, caseObj), isSecret ? 700 : 260);
    uiUpdate();
    return;
  }

  setupCaseTape(winner);
  const translate = computeTapeTranslate();

  // На слабых устройствах крутим кейс быстрее: меньше нагрузки и ожидания
  const spinMs = Quality.isLow() ? 3300 : 5200;
  const track = $('caseRouletteTrack');

  if (track) {
    requestAnimationFrame(() => {
      track.style.transition = `transform ${spinMs}ms cubic-bezier(0.12, 0.85, 0.18, 1)`;
      track.style.transform = `translateX(${translate}px)`;
    });
  }

  const tickInterval = setInterval(() => audio.playCaseTick(1), 150);
  setTimeout(() => clearInterval(tickInterval), Math.max(800, spinMs - 1000));

  uiUpdate();
  setTimeout(() => awardCaseDrop(winner, caseObj), spinMs + 200);
}

function openSelectedCaseMulti(count = 5) {
  if (state.isOpeningCase) return;
  const caseObj = state.selectedCase;
  const cost = casePrice(caseObj) * count;

  if (caseObj.secret) {
    Toast.error('Секретный кейс открывается только по одному — так задумано 🐱');
    return;
  }
  if (state.balance < cost) {
    Toast.error(`Для x${count} нужно ${fmt(cost)} ₽`);
    return;
  }

  audio.init();
  audio.playCoin();
  state.isOpeningCase = true;
  spendMoney(cost);
  // Спонсорство: 10% от стоимости открытия — автору кода
  if (typeof NetAuthor !== 'undefined') NetAuthor.trackCaseSpend(cost, caseObj.id);
  state.stats.casesOpened = (state.stats.casesOpened || 0) + count;
  addXp(XP_REWARDS.caseOpen * count, { silent: true });

  const pool = casePool(caseObj);
  const drops = [];
  for (let i = 0; i < count; i++) {
    const it = RNG.weighted(pool);
    const item = Object.assign({}, it, { uid: RNG.uid('case'), wonAt: nowTimeLabel() });
    state.inventory.unshift(item);
    drops.push(item);
    trackBiggestDrop(item);
    state.dropHistory.unshift(item);
  }
  state.dropHistory = state.dropHistory.slice(0, 12);

  const best = drops.reduce((a, b) => (b.price > a.price ? b : a), drops[0]);
  state.lastResultItem = drops[0];
  state.lastResultIsWin = true;

  const grid = $('multiResultGrid');
  grid.innerHTML = drops.map(d => {
    const rarity = rarityOf(d);
    return `
      <div class="bg-slate-950/80 border rounded-xl p-2 text-center" style="border-color:${rarity.color}66">
        <div class="flex justify-center mb-1">${renderItemMedia(d, 'w-11 h-11 text-2xl')}</div>
        <div class="text-[10px] text-white line-clamp-1">${escapeHtml(d.name)}</div>
        <div class="text-[10px] font-cs font-bold" style="color:${rarity.color}">${fmt(d.price)} ₽</div>
      </div>
    `;
  }).join('');

  const totalValue = drops.reduce((sum, d) => sum + d.price, 0);
  $('multiResultTitle').textContent = `${count} кейсов «${caseObj.name}»`;
  $('multiResultTotal').innerHTML = `
    Потрачено: <b class="text-rose-300">${fmt(cost)} ₽</b> ·
    Дроп: <b class="text-amber-300">${fmt(totalValue)} ₽</b><br>
    <span class="text-[10px] text-slate-400">Лучший: ${escapeHtml(best.name)} (${fmt(best.price)} ₽)</span>
  `;

  state.isOpeningCase = false;
  audio.playWin();
  Fx.burst(110);
  Modal.open('multiResultModal');
  Toast.success(`Открыто ${count} кейсов · дроп на ${fmt(totalValue)} ₽`);
  checkAchievements();
  uiUpdate();
  persist(true);
}

function closeMultiResult() {
  Modal.close('multiResultModal');
  if (state.selectedDeposit == null) state.selectedDeposit = state.inventory[0] || null;
  uiUpdate();
}

function awardCaseDrop(it, caseObj) {
  state.isOpeningCase = false;
  FXcaseAura(false);

  const item = Object.assign({}, it, { uid: RNG.uid('case'), wonAt: nowTimeLabel() });
  state.inventory.unshift(item);
  state.lastResultItem = item;
  state.lastResultIsWin = true;
  state.dropHistory.unshift(item);
  state.dropHistory = state.dropHistory.slice(0, 12);
  trackBiggestDrop(item);
  state.selectedDeposit = item;

  const isSecretCat = item.id === 'cat_keeper';
  const rarity = rarityOf(item);

  if (isSecretCat) {
    state.stats.catFound = true;
    if (!state.stats.unlockedTitles.includes('Хранитель Кота')) state.stats.unlockedTitles.push('Хранитель Кота');
    audio.playSecret();
    Toast.secret('КОТ-ХРАНИТЕЛЬ ШКОЛЫ найден! Легенда теперь живёт в твоём рюкзаке 🐱👑', 8000);
  } else if (item.rarity === 'secret' || item.rarity === 'gold') {
    Fx.gold(220);
    audio.playWin();
  } else if (item.rarity === 'covert' || item.rarity === 'classified') {
    Fx.burst(110, ['#eb4b4b', '#d32ce6', '#fbbf24']);
    audio.playWin();
  } else {
    audio.playWin();
    Fx.burst(70);
  }

  showResult(true, item, `Точное попадание под стрелку из кейса «${caseObj.name}»!`);

  checkAchievements();
  uiUpdate();
  persist(true);
}

function FXcaseAura(on) {
  const aura = $('caseAura');
  if (!aura) return;
  aura.classList.toggle('hidden', !on);
}

function openCaseOddsModal() {
  const caseObj = state.selectedCase;
  const odds = caseOdds(caseObj).sort((a, b) => b.chance - a.chance);
  $('oddsCaseTitle').textContent = `Шансы: ${caseObj.name}`;
  $('oddsList').innerHTML = odds.map(o => {
    const rarity = rarityOf(o.item);
    return `
      <div class="flex items-center gap-2 bg-slate-950/70 border border-slate-800 rounded-xl p-2">
        <div class="flex-shrink-0">${renderItemMedia(o.item, 'w-9 h-9 text-lg')}</div>
        <div class="flex-1 min-w-0">
          <div class="text-[11px] font-bold text-white line-clamp-1">${escapeHtml(o.item.name)}</div>
          <div class="text-[9px]" style="color:${rarity.color}">${rarity.name} · ${fmt(o.item.price)} ₽</div>
        </div>
        <div class="text-right">
          <div class="font-cs font-bold text-xs text-amber-300">${fmtChance(o.chance)}</div>
          <div class="text-[9px] text-slate-500">${chanceToOne(o.chance)}</div>
        </div>
      </div>
    `;
  }).join('');

  // Честность превыше всего: показываем ровно те шансы, по которым крутится рандом
  const tax = caseRichTaxInfo(caseObj);
  const note = $('oddsRigNote');
  if (note) {
    if (state.stats.vipActive) {
      note.className = 'text-[10px] text-amber-300 mb-2';
      note.innerHTML = `👑 <b>VIP-статус активен</b> — налог миллионера отключён навсегда! Шансы всегда как при балансе ниже 100 000 ₽. Спасибо за поддержку! 💎`;
    } else if (tax.factor >= 0.995) {
      note.className = 'text-[10px] text-emerald-400 mb-2';
      note.innerHTML = `✅ Баланс ${fmt(state.balance)} ₽ — «налог миллионера» ещё не включён, шансы как в описании кейса. Отключить налог навсегда можно VIP-статусом (⋮ → Промокоды).`;
    } else {
      note.className = 'text-[10px] text-rose-300 mb-2';
      note.innerHTML = `🧱 <b>Налог миллионера ×${tax.factor.toFixed(2)}</b> — при балансе ${fmt(state.balance)} ₽ шансы топовых редкостей порезаны на ${tax.topCut.toFixed(0)}%. Отключить налог навсегда можно VIP-статусом (⋮ → Промокоды). Ниже — уже итоговые шансы, они же участвуют в рандоме.`;
    }
  }
  Modal.open('caseOddsModal');
}

function closeCaseOddsModal() { Modal.close('caseOddsModal'); }

/* --------------------------------------------------------------------------
   РЮКЗАК
   -------------------------------------------------------------------------- */
function setInvFilter(type) {
  state.invFilter = type;
  const map = { all: 'fltAll', school: 'fltSchool', cs2: 'fltCs2', games: 'fltGames', cat: 'fltCat' };
  Object.values(map).forEach(id => {
    const el = $(id);
    if (el) el.className = 'filter-chip';
  });
  const active = $(map[type]);
  if (active) active.className = 'filter-chip filter-chip-active';
  renderInventory();
}

function inventoryList() {
  const school = state.inventory.filter(i => i.category === 'school');
  const cs2 = state.inventory.filter(i => i.category === 'cs2');
  const games = state.inventory.filter(i => i.category === 'other');
  const cats = state.inventory.filter(i => i.category === 'cat');

  let list = state.inventory;
  if (state.invFilter === 'school') list = school;
  if (state.invFilter === 'cs2') list = cs2;
  if (state.invFilter === 'games') list = games;
  if (state.invFilter === 'cat') list = cats;

  const search = ($('invSearchInput')?.value || '').trim().toLowerCase();
  if (search) list = list.filter(i => i.name.toLowerCase().includes(search));

  const sort = $('invSortSelect')?.value || 'new';
  const sorted = list.slice();
  if (sort === 'price-desc') sorted.sort((a, b) => b.price - a.price);
  else if (sort === 'price-asc') sorted.sort((a, b) => a.price - b.price);
  else if (sort === 'rarity') sorted.sort((a, b) => (rarityOf(b).order - rarityOf(a).order) || (b.price - a.price));
  else if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  return { sorted, counts: { all: state.inventory.length, school: school.length, cs2: cs2.length, games: games.length, cat: cats.length } };
}

function renderInventory() {
  const grid = $('inventoryGrid');
  if (!grid) return;

  const { sorted, counts } = inventoryList();

  $('countAll').textContent = counts.all;
  $('countSchool').textContent = counts.school;
  $('countCs2').textContent = counts.cs2;
  $('countGames').textContent = counts.games;
  $('countCat').textContent = counts.cat;

  const totalValue = state.inventory.reduce((sum, i) => sum + i.price, 0);
  $('invTotalValue').textContent = moneyText(totalValue, true);
  $('invTotalValue').title = moneyText(totalValue, false);
  const best = state.inventory.reduce((acc, it) => (!acc || it.price > acc.price ? it : acc), null);
  $('invBestItem').textContent = best ? best.name : '—';
  $('invBestItem').title = best ? `${best.name} — ${fmt(best.price)} ₽` : '';

  if (!sorted.length) {
    grid.innerHTML = `
      <div class="col-span-2 py-12 text-center text-slate-500 text-xs">
        Рюкзак пуст или фильтр ничего не нашёл.<br>Открой кейс или заработай монет на перемене 🍩
      </div>`;
    return;
  }

  grid.innerHTML = sorted.map(item => {
    const rarity = rarityOf(item);
    const cat = CATEGORIES[item.category] || CATEGORIES.other;
    const isCat = item.category === 'cat';
    const isNoSell = !!item.noSell;
    return `
      <div class="bg-slate-900/80 border rounded-2xl p-2.5 flex flex-col items-center justify-between text-center relative ${
        state.selectedDeposit && state.selectedDeposit.uid === item.uid ? 'item-selected' : 'border-slate-800'
      } ${isNoSell ? 'border-fuchsia-500/40' : ''}">
        <span class="absolute top-2 left-2 text-[9px] px-1.5 py-0.5 rounded font-bold border ${cat.badge}">${escapeHtml(itemDisplayCategory(item))}</span>
        ${isNoSell ? '<span class="absolute top-2 right-2 text-[10px] px-1 py-0.5 rounded bg-fuchsia-950/70 border border-fuchsia-500/50 text-fuchsia-300 font-bold">НЕ ПРОДАТЬ</span>' : (isCat ? '<span class="absolute top-2 right-2 text-[11px]">🐾</span>' : '')}
        <div class="my-1">${renderItemMedia(item, 'w-12 h-12 text-3xl')}</div>
        <span class="text-xs font-bold text-white line-clamp-1 w-full" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
        <span class="text-[11px] font-cs font-bold my-1" style="color:${rarity.color}">${fmt(item.price)} ₽</span>
        <div class="text-[8.5px] text-slate-500 mb-1">${escapeHtml(rarity.short)}</div>
        <div class="w-full grid grid-cols-2 gap-1.5 mt-1">
          <button data-act="dep" data-uid="${item.uid}" class="py-1 rounded-lg bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 border border-orange-500/30 text-[10px] font-bold transition">В деп</button>
          <button data-act="sell" data-uid="${item.uid}" ${isNoSell ? 'disabled' : ''} class="py-1 rounded-lg ${isNoSell ? 'bg-slate-900 text-slate-600 cursor-not-allowed border border-slate-800' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'} text-[10px] font-bold transition">${isNoSell ? 'Нельзя' : 'Продать'}</button>
        </div>
      </div>
    `;
  }).join('');
}

/** Делегирование кликов по рюкзаку (быстрее, чем сотни обработчиков) */
function handleInventoryClick(event) {
  const btn = event.target.closest('button[data-act]');
  if (!btn) return;
  if (btn.dataset.act === 'dep') pickForUpgrade(btn.dataset.uid);
  if (btn.dataset.act === 'sell') sellSingleItem(btn.dataset.uid);
}

function pickForUpgrade(uid) {
  const item = state.inventory.find(i => i.uid === uid);
  if (!item) return;
  state.selectedDeposit = item;
  audio.playTick();
  switchTab('upgrade');
  uiUpdate();
}

async function sellSingleItem(uid) {
  const idx = state.inventory.findIndex(i => i.uid === uid);
  if (idx === -1) return;
  const item = state.inventory[idx];

  // Предметы с флагом noSell нельзя продавать (например, Гора Богдана)
  if (item.noSell) {
    Toast.info(`«${escapeHtml(item.name)}» нельзя продать — это легендарный предмет! Его можно только апгрейднуть ⚡`);
    return;
  }

  if (item.price >= 1000000) {
    const ok = await ConfirmDialog.ask({
      icon: '💸',
      title: 'Продать легенду?',
      text: `«${escapeHtml(item.name)}» стоит ${fmt(item.price)} ₽. Точно продаём?`,
      okText: 'Продать'
    });
    if (!ok) return;
  }

  audio.init();
  audio.playCoin();
  state.balance += item.price;
  state.stats.earnedTotal = (state.stats.earnedTotal || 0) + item.price;
  state.stats.balanceMax = Math.max(state.stats.balanceMax || 0, state.balance);
  state.stats.itemsSold = (state.stats.itemsSold || 0) + 1;
  state.inventory.splice(idx, 1);
  if (state.selectedDeposit && state.selectedDeposit.uid === uid) {
    state.selectedDeposit = state.inventory[0] || null;
  }
  addXp(XP_REWARDS.sell, { silent: true });
  checkAchievements();
  uiUpdate();
  persist();
}

async function sellDuplicates() {
  const seen = new Set();
  const dupes = [];
  state.inventory.forEach(it => {
    if (it.noSell) return; // Непродаваемые предметы не участвуют в массовой продаже
    if (seen.has(it.id)) dupes.push(it);
    else seen.add(it.id);
  });

  if (!dupes.length) {
    Toast.info('Дубликатов нет — весь лут уникален!');
    return;
  }

  const gain = dupes.reduce((sum, d) => sum + d.price, 0);
  const ok = await ConfirmDialog.ask({
    icon: '♻️',
    title: 'Продать дубликаты?',
    text: `Будет продано <b>${dupes.length}</b> шт. на сумму <b class="text-amber-300">${fmt(gain)} ₽</b> (по одному предмету каждого вида остаётся).`,
    okText: 'Продать'
  });
  if (!ok) return;

  const dupeUids = new Set(dupes.map(d => d.uid));
  state.inventory = state.inventory.filter(it => !dupeUids.has(it.uid));
  state.balance += gain;
  state.stats.earnedTotal = (state.stats.earnedTotal || 0) + gain;
  state.stats.itemsSold = (state.stats.itemsSold || 0) + dupes.length;
  state.stats.balanceMax = Math.max(state.stats.balanceMax || 0, state.balance);
  if (state.selectedDeposit && dupeUids.has(state.selectedDeposit.uid)) state.selectedDeposit = state.inventory[0] || null;

  audio.playCoin();
  addXp(XP_REWARDS.sell * Math.min(dupes.length, 40), { silent: true });
  Toast.success(`Продано ${dupes.length} дубликатов на ${fmt(gain)} ₽`);
  checkAchievements();
  uiUpdate();
  persist(true);
}

/* --------------------------------------------------------------------------
   МОДАЛКА ВЫБОРА ПРЕДМЕТА
   -------------------------------------------------------------------------- */
function openItemPicker(type) {
  audio.init();
  audio.playTick();
  state.activeModalType = type;
  const modal = $('itemModal');
  const input = $('modalSearchInput');
  const filters = $('targetCategoryFilters');
  input.value = '';

  if (type === 'school') {
    $('modalTitle').textContent = 'Выбери предмет из рюкзака';
    $('modalSubtitle').textContent = 'Любая твоя вещь для ставки в апгрейдер';
    filters.classList.add('hidden');
  } else {
    $('modalTitle').textContent = 'Выбери желанную цель';
    $('modalSubtitle').textContent = 'Скины CS2, топ-предметы школы, лут из игр и котики';
    filters.classList.remove('hidden');
  }

  modal.classList.remove('hidden');
  syncModalState();
  renderModalItems();
}

function closeItemModal() {
  Modal.close('itemModal');
  state.activeModalType = null;
}

function setTargetCategory(cat) {
  state.targetFilter = cat;
  const map = { all: 'tgtCatAll', cs2: 'tgtCatCs2', school: 'tgtCatSchool', other: 'tgtCatOther', cat: 'tgtCatCat' };
  Object.values(map).forEach(id => {
    const el = $(id);
    if (el) el.className = 'filter-chip';
  });
  const active = $(map[cat]);
  if (active) active.className = 'filter-chip filter-chip-cyan-active';
  renderModalItems();
}

function filterModalItems() { renderModalItems(); }

function renderModalItems() {
  const grid = $('modalItemsGrid');
  const search = ($('modalSearchInput').value || '').toLowerCase().trim();
  grid.innerHTML = '';

  let list = [];
  if (state.activeModalType === 'school') {
    list = state.inventory.slice();
    if (!list.length) {
      grid.innerHTML = `
        <div class="col-span-2 py-8 text-center text-slate-500 text-xs">
          Твой рюкзак пуст!<br>
          <button onclick="closeItemModal(); switchTab('cases')" class="mt-3 px-3 py-1.5 rounded-lg bg-orange-500 text-black font-bold">Крутить школьные кейсы</button>
        </div>`;
      return;
    }
  } else {
    if (state.targetFilter === 'all') list = ALL_MASTER_ITEMS;
    else if (state.targetFilter === 'cs2') list = CS2_CATALOG;
    else if (state.targetFilter === 'school') list = SCHOOL_CATALOG;
    else if (state.targetFilter === 'other') list = OTHER_GAMES_CATALOG;
    else if (state.targetFilter === 'cat') list = CAT_CATALOG;
  }

  const filtered = list
    .filter(item => item.name.toLowerCase().includes(search))
    .sort((a, b) => a.price - b.price);

  grid.innerHTML = filtered.map(item => {
    const rarity = rarityOf(item);
    const selected = state.activeModalType === 'target'
      ? state.selectedTarget && state.selectedTarget.id === item.id
      : state.selectedDeposit && state.selectedDeposit.uid === item.uid;
    return `
      <div class="bg-slate-950/80 hover:bg-slate-800/80 border rounded-xl p-2.5 flex flex-col items-center text-center cursor-pointer transition active:scale-95 ${
        selected ? 'border-orange-500' : 'border-slate-800 hover:border-slate-600'
      }" data-item-id="${item.id}" data-uid="${item.uid || ''}">
        <div class="mb-1">${renderItemMedia(item, 'w-11 h-11 text-2xl')}</div>
        <span class="text-xs font-bold text-slate-200 line-clamp-1 w-full">${escapeHtml(item.name)}</span>
        <span class="text-[11px] font-cs font-bold mt-0.5" style="color:${rarity.color}">${fmt(item.price)} ₽</span>
        <span class="text-[9px] text-slate-400">${escapeHtml(itemDisplayCategory(item))}</span>
      </div>
    `;
  }).join('');

  if (!filtered.length) {
    grid.innerHTML = '<div class="col-span-2 py-8 text-center text-slate-500 text-xs">Ничего не найдено 🔍</div>';
  }
}

function handleModalItemsClick(event) {
  const card = event.target.closest('[data-item-id]');
  if (!card) return;
  const id = card.dataset.itemId;
  const uid = card.dataset.uid;
  let item = null;
  if (state.activeModalType === 'school') item = state.inventory.find(i => i.uid === uid);
  else item = ITEMS_BY_ID[id];
  if (!item) return;
  selectItemFromModal(item);
}

function selectItemFromModal(item) {
  if (state.activeModalType === 'school') state.selectedDeposit = item;
  else state.selectedTarget = item;
  audio.playTick();
  closeItemModal();
  uiUpdate();
}

/* --------------------------------------------------------------------------
   МАГАЗИН + КЛИКЕР
   -------------------------------------------------------------------------- */
const SHOP_EXCLUDED = ['sch_golden_diary', 'sch_timetable_relic'];

function renderShop() {
  const list = $('shopList');
  if (!list) return;

  const items = SCHOOL_CATALOG.filter(i => !SHOP_EXCLUDED.includes(i.id));
  $('shopCountLabel').textContent = `${items.length} позиций`;

  list.innerHTML = items.map(item => {
    const rarity = rarityOf(item);
    const canAfford = state.balance >= item.price;
    return `
      <div class="bg-slate-900/80 border border-slate-800/80 rounded-xl p-2.5 flex items-center justify-between gap-2">
        <div class="flex items-center space-x-2.5 min-w-0">
          <div class="flex-shrink-0">${renderItemMedia(item, 'w-10 h-10 text-2xl')}</div>
          <div class="min-w-0">
            <div class="text-xs font-bold text-white line-clamp-1">${escapeHtml(item.name)}</div>
            <div class="text-[10px] text-slate-400 line-clamp-1">${escapeHtml(item.desc || '')}</div>
            <div class="text-[11px] font-cs font-bold" style="color:${rarity.color}">${fmt(item.price)} ₽</div>
          </div>
        </div>
        <button data-buy="${item.id}" ${canAfford ? '' : 'disabled'} class="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold font-cs transition ${
          canAfford ? 'bg-orange-500 text-black hover:brightness-110 active:scale-95' : 'bg-slate-800 text-slate-500 cursor-not-allowed'
        }">Купить</button>
      </div>
    `;
  }).join('');

  const tapValue = tapMoneyValue();
  if (state.balance >= 100000 && !state.stats.tapFarmClosed) { state.stats.tapFarmClosed = true; persist(true); }
  const tapLocked = !!state.stats.tapFarmClosed || state.balance >= 100000;
  const tapButton = $('tapMoneyButton');
  $('tapValueLabel').textContent = tapLocked
    ? 'Фарм закрыт: достигнут лимит 100 000 ₽'
    : `+${fmt(tapValue)} ₽ за каждый тап · осталось до лимита: ${fmt(Math.max(0, 100000 - state.balance))} ₽`;
  if (tapButton) {
    tapButton.disabled = tapLocked;
    tapButton.classList.toggle('opacity-40', tapLocked);
    tapButton.classList.toggle('grayscale', tapLocked);
    tapButton.title = tapLocked ? 'Фарм закрыт после достижения 100 000 ₽' : 'Стрельнуть мелочь';
  }
}

function tapMoneyValue() {
  return 150 + (state.stats.level - 1) * 60;
}

function handleShopClick(event) {
  const btn = event.target.closest('button[data-buy]');
  if (!btn || btn.disabled) return;
  buySchoolItem(btn.dataset.buy);
}

function buySchoolItem(id) {
  const proto = SCHOOL_CATALOG.find(i => i.id === id);
  if (!proto || state.balance < proto.price) return;
  audio.init();
  audio.playCoin();
  spendMoney(proto.price);
  const newItem = Object.assign({}, proto, { uid: RNG.uid('shop') });
  state.inventory.unshift(newItem);
  if (!state.selectedDeposit) state.selectedDeposit = newItem;
  Toast.success(`Куплено: ${escapeHtml(proto.name)} за ${fmt(proto.price)} ₽`);
  uiUpdate();
  persist();
}

function tapForMoney(event) {
  if (state.stats.tapFarmClosed || state.balance >= 100000) {
    state.stats.tapFarmClosed = true;
    persist(true);
    uiUpdate();
    Toast.info('«Стрельнуть мелочь» закрыто: достигнут лимит 100 000 ₽.');
    return;
  }
  audio.init();
  audio.playCoin();
  haptic(8);
  const value = tapMoneyValue();
  state.balance += value;
  if (state.balance >= 100000) {
    state.stats.tapFarmClosed = true;
    Toast.gold('Лимит фарма достигнут: 100 000 ₽. «Стрельнуть мелочь» закрыто.', 5000);
  }
  state.stats.earnedTotal = (state.stats.earnedTotal || 0) + value;
  state.stats.balanceMax = Math.max(state.stats.balanceMax || 0, state.balance);
  floatMoney(event ? event.clientX : window.innerWidth / 2, event ? event.clientY : 140, `+${fmt(value)}₽`);
  addXp(1, { silent: true });
  uiUpdate();
  persist();
}

/* --------------------------------------------------------------------------
   МИНИ-ИГРА «ПЕРЕМЕНА»
   -------------------------------------------------------------------------- */
const mCanvas = $('miniGameCanvas');
const mCtx = (() => {
  try { return mCanvas ? mCanvas.getContext('2d') : null; } catch (e) { return null; }
})();
let mGameRunning = false;
let mPlayerX = 140;
let mLives = 3;
let mScore = 0;
let mCombo = 0;
let mDrops = [];
let mLastDropTime = 0;
let mAnimationId = null;
let mLastGameLoopTime = 0;

function initMiniGameCanvas() {
  if (!mCanvas) return;
  const rect = mCanvas.getBoundingClientRect();
  const dpr = Quality.canvasDpr();
  mCanvas.width = Math.max(200, rect.width * dpr);
  mCanvas.height = Math.max(200, rect.height * dpr);
  mPlayerX = mCanvas.width / 2;
}

function toggleMiniGame() {
  if (!mCanvas || !mCtx) {
    Toast.error('Твой браузер не поддерживает canvas — мини-игра недоступна 😔');
    return;
  }
  audio.init();
  audio.playTick();
  const overlay = $('gameOverlay');
  const btn = $('btnGameControl');

  if (!mGameRunning) {
    initMiniGameCanvas();
    mGameRunning = true;
    mLives = 3;
    mScore = 0;
    mCombo = 0;
    mDrops = [];
    mLastDropTime = 0;
    overlay.classList.add('hidden');
    btn.textContent = 'Стоп';
    btn.className = 'px-4 py-2 rounded-xl bg-red-600 text-white font-cs font-bold text-xs uppercase tracking-wider';
    mLastGameLoopTime = performance.now();
    mAnimationId = requestAnimationFrame(miniGameLoop);
  } else {
    stopMiniGame();
  }
}

function stopMiniGame() {
  mGameRunning = false;
  if (mAnimationId) cancelAnimationFrame(mAnimationId);
  const overlay = $('gameOverlay');
  const btn = $('btnGameControl');
  if (overlay) {
    overlay.innerHTML = `
      <div class="text-4xl mb-2">🏃‍♂️🎒</div>
      <div class="font-cs font-bold text-base text-white mb-1">Звонок на перемену!</div>
      <p class="text-xs text-slate-400 mb-3 max-w-[220px]">Лови пятёрки и пирожки (+₽), рыбки дают жизнь. Три двойки — звонок на урок!</p>
      <button onclick="toggleMiniGame()" class="px-5 py-2.5 bg-orange-500 text-black rounded-xl font-cs font-bold text-xs uppercase">Погнали!</button>
    `;
    overlay.classList.remove('hidden');
  }
  if (btn) {
    btn.textContent = 'Старт игры';
    btn.className = 'px-4 py-2 rounded-xl bg-orange-500 text-black font-cs font-bold text-xs uppercase tracking-wider hover:brightness-110 active:scale-95 shadow-md';
  }
}

function miniGameLoop(now) {
  if (!mGameRunning) return;
  const dt = Math.min((now - mLastGameLoopTime) / 1000, 0.1);
  mLastGameLoopTime = now;
  const scale = mCanvas.width / 320;

  if (now - mLastDropTime > Math.max(280, 560 - state.stats.level * 12)) {
    mLastDropTime = now;
    const roll = RNG.float();
    let kind;
    if (roll > 0.42) kind = { good: true, type: RNG.float() > 0.35 ? '5️⃣' : '🥟', value: 220 };
    else if (roll > 0.34) kind = { good: true, type: '🐟', value: 400, heal: true };
    else if (roll > 0.14) kind = { good: false, type: RNG.float() > 0.4 ? '2️⃣' : '📏', value: 0 };
    else kind = { good: true, type: '🐱', value: 900 };

    mDrops.push({
      x: Math.random() * (mCanvas.width - 40 * scale) + 20 * scale,
      y: -20,
      speed: (180 + Math.random() * 130) * (mCanvas.height / 400) * (1 + state.stats.level * 0.02),
      isGood: kind.good,
      type: kind.type,
      value: kind.value,
      heal: !!kind.heal,
      size: 26 * scale
    });
  }

  for (let i = mDrops.length - 1; i >= 0; i--) {
    const d = mDrops[i];
    d.y += d.speed * dt;

    const playerY = mCanvas.height - 40 * scale;
    const dist = Math.hypot(d.x - mPlayerX, d.y - playerY);

    if (dist < 36 * scale) {
      if (d.isGood) {
        audio.playCoin();
        const comboBonus = Math.round(1 + mCombo * 0.1 * 10) / 10;
        const gain = Math.round(d.value * comboBonus);
        mScore += gain;
        mCombo += 1;
        addMoney(gain, { silent: true, countEarned: true });
        if (d.heal && mLives < 5) {
          mLives += 1;
          Toast.info('Рыбка! +1 жизнь ❤️', 1600);
        }
        floatMoney(mCanvas.getBoundingClientRect().left + (d.x / scale), mCanvas.getBoundingClientRect().top + (d.y / scale), `+${fmt(gain)}₽`);
      } else {
        audio.playLoss();
        haptic(30);
        mCombo = 0;
        mLives -= 1;
        if (mLives <= 0) {
          mDrops.splice(i, 1);
          endMiniGame();
          return;
        }
      }
      mDrops.splice(i, 1);
      continue;
    }

    if (d.y > mCanvas.height + 20) mDrops.splice(i, 1);
  }

  mCtx.clearRect(0, 0, mCanvas.width, mCanvas.height);

  mCtx.strokeStyle = 'rgba(255,255,255,0.04)';
  mCtx.lineWidth = 1;
  for (let x = 0; x < mCanvas.width; x += 30 * scale) {
    mCtx.beginPath();
    mCtx.moveTo(x, 0);
    mCtx.lineTo(x, mCanvas.height);
    mCtx.stroke();
  }

  mCtx.textAlign = 'center';
  mCtx.textBaseline = 'middle';
  mDrops.forEach(d => {
    mCtx.font = `${d.size}px sans-serif`;
    mCtx.fillText(d.type, d.x, d.y);
  });

  const pY = mCanvas.height - 35 * scale;
  mCtx.font = `${36 * scale}px sans-serif`;
  mCtx.fillText('🎒', mPlayerX, pY);

  $('gameScoreText').textContent = moneyText(mScore, true);
  $('gameScoreText').title = moneyText(mScore, false);
  $('gameLivesText').textContent = '❤️'.repeat(Math.max(0, mLives));
  $('gameBestScore').textContent = moneyText(Math.max(state.stats.miniBest || 0, mScore), true);
  $('gameBestScore').title = moneyText(Math.max(state.stats.miniBest || 0, mScore), false);

  mAnimationId = requestAnimationFrame(miniGameLoop);
}

function endMiniGame() {
  const score = mScore;
  mGameRunning = false;
  if (mAnimationId) cancelAnimationFrame(mAnimationId);

  const isRecord = score > (state.stats.miniBest || 0);
  if (isRecord) state.stats.miniBest = score;
  state.stats.miniCaught = (state.stats.miniCaught || 0) + 1;

  audio.playLoss();
  addXp(XP_REWARDS.miniGameEnd + Math.floor(score / 5000), { silent: true });
  checkAchievements();
  persist(true);

  const overlay = $('gameOverlay');
  const btn = $('btnGameControl');
  if (overlay) {
    overlay.innerHTML = `
      <div class="text-4xl mb-2">🔔</div>
      <div class="font-cs font-bold text-base text-white mb-1">Звонок на урок!</div>
      <p class="text-xs text-slate-300 mb-1">Ты налутал: <span class="text-amber-400 font-bold">${fmt(score)} ₽</span></p>
      ${isRecord ? '<p class="text-[11px] text-emerald-400 font-bold mb-1">🏆 Новый личный рекорд!</p>' : ''}
      <button onclick="toggleMiniGame()" class="mt-2 px-5 py-2.5 bg-orange-500 text-black rounded-xl font-cs font-bold text-xs uppercase">Сыграть ещё</button>
    `;
    overlay.classList.remove('hidden');
  }
  if (btn) {
    btn.textContent = 'Старт игры';
    btn.className = 'px-4 py-2 rounded-xl bg-orange-500 text-black font-cs font-bold text-xs uppercase tracking-wider hover:brightness-110 active:scale-95 shadow-md';
  }
}

function handleGameInput(e) {
  if (!mGameRunning) return;
  const rect = mCanvas.getBoundingClientRect();
  const clientX = e.touches ? e.touches[0].clientX : e.clientX;
  const relX = (clientX - rect.left) * (mCanvas.width / rect.width);
  mPlayerX = clamp(relX, 30, mCanvas.width - 30);
}

/* --------------------------------------------------------------------------
   ДЕЖУРСТВО ПО ШКОЛЕ (IDLE)
   -------------------------------------------------------------------------- */
function idleAps() {
  const lvl = clamp(state.stats.idle.level || 0, 0, IDLE_LEVELS.length);
  if (!lvl) return 0;
  const cfg = IDLE_LEVELS[Math.min(lvl, IDLE_LEVELS.length) - 1];
  return cfg ? cfg.aps : 0;
}

function nextIdleLevel() {
  const lvl = state.stats.idle.level || 0;
  return IDLE_LEVELS.find(l => l.level === lvl + 1) || null;
}

function renderFarm() {
  const level = state.stats.idle.level || 0;
  const pending = state.stats.idle.pending || 0;

  $('idleLevelText').textContent = `ур. ${level}`;
  $('idleApsText').textContent = `${shortMoney(idleAps())} ₽/сек`;
  $('idleApsText').title = `${moneyText(idleAps(), false)}/сек`;
  $('idlePendingText').textContent = moneyText(pending, true);
  $('idlePendingText').title = moneyText(pending, false);
  $('btnCollectIdle').disabled = pending < 1;
  $('btnCollectIdle').className = pending >= 1
    ? 'px-3 py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 font-bold text-[11px] transition active:scale-95'
    : 'px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-500 font-bold text-[11px] cursor-not-allowed';

  $('gameBestScore').textContent = moneyText(state.stats.miniBest || 0, true);
  $('gameBestScore').title = moneyText(state.stats.miniBest || 0, false);
  $('dailyStreakLabel').textContent = `стрик: ${state.stats.dailyStreak || 0}`;

  const list = $('idleUpgradeList');
  if (list) {
    list.innerHTML = IDLE_LEVELS.map(cfg => {
      const current = state.stats.idle.level || 0;
      const owned = current >= cfg.level;
      const available = current + 1 === cfg.level;
      const canAfford = state.balance >= cfg.cost;
      const name = IDLE_NAMES[Math.min(cfg.level - 1, IDLE_NAMES.length - 1)];
      return `
        <div class="flex items-center justify-between gap-2 bg-slate-950/70 border border-slate-800 rounded-xl p-2 ${owned ? 'opacity-75' : ''}">
          <div class="min-w-0">
            <div class="text-[11px] font-bold text-slate-200 line-clamp-1">Ур. ${cfg.level} · ${escapeHtml(name)}</div>
            <div class="text-[10px] text-emerald-400">+${fmt(cfg.aps)} ₽/сек</div>
          </div>
          <button data-idle="${cfg.level}" ${owned || !available || !canAfford ? 'disabled' : ''} class="flex-shrink-0 px-2.5 py-1.5 rounded-lg text-[10px] font-bold font-cs transition ${
            owned ? 'bg-slate-800 text-emerald-400 cursor-default'
              : (!available ? 'bg-slate-800 text-slate-500 cursor-not-allowed'
                : (canAfford ? 'bg-emerald-500 text-black hover:brightness-110 active:scale-95' : 'bg-slate-800 text-slate-500 cursor-not-allowed'))
          }">${owned ? '✓ есть' : (!available ? '🔒 заблокировано' : `Купить · ${shortMoney(cfg.cost)}`)}</button>
        </div>
      `;
    }).join('');
  }

  renderPromoList();
  renderDailyModalIfOpen();
}

function handleIdleClick(event) {
  const btn = event.target.closest('button[data-idle]');
  if (!btn || btn.disabled) return;
  buyIdleLevel(parseInt(btn.dataset.idle, 10));
}

function buyIdleLevel(level) {
  const cfg = IDLE_LEVELS.find(l => l.level === level);
  if (!cfg) return;
  if ((state.stats.idle.level || 0) + 1 !== level) return;
  if (state.balance < cfg.cost) {
    Toast.error(`Нужно ${fmt(cfg.cost)} ₽ для повышения дежурства`);
    return;
  }
  audio.init();
  audio.playCoin();
  spendMoney(cfg.cost);
  state.stats.idle.level = level;
  state.stats.idle.lastCollect = Date.now();
  Toast.success(`Дежурство ур. ${level}: +${fmt(cfg.aps)} ₽/сек`);
  addXp(40 + level * 20);
  uiUpdate();
  persist(true);
}

function collectIdle() {
  const pending = Math.floor(state.stats.idle.pending || 0);
  if (pending < 1) return;
  audio.init();
  audio.playCoin();
  state.stats.idle.pending = 0;
  state.stats.idle.lastCollect = Date.now();
  state.stats.idleCollected = (state.stats.idleCollected || 0) + pending;
  addMoney(pending, { silent: true, countEarned: true });
  addXp(XP_REWARDS.idleCollect, { silent: true });
  Toast.success(`Собрано с дежурства: ${fmt(pending)} ₽`);
  checkAchievements();
  uiUpdate();
  persist(true);
}

function startIdleTicker() {
  setInterval(() => {
    const aps = idleAps();
    if (!aps) return;
    state.stats.idle.pending = (state.stats.idle.pending || 0) + aps;
    state.stats.idle.lastCollect = Date.now();
    if (viewVisible('viewFarm')) {
      $('idlePendingText').textContent = moneyText(state.stats.idle.pending, true);
      $('idlePendingText').title = moneyText(state.stats.idle.pending, false);
      $('btnCollectIdle').disabled = false;
      $('btnCollectIdle').className = 'px-3 py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 font-bold text-[11px] transition active:scale-95';
    }
    if (Math.random() < 0.08) persist();
  }, 1000);
}

function applyOfflineIdleIncome() {
  const aps = idleAps();
  if (!aps) return;
  const lastSeen = state.prevLastSeen || state.stats.lastSeen || Date.now();
  const elapsed = Math.max(0, Math.min((Date.now() - lastSeen) / 1000, IDLE_OFFLINE_CAP_H * 3600));
  if (elapsed < 60) return;
  const earned = Math.floor(aps * elapsed * IDLE_OFFLINE_RATE);
  if (earned < 1) return;
  state.stats.idle.pending = (state.stats.idle.pending || 0) + earned;
  setTimeout(() => {
    Toast.info(`Пока тебя не было (${Math.round(elapsed / 60)} мин), дежурство накопило <b>${fmt(earned)} ₽</b>. Забери в разделе «Фарм»!`, 6000);
  }, 1400);
}

/* --------------------------------------------------------------------------
   ЕЖЕДНЕВНАЯ НАГРАДА
   -------------------------------------------------------------------------- */
function dailyDayIndex() {
  return clamp(((state.stats.dailyStreak || 0) % DAILY_REWARDS.length), 0, DAILY_REWARDS.length - 1);
}

function canClaimDaily() {
  const last = state.stats.lastDailyClaim || 0;
  if (!last) return true;
  const hoursPassed = (Date.now() - last) / 3600000;
  return hoursPassed >= 20;
}

function updateDailyIndicator() {
  const dot = $('dailyDot');
  if (!dot) return;
  dot.classList.toggle('hidden', !canClaimDaily());
}

function openDailyModal() {
  audio.init();
  audio.playTick();
  renderDailyModal();
  Modal.open('dailyModal');
}

function closeDailyModal() { Modal.close('dailyModal'); }

function renderDailyModal() {
  const grid = $('dailyGrid');
  if (!grid) return;
  const claimedToday = !canClaimDaily();
  const dayIdx = dailyDayIndex();

  grid.innerHTML = DAILY_REWARDS.map((d, i) => {
    const claimed = i < dayIdx || (i === dayIdx && claimedToday);
    const isNext = i === dayIdx && !claimedToday;
    return `
      <div class="rounded-xl border p-2 text-center ${
        claimed ? 'bg-emerald-950/40 border-emerald-700/60' : (isNext ? 'bg-orange-950/40 border-orange-500/70' : 'bg-slate-950/70 border-slate-800')
      }">
        <div class="text-xl">${d.icon}</div>
        <div class="text-[9px] text-slate-400">День ${d.day}</div>
        <div class="text-[10px] font-cs font-bold ${claimed ? 'text-emerald-300' : 'text-amber-300'}">${shortMoney(d.money)} ₽</div>
        ${claimed ? '<div class="text-[9px] text-emerald-400">получено ✓</div>' : ''}
      </div>
    `;
  }).join('');

  $('dailyStreakText').textContent = `${state.stats.dailyStreak || 0} дней`;
  $('dailyNextText').textContent = moneyText(DAILY_REWARDS[dayIdx].money, true);
  $('dailyNextText').title = moneyText(DAILY_REWARDS[dayIdx].money, false);

  const btn = $('btnClaimDaily');
  if (claimedToday) {
    btn.disabled = true;
    btn.textContent = 'Уже получено — приходи завтра!';
    btn.className = 'mt-3 w-full py-3 rounded-xl bg-slate-800 text-slate-500 font-cs font-bold text-xs uppercase tracking-wider cursor-not-allowed';
  } else {
    btn.disabled = false;
    btn.textContent = `Забрать ${fmt(DAILY_REWARDS[dayIdx].money)} ₽`;
    btn.className = 'btn-shine mt-3 w-full py-3 rounded-xl bg-gradient-to-r from-fuchsia-600 to-purple-600 text-white font-cs font-bold text-xs uppercase tracking-wider active:scale-95 transition';
  }
}

function renderDailyModalIfOpen() {
  if (Modal.isOpen('dailyModal')) renderDailyModal();
}

function claimDaily() {
  if (!canClaimDaily()) {
    Toast.info('Награда уже получена — приходи завтра!');
    return;
  }
  const last = state.stats.lastDailyClaim || 0;
  const hoursPassed = last ? (Date.now() - last) / 3600000 : 0;
  if (last && hoursPassed > DAILY_STREAK_RESET_HOURS) state.stats.dailyStreak = 0;

  state.stats.dailyStreak = (state.stats.dailyStreak || 0) + 1;
  state.stats.lastDailyClaim = Date.now();

  const reward = DAILY_REWARDS[dailyDayIndex()];
  audio.init();
  audio.playLevelUp();
  addMoney(reward.money, { silent: true, countEarned: true });
  addXp(35 + state.stats.dailyStreak * 5, { silent: true });
  Fx.burst(90, ['#a855f7', '#ec4899', '#fbbf24']);
  Toast.gold(`День ${state.stats.dailyStreak}: +${fmt(reward.money)} ₽ (${reward.label})`, 4500);
  checkAchievements();
  renderDailyModal();
  updateDailyIndicator();
  uiUpdate();
  persist(true);
}

/* --------------------------------------------------------------------------
   ПРОМОКОДЫ
   -------------------------------------------------------------------------- */
function redeemPromo() {
  const input = $('promoInput');
  // Нормализация: убираем пробелы, приводим к верхнему регистру (промокоды не чувствительны к пробелам)
  const code = (input.value || '').replace(/\s+/g, '').toUpperCase();
  if (!code) {
    Toast.error('Введи промокод');
    return;
  }

  if (code === 'ADMIN' + ADMIN_CODE) {
    input.value = '';
    state.rigReady = true;
    openAdminModal();
    Toast.info('Привет, разработчик! Панель открыта 👑');
    return;
  }

  if (state.stats.promosUsed.includes(code)) {
    Toast.info('Этот промокод уже активирован');
    return;
  }

  // ===== ПРОВЕРКА VIP-КОДОВ (одноразовые, за реальные 150 ₽ на FunPay) =====
  if (VIP_CODES.includes(code)) {
    if (state.stats.usedVipCodes && state.stats.usedVipCodes.includes(code)) {
      Toast.error('Этот VIP-код уже был использован. Каждый код работает только один раз.');
      return;
    }
    if (state.stats.vipActive) {
      Toast.info('У тебя уже активирован VIP-статус 👑');
      return;
    }
    // Активируем вечный VIP
    state.stats.vipActive = true;
    state.stats.vipActivatedAt = Date.now();
    state.stats.vipCode = code;
    if (!state.stats.usedVipCodes) state.stats.usedVipCodes = [];
    state.stats.usedVipCodes.push(code);
    state.stats.promosUsed.push(code);
    if (!state.stats.unlockedTitles.includes('👑 VIP Игрок')) {
      state.stats.unlockedTitles.push('👑 VIP Игрок');
    }
    audio.init();
    audio.playSecret();
    Fx.secretRain();
    Fx.gold(300);
    addXp(1000, { silent: true });
    Toast.gold('👑 VIP-СТАТУС АКТИВИРОВАН НАВСЕГДА! Налог миллионера отключён — шансы всегда честные, как при маленьком балансе! Спасибо за поддержку! 💎', 9000);
    input.value = '';
    checkAchievements();
    renderPromoList();
    uiUpdate();
    persist(true);
    return;
  }

  const promo = PROMO_CODES[code];
  if (!promo) {
    Toast.error('Такого промокода нет. Ищи коды в видео David Lite или VIP-код в лоте на FunPay!');
    return;
  }

  state.stats.promosUsed.push(code);
  audio.init();

  let rewardText = '';

  // Денежная награда
  if (promo.money && promo.money > 0) {
    addMoney(promo.money, { silent: true, countEarned: true });
    rewardText += `+${fmt(promo.money)} ₽`;
  }

  // Опыт
  if (promo.xp && promo.xp > 0) {
    addXp(promo.xp, { silent: true });
    if (rewardText) rewardText += ' и ';
    rewardText += `${promo.xp} XP`;
  }

  // Предметная награда (например, легендарный котик)
  if (promo.item) {
    const proto = ITEMS_BY_ID[promo.item];
    if (proto) {
      const newItem = Object.assign({}, proto, { uid: RNG.uid('promo'), wonAt: nowTimeLabel() });
      state.inventory.unshift(newItem);
      trackBiggestDrop(newItem);

      // Особый случай: Кот Гора Богдана
      if (promo.item === 'cat_gora_bogdan') {
        state.stats.catFound = true;
        if (!state.stats.unlockedTitles.includes('Легенда Горы Богдана')) {
          state.stats.unlockedTitles.push('Легенда Горы Богдана');
        }
        audio.playSecret();
        Fx.secretRain();
        Fx.thunder();
      } else {
        audio.playWin();
        Fx.gold(180);
      }

      if (!state.selectedDeposit) state.selectedDeposit = newItem;
      if (rewardText) rewardText += ' и ';
      rewardText += `<b>${escapeHtml(proto.name)}</b> 🎁`;
    }
  }

  if (!rewardText) {
    audio.playLevelUp();
    Fx.burst(80);
  } else {
    audio.playLevelUp();
    Fx.burst(120);
  }

  Toast.success(`Промокод <b>${code}</b> активирован: ${rewardText}! ${promo.label ? '· ' + promo.label : ''}`, 6000);
  input.value = '';
  checkAchievements();
  renderPromoList();
  uiUpdate();
  persist(true);
}

/* --------------------------------------------------------------------------
   ЗАКРЫТЫЙ БЕТА-ТЕСТ (доступ по скрытому коду)
   Поле кода живёт в настройках — «Лаборатория / Бета-тестирование», тумблер
   3.6 Beta и вся механика тестовой ветки — js/betaManager.js.
   -------------------------------------------------------------------------- */
function redeemBetaCode(inputId = 'betaLabCodeInput') {
  const input = $(inputId);
  const raw = ((input && input.value) || '').replace(/\s+/g, '');
  if (!raw) {
    Toast.error('Введи код доступа');
    return;
  }
  if (state.stats.betaTester) {
    Toast.info('Бета-доступ уже активирован 🧪 — теперь включай ветку 3.6 Beta кнопкой выше.');
    if (input) input.value = '';
    if (typeof BetaMode !== 'undefined') BetaMode.renderLab();
    return;
  }

  // Код в открытом виде в игре не хранится — сравниваем только хеши
  if (betaCodeHash(raw) !== BETA_CODE_HASH) {
    if (input) input.value = '';
    audio.init();
    audio.playLoss();
    Toast.error('Неверный код. Доступ к закрытому бета-тесту выдаёт только автор проекта.');
    return;
  }

  state.stats.betaTester = true;
  state.stats.betaActivatedAt = Date.now();
  if (!state.stats.unlockedTitles.includes(BETA_TITLE)) {
    state.stats.unlockedTitles.push(BETA_TITLE);
  }

  audio.init();
  audio.playSecret();
  Fx.secretRain();
  Fx.burst(140, ['#22d3ee', '#0ea5e9', '#fbbf24']);
  addMoney(BETA_REWARD.money, { silent: true, countEarned: true });
  addXp(BETA_REWARD.xp, { silent: true });

  Toast.gold(`🧪 ДОСТУП К ЗАКРЫТОМУ БЕТА-ТЕСТУ АКТИВИРОВАН! +${fmt(BETA_REWARD.money)} ₽, +${BETA_REWARD.xp} XP и титул «${BETA_TITLE}». Теперь жми «Включить 3.6 Beta»!`, 9000);

  if (input) input.value = '';
  checkAchievements();
  if (typeof BetaMode !== 'undefined') BetaMode.renderLab();
  uiUpdate();
  persist(true);
}

function renderPromoList() {
  const box = $('promoList');
  if (!box) return;
  if (!state.stats.promosUsed.length) {
    const vipHint = state.stats.vipActive
      ? '<br><span class="text-amber-400">👑 VIP-статус активен — налог миллионера отключён навсегда!</span>'
      : `<br><span class="text-fuchsia-400">VIP за ${VIP_PRICE_RUB}₽ отключает налог миллионера навсегда</span>`;
    box.innerHTML = `<span class="text-[10px] text-slate-500">Пока ни один код не активирован. Подсказка: следи за видео David Lite 🎬<br><span class="text-fuchsia-400">Коды обновления 3.0.2: NEWUPDATE2026, GORABOGDAN5G</span>${vipHint}</span>`;
    return;
  }
  box.innerHTML = state.stats.promosUsed.map(code => {
    const isVip = code.startsWith('VIP-') && VIP_CODES.includes(code);
    if (isVip) {
      return `<span class="text-[9px] px-2 py-0.5 rounded-full bg-amber-950/70 border border-amber-600/60 text-amber-300 font-mono" title="VIP активирован навечно">👑 ${escapeHtml(code)} ✓ · ВЕЧНЫЙ VIP</span>`;
    }
    const p = PROMO_CODES[code];
    let rewardLabel = '';
    if (p) {
      if (p.item) {
        const it = ITEMS_BY_ID[p.item];
        rewardLabel = ' · ' + (it ? it.name : 'предмет');
      } else if (p.money) {
        rewardLabel = ' · ' + fmt(p.money) + '₽';
      }
    }
    return `<span class="text-[9px] px-2 py-0.5 rounded-full bg-emerald-950/60 border border-emerald-800 text-emerald-300 font-mono">${escapeHtml(code)} ✓${rewardLabel}</span>`;
  }).join('');
}

/* --------------------------------------------------------------------------
   ПРОФИЛЬ
   -------------------------------------------------------------------------- */
function openProfileModal() {
  audio.init();
  audio.playTick();
  const modal = $('profileModal');
  const regView = $('profileRegisterView');
  const logView = $('profileLoggedInView');

  if (!state.user) {
    $('profileModalTitle').textContent = 'Создание профиля ученика';
    regView.classList.remove('hidden');
    logView.classList.add('hidden');
  } else {
    $('profileModalTitle').textContent = 'Личный кабинет';
    regView.classList.add('hidden');
    logView.classList.remove('hidden');
    renderProfile();
  }
  Modal.open('profileModal');
}

function closeProfileModal() { Modal.close('profileModal'); }

function selectRegAvatar(emoji) {
  state.tempRegAvatar = emoji;
  document.querySelectorAll('#avatarSelector button').forEach(b => {
    b.className = b.textContent === emoji ? 'avatar-btn avatar-btn-active' : 'avatar-btn';
  });
  audio.playTick();
}

function openExtrasModal() { updateVipCardVisibility(); if (typeof BetaMode !== 'undefined') BetaMode.renderLab(); Modal.open('extrasModal'); }

function updateVipCardVisibility() {
  const vipStatusCard = $('vipStatusCard');
  const vipBuyCard = $('vipBuyCard');
  if (!vipStatusCard || !vipBuyCard) return;
  const vipActive = !!(state && state.stats && state.stats.vipActive);
  vipStatusCard.classList.toggle('hidden', !vipActive);
  vipBuyCard.classList.toggle('hidden', vipActive);
}
function closeExtrasModal() { Modal.close('extrasModal'); }

function submitRegistration() {
  const nick = ($('regNicknameInput').value || '').trim();
  const grade = ($('regGradeInput').value || '').trim();

  if (nick.length < 2) {
    Toast.error('Введи никнейм (минимум 2 символа)');
    return;
  }

  audio.init();
  audio.playWin();
  state.user = {
    id: RNG.uid('player'),
    nick: nick.slice(0, 18),
    avatar: state.tempRegAvatar || '🎒',
    grade: grade || 'Ученик школы',
    joinedAt: new Date().toLocaleDateString('ru-RU')
  };

  // Если профиль создаётся при включённой 3.6 Beta — ник сразу становится «Тест»
  if (typeof BetaMode !== 'undefined') BetaMode.onUserCreated();

  addMoney(2500, { silent: true, countEarned: true });
  Fx.burst(100);
  Toast.success(`Профиль создан: ${escapeHtml(state.user.nick)}! Приветственный бонус +2 500 ₽ 🎒`);
  persist(true);
  openProfileModal();
  uiUpdate();
}

function logoutProfile() {
  ConfirmDialog.ask({
    icon: '👤',
    title: 'Сменить профиль?',
    text: 'Аккаунт не удаляется, но прогресс останется привязан к текущему сохранению.',
    okText: 'Сменить'
  }).then(ok => {
    if (!ok) return;
    state.user = null;
    persist(true);
    uiUpdate();
    openProfileModal();
  });
}

function switchProfileTab(tab) {
  state.profileTab = tab;
  ['profile', 'stats', 'ach'].forEach(t => {
    const btn = $('profTab' + t.charAt(0).toUpperCase() + t.slice(1));
    const panel = $('profPanel' + t.charAt(0).toUpperCase() + t.slice(1));
    if (btn) btn.className = `prof-tab ${t === tab ? 'prof-tab-active' : ''}`;
    if (panel) panel.classList.toggle('hidden', t !== tab);
  });
  audio.playTick();
  if (tab === 'ach') renderAchievements();
}

function renderProfile() {
  if (!state.user) return;
  const rank = rankForLevel(state.stats.level);
  const next = nextRankForLevel(state.stats.level);
  const xpNow = state.stats.xp;
  const xpStart = rank.xp;
  const xpNext = next ? next.xp : rank.xp;
  const percent = next ? clamp(((xpNow - xpStart) / Math.max(1, xpNext - xpStart)) * 100, 0, 100) : 100;

  $('profileViewAvatar').textContent = state.user.avatar || '🎒';
  $('profileViewNick').textContent = state.user.nick;
  $('profileViewGrade').textContent = state.user.grade || 'Ученик школы';
  $('profileLevelBadge').textContent = `${state.stats.level} ур.`;
  $('profileRankName').textContent = rank.name;
  $('profileXpText').textContent = next ? `${fmt(xpNow)} / ${fmt(xpNext)} XP` : `${fmt(xpNow)} XP · МАКС`;
  $('profileXpPercent').textContent = `${Math.floor(percent)}%`;
  $('profileXpBar').style.width = `${percent}%`;
  $('profileLevelHint').innerHTML = next
    ? `До уровня ${next.level} («${next.name}») осталось <b class="text-emerald-400">${fmt(Math.max(0, xpNext - xpNow))} XP</b>. Награда: ${fmt(next.reward)} ₽`
    : 'Ты достиг максимального уровня! Ты — БЕССМЕРТНЫЙ ДРОПЕР 🏆';

  const titles = state.stats.unlockedTitles.length ? state.stats.unlockedTitles : ['Новичок'];
  $('titleChips').innerHTML = titles.map(t =>
    `<span class="text-[9px] px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300 font-bold">${escapeHtml(t)}</span>`
  ).join('');

  // id аккаунта — нужен друзьям для подарков, а владельцу проекта — для выдачи кода автора
  const uidEl = $('profileUid');
  if (uidEl) uidEl.textContent = state.user ? state.user.id : '—';

  const invValue = state.inventory.reduce((sum, i) => sum + i.price, 0);
  $('statBalance').textContent = moneyText(state.balance, true);
  $('statBalance').title = moneyText(state.balance, false);
  $('statItemCount').textContent = fmt(state.inventory.length);
  $('statInvValue').textContent = moneyText(invValue, true);
  $('statInvValue').title = moneyText(invValue, false);
  $('statSchoolRank').textContent = state.stats.catFound
    ? 'Хранитель Кота'
    : (invValue > 10000000 ? 'Легенда школы' : invValue > 1000000 ? 'Гроза школы' : invValue > 100000 ? 'Староста' : 'Любитель');

  $('statCases').textContent = fmt(state.stats.casesOpened || 0);
  $('statUpgrades').textContent = fmt(state.stats.upgradesWon || 0);
  $('statBestDrop').textContent = state.stats.biggestDropName ? `${state.stats.biggestDropName} (${shortMoney(state.stats.biggestDrop)}₽)` : '—';
  $('statBestWin').textContent = state.stats.bestWinChance ? `x${state.stats.bestWinChance.toFixed(1)}` : '—';
  $('statEarned').textContent = moneyText(state.stats.earnedTotal || 0, true);
  $('statEarned').title = moneyText(state.stats.earnedTotal || 0, false);
  $('statSold').textContent = fmt(state.stats.itemsSold || 0);
  $('statMiniGame').textContent = moneyText(state.stats.miniBest || 0, true);
  $('statMiniGame').title = moneyText(state.stats.miniBest || 0, false);
  $('statCatFound').textContent = state.stats.catFound ? '🏆 НАЙДЕН' : 'не найден';
  const vipEl = $('statVipStatus');
  if (vipEl) vipEl.textContent = state.stats.vipActive ? '👑 АКТИВЕН' : 'не активен';
  const betaEl = $('statBetaStatus');
  if (betaEl) betaEl.textContent = state.stats.betaMode ? '🧪 3.6 ВКЛ' : (state.stats.betaTester ? 'доступ ✔' : 'нет доступа');

  if (state.profileTab === 'ach') renderAchievements();
}

/* --------------------------------------------------------------------------
   НАСТРОЙКИ
   -------------------------------------------------------------------------- */
function openSettingsModal() {
  audio.init();
  audio.playTick();
  applySettingsToUI();
  updateLegacyRestoreButton();
  Modal.open('settingsModal');
}

function closeSettingsModal() { Modal.close('settingsModal'); }

function applySettingsToUI() {
  const s = state.settings;
  setTogglePill($('setSoundToggle'), s.sound);
  setTogglePill($('setFastToggle'), s.fastOpen);
  setTogglePill($('setMotionToggle'), s.reduceMotion);
  if ($('setVolumeRange')) $('setVolumeRange').value = s.volume;
  if ($('setVolumeLabel')) $('setVolumeLabel').textContent = `${s.volume}%`;

  document.body.dataset.accent = s.accent || 'orange';
  document.querySelectorAll('#accentSwitcher .accent-dot').forEach(dot => {
    dot.classList.toggle('accent-dot-active', dot.dataset.accent === s.accent);
  });
  document.body.classList.toggle('no-motion', !!s.reduceMotion);
  audio.applySettings(s);
  applyQualityToUI();
  $('settingsVersion').textContent = `v${APP_VERSION}`;
  $('aboutVersion').textContent = APP_VERSION;
  // Бейдж шапки: v3.5 Stable или неоновый v3.6 BETA TESTING (js/betaManager.js)
  if (typeof BetaMode !== 'undefined') BetaMode.renderBadge();
  else $('versionBadge').textContent = `v${APP_VERSION} Stable`;
}

function saveSettings() {
  SettingsStore.toCookie(state.settings);
  persist();
}

function toggleSoundSetting() {
  state.settings.sound = !state.settings.sound;
  applySettingsToUI();
  saveSettings();
  if (state.settings.sound) { audio.init(); audio.playCoin(); }
}

function setVolumeSetting(value) {
  state.settings.volume = clamp(parseInt(value, 10) || 0, 0, 100);
  audio.applySettings(state.settings);
  $('setVolumeLabel').textContent = `${state.settings.volume}%`;
  saveSettings();
}

function toggleFastSetting() {
  state.settings.fastOpen = !state.settings.fastOpen;
  applySettingsToUI();
  saveSettings();
  Toast.info(state.settings.fastOpen ? 'Быстрый режим: кейсы открываются без анимации' : 'Обычный режим: с анимацией рулетки');
}

function toggleMotionSetting() {
  state.settings.reduceMotion = !state.settings.reduceMotion;
  applySettingsToUI();
  saveSettings();
  Quality.apply();
}

function setQuality(mode) {
  if (!['auto', 'high', 'low'].includes(mode)) return;
  state.settings.quality = mode;
  Quality.set(mode);
  applyQualityToUI();
  saveSettings();
  audio.playTick();
  const text = { auto: 'Авто: качество подстроится под устройство', high: 'Высокое: максимум эффектов', low: 'Низкое: максимальная плавность и экономия батареи' };
  Toast.info(text[mode]);
}

function applyQualityToUI() {
  document.querySelectorAll('#qualitySwitcher .quality-btn').forEach(btn => {
    btn.classList.toggle('quality-btn-active', btn.dataset.quality === state.settings.quality);
  });
  Quality.renderLabel();
}

function setAccent(accent) {
  state.settings.accent = accent;
  applySettingsToUI();
  saveSettings();
  audio.playTick();
}

/** Прогресс старой версии в localStorage ещё жив? Показываем кнопку возврата */
function updateLegacyRestoreButton() {
  const btn = $('btnRestoreLegacy');
  if (!btn) return;
  const legacy = SaveManager.readLegacy();
  const hasData = !!(legacy && ((legacy.balance && legacy.balance > 2000) || (legacy.inventory && legacy.inventory.length > 4) || legacy.user));
  btn.classList.toggle('hidden', !hasData);
}

async function restoreLegacySave() {
  const legacy = SaveManager.readLegacy();
  if (!legacy) {
    Toast.info('Прогресс версии 1.0 в этом браузере не найден');
    updateLegacyRestoreButton();
    return;
  }

  const invValue = (legacy.inventory || []).reduce((sum, i) => sum + (i.price || 0), 0);
  const ok = await ConfirmDialog.ask({
    icon: '↩️',
    title: 'Вернуть прогресс 1.0?',
    text: `Найдено: баланс <b class="text-amber-300">${fmt(legacy.balance || 0)} ₽</b>, предметов <b>${(legacy.inventory || []).length}</b> на ${fmt(invValue)} ₽${legacy.user ? `, профиль «${escapeHtml(legacy.user.nick)}»` : ''}.<br>Текущий прогресс будет заменён.`,
    okText: 'Вернуть'
  });
  if (!ok) return;

  const normalized = SaveManager.normalize(legacy);
  state.balance = normalized.balance;
  state.inventory = normalized.inventory;
  state.user = normalized.user;
  state.selectedDeposit = state.inventory[0] || null;
  state.selectedTarget = state.selectedTarget || ITEMS_BY_ID['cs_usp_torque'];
  auditInventory();
  persist(true);
  uiUpdate();
  Toast.success('Прогресс версии 1.0 восстановлен! 🎒');
  Modal.close('settingsModal');
}

async function askResetProgress() {
  const ok = await ConfirmDialog.ask({
    icon: '⚠️',
    title: 'Сбросить всё?',
    text: 'Баланс, рюкзак, уровень, достижения и промокоды будут удалены безвозвратно.',
    okText: 'Удалить всё'
  });
  if (!ok) return;
  SaveManager.clearAll();
  CookieStore.clearAll();
  Toast.info('Прогресс сброшен. Перезагружаю игру...');
  setTimeout(() => location.reload(), 900);
}

function exportSaveToArea() {
  const text = SaveManager.exportString(snapshot());
  $('saveExportArea').value = text;
  Toast.success('Резервная копия выгружена в поле ниже');
}

async function copySaveToClipboard() {
  const text = SaveManager.exportString(snapshot());
  const ok = await copyText(text);
  Toast[ok ? 'success' : 'error'](ok ? 'Копия прогресса скопирована в буфер обмена' : 'Не удалось скопировать');
}

async function exportSaveToClipboard() {
  const text = SaveManager.exportString(snapshot());
  const ok = await copyText(text);
  Toast[ok ? 'success' : 'error'](ok ? 'Копия прогресса скопирована. Сохрани её в заметках!' : 'Не удалось скопировать');
}

async function importSaveFromArea() {
  const text = $('saveExportArea').value || '';
  const parsed = SaveManager.parseImport(text);
  if (!parsed) {
    Toast.error('Не удалось прочитать сохранение. Проверь текст.');
    return;
  }
  const ok = await ConfirmDialog.ask({
    icon: '📥',
    title: 'Импортировать прогресс?',
    text: 'Текущее сохранение будет заменено данными из резервной копии.',
    okText: 'Импортировать'
  });
  if (!ok) return;

  state.balance = parsed.balance;
  state.inventory = parsed.inventory;
  state.user = parsed.user;
  state.stats = parsed.stats;
  state.settings = Object.assign({}, DEFAULT_SETTINGS, parsed.settings || {});
  state.selectedDeposit = state.inventory[0] || null;
  applySettingsToUI();
  persist(true);
  uiUpdate();
  Toast.success('Прогресс восстановлен из резервной копии!');
  Modal.close('settingsModal');
}

/* --------------------------------------------------------------------------
   COOKIE: БАННЕР, НАСТРОЙКИ, ПОЛИТИКА
   -------------------------------------------------------------------------- */
function showCookieBannerIfNeeded() {
  const banner = $('cookieBanner');
  if (!banner) return;
  if (Consent.isSet()) {
    banner.classList.add('hidden');
    return;
  }
  banner.classList.remove('hidden');
}

function hideCookieBanner() {
  const banner = $('cookieBanner');
  if (banner) banner.classList.add('hidden');
}

function acceptAllCookies() {
  Consent.set({ save: true, functional: true, analytics: true });
  applyCookieCategoriesToUI();
  hideCookieBanner();
  saveSettings();
  persist(true);
  Toast.success('Спасибо! Все cookie включены — прогресс и настройки сохраняются 🍪');
}

function acceptNecessaryCookies() {
  Consent.set({ save: true, functional: false, analytics: false });
  applyCookieCategoriesToUI();
  CookieStore.remove('shkola_settings');
  hideCookieBanner();
  persist(true);
  Toast.info('Только необходимые cookie: прогресс сохраняется, аналитика и настройки-файлы отключены.');
}

function openCookieSettingsModal() {
  applyCookieCategoriesToUI();
  Modal.open('cookieModal');
}

function closeCookieSettingsModal() { Modal.close('cookieModal'); }

function openCookiePolicyModal() {
  Modal.open('cookiePolicyModal');
}

function closeCookiePolicyModal() { Modal.close('cookiePolicyModal'); }

function currentConsentCats() {
  const c = Consent.get();
  return c ? c.cats : Object.assign({}, COOKIE_CATEGORIES_DEFAULT);
}

function applyCookieCategoriesToUI() {
  const cats = currentConsentCats();
  setTogglePill($('cookieToggleSave'), cats.save !== false);
  setTogglePill($('cookieToggleFunctional'), cats.functional !== false);
  setTogglePill($('cookieToggleAnalytics'), cats.analytics !== false);

  const used = CookieStore.totalSizeKB();
  const chunks = SaveManager.readCookieBackup() ? 1 : 0;
  const info = $('cookieStorageInfo');
  if (info) {
    info.innerHTML = `
      Использовано cookie: <span class="text-orange-300">${used.toFixed(2)} КБ</span> из ~12 КБ<br>
      Файлов проекта: <span class="text-orange-300">${CookieStore.names().length}</span> ·
      резервная копия: <span class="${chunks ? 'text-emerald-300' : 'text-slate-500'}">${chunks ? 'активна' : 'нет данных'}</span><br>
      localStorage: <span class="text-orange-300">${localSaveSizeKB().toFixed(1)} КБ</span>
    `;
  }
}

function localSaveSizeKB() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? raw.length / 1024 : 0;
  } catch (e) {
    return 0;
  }
}

function toggleCookieCategory(cat) {
  const cats = currentConsentCats();
  cats[cat] = !cats[cat];

  if (cat === 'save' && !cats.save) {
    ConfirmDialog.ask({
      icon: '🍪',
      title: 'Отключить сохранения?',
      text: 'Сохранённый прогресс (balance, рюкзак, достижения) будет удалён, и игра перестанет запоминать результат.',
      okText: 'Отключить'
    }).then(ok => {
      if (!ok) {
        cats.save = true;
        applyCookieCategoriesToUI();
        return;
      }
      Consent.set(cats);
      SaveManager.clearAll();
      applyCookieCategoriesToUI();
      applyConsentToStores();
      Toast.info('Игровые сохранения отключены — прогресс держится только в памяти вкладки.');
    });
    return;
  }

  Consent.set(cats);
  applyCookieCategoriesToUI();
  applyConsentToStores();
}

function applyConsentToStores() {
  const cats = currentConsentCats();
  if (!cats.functional) CookieStore.remove('shkola_settings');
  else SettingsStore.toCookie(state.settings);
  if (!cats.analytics) CookieStore.remove(MetaStore.COOKIE_STATS);
  if (cats.save) persist(true);
  applyCookieCategoriesToUI();
}

function saveCookieSettings() {
  const cats = currentConsentCats();
  Consent.set(cats);
  applyConsentToStores();
  hideCookieBanner();
  Toast.success('Настройки cookie сохранены 🍪');
  Modal.close('cookieModal');
}

function clearAllCookies() {
  ConfirmDialog.ask({
    icon: '🧹',
    title: 'Удалить все cookie?',
    text: 'Cookie проекта будут удалены. Прогресс в localStorage останется, но резервная копия и согласие сбросятся.',
    okText: 'Удалить'
  }).then(ok => {
    if (!ok) return;
    CookieStore.clearAll();
    applyCookieCategoriesToUI();
    showCookieBannerIfNeeded();
    Toast.info('Все cookie проекта удалены');
  });
}

/* --------------------------------------------------------------------------
   ПРОЧИЕ МОДАЛКИ
   -------------------------------------------------------------------------- */
function openAuthorModal() {
  audio.init();
  audio.playTick();
  Modal.open('authorModal');
}
function closeAuthorModal() { Modal.close('authorModal'); }
function openTermsModal() { audio.init(); audio.playTick(); Modal.open('termsModal'); }
function closeTermsModal() { Modal.close('termsModal'); }

function closeWelcomeDisclaimer() {
  audio.init();
  audio.playTick();
  const modal = $('welcomeDisclaimerModal');
  if (modal) {
    modal.classList.add('opacity-0', 'pointer-events-none');
    resyncModalState();   // сразу возвращаем прокрутку, не дожидаясь конца анимации
    setTimeout(() => { modal.remove(); resyncModalState(); }, 300);
  }
  MetaStore.write(Object.assign(MetaStore.read(), { welcomeSeen: true }));
  showCookieBannerIfNeeded();
}

async function copyContactEmail() {
  const el = $('projectContactEmail');
  const email = el ? el.textContent.trim() : 'shkoladrop.contact@gmail.com';
  const ok = await copyText(email);
  Toast[ok ? 'success' : 'info'](ok ? 'Почта скопирована: ' + email : 'Почта для связи: ' + email);
}

/* --------------------------------------------------------------------------
   СКРЫТАЯ ПАНЕЛЬ РАЗРАБОТЧИКА
   -------------------------------------------------------------------------- */
function handleAdminTrigger() {
  state.adminClicks += 1;
  audio.init();
  audio.playTick();
  if (state.adminClicks === 3) Toast.info('Ещё пара кликов... 👀', 1200);
  if (state.adminClicks >= 5) {
    state.adminClicks = 0;
    openAdminCodeModal();
  }
}

/** Окно ввода кода: работает и в iframe, где window.prompt заблокирован */
function openAdminCodeModal() {
  const modal = $('adminCodeModal');
  if (!modal) return;
  const input = $('adminCodeInput');
  const error = $('adminCodeError');
  if (input) input.value = '';
  if (error) error.classList.add('hidden');
  Modal.open('adminCodeModal');
  setTimeout(() => { if (input) input.focus(); }, 80);
}

function closeAdminCodeModal() {
  Modal.close('adminCodeModal');
}

function submitAdminCode() {
  const input = $('adminCodeInput');
  const error = $('adminCodeError');
  const code = ((input && input.value) || '').trim().toUpperCase();

  // принимаем 1337 и удобные варианты записи
  const accepted = [ADMIN_CODE, 'SHKOLA' + ADMIN_CODE, 'ADMIN' + ADMIN_CODE, 'КОТ' + ADMIN_CODE];

  if (accepted.includes(code)) {
    state.rigReady = true;
    closeAdminCodeModal();
    openAdminModal();
    audio.playLevelUp();
    Fx.burst(80, ['#10b981', '#fbbf24']);
    Toast.success('Панель разработчика открыта. Тише! 🤫');
  } else {
    if (error) error.classList.remove('hidden');
    audio.playLoss();
    if (input) input.select();
  }
}

function openAdminModal() {
  if (!state.rigReady) return;
  Modal.open('adminModal');
  updateAdminUI();
}

function closeAdminModal() { Modal.close('adminModal'); }

function setRigMode(mode) {
  if (!state.rigReady) return;
  state.rigMode = mode;
  audio.playTick();
  updateAdminUI();
}

function updateAdminUI() {
  ['win', 'near', 'lose', 'fair'].forEach(m => {
    const key = m.charAt(0).toUpperCase() + m.slice(1);
    const btn = $('rig' + key + 'Btn');
    const check = $('rig' + key + 'Check');
    if (!btn || !check) return;
    const active = state.rigMode === m;
    btn.classList.toggle('border-orange-500', active);
    btn.classList.toggle('bg-orange-500/20', active);
    check.classList.toggle('hidden', !active);
  });
}

function adminAddMoney(amount) {
  if (!state.rigReady) return;
  addMoney(amount);
  Toast.gold(`Dev-начисление: +${fmt(amount)} ₽`);
}

function adminGrantCat() {
  if (!state.rigReady) return;
  const cat = ITEMS_BY_ID['cat_keeper'];
  const item = Object.assign({}, cat, { uid: RNG.uid('dev'), wonAt: nowTimeLabel() });
  state.inventory.unshift(item);
  state.stats.catFound = true;
  trackBiggestDrop(item);
  if (!state.stats.unlockedTitles.includes('Хранитель Кота')) state.stats.unlockedTitles.push('Хранитель Кота');
  audio.playSecret();
  Fx.secretRain();
  Toast.secret('Кот-Хранитель выдан через панель разработчика 🐱');
  checkAchievements();
  uiUpdate();
  persist(true);
}

function adminMaxLevel() {
  if (!state.rigReady) return;
  state.stats.idle.level = IDLE_LEVELS.length;
  addXp(900000);
  Toast.gold('Максимальное дежурство и опыт выданы');
  uiUpdate();
  persist(true);
}

/* --------------------------------------------------------------------------
   НАВИГАЦИЯ
   -------------------------------------------------------------------------- */
function switchTab(tab) {
  audio.init();
  audio.playTick();
  if (mGameRunning && tab !== 'farm') stopMiniGame();
  scrollViewportTop();

  const views = {
    upgrade: $('viewUpgrade'),
    cases: $('viewCases'),
    inventory: $('viewInventory'),
    farm: $('viewFarm'),
    shop: $('viewShop')
  };
  const tabs = {
    upgrade: $('tabUpgrade'),
    cases: $('tabCases'),
    inventory: $('tabInv'),
    farm: $('tabFarm'),
    shop: $('tabShop')
  };

  Object.keys(views).forEach(k => {
    if (!views[k] || !tabs[k]) return;
    if (k === tab) {
      views[k].classList.remove('hidden');
      tabs[k].className = 'nav-tab nav-tab-active';
    } else {
      views[k].classList.add('hidden');
      tabs[k].className = 'nav-tab';
    }
  });

  if (tab === 'cases') { renderCasesUI(); setupCaseTape(); }
  if (tab === 'inventory') renderInventory();
  if (tab === 'shop') renderShop();
  if (tab === 'farm') {
    setTimeout(initMiniGameCanvas, 60);
    renderFarm();
  }
  if (tab === 'upgrade') renderUpgradeHud();

  uiUpdate();
}

/* --------------------------------------------------------------------------
   ПРИВЯЗКА СОБЫТИЙ
   -------------------------------------------------------------------------- */
function bindGlobalEvents() {
  const invGrid = $('inventoryGrid');
  if (invGrid) invGrid.addEventListener('click', handleInventoryClick);

  const shopList = $('shopList');
  if (shopList) shopList.addEventListener('click', handleShopClick);

  const idleList = $('idleUpgradeList');
  if (idleList) idleList.addEventListener('click', handleIdleClick);

  const modalGrid = $('modalItemsGrid');
  if (modalGrid) modalGrid.addEventListener('click', handleModalItemsClick);

  if (mCanvas) {
    mCanvas.addEventListener('mousemove', handleGameInput);
    mCanvas.addEventListener('touchmove', handleGameInput, { passive: true });
    mCanvas.addEventListener('touchstart', handleGameInput, { passive: true });
    mCanvas.addEventListener('click', handleGameInput);
  }

  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      ['settingsModal', 'profileModal', 'authorModal', 'termsModal', 'cookieModal', 'cookiePolicyModal',
        'caseOddsModal', 'dailyModal', 'multiResultModal', 'confirmModal'].forEach(id => {
          if (Modal.isOpen(id)) Modal.close(id);
        });
      if (Modal.isOpen('itemModal')) closeItemModal();
      if (Modal.isOpen('resultOverlay')) closeResultOverlay();
    }
    if (mGameRunning) {
      const scale = mCanvas.width / 320;
      if (e.key === 'ArrowLeft') mPlayerX = Math.max(30 * scale, mPlayerX - 35 * scale);
      if (e.key === 'ArrowRight') mPlayerX = Math.min(mCanvas.width - 30 * scale, mPlayerX + 35 * scale);
    }
  });

  // Сохраняем прогресс при уходе со страницы
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      SaveManager.save(snapshot());
      SettingsStore.toCookie(state.settings);
    }
  });

  window.addEventListener('pagehide', () => {
    SaveManager.save(snapshot());
    SettingsStore.toCookie(state.settings);
  });

  document.querySelectorAll('.app-modal').forEach(modal => {
    modal.addEventListener('click', e => {
      if (e.target === modal) Modal.close(modal.id);
    });
  });
}

/* --------------------------------------------------------------------------
   ИНИЦИАЛИЗАЦИЯ
   -------------------------------------------------------------------------- */
function initGame() {
  loadGame();
  applySettingsToUI();
  bindGlobalEvents();
  watchOverlayLock();   // прокрутка не может «залипнуть» заблокированной
  BackgroundFx.init();

  // Заглушки на случай отсутствия данных кейсов
  if (!state.selectedCase) state.selectedCase = CASES_LIST.find(c => !c.secret && !c.beta) || CASES_LIST[0];

  setInvFilter('all');
  setTargetCategory('all');
  renderCasesUI();
  setupCaseTape();
  renderFarm();
  renderPromoList();
  renderProfile();
  applyCookieCategoriesToUI();
  updateDailyIndicator();
  updateLegacyRestoreButton();
  syncModalState();   // приветственное окно открыто — контент под ним не скроллится

  renderAll();

  // Приветственная лента заносов
  addFeedItem(true, ITEMS_BY_ID['sch_bad_grade'], ITEMS_BY_ID['cs_p250_sand']);
  addFeedItem(true, ITEMS_BY_ID['sch_chewed_pen'], ITEMS_BY_ID['gm_mc_pickaxe']);
  addFeedItem(false, ITEMS_BY_ID['sch_eraser'], ITEMS_BY_ID['cs_ak_vulcan']);

  scrollViewportTop();
  applyOfflineIdleIncome();
  startIdleTicker();
  checkAchievements();

  // Лаборатория 3.6 Beta: восстановить состояние тестовой ветки (ник «Тест», бейдж, бета-кейсы)
  if (typeof BetaMode !== 'undefined') BetaMode.onBoot();

  // Онлайн-функции: спонсорство, подарки, трейдинг (js/netplay.js)
  if (typeof NetBoot === 'function') NetBoot();

  // Первое сохранение нового формата
  persist(true);
}
