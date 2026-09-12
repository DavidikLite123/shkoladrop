/* ==========================================================================
   ШКОЛА ДРОП 2.0 — js/game.js
   Ядро игры: апгрейдер, кейсы, рюкзак, магазин, дежурство (idle),
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
  adminRole: null, // 'owner' | 'admin' | null — роль, с которой открыта админка
  // Вход по e-mail (AuthGate): сервер выдал uid/ID — забирает их регистрация
  pendingAuthUid: null,
  pendingAuthEmail: null,
  pendingAuthTag: null,
  pendingAuthVerified: false,
  seasonWipeToast: false,
  accountResetToast: false,
  accountResetOldUser: null,
  apologyGiftPending: false // сезон 3.5 — подарок-извинение нужно выдать
};

/* --------------------------------------------------------------------------
   ЗАГРУЗКА / СОХРАНЕНИЕ
   -------------------------------------------------------------------------- */
function loadGame() {
  const { data, migrated, fresh, wiped, carriedUser, hadOldSave, oldUser } = SaveManager.load();

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
  // v13 — ПОЛНЫЙ вайп аккаунтов 3.9: показываем одноразовое уведомление «прости, твой аккаунт был сброшен»
  // v14 — сезон 3.5: извинительный подарок за вайп
  const metaForWipe = MetaStore.read();
  if (wiped && (carriedUser || hadOldSave)) {
    // показываем только если ещё не показывали для этой версии сохранения
    if (metaForWipe.resetNoticeSeen !== SAVE_VERSION) {
      state.accountResetToast = true;
      state.accountResetOldUser = oldUser || null;
      state.seasonWipeToast = false;
    }
  } else if (wiped && carriedUser) {
    state.seasonWipeToast = true;
  }

  // Сезон 3.5 — подарок-извинение: каждый, кто был сброшен, получает дорогой предмет бесплатно
  // Выдаётся один раз на сезон (флаг apologyGiftSeen), даже если fresh
  try {
    const metaApology = MetaStore.read();
    const alreadyGotGift = metaApology.apologyGiftSeen === SAVE_VERSION || state.stats.apologyGiftClaimed;
    const shouldGetGift = !alreadyGotGift && (hadOldSave || carriedUser || wiped || metaForWipe.resetNoticeSeen === 13 || fresh);
    // В сезоне 3.5 даём подарок ВСЕМ при первом входе в 3.5, но особенно тем, кто был сброшен
    if (shouldGetGift || (!alreadyGotGift && !state.stats.apologyGiftClaimed)) {
      state.apologyGiftPending = true;
    }
  } catch (e) {
    state.apologyGiftPending = true;
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

/* Сезон 3.5 — подарок-извинение за вайп 3.9: дорогой предмет бесплатно */
function giveApologyGiftIfNeeded() {
  if (!state.apologyGiftPending) return false;
  const meta = MetaStore.read();
  if (meta.apologyGiftSeen === SAVE_VERSION || state.stats.apologyGiftClaimed) {
    state.apologyGiftPending = false;
    return false;
  }
  const proto = ITEMS_BY_ID['gift_apology_35'] || ITEMS_BY_ID['sch_golden_diary'] || ITEMS_BY_ID['cs_karambit_fade'];
  if (!proto) return false;
  // Не даём дубликат если уже есть в рюкзаке
  if (state.inventory.some(it => it.id === proto.id)) {
    MetaStore.write(Object.assign(MetaStore.read(), { apologyGiftSeen: SAVE_VERSION }));
    state.stats.apologyGiftClaimed = true;
    state.apologyGiftPending = false;
    persist(true);
    return false;
  }
  const gift = Object.assign({}, proto, { uid: RNG.uid('apology'), wonAt: nowTimeLabel() });
  state.inventory.unshift(gift);
  trackBiggestDrop(gift);
  state.stats.apologyGiftClaimed = true;
  state.apologyGiftPending = false;
  MetaStore.write(Object.assign(MetaStore.read(), { apologyGiftSeen: SAVE_VERSION }));
  persist(true);
  // Пуш на сервер сразу — каждое действие сохраняется на сервере (сезон 3.5)
  if (typeof CloudSave !== 'undefined') {
    try { CloudSave.push(false); } catch (e) {}
  }
  setTimeout(() => {
    audio.init();
    audio.playSecret();
    Fx.gold(250);
    Fx.secretRain();
    Toast.gold(`🎁 <b>Подарок-извинение сезона 3.5!</b> За полный сброс аккаунтов в 3.9 из-за технических неполадок — вы бесплатно получаете <b>${escapeHtml(proto.name)}</b> стоимостью <b class="text-amber-300">${fmt(proto.price)} ₽</b>! Теперь всё в норме ❤️ Спасибо, что остаётесь с нами!`, 12000);
  }, 800);
  return true;
}

function persist(immediate = false) {
  if (immediate) {
    SaveManager.save(snapshot());
    SettingsStore.toCookie(state.settings);
    // Сезон 3.5: каждое сохранение сразу улетает на сервер — аккаунт всегда отобразится
    if (typeof CloudSave !== 'undefined' && state.user) {
      try { CloudSave.push(false); } catch (e) {}
    }
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
    // Сезон 3.5: каждое действие сохраняется на сервере, не только локально
    if (typeof CloudSave !== 'undefined' && state.user) {
      try { CloudSave.push(false); } catch (e) {}
    }
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

/* ---------- 4.1 ПЕРЕРОЖДЕНИЕ ---------- */
function getRebirthCard(lvl) {
  if (!lvl) return null;
  return (typeof REBIRTH_CARDS !== 'undefined' ? REBIRTH_CARDS.find(c => c.level === lvl) : null) || null;
}
function getCurrentCard() {
  const r = state.stats.rebirth || 0;
  if (r <= 0) return null;
  return getRebirthCard(r);
}
function getCreditLimit() {
  const c = getCurrentCard();
  return c ? c.limit : 0;
}
function getCreditAvailable() {
  const limit = getCreditLimit();
  const debt = state.stats.creditDebt || 0;
  return Math.max(0, limit - debt);
}
function getRebirthRequirement(lvl) {
  return (typeof REBIRTH_REQUIREMENTS !== 'undefined' ? REBIRTH_REQUIREMENTS.find(x => x.level === lvl) : null) || null;
}
function canRebirthNext() {
  const cur = state.stats.rebirth || 0;
  if (cur >= REBIRTH_MAX) return { ok: false, reason: 'MAX' };
  const nxt = cur + 1;
  const req = getRebirthRequirement(nxt);
  if (!req) return { ok: false, reason: 'NOREQ' };
  if ((state.stats.level || 1) < req.needLevel) return { ok: false, reason: 'LEVEL', need: req.needLevel };
  if ((state.stats.casesOpened || 0) < req.needCases) return { ok: false, reason: 'CASES', need: req.needCases };
  if (state.balance < req.needMoney) return { ok: false, reason: 'MONEY', need: req.needMoney };
  if ((state.stats.creditDebt || 0) > 0) return { ok: false, reason: 'DEBT' };
  return { ok: true, next: nxt, req };
}
function formatRebirthDebtTimer() {
  const debt = state.stats.creditDebt || 0;
  if (debt <= 0) return '';
  const borrowAt = state.stats.creditBorrowAt || 0;
  const elapsed = Date.now() - borrowAt;
  const remain = Math.max(0, (typeof CREDIT_BANKRUPT_AFTER_MS !== 'undefined' ? CREDIT_BANKRUPT_AFTER_MS : 3600000) - elapsed);
  const m = Math.floor(remain / 60000);
  const s = Math.floor((remain % 60000) / 1000);
  return `${m}м ${s}с`;
}
function checkCreditBankrupt() {
  const debt = state.stats.creditDebt || 0;
  if (debt <= 0) return false;
  const borrowAt = state.stats.creditBorrowAt || 0;
  if (!borrowAt) return false;
  const now = Date.now();
  const after = typeof CREDIT_BANKRUPT_AFTER_MS !== 'undefined' ? CREDIT_BANKRUPT_AFTER_MS : 3600000;
  if (now - borrowAt < after) return false;
  // уже банкрот?
  if (state.stats.bankruptUntil && state.stats.bankruptUntil > now) return false;
  // триггер
  const chance = typeof CREDIT_BANKRUPT_CHANCE !== 'undefined' ? CREDIT_BANKRUPT_CHANCE : 0.15;
  const isVozduhan = Math.random() < chance;
  state.stats.bankruptType = isVozduhan ? 'vozduhan' : 'bankrupt';
  state.stats.bankruptUntil = now + 24 * 60 * 60 * 1000; // 24ч позора
  // выдаём титул в профиль если есть
  if (state.user) {
    const st = state.stats.bankruptType;
    if (st && state.user) {
      state.user.status = st; // временно ставим статус, владелец может снять, но для отображения в чате
    }
  }
  Toast.error(isVozduhan ? '🌬 Ты получил титул ВОЗДУХАН! Верни долг банку!' : '💸 Ты получил титул БАНКРОТ! Верни долг в течение часа было надо...', 6000);
  persist(true);
  if (typeof CloudSave !== 'undefined' && CloudSave.push) CloudSave.push();
  renderProfile();
  return true;
}
function repayCredit(amount) {
  amount = Math.max(0, Number(amount) || 0);
  if (amount <= 0) return { ok: false };
  const debt = state.stats.creditDebt || 0;
  if (debt <= 0) { Toast.info('У тебя нет долга'); return { ok: false }; }
  if (state.balance < amount) { Toast.error('Недостаточно баланса для возврата'); return { ok: false }; }
  const pay = Math.min(amount, debt);
  state.balance -= pay;
  state.stats.creditDebt = Math.max(0, debt - pay);
  if (state.stats.creditDebt <= 0) {
    state.stats.creditDebt = 0;
    state.stats.creditBorrowAt = 0;
    // снимаем банкрот если долг закрыт
    if (state.stats.bankruptType) {
      Toast.success('✅ Долг закрыт! Титул банкрота снят.');
      state.stats.bankruptType = '';
      state.stats.bankruptUntil = 0;
      if (state.user && (state.user.status === 'bankrupt' || state.user.status === 'vozduhan')) {
        state.user.status = '';
      }
    } else {
      Toast.success(`✅ Вернул ${fmt(pay)} ₽ долга`);
    }
  } else {
    Toast.success(`Вернул ${fmt(pay)} ₽, осталось ${fmt(state.stats.creditDebt)} ₽`);
  }
  persist(true);
  uiUpdate();
  renderProfile();
  return { ok: true, paid: pay };
}
function repayAllCredit() {
  const debt = state.stats.creditDebt || 0;
  if (debt <= 0) return;
  if (state.balance <= 0) { Toast.error('Нет денег для возврата'); return; }
  const pay = Math.min(state.balance, debt);
  repayCredit(pay);
}
function tryPayWithCredit(cost) {
  cost = Number(cost) || 0;
  if (cost <= 0) return { ok: true, usedBalance: 0, usedCredit: 0 };
  if (state.balance >= cost) {
    // хватает баланса
    state.balance -= cost;
    return { ok: true, usedBalance: cost, usedCredit: 0 };
  }
  const need = cost - state.balance;
  const avail = getCreditAvailable();
  if (avail <= 0 || need > avail) {
    return { ok: false, need, avail };
  }
  // используем весь баланс + кредит
  const usedBal = state.balance;
  state.balance = 0;
  state.stats.creditDebt = (state.stats.creditDebt || 0) + need;
  state.stats.creditBorrowAt = Date.now();
  state.stats.creditHistory = (state.stats.creditHistory || 0) + need;
  // первый кредит — показываем подсказку
  if (!state.stats.rebirthNotified) {
    state.stats.rebirthNotified = true;
    Toast.info(`💳 Взял ${fmt(need)} ₽ в кредит по карте ${getCurrentCard()?.name || ''}. Верни за час, иначе — титул банкрота!`, 7000);
  }
  return { ok: true, usedBalance: usedBal, usedCredit: need };
}
function doRebirth() {
  const chk = canRebirthNext();
  if (!chk.ok) {
    let msg = 'Не могу переродиться';
    if (chk.reason === 'MAX') msg = 'Ты уже на максимальном перерождении (10)';
    else if (chk.reason === 'LEVEL') msg = `Нужен ${chk.need} уровень, у тебя ${state.stats.level}`;
    else if (chk.reason === 'CASES') msg = `Нужно открыть ${fmt(chk.need)} кейсов, у тебя ${fmt(state.stats.casesOpened||0)}`;
    else if (chk.reason === 'MONEY') msg = `Нужно ${fmt(chk.need)} ₽, у тебя ${fmt(state.balance)} ₽`;
    else if (chk.reason === 'DEBT') msg = 'Сначала верни кредит! Долг — ' + fmt(state.stats.creditDebt) + ' ₽';
    Toast.error(msg);
    return;
  }
  const nextLvl = chk.next;
  const card = getRebirthCard(nextLvl);
  if (!card) { Toast.error('Карта не найдена'); return; }
  Modal.confirm({
    title: `Переродиться в ${card.name}?`,
    text: `Ты перейдёшь на ${nextLvl} перерождение и получишь ${card.name} с лимитом ${fmt(card.limit)} ₽. Весь прогресс (баланс, рюкзак, уровень) сбросится, но карта останется навсегда. Продолжить?`,
    confirmText: '🔄 ПЕРЕРОДИТЬСЯ',
    cancelText: 'Отмена',
    danger: false,
    onConfirm: () => {
      // списываем требование денег если есть
      if (chk.req.needMoney > 0) state.balance -= chk.req.needMoney;
      state.stats.rebirth = nextLvl;
      // сброс
      state.balance = 2000;
      state.inventory = [];
      state.stats.level = 1;
      state.stats.xp = 0;
      state.stats.creditDebt = 0;
      state.stats.creditBorrowAt = 0;
      state.stats.bankruptType = '';
      state.stats.bankruptUntil = 0;
      // титулы
      if (!state.stats.unlockedTitles.includes(card.title)) state.stats.unlockedTitles.push(card.title);
      // стартовые предметы + подарок если был
      try { if (typeof START_ITEMS !== 'undefined') state.inventory = START_ITEMS.map(id => { const proto = ITEMS_BY_ID[id]; return proto ? Object.assign({}, proto, { uid: 'rebirth_' + id + '_' + Math.random().toString(36).slice(2,6) }) : null; }).filter(Boolean); } catch(e){}
      Toast.success(`🔄 Перерождение ${nextLvl}! Получена ${card.name} — лимит ${fmt(card.limit)} ₽`, 6000);
      Fx.burst(80, [card.color || '#ffd700', '#ff00ff', '#00f0ff']);
      audio.init(); audio.playLevelUp();
      persist(true);
      renderAll();
      openRebirthModal();
    }
  });
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
  if (viewVisible('viewCommunity')) renderCommunityTab();
  // 🚀 Ракета: подсказка баланса и статистика (только когда панель на экране)
  if (viewVisible('viewCrash') && typeof CrashGame !== 'undefined') {
    const hint = $('crashBalanceHint');
    if (hint) hint.textContent = moneyText(state.balance, true);
    CrashGame.renderStats();
  }

  if (Modal.isOpen('profileModal')) renderProfile();

  updateDailyIndicator();

  // 4.1 кредит — проверка просрочки каждую отрисовку (дешёво)
  try { checkCreditBankrupt(); } catch(e) {}
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
  if (typeof ServerAPI !== 'undefined' && !ServerAPI.isOnline() && !window.__shkoladropServerOnline) {
    if (showServerRequiredModalIfNeeded()) {
      Toast.error('Сначала подключись к серверу — апгрейдер требует онлайн (сезон 3.5) 🌐');
      return;
    }
  }
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

/* Список кейсов (бета-ветка 3.6 удалена — бета-кейсы больше не показываются) */
function activeCasesList() {
  const showBeta41 = !!(state.settings && state.settings.beta41);
  return CASES_LIST.filter(c => {
    if (c.beta) return false; // старая бета 3.6 отключена навсегда
    if (c.beta41 && !showBeta41) return false;
    return true;
  });
}

/* Карточка кейса на витрине */
function buildCaseCard(c) {
  const selected = c.id === state.selectedCase.id;
  const canAffordBalance = state.balance >= casePrice(c);
  const canAffordCredit = canAffordBalance || (getCreditAvailable() > 0 && (state.balance + getCreditAvailable()) >= casePrice(c));
  const affordable = canAffordBalance || canAffordCredit;
  const card = document.createElement('div');
  card.className = `case-card ${selected ? 'case-card-selected' : ''} ${c.secret ? 'case-card-secret' : ''} ${!affordable && c.secret ? 'case-card-locked' : ''} ${c.beta ? 'case-card-beta' : ''} ${c.beta41 ? 'case-card-beta41' : ''}`;
  card.innerHTML = `
    <div class="text-3xl mb-1 relative z-10">${c.image ? `<img src="${escapeHtml(c.image)}" alt="${escapeHtml(c.name)}" class="case-cover" onerror="this.style.display='none';this.nextElementSibling.style.display='block';"><span style="display:none">${c.icon}</span>` : (c.secret && !canAffordBalance ? '🔒' : c.icon)}</div>
    <div class="text-xs font-bold font-cs ${c.secret ? 'secret-shine' : 'text-white'} leading-tight relative z-10">${escapeHtml(c.name)}</div>
    <div class="text-[10px] text-slate-400 line-clamp-1 my-1 relative z-10">${escapeHtml(c.desc)}</div>
    <div class="text-xs font-cs font-bold relative z-10" style="color:${c.color}">${fmt(casePrice(c))} ₽ ${canAffordCredit && !canAffordBalance ? '<span class="text-[9px] text-cyan-300">💳 кредит</span>' : ''}</div>
    ${c.beta ? '<div class="beta-case-flag">🧪 ЭКСПЕРИМЕНТАЛЬНО</div>' : ''}
    ${c.beta41 ? '<div class="beta-case-flag" style="background:rgba(99,102,241,0.3);border-color:rgba(99,102,241,0.6);color:#a5b4fc">🚀 БЕТА 4.1</div>' : ''}
    ${c.secret ? `<div class="text-[9px] text-fuchsia-300 mt-0.5 relative z-10">${canAffordBalance ? 'ДОСТУПЕН! ТЫ ЛЕГЕНДА' : 'секретный · нужен 10 000 000 ₽'}</div>` : ''}
  `;
  card.onclick = () => selectCase(c.id);
  return card;
}

function renderCasesUI() {
  const grid = $('casesGrid');
  if (!grid) return;

  const allCases = activeCasesList();

  $('currentCaseTitle').textContent = `${state.selectedCase.season === 3 ? 'Сезон 3 · ' : ''}Кейс: ${state.selectedCase.name}`;
  const selectedPrice = casePrice(state.selectedCase);
  $('currentCasePrice').textContent = moneyText(selectedPrice, true);
  $('currentCasePrice').title = moneyText(selectedPrice, false);
  $('casesCountLabel').textContent = `${allCases.length} кейсов · ${ALL_MASTER_ITEMS.length} предметов`;
  $('casesOpenedLabel').textContent = `всего: ${fmt(state.stats.casesOpened || 0)}`;

  const creditAvail = getCreditAvailable();
  const enoughMoney = state.balance >= selectedPrice || (creditAvail > 0 && (state.balance + creditAvail) >= selectedPrice);
  const needCredit = enoughMoney && state.balance < selectedPrice;
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
    if (enoughMoney) {
      openText.textContent = needCredit ? `ОТКРЫТЬ В КРЕДИТ 💳 ${shortMoney(selectedPrice)} ₽` : `ОТКРЫТЬ ЗА ${shortMoney(selectedPrice)} ₽`;
    } else {
      openText.textContent = `НУЖНО ${shortMoney(selectedPrice)} ₽`;
    }
    const x5Cost = selectedPrice * 5;
    const enoughX5 = state.balance >= x5Cost || (creditAvail > 0 && (state.balance + creditAvail) >= x5Cost);
    openX5.disabled = !enoughX5;
    openX5.classList.toggle('opacity-50', !enoughX5);
    openX5.textContent = state.selectedCase.secret ? 'x5 🔒' : (enoughX5 && state.balance < x5Cost ? `x5 💳 ${shortMoney(x5Cost)}₽` : `x5 · ${shortMoney(x5Cost)}₽`);
  }

  const affordableList = allCases.filter(c => {
    const p = casePrice(c);
    return state.balance >= p || (creditAvail > 0 && (state.balance + creditAvail) >= p);
  });
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

  visibleCases.forEach(c => grid.appendChild(buildCaseCard(c)));

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
  // Сезон 3.5 — обязательный онлайн: без сервера не открываем кейсы, чтобы аккаунт отобразился
  if (typeof ServerAPI !== 'undefined' && !ServerAPI.isOnline() && !window.__shkoladropServerOnline) {
    if (showServerRequiredModalIfNeeded()) {
      Toast.error('Сначала подключись к серверу — игра не пускает играть пока не подключится (сезон 3.5) 🌐');
      return;
    }
  }
  const caseObj = state.selectedCase;
  const price = casePrice(caseObj);
  const payRes = tryPayWithCredit(price);
  if (!payRes.ok) {
    const need = payRes.need ? fmt(payRes.need) : fmt(price);
    const limit = getCreditLimit();
    if (limit > 0) Toast.error(`Не хватает монет: нужно ${fmt(price)} ₽, кредит доступно ${fmt(payRes.avail||0)} ₽ (лимит ${fmt(limit)} ₽)`);
    else Toast.error(`Не хватает монет: нужно ${fmt(price)} ₽. Получи карту перерождения для кредита!`);
    return;
  }
  if (payRes.usedCredit > 0) {
    Toast.info(`💳 Открытие в кредит: ${fmt(payRes.usedBalance)} ₽ баланс + ${fmt(payRes.usedCredit)} ₽ кредит`, 4000);
  }

  const isSecret = !!caseObj.secret;
  const fast = state.settings.fastOpen || state.settings.reduceMotion;
  // Дроп всегда определяется честным розыгрышем по весам текущего кейса
  const winner = RNG.weighted(casePool(caseObj));

  audio.init();
  audio.playCoin();
  state.isOpeningCase = true;
  // spendMoney уже учтён в tryPayWithCredit (баланс + долг)
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
  if (typeof ServerAPI !== 'undefined' && !ServerAPI.isOnline() && !window.__shkoladropServerOnline) {
    if (showServerRequiredModalIfNeeded()) {
      Toast.error('Подключись к серверу — без него нельзя открывать кейсы (сезон 3.5) 🌐');
      return;
    }
  }
  const caseObj = state.selectedCase;
  const cost = casePrice(caseObj) * count;

  if (caseObj.secret) {
    Toast.error('Секретный кейс открывается только по одному — так задумано 🐱');
    return;
  }
  const payResM = tryPayWithCredit(cost);
  if (!payResM.ok) {
    const limit = getCreditLimit();
    if (limit > 0) Toast.error(`Для x${count} нужно ${fmt(cost)} ₽, кредит доступно ${fmt(payResM.avail||0)} ₽`);
    else Toast.error(`Для x${count} нужно ${fmt(cost)} ₽`);
    return;
  }
  if (payResM.usedCredit > 0) Toast.info(`💳 x${count} в кредит: ${fmt(payResM.usedBalance)} ₽ баланс + ${fmt(payResM.usedCredit)} ₽ кредит`, 4000);

  audio.init();
  audio.playCoin();
  state.isOpeningCase = true;
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
  const map = { all: 'fltAll', school: 'fltSchool', cs2: 'fltCs2', games: 'fltGames', cat: 'fltCat', upgrade: 'fltUpgrade' };
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
  const games = state.inventory.filter(i => ['other','beta','beta41'].includes(i.category));
  const cats = state.inventory.filter(i => i.category === 'cat');
  const upgrades = state.inventory.filter(i => i.category === 'upgrade');
  const beta41 = state.inventory.filter(i => i.category === 'beta41');

  let list = state.inventory;
  if (state.invFilter === 'school') list = school;
  if (state.invFilter === 'cs2') list = cs2;
  if (state.invFilter === 'games') list = games;
  if (state.invFilter === 'cat') list = cats;
  if (state.invFilter === 'upgrade') list = upgrades;
  if (state.invFilter === 'beta41') list = beta41;

  const search = ($('invSearchInput')?.value || '').trim().toLowerCase();
  if (search) list = list.filter(i => i.name.toLowerCase().includes(search));

  const sort = $('invSortSelect')?.value || 'new';
  const sorted = list.slice();
  if (sort === 'price-desc') sorted.sort((a, b) => b.price - a.price);
  else if (sort === 'price-asc') sorted.sort((a, b) => a.price - b.price);
  else if (sort === 'rarity') sorted.sort((a, b) => (rarityOf(b).order - rarityOf(a).order) || (b.price - a.price));
  else if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name, 'ru'));

  return { sorted, counts: { all: state.inventory.length, school: school.length, cs2: cs2.length, games: games.length, cat: cats.length, upgrade: upgrades.length } };
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
  const cu = $('countUpgrade');
  if (cu) cu.textContent = counts.upgrade;

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
    $('modalSubtitle').textContent = 'Скины, котики и ⚡ эксклюзивы, которые добываются ТОЛЬКО тут';
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
  const map = { all: 'tgtCatAll', cs2: 'tgtCatCs2', school: 'tgtCatSchool', other: 'tgtCatOther', cat: 'tgtCatCat', upgrade: 'tgtCatUpgrade' };
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
    else if (state.targetFilter === 'school') list = [...SCHOOL_CATALOG, ...(typeof GOLDEN_CATALOG !== 'undefined' ? GOLDEN_CATALOG : [])];
    else if (state.targetFilter === 'other') list = [...OTHER_GAMES_CATALOG, ...(typeof BETA_CATALOG !== 'undefined' ? BETA_CATALOG : []), ...(typeof BETA41_CATALOG !== 'undefined' ? BETA41_CATALOG : []), ...(typeof SEASON3_CATALOG !== 'undefined' ? SEASON3_CATALOG : []), ...(typeof ULTRA_CATALOG !== 'undefined' ? ULTRA_CATALOG : [])];
    else if (state.targetFilter === 'cat') list = CAT_CATALOG;
    else if (state.targetFilter === 'upgrade') list = UPGRADE_CATALOG;
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
   Сезон 3.7: в лавке остались только 4 базовые вещицы (SHOP_ITEM_IDS).
   Всё ценное — из кейсов (жёстко!) или апгрейд-эксклюзивы из апгрейдера.
   -------------------------------------------------------------------------- */
function shopCatalog() {
  return SHOP_ITEM_IDS.map(id => ITEMS_BY_ID[id]).filter(Boolean);
}

function renderShop() {
  const list = $('shopList');
  if (!list) return;

  const items = shopCatalog();
  $('shopCountLabel').textContent = `${items.length} базовых`;

  const creditAvail = getCreditAvailable();
  list.innerHTML = items.map(item => {
    const rarity = rarityOf(item);
    const canAffordBal = state.balance >= item.price;
    const canAfford = canAffordBal || (creditAvail > 0 && (state.balance + creditAvail) >= item.price);
    const needCredit = canAfford && !canAffordBal;
    return `
      <div class="bg-slate-900/80 border border-slate-800/80 rounded-xl p-2.5 flex items-center justify-between gap-2">
        <div class="flex items-center space-x-2.5 min-w-0">
          <div class="flex-shrink-0">${renderItemMedia(item, 'w-10 h-10 text-2xl')}</div>
          <div class="min-w-0">
            <div class="text-xs font-bold text-white line-clamp-1">${escapeHtml(item.name)}</div>
            <div class="text-[10px] text-slate-400 line-clamp-1">${escapeHtml(item.desc || '')}</div>
            <div class="text-[11px] font-cs font-bold" style="color:${rarity.color}">${fmt(item.price)} ₽ ${needCredit ? '<span class="text-cyan-300">💳</span>' : ''}</div>
          </div>
        </div>
        <button data-buy="${item.id}" ${canAfford ? '' : 'disabled'} class="flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold font-cs transition ${
          canAfford ? (needCredit ? 'bg-cyan-600 text-white hover:brightness-110 active:scale-95' : 'bg-orange-500 text-black hover:brightness-110 active:scale-95') : 'bg-slate-800 text-slate-500 cursor-not-allowed'
        }">${needCredit ? 'В кредит' : 'Купить'}</button>
      </div>
    `;
  }).join('');

  const tapValue = tapMoneyValue();
  if (state.balance >= 100000 && !state.stats.tapLimitClosed) { state.stats.tapLimitClosed = true; persist(true); }
  const tapLocked = !!state.stats.tapLimitClosed || state.balance >= 100000;
  const tapButton = $('tapMoneyButton');
  $('tapValueLabel').textContent = tapLocked
    ? 'Доход закрыт: достигнут лимит 100 000 ₽'
    : `+${fmt(tapValue)} ₽ за каждый тап · осталось до лимита: ${fmt(Math.max(0, 100000 - state.balance))} ₽`;
  if (tapButton) {
    tapButton.disabled = tapLocked;
    tapButton.classList.toggle('opacity-40', tapLocked);
    tapButton.classList.toggle('grayscale', tapLocked);
    tapButton.title = tapLocked ? 'Доход закрыт после достижения 100 000 ₽' : 'Стрельнуть мелочь';
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
  if (!SHOP_ITEM_IDS.includes(id)) {
    Toast.info('Такое теперь только из кейсов или из апгрейдера — в лавке не продаётся 😅');
    return;
  }
  const proto = shopCatalog().find(i => i.id === id);
  if (!proto) return;
  const pay = tryPayWithCredit(proto.price);
  if (!pay.ok) {
    Toast.error(`Не хватает: нужно ${fmt(proto.price)} ₽`);
    return;
  }
  audio.init();
  audio.playCoin();
  const newItem = Object.assign({}, proto, { uid: RNG.uid('shop') });
  state.inventory.unshift(newItem);
  if (!state.selectedDeposit) state.selectedDeposit = newItem;
  if (pay.usedCredit > 0) Toast.success(`Куплено в кредит 💳: ${escapeHtml(proto.name)} — ${fmt(pay.usedBalance)} ₽ баланс + ${fmt(pay.usedCredit)} ₽ кредит`);
  else Toast.success(`Куплено: ${escapeHtml(proto.name)} за ${fmt(proto.price)} ₽`);
  uiUpdate();
  persist();
}

function tapForMoney(event) {
  if (state.stats.tapLimitClosed || state.balance >= 100000) {
    state.stats.tapLimitClosed = true;
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
    state.stats.tapLimitClosed = true;
    Toast.gold('Лимит дохода достигнут: 100 000 ₽. «Стрельнуть мелочь» закрыто.', 5000);
  }
  state.stats.earnedTotal = (state.stats.earnedTotal || 0) + value;
  state.stats.balanceMax = Math.max(state.stats.balanceMax || 0, state.balance);
  floatMoney(event ? event.clientX : window.innerWidth / 2, event ? event.clientY : 140, `+${fmt(value)}₽`);
  addXp(1, { silent: true });
  uiUpdate();
  persist();
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

function renderCommunityTab() {
  accrueIdle();
  const level = state.stats.idle.level || 0;

  const aps = idleAps();
  $('idleLevelText').textContent = `ур. ${level}`;
  $('idleApsText').textContent = aps ? `${shortMoney(aps)} ₽/сек` : '0 ₽/сек';
  $('idleApsText').title = aps
    ? `${moneyText(aps, false)}/сек · ${moneyText(aps * 60, false)}/мин · ${moneyText(aps * 3600, false)}/час`
    : 'Купи первый уровень дежурства — доход начнёт капать каждую секунду';
  renderIdlePending();

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
  accrueIdle();                 // старая ставка досчитывается до этого момента
  spendMoney(cfg.cost);
  state.stats.idle.level = level;
  state.stats.idle.lastTick = Date.now();
  if (!state.stats.idle.lastCollect) state.stats.idle.lastCollect = Date.now();
  Toast.success(`Дежурство ур. ${level}: +${fmt(cfg.aps)} ₽/сек`);
  addXp(40 + level * 20);
  renderCommunityTab();         // «Доход в секунду» обновляется сразу, не дожидаясь кадра
  uiUpdate();
  persist(true);
}

function collectIdle() {
  accrueIdle();
  const pending = Math.floor(state.stats.idle.pending || 0);
  if (pending < 1) return;
  audio.init();
  audio.playCoin();
  state.stats.idle.pending = Math.max(0, (state.stats.idle.pending || 0) - pending);
  state.stats.idle.lastCollect = Date.now();
  state.stats.idleCollected = (state.stats.idleCollected || 0) + pending;
  addMoney(pending, { silent: true, countEarned: true });
  addXp(XP_REWARDS.idleCollect, { silent: true });
  Toast.success(`Собрано с дежурства: ${fmt(pending)} ₽`);
  checkAchievements();
  uiUpdate();
  persist(true);
}

/* Начисление по РЕАЛЬНОМУ времени. Раньше «pending += aps» делалось на каждый
   тик setInterval(1000): в фоновой вкладке / на заблокированном телефоне
   браузер режет таймеры до 1 раза в минуту (Chrome — до 1 раза в час), поэтому
   игрок получал ~1% дохода вместо 100%. Теперь считаем секунды между двумя
   моментами времени (idle.lastTick) — сколько бы тиков ни пропало.
   Возвращает начисленную сумму. */
function accrueIdle(now = Date.now()) {
  const idle = state.stats.idle;
  const aps = idleAps();
  if (!aps) { idle.lastTick = now; return 0; }
  const last = Number(idle.lastTick) || Number(idle.lastCollect) || now;
  const elapsed = clamp((now - last) / 1000, 0, IDLE_OFFLINE_CAP_H * 3600);
  idle.lastTick = now;
  if (elapsed <= 0) return 0;
  const earned = aps * elapsed;
  idle.pending = (idle.pending || 0) + earned;
  return earned;
}

function renderIdlePending() {
  const pending = state.stats.idle.pending || 0;
  const textEl = $('idlePendingText');
  const btn = $('btnCollectIdle');
  if (textEl) {
    textEl.textContent = moneyText(pending, true);
    textEl.title = moneyText(pending, false);
  }
  if (btn) {
    btn.disabled = pending < 1;
    btn.className = pending >= 1
      ? 'px-3 py-2 rounded-xl bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 font-bold text-[11px] transition active:scale-95'
      : 'px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-slate-500 font-bold text-[11px] cursor-not-allowed';
  }
}

let idleTickerTimer = null;
function startIdleTicker() {
  if (idleTickerTimer) return;
  let sinceSave = 0;
  idleTickerTimer = setInterval(() => {
    const earned = accrueIdle();
    if (!earned) return;
    if (viewVisible('viewCommunity')) renderIdlePending();
    // Сохраняем не чаще раза в ~10 с — накопленное не теряется при закрытии вкладки
    sinceSave += 1;
    if (sinceSave >= 10) { sinceSave = 0; persist(); }
  }, 1000);

  // Вернулись из фона — досчитать пропущенное сразу, а не ждать следующий тик
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { accrueIdle(); persist(true); return; }
    const earned = accrueIdle();
    if (earned && viewVisible('viewCommunity')) renderIdlePending();
  });
  window.addEventListener('focus', () => {
    const earned = accrueIdle();
    if (earned && viewVisible('viewCommunity')) renderIdlePending();
  });
}

/* Оффлайн-доход при входе: время с последнего сохранения (lastSeen / lastTick)
   до сейчас — по полной ставке, с потолком IDLE_OFFLINE_CAP_H часов. */
function applyOfflineIdleIncome() {
  const aps = idleAps();
  const idle = state.stats.idle;
  if (!aps) { idle.lastTick = Date.now(); return; }
  // Точка отсчёта: последний тик (самая точная) → последнее сохранение → сейчас
  const lastTick = Number(idle.lastTick) || 0;
  const lastSeen = Number(state.prevLastSeen) || 0;
  const from = lastTick || lastSeen || Date.now();
  const elapsed = clamp((Date.now() - from) / 1000, 0, IDLE_OFFLINE_CAP_H * 3600);
  const earned = Math.floor(aps * elapsed * IDLE_OFFLINE_RATE);
  idle.lastTick = Date.now();
  if (earned < 1) return;
  idle.pending = (idle.pending || 0) + earned;
  persist();
  if (elapsed < IDLE_OFFLINE_NOTICE_S) return;
  const mins = Math.round(elapsed / 60);
  const capped = elapsed >= IDLE_OFFLINE_CAP_H * 3600;
  setTimeout(() => {
    Toast.info(`Пока тебя не было (${mins >= 60 ? `${Math.floor(mins / 60)} ч ${mins % 60} мин` : `${mins} мин`}${capped ? `, лимит ${IDLE_OFFLINE_CAP_H} ч` : ''}), дежурство накопило <b>${fmt(earned)} ₽</b>. Забери во вкладке «Сообщество»!`, 6000);
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
async function redeemPromo() {
  const input = $('promoInput');
  // Нормализация: убираем пробелы, приводим к верхнему регистру (промокоды не чувствительны к пробелам)
  const code = (input.value || '').replace(/\s+/g, '').toUpperCase();
  if (!code) {
    Toast.error('Введи промокод');
    return;
  }
  /* Коды вида XXXX-XXXX-XXXX: игрок может не напечатать дефисы — приводим к каноническому виду */
  const canonicalPromoKey = c => (typeof PROMO_CODES !== 'undefined' && PROMO_CODES[c])
    ? c
    : (Object.keys(PROMO_CODES).find(k => k.replace(/-/g, '') === c.replace(/-/g, '')) || null);

  // Вход в админку через промокод: ADMIN<код> (роль определяется по хешу кода)
  if (code.startsWith('ADMIN') && resolveAdminRole(code.slice(5))) {
    input.value = '';
    grantAdminRole(resolveAdminRole(code.slice(5)));
    return;
  }

  const promoKey = canonicalPromoKey(code);
  if (state.stats.promosUsed.includes(code) || (promoKey && state.stats.promosUsed.includes(promoKey))) {
    Toast.info('Этот промокод уже активирован');
    return;
  }

  // ===== ПРОВЕРКА VIP-КОДОВ (одноразовые, за реальные 150 ₽ — покупка через почту) =====
  // Код сверяется только по SHA-256-хешу — открытых кодов в клиенте нет (утечка закрыта)
  if (code.startsWith('VIP-') && await isValidVipCode(code)) {
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

  // Ключ в реестре: точное совпадение или тот же код без дефисов
  const promo = promoKey ? PROMO_CODES[promoKey] : null;
  if (!promo) {
    Toast.error('Такого промокода нет. Ищи коды в видео David Lite или купи VIP-код, написав нам на почту!');
    return;
  }

  state.stats.promosUsed.push(promoKey);
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

  Toast.success(`Промокод <b>${promoKey}</b> активирован: ${rewardText}! ${promo.label ? '· ' + promo.label : ''}`, 6000);
  input.value = '';
  checkAchievements();
  renderPromoList();
  uiUpdate();
  persist(true);
}

/* SHA-256 через WebCrypto (есть во всех современных браузерах, в т.ч. на телефонах) */
async function vipCodeHash(code) {
  const data = new TextEncoder().encode('shkoladrop-vip:' + String(code || '').trim().toUpperCase());
  try {
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', data);
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
    }
  } catch (e) {}
  return sha256Hex(data).slice(0, 24); // http:// без secure context — чистый JS
}
/* Компактный SHA-256 на чистом JS (резерв, когда crypto.subtle недоступен) */
function sha256Hex(bytes) {
  const K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  let H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const l = bytes.length, bitLen = l * 8;
  const padLen = ((l + 9 + 63) >> 6) << 6;
  const m = new Uint8Array(padLen); m.set(bytes); m[l] = 0x80;
  const dv = new DataView(m.buffer); dv.setUint32(padLen - 4, bitLen >>> 0); dv.setUint32(padLen - 8, Math.floor(bitLen / 0x100000000));
  const w = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < padLen; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i-15], 7) ^ rotr(w[i-15], 18) ^ (w[i-15] >>> 3);
      const s1 = rotr(w[i-2], 17) ^ rotr(w[i-2], 19) ^ (w[i-2] >>> 10);
      w[i] = (w[i-16] + s0 + w[i-7] + s1) >>> 0;
    }
    let [a,b,c,d,e,f,g,h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e,6) ^ rotr(e,11) ^ rotr(e,25), ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a,2) ^ rotr(a,13) ^ rotr(a,22), maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H = H.map((v, i) => (v + [a,b,c,d,e,f,g,h][i]) >>> 0);
  }
  return H.map(v => v.toString(16).padStart(8, '0')).join('');
}
async function isValidVipCode(code) {
  const h = await vipCodeHash(code);
  return !!h && VIP_CODE_HASHES.includes(h);
}

/* Ревизия VIP при входе: если VIP активирован кодом, которого нет в актуальном списке
   (старые коды утекли через публичный GitHub и аннулированы) — VIP снимается.
   Настоящий покупатель просто вводит новый код, полученный по почте. */
async function auditVip() {
  if (!state.stats.vipActive) return false;
  const ok = state.stats.vipCode ? await isValidVipCode(state.stats.vipCode) : false;
  if (ok) return false;
  state.stats.vipActive = false;
  state.stats.vipActivatedAt = 0;
  const bad = state.stats.vipCode || '';
  state.stats.vipCode = '';
  state.stats.promosUsed = (state.stats.promosUsed || []).filter(c => c !== bad);
  state.stats.usedVipCodes = (state.stats.usedVipCodes || []).filter(c => c !== bad);
  state.stats.unlockedTitles = (state.stats.unlockedTitles || []).filter(t => t !== '👑 VIP Игрок');
  if (state.user && state.user.title === '👑 VIP Игрок') state.user.title = null;
  persist(true);
  uiUpdate();
  if (typeof renderProfile === 'function') renderProfile();
  setTimeout(() => Toast.info('👑 VIP-статус снят: его код был выдан по ошибке и аннулирован. Если ты честно покупал VIP — напиши на почту, пришлём новый код.', 9000), 2000);
  return true;
}

function renderPromoList() {
  const box = $('promoList');
  if (!box) return;
  const used = Array.isArray(state.stats.promosUsed) ? state.stats.promosUsed : [];
  if (!used.length) {
    const vipHint = state.stats.vipActive
      ? '<br><span class="text-amber-400">👑 VIP-статус активен — налог миллионера отключён навсегда!</span>'
      : `<br><span class="text-fuchsia-400">VIP за ${VIP_PRICE_RUB}₽ отключает налог миллионера навсегда</span>`;
    // Промокоды скрыты — только владелец знает их. Показываем только подсказку без списка.
    box.innerHTML = `<span class="text-[10px] text-slate-500">Пока ни один код не активирован. Подсказка: следи за видео David Lite 🎬<br><span class="text-slate-400">Промокоды скрыты — их знает только владелец. Введи код, если он у тебя есть.</span>${vipHint}</span>`;
    return;
  }
  box.innerHTML = used.map(code => {
    const isVip = code.startsWith('VIP-') && (typeof VIP_CODES !== 'undefined' && VIP_CODES.includes(code));
    if (isVip) {
      return `<span class="text-[9px] px-2 py-0.5 rounded-full bg-amber-950/70 border border-amber-600/60 text-amber-300 font-mono" title="VIP активирован навечно">👑 ✓ · ВЕЧНЫЙ VIP</span>`;
    }
    const p = (typeof PROMO_CODES !== 'undefined' && PROMO_CODES[code]) ? PROMO_CODES[code] : null;
    let rewardLabel = '';
    if (p) {
      if (p.item) {
        const it = (typeof ITEMS_BY_ID !== 'undefined' && ITEMS_BY_ID[p.item]) ? ITEMS_BY_ID[p.item] : null;
        rewardLabel = ' · ' + (it ? it.name : 'предмет');
      } else if (p.money) {
        rewardLabel = ' · ' + fmt(p.money) + '₽';
      }
    }
    // Не показываем сам код — только факт активации и награду, чтобы коды не утекали
    return `<span class="text-[9px] px-2 py-0.5 rounded-full bg-emerald-950/60 border border-emerald-800 text-emerald-300 font-mono">✓ активирован${rewardLabel}</span>`;
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

function openExtrasModal() { updateVipCardVisibility(); if (typeof DmInbox !== 'undefined') DmInbox.renderDot(); Modal.open('extrasModal'); }

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
  // Если аккаунт привязался к e-mail (AuthGate) — сохраняем ВЫДАННЫЙ СЕРВЕРОМ uid,
  // чтобы ID аккаунта и облачный сейв не потерялись
  state.user = {
    id: state.pendingAuthUid || RNG.uid('player'),
    nick: nick.slice(0, 18),
    avatar: state.tempRegAvatar || '🎒',
    grade: grade || 'Ученик школы',
    joinedAt: new Date().toLocaleDateString('ru-RU')
  };
  if (state.pendingAuthEmail) state.user.email = state.pendingAuthEmail;
  if (state.pendingAuthTag) state.user.tag = state.pendingAuthTag;
  if (state.pendingAuthVerified) state.user.verified = true;
  state.pendingAuthUid = null;
  state.pendingAuthEmail = null;
  state.pendingAuthTag = null;
  state.pendingAuthVerified = false;


  addMoney(2500, { silent: true, countEarned: true });
  Fx.burst(100);
  Toast.success(`Профиль создан: ${escapeHtml(state.user.nick)}! Приветственный бонус +2 500 ₽ 🎒`);
  persist(true);
  openProfileModal();
  uiUpdate();

  // Онлайн: сервер сразу выдаёт аккаунту уникальный ID (и галочку, если уже выдана)
  if (typeof NetIdentity !== 'undefined') NetIdentity.sync();
  // Закрываем шлагбаум входа — новичок теперь зарегистрирован
  if (typeof AuthGate !== 'undefined') AuthGate.onUserRegistered();
}

function logoutProfile() {
  const hasEmail = !!(state.user && state.user.email);
  ConfirmDialog.ask({
    icon: '👤',
    title: hasEmail ? 'Выйти из аккаунта?' : '⚠️ Выйти БЕЗ e-mail?',
    text: hasEmail
      ? 'Прогресс сохранён в облаке и привязан к твоему e-mail — вернёшься за пару кликов по коду из письма.'
      : 'Твой аккаунт <b class="text-rose-300">НЕ привязан к e-mail</b>! После выхода ID и прогресс восстановить будет <b class="text-rose-300">невозможно</b> — мы уже не виноваты. Лучше сначала привяжи почту в окне аккаунта.',
    okText: hasEmail ? 'Выйти' : 'Выйти на свой страх и риск'
  }).then(ok => {
    if (!ok) return;
    state.user = null;
    persist(true);
    uiUpdate();
    openProfileModal();
    // Шлагбаум входа возвращается — без аккаунта дальше никак
    if (typeof AuthGate !== 'undefined') AuthGate.onBoot();
  });
}

/* --------------------------------------------------------------------------
   СМЕНА НИКА — тот же аккаунт (uid, ID, почта, прогресс), меняется только имя.
   Новый аккаунт НЕ создаётся. Ник проверяется на сервере на уникальность.
   -------------------------------------------------------------------------- */
function openNickChangeModal() {
  if (!state.user) return;
  const input = $('nickChangeInput');
  if (input) input.value = state.user.nick || '';
  const err = $('nickChangeError');
  if (err) err.classList.add('hidden');
  const cur = $('nickChangeCurrent');
  if (cur) cur.textContent = state.user.nick || '—';
  Modal.open('nickChangeModal');
  setTimeout(() => { if (input) { input.focus(); input.select(); } }, 80);
}

function closeNickChangeModal() { Modal.close('nickChangeModal'); }

async function submitNickChange() {
  if (!state.user) return;
  const input = $('nickChangeInput');
  const err = $('nickChangeError');
  const showErr = (t) => { if (err) { err.textContent = t; err.classList.remove('hidden'); } audio.playLoss(); };
  const nick = ((input && input.value) || '').trim().slice(0, 18);
  if (nick.length < 2) return showErr('Ник — минимум 2 символа');
  if (nick === state.user.nick) return showErr('Это и так твой текущий ник 🙂');
  const btn = $('nickChangeBtn');
  if (btn) btn.disabled = true;
  try {
    // Онлайн: сервер проверит уникальность и обновит ник у того же аккаунта
    if (typeof ServerAPI !== 'undefined' && await ServerAPI.ping(true)) {
      if (typeof NetIdentity !== 'undefined') NetIdentity.ensureUid();
      const { data } = await ServerAPI.req('POST', '/api/players/nick', { uid: state.user.id, nick });
      if (!data.ok) return showErr(data.error || 'Сервер отклонил новый ник');
    }
    const old = state.user.nick;
    state.user.nick = nick;
    persist(true);
    closeNickChangeModal();
    renderProfile();
    uiUpdate();
    if (typeof NetIdentity !== 'undefined') NetIdentity.renderEverywhere();
    if (typeof CloudSave !== 'undefined') CloudSave.push(false);
    audio.playWin();
    Toast.success(`Ник изменён: <b>${escapeHtml(old)}</b> → <b>${escapeHtml(nick)}</b>. Аккаунт, ID и прогресс те же 🎒`, 6000);
  } finally {
    if (btn) btn.disabled = false;
  }
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
  // Уникальный ID сообщества (выдаёт сервер) и галочка верификации
  const tagEl = $('profileTag');
  if (tagEl) tagEl.textContent = (state.user && state.user.tag) ? state.user.tag : '—';
  const vbEl = $('profileVerifiedBadge');
  if (vbEl) {
    vbEl.classList.toggle('hidden', !(state.user && state.user.verified));
    if (state.user && state.user.verified && typeof verifiedBadgeHtml === 'function') vbEl.innerHTML = verifiedBadgeHtml();
  }
  const sbEl = $('profileStatusBadge');
  if (sbEl) {
    const st = state.user && state.user.status;
    sbEl.classList.toggle('hidden', !st);
    if (st && typeof statusChipHtml === 'function') sbEl.innerHTML = statusChipHtml(st);
  }
  const rbEl = $('profileRoleBadge');
  if (rbEl) {
    const isStaff = !!(state.user && state.user.role === 'admin');
    rbEl.classList.toggle('hidden', !isStaff);
    if (isStaff && typeof staffChipHtml === 'function') rbEl.innerHTML = staffChipHtml();
  }

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
  const verEl = $('statVerified');
  if (verEl) verEl.textContent = (state.user && state.user.verified) ? '✔ ВЕРИФИЦИРОВАН' : 'нет';
  if (verEl) verEl.className = 'stat-tile-value text-xs ' + ((state.user && state.user.verified) ? 'text-cyan-300' : 'text-slate-400');
  $('statCatFound').textContent = state.stats.catFound ? '🏆 НАЙДЕН' : 'не найден';
  const vipEl = $('statVipStatus');
  if (vipEl) vipEl.textContent = state.stats.vipActive ? '👑 АКТИВЕН' : 'не активен';
  const stEl = $('statPlayerStatus');
  if (stEl) {
    const st = state.user && state.user.status;
    stEl.textContent = st && typeof statusLabel === 'function' ? statusLabel(st) : (state.user && state.user.role === 'admin' ? '🛡 АДМИН' : 'обычный');
  }

  // ---- 4.1 Rebirth UI ----
  try {
    const rLvl = state.stats.rebirth || 0;
    const rBadge = $('rebirthLevelBadge');
    if (rBadge) rBadge.textContent = `${rLvl} / ${REBIRTH_MAX}`;
    const cardDisp = $('rebirthCardDisplay');
    const creditInfo = $('creditInfo');
    const bankruptWarn = $('bankruptWarning');
    const curCard = getCurrentCard();
    if (cardDisp) {
      if (!curCard) {
        cardDisp.innerHTML = `<div class="text-[10px] text-slate-500">Нет карты — переродись, чтобы получить <b class="text-amber-300">бронзовую кредитку</b> на 1 000 ₽</div>`;
        cardDisp.className = 'rounded-lg p-2.5 border border-slate-800 bg-slate-950/70 text-center';
      } else {
        cardDisp.className = `rounded-lg p-2.5 border bg-gradient-to-br ${curCard.bg} border-amber-500/30 text-center`;
        cardDisp.innerHTML = `
          <div class="flex items-center justify-center gap-2">
            <span class="text-2xl">${curCard.icon}</span>
            <div class="text-left">
              <div class="text-[12px] font-black text-white">${escapeHtml(curCard.name)}</div>
              <div class="text-[10px] text-slate-200">Лимит ${fmt(curCard.limit)} ₽ · ${rLvl} уровень</div>
            </div>
          </div>
          <div class="text-[9px] text-slate-300 mt-1">${escapeHtml(curCard.desc)}</div>
        `;
      }
    }
    if (creditInfo) {
      const debt = state.stats.creditDebt || 0;
      const limit = getCreditLimit();
      const avail = getCreditAvailable();
      const borrowAt = state.stats.creditBorrowAt || 0;
      if (rLvl === 0) {
        creditInfo.innerHTML = `💳 Кредит доступен только после 1-го перерождения.`;
      } else if (debt > 0) {
        const timer = formatRebirthDebtTimer();
        creditInfo.innerHTML = `
          Долг: <b class="text-rose-300">${fmt(debt)} ₽</b> · Доступно: <b class="text-cyan-300">${fmt(avail)} ₽</b> / ${fmt(limit)} ₽<br>
          ⏳ Вернуть за: <b class="text-amber-300">${timer}</b> — иначе титул банкрота!
        `;
      } else {
        creditInfo.innerHTML = `Лимит: <b class="text-emerald-300">${fmt(limit)} ₽</b> · Доступно: <b class="text-cyan-300">${fmt(avail)} ₽</b> · Долга нет ✅`;
      }
    }
    if (bankruptWarn) {
      const debt = state.stats.creditDebt || 0;
      const bType = state.stats.bankruptType;
      const bUntil = state.stats.bankruptUntil || 0;
      const now = Date.now();
      if (bType && bUntil > now) {
        bankruptWarn.classList.remove('hidden');
        if (bType === 'bankrupt') {
          bankruptWarn.className = 'text-[10px] font-bold p-1.5 rounded-lg border bg-rose-950/50 border-rose-800/60 text-rose-300';
          bankruptWarn.textContent = `💸 ТИТУЛ БАНКРОТ до ${new Date(bUntil).toLocaleTimeString()} — верни долг ${fmt(debt)} ₽ чтобы снять!`;
        } else {
          bankruptWarn.className = 'text-[10px] font-bold p-1.5 rounded-lg border bg-sky-950/40 border-sky-800/50 text-sky-300';
          bankruptWarn.textContent = `🌬 ТИТУЛ ВОЗДУХАН до ${new Date(bUntil).toLocaleTimeString()} — верни долг ${fmt(debt)} ₽!`;
        }
      } else if (debt > 0 && state.stats.creditBorrowAt) {
        const elapsed = now - (state.stats.creditBorrowAt||0);
        const after = CREDIT_BANKRUPT_AFTER_MS || 3600000;
        if (elapsed > after * 0.8) {
          bankruptWarn.classList.remove('hidden');
          bankruptWarn.className = 'text-[10px] font-bold p-1.5 rounded-lg border bg-amber-950/50 border-amber-800/60 text-amber-300';
          bankruptWarn.textContent = `⚠️ До банкрота осталось ${formatRebirthDebtTimer()}! Срочно верни ${fmt(debt)} ₽`;
        } else {
          bankruptWarn.classList.add('hidden');
        }
      } else {
        bankruptWarn.classList.add('hidden');
      }
    }
  } catch(e) { console.warn('rebirth ui', e); }

  if (state.profileTab === 'ach') renderAchievements();
}

/* --------------------------------------------------------------------------
   НАСТРОЙКИ
   -------------------------------------------------------------------------- */
function openSettingsModal() {
  audio.init();
  audio.playTick();
  applySettingsToUI();
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
  $('versionBadge').textContent = `v${APP_VERSION} Stable`;
  setTogglePill($('setAutoWakeToggle'), !!s.autoWake);
  setTogglePill($('setChatNotifyToggle'), !!s.chatNotify);
  setTogglePill($('setBeta41Toggle'), !!s.beta41);
}

/* ---------- 4.1 Beta41 toggle ---------- */
function toggleBeta41Setting() {
  state.settings.beta41 = !state.settings.beta41;
  applySettingsToUI();
  saveSettings();
  if (state.settings.beta41) {
    Toast.info('🚀 Бета 4.1 включена! Появились кейсы и предметы вне школьной тематики + перерождение', 5000);
  } else {
    Toast.info('Бета 4.1 выключена — нешкольные предметы скрыты');
  }
  renderCasesUI();
}

/* ---------- 4.1 Rebirth Modal ---------- */
function openRebirthModal() {
  const listEl = $('rebirthCardsList');
  const reqEl = $('rebirthNextReq');
  const doBtn = $('rebirthDoBtn');
  const cur = state.stats.rebirth || 0;
  if (listEl) {
    listEl.innerHTML = REBIRTH_CARDS.map(card => {
      const owned = cur >= card.level;
      const isNext = cur + 1 === card.level;
      const isCur = cur === card.level;
      return `
        <div class="flex items-center gap-2 p-2 rounded-lg border ${owned ? 'bg-gradient-to-br ' + card.bg + ' border-amber-500/40' : 'bg-slate-900/60 border-slate-800'} ${isCur ? 'ring-1 ring-amber-400' : ''}">
          <span class="text-xl">${card.icon}</span>
          <div class="flex-1 min-w-0">
            <div class="text-[11px] font-bold ${owned ? 'text-white' : 'text-slate-400'}">${card.level}. ${escapeHtml(card.name)} ${owned ? '✅' : ''} ${isCur ? '— текущая' : ''}</div>
            <div class="text-[10px] ${owned ? 'text-slate-200' : 'text-slate-500'}">Лимит ${fmt(card.limit)} ₽</div>
            <div class="text-[9px] text-slate-400">${escapeHtml(card.desc)}</div>
          </div>
          <span class="text-[9px] font-bold px-1.5 py-0.5 rounded ${owned ? 'bg-emerald-500/20 text-emerald-300' : 'bg-slate-800 text-slate-500'}">${owned ? 'есть' : (isNext ? 'след.' : '—')}</span>
        </div>
      `;
    }).join('');
  }
  if (reqEl) {
    if (cur >= REBIRTH_MAX) {
      reqEl.innerHTML = `<b class="text-amber-300">🏆 Максимум!</b> Ты на 10-м перерождении — радужная карта ${fmt(100000000000)} ₽! Больше перерождений нет.`;
    } else {
      const chk = canRebirthNext();
      const req = chk.req;
      if (!req) reqEl.textContent = 'Требования не найдены';
      else {
        const lvlOk = (state.stats.level||1) >= req.needLevel;
        const caseOk = (state.stats.casesOpened||0) >= req.needCases;
        const moneyOk = state.balance >= req.needMoney;
        const debtOk = (state.stats.creditDebt||0) <= 0;
        reqEl.innerHTML = `
          <div class="text-[10px] font-bold text-amber-300 mb-1">Следующее: ${REBIRTH_CARDS[cur].name} → ${REBIRTH_CARDS[cur+1-1]?.name || ''} (ур. ${cur+1})</div>
          <div class="${lvlOk ? 'text-emerald-400' : 'text-rose-400'}">• Уровень: ${state.stats.level} / ${req.needLevel} ${lvlOk ? '✅' : '❌'}</div>
          <div class="${caseOk ? 'text-emerald-400' : 'text-rose-400'}">• Кейсов открыто: ${fmt(state.stats.casesOpened||0)} / ${fmt(req.needCases)} ${caseOk ? '✅' : '❌'}</div>
          <div class="${moneyOk ? 'text-emerald-400' : 'text-rose-400'}">• Деньги: ${fmt(state.balance)} / ${fmt(req.needMoney)} ${moneyOk ? '✅' : '❌'}</div>
          <div class="${debtOk ? 'text-emerald-400' : 'text-rose-400'}">• Долг: ${fmt(state.stats.creditDebt||0)} ₽ — ${debtOk ? 'нет ✅' : 'верни долг ❌'}</div>
          ${!chk.ok ? `<div class="mt-1 text-[10px] text-rose-300">Не хватает условий для перерождения</div>` : `<div class="mt-1 text-[10px] text-emerald-300">Готов к перерождению! Жми кнопку ниже</div>`}
        `;
      }
    }
  }
  if (doBtn) {
    const chk = canRebirthNext();
    doBtn.disabled = !chk.ok;
    doBtn.classList.toggle('opacity-50', !chk.ok);
    doBtn.textContent = chk.ok ? `🔄 ПЕРЕРОДИТЬСЯ В ${cur+1} УРОВЕНЬ` : (cur>=REBIRTH_MAX ? 'МАКСИМУМ ДОСТИГНУТ' : 'НЕ ГОТОВ');
  }
  Modal.open('rebirthModal');
}
function closeRebirthModal() { Modal.close('rebirthModal'); }

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

/* ---- Эксперименты ---- */
function toggleAutoWakeSetting() {
  state.settings.autoWake = !state.settings.autoWake;
  applySettingsToUI();
  saveSettings();
  if (state.settings.autoWake) {
    Toast.info('⚡ Эксперимент включён: игра будет сама будить сервер при запуске. Если что-то сломается — выключи.', 6000);
    if (typeof AutoWake !== 'undefined') AutoWake.start();
  } else {
    Toast.info('Автопробуждение выключено.');
    if (typeof AutoWake !== 'undefined') AutoWake.stop();
  }
}

function toggleChatNotifySetting() {
  state.settings.chatNotify = !state.settings.chatNotify;
  applySettingsToUI();
  saveSettings();
  if (state.settings.chatNotify) {
    Toast.info('🔔 Уведомления из общего чата включены — будут всплывать, пока сервер онлайн.', 6000);
    if (typeof ChatNotify !== 'undefined') ChatNotify.start();
  } else {
    Toast.info('Уведомления из чата выключены.');
    if (typeof ChatNotify !== 'undefined') ChatNotify.stop();
  }
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

// Кнопка «Вернуть прогресс из версии 1.0» убрана в сезоне 3.7:
// прогресс теперь живёт в облаке, а локальный вайп обнуляет старую экономику.

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

/* Ручной JSON-экспорт/импорт прогресса убран: сохранение синхронизируется
   с сервером сообщества автоматически (см. CloudSave в js/netplay.js). */

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
  // Сначала показываем уведомление о сбросе аккаунта (если был вайп), потом «что нового»
  if (!showAccountResetNoticeIfNeeded()) {
    showWhatsNewIfNeeded();
  }
}

/* --------------------------------------------------------------------------
   УВЕДОМЛЕНИЕ О СБРОСЕ АККАУНТА (вайп 3.9 → подарок 3.5)
   Показывается ОДИН раз на первый вход после полного сброса: «прости, твой
   аккаунт был сброшен». Потом флаг resetNoticeSeen не даёт показывать снова.
   Сезон 3.5: сразу после этого даём дорогой подарок-извинение.
   -------------------------------------------------------------------------- */
function showAccountResetNoticeIfNeeded() {
  if (!state.accountResetToast) return false;
  const modal = $('accountResetModal');
  if (!modal) {
    // fallback — тост, если модалки нет в DOM
    Toast.error('Прости, твой аккаунт был сброшен в связи с вайпом сезона 3.9. Но в 3.5 ты бесплатно получишь дорогой предмет! 🎁', 10000);
    MetaStore.write(Object.assign(MetaStore.read(), { resetNoticeSeen: SAVE_VERSION }));
    state.accountResetToast = false;
    // сразу выдаём подарок
    setTimeout(() => giveApologyGiftIfNeeded(), 500);
    return true;
  }
  // Персонализируем текст, если помним старый ник
  const old = state.accountResetOldUser;
  const nameEl = $('accountResetOldName');
  const wrapEl = $('accountResetOldNameWrap');
  if (nameEl) nameEl.textContent = old && old.nick ? old.nick : '';
  if (wrapEl) {
    if (old && old.nick) wrapEl.classList.remove('hidden');
    else wrapEl.classList.add('hidden');
  }
  Modal.open('accountResetModal');
  return true;
}

function closeAccountResetModal() {
  audio.init();
  audio.playTick();
  Modal.close('accountResetModal');
  MetaStore.write(Object.assign(MetaStore.read(), { resetNoticeSeen: SAVE_VERSION }));
  state.accountResetToast = false;
  // Сезон 3.5 — сразу после закрытия показываем подарок-извинение
  if (state.apologyGiftPending) {
    setTimeout(() => {
      giveApologyGiftIfNeeded();
      showApologyGiftModalIfNeeded();
    }, 400);
  }
  // После закрытия — показываем «что нового» и остальное
  showWhatsNewIfNeeded();
  showCookieBannerIfNeeded();
}

/* --------------------------------------------------------------------------
   ПОДАРОК-ИЗВИНЕНИЕ СЕЗОНА 3.5
   -------------------------------------------------------------------------- */
function showApologyGiftModalIfNeeded() {
  const meta = MetaStore.read();
  if (meta.apologyGiftSeen !== SAVE_VERSION) return false;
  // если уже показывали модал подарка — не спамим
  if (meta.apologyModalSeen === SAVE_VERSION) return false;
  const modal = $('apologyGiftModal');
  if (!modal) return false;
  const proto = ITEMS_BY_ID['gift_apology_35'];
  const box = $('apologyGiftItemBox');
  if (box && proto) {
    box.innerHTML = `
      <div class="flex-shrink-0">${renderItemMedia(proto, 'w-12 h-12 text-2xl')}</div>
      <div class="text-left">
        <div class="text-[11px] font-bold text-white">${escapeHtml(proto.name)}</div>
        <div class="text-[10px] text-amber-300 font-mono">${fmt(proto.price)} ₽ · ${rarityOf(proto).name} · уже в рюкзаке 🎒</div>
      </div>
    `;
  }
  Modal.open('apologyGiftModal');
  return true;
}

function closeApologyGiftModal() {
  audio.init();
  audio.playTick();
  Modal.close('apologyGiftModal');
  MetaStore.write(Object.assign(MetaStore.read(), { apologyModalSeen: SAVE_VERSION }));
  showWhatsNewIfNeeded();
}

/* --------------------------------------------------------------------------
   ОБЯЗАТЕЛЬНОЕ ПОДКЛЮЧЕНИЕ К СЕРВЕРУ (сезон 3.5)
   Игра не пускает играть, пока не подключится к серверам — чтобы аккаунт
   точно отобразился в базе. При загрузке прелоадер уже ждёт сервер, но
   если связь пропала во время игры — показываем модал.
   -------------------------------------------------------------------------- */
let _serverRequiredTimer = null;
function showServerRequiredModalIfNeeded() {
  const modal = $('serverRequiredModal');
  if (!modal) return false;
  // если сервер уже онлайн — не показываем
  if (typeof ServerAPI !== 'undefined' && ServerAPI.isOnline()) return false;
  if (typeof window !== 'undefined' && window.__shkoladropServerOnline) return false;
  Modal.open('serverRequiredModal');
  updateServerRequiredStatus();
  // авто-ретрай каждые 4 сек
  if (_serverRequiredTimer) clearInterval(_serverRequiredTimer);
  _serverRequiredTimer = setInterval(() => {
    updateServerRequiredStatus();
    checkServerConnectionForGate();
  }, 4000);
  return true;
}

function updateServerRequiredStatus() {
  const el = $('serverRequiredStatus');
  if (!el) return;
  const tries = (typeof window !== 'undefined' && window.__preloaderRetry) ? window.__preloaderRetry : 0;
  if (typeof ServerAPI !== 'undefined' && ServerAPI.isOnline()) {
    el.textContent = 'Подключение успешно! Добро пожаловать 🎒';
    el.className = 'text-[11px] leading-relaxed text-emerald-300 font-mono';
  } else {
    el.textContent = tries > 2 ? 'Сервер спит, будим... ⏳ подождите, подключение скоро будет — просто подождите' : 'Подключение к серверу, подождите... сервер спит, будим';
    el.className = 'text-[11px] leading-relaxed text-amber-300 font-mono';
  }
}

async function checkServerConnectionForGate() {
  if (typeof ServerAPI === 'undefined') return false;
  const online = await ServerAPI.ping(true);
  if (online) {
    closeServerRequiredModal();
    Toast.gold('🌐 Подключение успешно! Добро пожаловать — теперь каждое действие сохраняется на сервере ☁️', 6000);
    // сразу пушим текущий прогресс
    if (typeof CloudSave !== 'undefined') CloudSave.push(false);
    return true;
  }
  return false;
}

function closeServerRequiredModal() {
  Modal.close('serverRequiredModal');
  if (_serverRequiredTimer) { clearInterval(_serverRequiredTimer); _serverRequiredTimer = null; }
}

async function retryServerConnection() {
  const btn = document.querySelector('#serverRequiredModal button');
  const orig = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = 'Подключаюсь... ⏳'; }
  updateServerRequiredStatus();
  // пробуем разбудить сервер как в Community
  if (typeof wakeCommunityServer === 'function') {
    await wakeCommunityServer(btn);
  } else {
    await checkServerConnectionForGate();
  }
  if (btn) { btn.disabled = false; btn.textContent = orig || '⚡ Подключиться к серверу'; }
  if (typeof ServerAPI !== 'undefined' && ServerAPI.isOnline()) {
    closeServerRequiredModal();
  } else {
    updateServerRequiredStatus();
    Toast.info('Сервер пока спит — подождите ещё немного, он просыпается ~минуту ⏳', 5000);
  }
}

/* --------------------------------------------------------------------------
   «ЧТО НОВОГО» — короткое окно после обновления игры (один раз на версию)
   + указатель-подсказка «Смотри, новая функция!» на вкладке «Сообщество»
   -------------------------------------------------------------------------- */
function showWhatsNewIfNeeded() {
  const meta = MetaStore.read();
  if (meta.whatsNewSeen === WHATS_NEW_VERSION) {
    showCommunityHintIfNeeded();
    return;
  }
  const modal = $('whatsNewModal');
  if (!modal) return;
  const verLabel = $('whatsNewVersion');
  if (verLabel) verLabel.textContent = `Сезон ${SEASON_NUMBER} · v${APP_VERSION}`;
  Modal.open('whatsNewModal');
}

function closeWhatsNewModal() {
  audio.init();
  audio.playTick();
  Modal.close('whatsNewModal');
  MetaStore.write(Object.assign(MetaStore.read(), { whatsNewSeen: WHATS_NEW_VERSION }));
  showCommunityHintIfNeeded();
}

/** Показывает мигающий бейдж «NEW» и всплывающую подсказку над вкладкой «Сообщество»,
    пока игрок сам туда не заглянет (после этого подсказка больше не нужна). */
function showCommunityHintIfNeeded() {
  const meta = MetaStore.read();
  if (meta.communityTabSeen) return;
  const badge = $('communityNewBadge');
  const bubble = $('communityHintBubble');
  if (badge) badge.classList.remove('hidden');
  if (bubble) {
    bubble.classList.remove('hidden');
    setTimeout(() => dismissCommunityHint(true), 8000); // сама скрывается через 8 сек, бейдж остаётся
  }
}

function dismissCommunityHint(bubbleOnly) {
  const bubble = $('communityHintBubble');
  if (bubble) bubble.classList.add('hidden');
  if (bubbleOnly) return;
  const badge = $('communityNewBadge');
  if (badge) badge.classList.add('hidden');
  MetaStore.write(Object.assign(MetaStore.read(), { communityTabSeen: true }));
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

/* Определяем роль по введённому коду (сравниваем хеши, коды в открытом виде не храним) */
function resolveAdminRole(raw) {
  const code = String(raw || '').trim().toUpperCase();
  if (!code) return null;
  // убираем удобные префиксы: SHKOLA1337 / ADMIN1337 / КОТ1337 → 1337
  const bare = code.replace(/^(SHKOLA|ADMIN|КОТ|OWNER|STAFF)/, '');
  const candidates = [code, bare];
  for (const c of candidates) {
    const h = betaCodeHash(c);
    if (h === OWNER_CODE_HASH) return 'owner';
  }
  for (const c of candidates) {
    const h = betaCodeHash(c);
    if (h === ADMIN_CODE_HASH) return 'admin';
  }
  return null;
}

function adminHas(perm) {
  const role = state.adminRole;
  if (!role) return false;
  return (ADMIN_PERMS[role] || []).includes(perm);
}

function grantAdminRole(role) {
  state.adminRole = role;
  state.rigReady = true;
  // секрет для серверных запросов подбирается под роль
  try { localStorage.setItem('shkola_admin_secret', role === 'owner' ? OWNER_SERVER_SECRET : ADMIN_SERVER_SECRET); } catch (e) {}
  closeAdminCodeModal();
  openAdminModal();
  audio.playLevelUp();
  Fx.burst(80, role === 'owner' ? ['#10b981', '#fbbf24'] : ['#38bdf8', '#a78bfa']);
  Toast.success(role === 'owner'
    ? 'Панель ВЛАДЕЛЬЦА открыта — доступны все функции. Тише! 🤫'
    : 'Панель АДМИНИСТРАЦИИ открыта — доступны функции модерации 🛡');
}

function submitAdminCode() {
  const input = $('adminCodeInput');
  const error = $('adminCodeError');
  const code = ((input && input.value) || '').trim();
  const role = resolveAdminRole(code);
  if (role) {
    grantAdminRole(role);
  } else {
    if (error) error.classList.remove('hidden');
    audio.playLoss();
    if (input) input.select();
  }
}

function openAdminModal() {
  if (!state.rigReady || !state.adminRole) return;
  applyAdminPermissions();
  Modal.open('adminModal');
  updateAdminUI();
  // Онлайн-разделы панели: список игроков с галочками и реестр кодов авторов
  if (typeof adminLoadPlayers === 'function') adminLoadPlayers();
  if (adminHas('authorcodes') && typeof renderAdminAuthorList === 'function') renderAdminAuthorList();
  if (typeof AdminVaultBackup !== 'undefined' && typeof AdminVaultBackup.renderStatus === 'function') AdminVaultBackup.renderStatus();
}

/* Показываем только те блоки панели, на которые у роли есть права */
function applyAdminPermissions() {
  const role = state.adminRole;
  document.querySelectorAll('#adminModal [data-admin-perm]').forEach(el => {
    const perms = String(el.getAttribute('data-admin-perm')).split(/[\s,]+/).filter(Boolean);
    const allowed = perms.some(p => adminHas(p));
    el.classList.toggle('hidden', !allowed);
  });
  const title = $('adminModalTitle');
  if (title) title.textContent = role === 'owner' ? '👑 Панель владельца' : '🛡 Панель администрации';
  const badge = $('adminRoleBadge');
  if (badge) {
    badge.textContent = role === 'owner' ? 'OWNER · полный доступ' : 'ADMIN · модерация';
    badge.className = 'text-[8px] font-black px-1.5 py-0.5 rounded border uppercase ' +
      (role === 'owner' ? 'bg-amber-500/20 text-amber-300 border-amber-500/50' : 'bg-sky-500/20 text-sky-300 border-sky-500/50');
  }
  const card = document.querySelector('#adminModal .modal-card');
  if (card) {
    card.classList.toggle('border-emerald-700/60', role === 'owner');
    card.classList.toggle('border-sky-700/60', role !== 'owner');
  }
}

function closeAdminModal() { Modal.close('adminModal'); }

/* Развернуть любое модальное окно на весь экран (и обратно) */
function toggleModalExpand(id) {
  const modal = $(id);
  if (!modal) return;
  const card = modal.querySelector('.modal-card');
  if (!card) return;
  card.classList.toggle('modal-card-expanded');
  audio.playTick();
}

/* Выход из админки: роль сбрасывается, панель снова закрыта */
function adminLogout() {
  state.adminRole = null;
  state.rigReady = false;
  state.rigMode = 'fair';
  try { localStorage.removeItem('shkola_admin_secret'); } catch (e) {}
  closeAdminModal();
  Toast.info('Вышел из админ-панели');
}

function setRigMode(mode) {
  if (!state.rigReady || !adminHas('rig')) return;
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
  if (!state.rigReady || !adminHas('money')) return;
  addMoney(amount);
  Toast.gold(`Dev-начисление: +${fmt(amount)} ₽`);
}

function adminGrantCat() {
  if (!state.rigReady || !adminHas('cat')) return;
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
  if (!state.rigReady || !adminHas('maxlevel')) return;
  accrueIdle();
  state.stats.idle.level = IDLE_LEVELS.length;
  state.stats.idle.lastTick = Date.now();
  addXp(900000);
  Toast.gold('Максимальное дежурство и опыт выданы');
  uiUpdate();
  persist(true);
}

/* --------------------------------------------------------------------------
   НАВИГАЦИЯ
   Активные игры (кейсы, апгрейд, ракета…) свёрнуты в одну кнопку «Игры»:
   их список живёт в реестре MINI_GAMES (js/config.js), меню собирает js/games.js.
   -------------------------------------------------------------------------- */

/** Какая вкладка открыта сейчас. Используется меню игр (MiniGames.isCurrent). */
let currentTab = 'upgrade';

/** Панель вкладки: 'cases' -> #viewCases, 'crash' -> #viewCrash и т.д. */
function viewIdForTab(tab) {
  return 'view' + String(tab || '').charAt(0).toUpperCase() + String(tab || '').slice(1);
}

/** Кнопка нижней навигации для вкладки (у всех игр это общая кнопка «Игры») */
function navButtonForTab(tab) {
  const games = (typeof MINI_GAMES !== 'undefined' && Array.isArray(MINI_GAMES)) ? MINI_GAMES : [];
  if (games.some(g => g && (g.tab || g.id) === tab)) return $('tabGames');
  return $({ inventory: 'tabInventory', community: 'tabCommunity', shop: 'tabShop' }[tab] || '');
}

function switchTab(tab) {
  audio.init();
  audio.playTick();
  scrollViewportTop();

  currentTab = tab;

  // Прячем все панели, гасим все кнопки навигации (classList, а не className:
  // у кнопки «Сообщество» есть служебный класс .relative для бейджа NEW)
  document.querySelectorAll('.view-panel').forEach(v => v.classList.add('hidden'));
  document.querySelectorAll('#tabbar .nav-tab').forEach(t => t.classList.remove('nav-tab-active'));

  const view = $(viewIdForTab(tab));
  if (!view) return;                       // неизвестная вкладка — ничего не ломаем
  view.classList.remove('hidden');
  const navBtn = navButtonForTab(tab);
  if (navBtn) navBtn.classList.add('nav-tab-active');

  // Рендер панели
  if (tab === 'cases') { renderCasesUI(); setupCaseTape(); }
  if (tab === 'inventory') renderInventory();
  if (tab === 'shop') renderShop();
  if (tab === 'community') { renderCommunityTab(); dismissCommunityHint(false); }
  if (tab === 'upgrade') renderUpgradeHud();
  if (tab === 'crash' && typeof CrashGame !== 'undefined') CrashGame.onShow();

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

  window.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      ['settingsModal', 'profileModal', 'authorModal', 'termsModal', 'cookieModal', 'cookiePolicyModal',
        'caseOddsModal', 'dailyModal', 'multiResultModal', 'confirmModal', 'communityModal', 'netplayModal', 'extrasModal', 'whatsNewModal', 'nickChangeModal', 'adminModal', 'adminCodeModal', 'adminPlayerModal', 'banReasonModal', 'adminDmModal', 'dmInboxModal', 'bannedModal'].forEach(id => {
          if (Modal.isOpen(id)) Modal.close(id);
        });
      if (Modal.isOpen('itemModal')) closeItemModal();
      if (Modal.isOpen('resultOverlay')) closeResultOverlay();
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
  applyOfflineIdleIncome();   // ДО первого рендера: иначе accrueIdle() съест оффлайн-время без уведомления
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
  renderCommunityTab();
  // 🚀 Мини-игры: ракета + меню «Игры»
  try { if (typeof CrashGame !== 'undefined') CrashGame.init(); } catch (e) { console.error('[crash] init:', e); }
  try { if (typeof MiniGames !== 'undefined') MiniGames.render(); } catch (e) { console.error('[games] init:', e); }
  renderPromoList();
  renderProfile();
  applyCookieCategoriesToUI();
  updateDailyIndicator();
  syncModalState();   // приветственное окно открыто — контент под ним не скроллится

  renderAll();

  // Приветственная лента заносов
  addFeedItem(true, ITEMS_BY_ID['sch_bad_grade'], ITEMS_BY_ID['cs_p250_sand']);
  addFeedItem(true, ITEMS_BY_ID['sch_chewed_pen'], ITEMS_BY_ID['gm_mc_pickaxe']);
  addFeedItem(false, ITEMS_BY_ID['sch_eraser'], ITEMS_BY_ID['cs_ak_vulcan']);

  scrollViewportTop();
  startIdleTicker();
  checkAchievements();

  // Если сохранение застало игрока в удалённой бета-ветке 3.6 — вернуть настоящий ник
  if (state.stats && state.stats.betaMode) {
    state.stats.betaMode = false;
    if (state.user && state.stats.betaSavedNick) state.user.nick = state.stats.betaSavedNick;
    state.stats.betaSavedNick = '';
    persist(true);
  }

  // Онлайн-функции: спонсорство, подарки, трейдинг (js/netplay.js)
  if (typeof NetBoot === 'function') NetBoot();

  // Шлагбаум «введите аккаунт» — если профиля ещё нет (js/netplay.js)
  if (typeof AuthGate !== 'undefined') AuthGate.onBoot();

  // Первое сохранение нового формата — сразу пушим на сервер (сезон 3.5: каждое действие на сервер)
  persist(true);
  // Явно пушим в облако, чтобы аккаунт точно отобразился в базе даже если игрок офлайн
  if (typeof CloudSave !== 'undefined' && state.user) {
    setTimeout(() => { try { CloudSave.push(false); } catch (e) {} }, 800);
  }

  // Ревизия VIP (аннулированные утёкшие коды) — асинхронно, после старта
  auditVip();

  // Сезон 3.5 — обязательный онлайн: если сервер не подключен через 1.5 сек после загрузки — показываем модал
  setTimeout(() => {
    if (typeof ServerAPI !== 'undefined' && !ServerAPI.isOnline() && !window.__shkoladropServerOnline) {
      showServerRequiredModalIfNeeded();
    }
  }, 1500);

  // Сезон 3.5 — подарок-извинение: если флаг pending — выдаём и показываем модал (если не вайп)
  setTimeout(() => {
    if (state.apologyGiftPending) {
      giveApologyGiftIfNeeded();
      // если не было вайп-модала — сразу показываем подарок
      if (!state.accountResetToast) {
        showApologyGiftModalIfNeeded();
      }
    } else {
      // если подарок уже получен, но модал ещё не видели — покажем
      const meta = MetaStore.read();
      if (meta.apologyGiftSeen === SAVE_VERSION && meta.apologyModalSeen !== SAVE_VERSION) {
        showApologyGiftModalIfNeeded();
      }
    }
  }, 900);

  // Если был полный вайп 3.9 и приветствие уже закрыто — сразу показываем уведомление о сбросе
  const welcomeEl = $('welcomeDisclaimerModal');
  const welcomeVisible = welcomeEl && !welcomeEl.classList.contains('hidden') && welcomeEl.style.display !== 'none';
  if (state.accountResetToast && !welcomeVisible) {
    // Небольшая задержка, чтобы UI успел отрисоваться
    setTimeout(() => showAccountResetNoticeIfNeeded(), 600);
  }

  // 4.1 кредит — проверка просрочки каждую минуту + обновление таймера в профиле
  setInterval(() => {
    try {
      const hadDebt = (state.stats.creditDebt||0) > 0;
      checkCreditBankrupt();
      if (hadDebt || (state.stats.creditDebt||0)>0) {
        if (Modal.isOpen('profileModal')) renderProfile();
        if (Modal.isOpen('rebirthModal')) openRebirthModal();
      }
    } catch(e) {}
  }, 30000);
}
