/* ==========================================================================
   ШКОЛА ДРОП 3.6 — js/betaManager.js
   «Лаборатория / Бета-тестирование»: тестовая ветка 3.6 Beta.

   • Доступ — только по секретному коду (см. redeemBetaCode в game.js): код
     хранится в виде djb2-хеша и нигде не показывается (js/config.js).
   • Включение — через имитацию загрузки обновления (2.5–3 с), состояние
     сохраняется в stats.betaMode и зеркально в localStorage (isBetaMode-флаг).
   • В бете ник игрока временно становится «Тест», настоящий ник бэкапится
     (stats.betaSavedNick + localStorage savedRealNickname) и восстанавливается
     при возврате в стабильную 3.5.
   • Неоновый индикатор шапки «v3.6 BETA TESTING», бета-кейсы, панель
     «в разработке» и архив стандартных кейсов — всё управляется отсюда.
   ========================================================================== */

const BETA_MODE_KEY = 'isBetaMode';           // localStorage-флаг по ТЗ
const BETA_NICK_KEY = 'savedRealNickname';    // бэкап настоящего ника по ТЗ
const BETA_TEST_NICK = 'Тест';

const BetaMode = {
  updateTimer: null,

  isActive() {
    return !!(typeof state !== 'undefined' && state.stats && state.stats.betaMode);
  },

  hasAccess() {
    return !!(typeof state !== 'undefined' && state.stats && state.stats.betaTester);
  },

  /* ---------- Тумблер в настройках ---------- */
  toggle() {
    audio.init();
    audio.playTick();

    if (this.isActive()) {
      this.applyDisable();
      Toast.info(`Возврат в стабильную v${APP_VERSION}: бета-контент свёрнут, настоящий ник восстановлен.`);
      return;
    }

    if (!this.hasAccess()) {
      // Закрытый бета-тест: без кода доступа тумблер не включается
      Toast.error('Это закрытый бета-тест: сначала введи код доступа ниже 👇');
      const inp = $('betaLabCodeInput');
      if (inp) {
        inp.classList.add('beta-input-attention');
        inp.focus();
        setTimeout(() => inp.classList.remove('beta-input-attention'), 900);
      }
      return;
    }

    this.beginEnable();
  },

  /* ---------- Имитация загрузки обновления 3.6 (2.5–3 секунды) ---------- */
  beginEnable() {
    const overlay = $('betaUpdateOverlay');
    if (!overlay) { this.applyEnable(); return; }

    Modal.open('betaUpdateOverlay');
    const bar = $('betaUpdateBar');
    const pct = $('betaUpdatePercent');
    const status = $('betaUpdateStatus');
    const stepPack = 'Распаковка экспериментальных кейсов и конфигов...';

    if (status) status.textContent = 'Подключение к тестовой ветке 3.6 Beta...';
    if (bar) bar.style.width = '0%';
    if (pct) pct.textContent = '0%';

    const duration = 2500 + Math.random() * 500;
    const t0 = Date.now();

    clearInterval(this.updateTimer);
    this.updateTimer = setInterval(() => {
      const k = Math.min(1, (Date.now() - t0) / duration);
      const p = Math.round(k * 100);
      if (bar) bar.style.width = p + '%';
      if (pct) pct.textContent = p + '%';
      if (k > 0.5 && status && status.textContent !== stepPack) status.textContent = stepPack;
      if (k >= 1) {
        clearInterval(this.updateTimer);
        this.updateTimer = null;
        Modal.close('betaUpdateOverlay');
        this.applyEnable();
        Toast.gold('🧪 3.6 Beta активирована! Экспериментальные кейсы распакованы — ищи плашку «🧪 ЭКСПЕРИМЕНТАЛЬНО» на экране кейсов.', 8000);
      }
    }, 50);
  },

  /* ---------- Применение состояний ---------- */
  applyEnable() {
    state.stats.betaMode = true;
    try { localStorage.setItem(BETA_MODE_KEY, 'true'); } catch (e) {}

    // Бэкапим настоящий ник и включаем ник «Тест»
    if (state.user && state.user.nick && state.user.nick !== BETA_TEST_NICK) {
      state.stats.betaSavedNick = state.user.nick;
      try { localStorage.setItem(BETA_NICK_KEY, state.user.nick); } catch (e) {}
      state.user.nick = BETA_TEST_NICK;
    }

    state.caseFilter = 'all';
    state.betaArchiveOpen = false;

    audio.playWin();
    Fx.burst(130, ['#22d3ee', '#67e8f9', '#f0abfc']);
    persist(true);
    this.syncUI();
  },

  applyDisable() {
    state.stats.betaMode = false;
    try { localStorage.setItem(BETA_MODE_KEY, 'false'); } catch (e) {}

    // Возвращаем настоящий ник из бэкапа
    const saved = state.stats.betaSavedNick || this._readSavedNick();
    if (state.user && saved) state.user.nick = saved;
    state.stats.betaSavedNick = '';
    try { localStorage.removeItem(BETA_NICK_KEY); } catch (e) {}

    // Если выбранный кейс — бета-кейс, мягко пересаживаем на стабильный
    if (state.selectedCase && state.selectedCase.beta) {
      state.selectedCase = CASES_LIST.find(c => !c.secret && !c.beta) || CASES_LIST[0];
      if (typeof setupCaseTape === 'function') setupCaseTape();
    }
    state.betaArchiveOpen = false;

    persist(true);
    this.syncUI();
  },

  /* ---------- Полный пересчёт UI под текущее состояние ---------- */
  syncUI() {
    this.renderBadge();
    this.renderLab();
    if (typeof renderCasesUI === 'function') renderCasesUI();
    if (typeof renderProfile === 'function') renderProfile();
    if (typeof uiUpdate === 'function') uiUpdate();
  },

  /* Неоновый индикатор в шапке */
  renderBadge() {
    const b = $('versionBadge');
    if (!b) return;
    if (this.isActive()) {
      b.textContent = `v${BETA_VERSION} BETA TESTING`;
      b.classList.add('version-badge-beta');
    } else {
      b.textContent = `v${APP_VERSION} Stable`;
      b.classList.remove('version-badge-beta');
    }
  },

  /* Секция «Лаборатория» в настройках */
  renderLab() {
    const toggleBtn = $('betaModeToggle');
    const codeBlock = $('betaLabCodeBlock');
    const info = $('betaLabActiveInfo');
    const access = this.hasAccess();
    const active = this.isActive();

    if (toggleBtn) {
      toggleBtn.textContent = active ? `Выключить 3.6 Beta · назад в v${APP_VERSION}` : 'Включить 3.6 Beta';
      toggleBtn.classList.toggle('beta-toggle-off', active);
      toggleBtn.classList.toggle('beta-toggle-locked', !access);
    }
    if (codeBlock) codeBlock.classList.toggle('hidden', access);
    if (info) {
      info.classList.toggle('hidden', !access);
      const st = $('betaLabInfoState');
      if (st) st.textContent = active ? `Ветка 3.6 Beta: ВКЛЮЧЕНА · ник временно «${BETA_TEST_NICK}»` : 'Ветка 3.6 Beta: выключена';
      const dt = $('betaLabInfoDate');
      if (dt) dt.textContent = state.stats.betaActivatedAt
        ? 'Доступ активирован: ' + new Date(state.stats.betaActivatedAt).toLocaleDateString('ru-RU')
        : '';
    }

    // Бейдж «АКТИВЕН» у кнопки меню «Бета-тест»
    const badge = $('betaMenuBadge');
    if (badge) badge.classList.toggle('hidden', !access);

    // Тайл в профиле
    const tile = $('statBetaStatus');
    if (tile) tile.textContent = active ? '🧪 3.6 ВКЛ' : (access ? 'доступ ✔' : 'нет доступа');
  },

  /* Карточки «в разработке» */
  devSoon(feature) {
    audio.playTick();
    Toast.info(`«${feature}» — функция тестируется в закрытом режиме 3.6!`);
  },

  _readSavedNick() {
    try { return localStorage.getItem(BETA_NICK_KEY); } catch (e) { return null; }
  },

  /* Вызывается после загрузки сейва */
  onBoot() {
    try {
      // Страховка: флаг в localStorage имеет приоритет, если сейв потерялся
      if (localStorage.getItem(BETA_MODE_KEY) === 'true' && !state.stats.betaMode) {
        state.stats.betaMode = true;
      }
    } catch (e) {}

    // Если игра стартует в бете, но ник не подменён (например, после бэкапа сейва) — подменяем
    if (this.isActive() && state.user && state.user.nick && state.user.nick !== BETA_TEST_NICK) {
      if (!state.stats.betaSavedNick) state.stats.betaSavedNick = state.user.nick;
      state.user.nick = BETA_TEST_NICK;
    }

    this.renderBadge();
    this.renderLab();
  },

  /* Вызывается, когда игрок создаёт профиль, находясь в бете */
  onUserCreated() {
    if (!this.isActive() || !state.user) return;
    state.stats.betaSavedNick = state.user.nick;
    try { localStorage.setItem(BETA_NICK_KEY, state.user.nick); } catch (e) {}
    state.user.nick = BETA_TEST_NICK;
  }
};

/* Кнопка «Бета-тест» в меню «Дополнительно»: открыть настройки и доскроллить до лаборатории */
function openBetaLab() {
  openSettingsModal();
  setTimeout(() => {
    const section = $('betaLabSection');
    if (section) {
      section.scrollIntoView({ behavior: 'smooth', block: 'center' });
      section.classList.add('beta-lab-highlight');
      setTimeout(() => section.classList.remove('beta-lab-highlight'), 1400);
    }
  }, 160);
}

/* Сворачивание «Архива 3.5» на экране кейсов при активной бете */
function toggleBetaArchive() {
  state.betaArchiveOpen = !state.betaArchiveOpen;
  renderCasesUI();
}
