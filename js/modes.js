/* ==========================================================================
   ШКОЛА ДРОП 2.0 — js/modes.js
   Игровые режимы: Лёгкий, Обычный, Сложный, Хардкорный
   Только Обычный синхронизируется с сервером.
   ========================================================================== */

const ModeManager = {
  current: null,

  init() {
    this.current = getCurrentModeId();
    return this.current;
  },

  getCurrent() {
    if (!this.current) this.current = getCurrentModeId();
    return getGameMode(this.current);
  },

  getCurrentId() {
    if (!this.current) this.current = getCurrentModeId();
    return this.current;
  },

  isSyncEnabled() {
    return this.getCurrent().sync === true;
  },

  isChatEnabled() {
    return this.getCurrent().chat === true;
  },

  isLocalOnly() {
    return this.getCurrent().local === true;
  },

  isHardcore() {
    return this.getCurrent().hardcore === true;
  },

  getPrice(price) {
    return getModePrice(price, this.getCurrentId());
  },

  /** Проверка, жив ли игрок в хардкоре */
  isDead(stateRef) {
    if (!this.isHardcore()) return false;
    if (!stateRef) return false;
    return !!stateRef.stats.hardcoreDead;
  },

  /** Обработка банкротства */
  handleBankruptcy(stateRef) {
    if (!stateRef) return { dead: false, loan: false };
    const mode = this.getCurrent();
    if (stateRef.balance > 0) return { dead: false, loan: false };

    if (mode.id === 'hardcore') {
      // Шанс кредита
      const chance = mode.creditChance || 0.6;
      const roll = (typeof RNG !== 'undefined' && RNG.float) ? RNG.float() : Math.random();
      if (roll < chance) {
        // Кредит выдан
        const loanAmount = 5000; // базовая сумма займа
        stateRef.balance += loanAmount;
        stateRef.stats.creditDebt = (stateRef.stats.creditDebt || 0) + loanAmount;
        stateRef.stats.creditBorrowAt = Date.now();
        stateRef.stats.creditHistory = (stateRef.stats.creditHistory || 0) + loanAmount;
        return { dead: false, loan: true, amount: loanAmount };
      } else {
        // Смерть
        stateRef.stats.hardcoreDead = true;
        stateRef.stats.hardcoreDeathAt = Date.now();
        if (stateRef.stats.modeStats && stateRef.stats.modeStats.hardcore) {
          stateRef.stats.modeStats.hardcore.deaths = (stateRef.stats.modeStats.hardcore.deaths || 0) + 1;
        }
        return { dead: true, loan: false };
      }
    }

    if (mode.id === 'hard') {
      // В сложном режиме просто банкротство, но не смерть — даём минимальный займ
      stateRef.balance = 1000;
      return { dead: false, loan: true, amount: 1000 };
    }

    if (mode.id === 'easy') {
      // В лёгком режиме — просто ресетаем до 2000
      stateRef.balance = 2000;
      return { dead: false, loan: false };
    }

    // Обычный режим — стандартная логика (кредитные карты перерождения)
    return { dead: false, loan: false };
  },

  /** Переключение режима */
  switchMode(newModeId, stateRef) {
    const target = (newModeId && GAME_MODES[newModeId]) ? newModeId : 'normal';
    const prev = this.getCurrentId();

    // Сохраняем текущий прогресс
    let result;
    if (stateRef) {
      result = SaveManager.switchMode(target, stateRef);
    } else {
      result = SaveManager.switchMode(target, null);
    }

    this.current = target;
    setCurrentModeId(target);

    // Обновляем глобальный state если есть
    if (typeof state !== 'undefined' && result && result.data) {
      // state будет перезаписан извне
    }

    return result;
  },

  /** Получить описание режима для UI */
  getModeInfo(modeId) {
    const m = getGameMode(modeId);
    return {
      id: m.id,
      label: m.label,
      short: m.short,
      icon: m.icon,
      color: m.color,
      bg: m.bg,
      desc: m.desc,
      features: m.features || [],
      priceMult: m.priceMult,
      sync: m.sync,
      chat: m.chat
    };
  },

  /** Список всех режимов для выбора */
  listModes() {
    return Object.values(GAME_MODES).map(m => this.getModeInfo(m.id));
  }
};

// Инициализация при загрузке
try { ModeManager.init(); } catch (e) {}
