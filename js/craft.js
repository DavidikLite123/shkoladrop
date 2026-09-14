/* ==========================================================================
   ШКОЛА ДРОП 2.0 — js/craft.js
   Крафт: 10 предметов одной редкости → 1 предмет той же редкости.
   Коллекция результата определяется пропорционально входным коллекциям.
   Бонусы коллекций влияют на дроп и крафт.
   ========================================================================== */

const CraftManager = {
  /** Проверка, можно ли скрафтить выбранные предметы (массив инвентаря) */
  validate(items) {
    if (!Array.isArray(items)) return { ok: false, reason: 'Неверный формат' };
    if (items.length !== CRAFT_CONFIG.requiredCount) return { ok: false, reason: `Нужно ${CRAFT_CONFIG.requiredCount} предметов` };
    // Все должны быть одной редкости
    const rarities = items.map(it => normalizeRarity(it.rarity));
    const first = rarities[0];
    if (!first) return { ok: false, reason: 'Неизвестная редкость' };
    for (let i = 1; i < rarities.length; i++) {
      if (rarities[i] !== first) return { ok: false, reason: 'Все предметы должны быть одной редкости' };
    }
    // Нельзя крафтить предметы noSell? Можно, но проверим
    return { ok: true, rarity: first };
  },

  /** Подсчёт коллекций входа: { collectionId: count } */
  countCollections(items) {
    const counts = {};
    items.forEach(it => {
      const col = (it.collection || (ITEMS_BY_ID[it.id] && ITEMS_BY_ID[it.id].collection) || 'other');
      counts[col] = (counts[col] || 0) + 1;
    });
    return counts;
  },

  /** Выбор коллекции результата пропорционально входам */
  pickResultCollection(counts) {
    const total = Object.values(counts).reduce((a, b) => a + b, 0) || 0;
    if (!total) return 'school';
    // Строим взвешенный список
    const pool = [];
    for (const [col, cnt] of Object.entries(counts)) {
      const w = cnt / total;
      pool.push({ col, weight: Math.max(CRAFT_CONFIG.minCollectionWeight, w) });
    }
    // Если 10 одинаковых — гарантировано та же коллекция (веса всё равно приведут к ней)
    // Используем RNG.weighted если есть, иначе Math.random
    const totalW = pool.reduce((s, e) => s + e.weight, 0);
    let r = Math.random() * totalW;
    if (typeof RNG !== 'undefined' && RNG.float) {
      r = RNG.float() * totalW;
    }
    let acc = 0;
    for (const e of pool) {
      acc += e.weight;
      if (r <= acc) return e.col;
    }
    return pool[0].col;
  },

  /** Выбор итогового предмета: случайный предмет той же редкости и выбранной коллекции */
  pickResultItem(rarity, collection) {
    const r = normalizeRarity(rarity);
    // Пытаемся найти предметы в нужной коллекции и редкости
    let candidates = getItemsByCollectionAndRarity(collection, r);
    // Если нет в этой коллекции такой редкости — берём из любой коллекции той же редкости
    if (!candidates.length) {
      candidates = getItemsByRarity(r);
    }
    if (!candidates.length) return null;
    // Исключаем promoOnly / noSell? Для крафта можно всё, но лучше исключать promoOnly чтобы не дюпать Гору Богдана
    const filtered = candidates.filter(it => !it.promoOnly);
    const pool = filtered.length ? filtered : candidates;
    // Взвешенный выбор по цене? Для простоты равновероятно, но можно учесть бонусы
    const idx = (typeof RNG !== 'undefined' && RNG.int) ? RNG.int(0, pool.length - 1) : Math.floor(Math.random() * pool.length);
    return pool[idx] || null;
  },

  /** Основной крафт: items — массив объектов инвентаря (с uid) */
  craft(items, stateRef) {
    const v = this.validate(items);
    if (!v.ok) return { ok: false, reason: v.reason };

    const counts = this.countCollections(items);
    const resultCollection = this.pickResultCollection(counts);
    const resultProto = this.pickResultItem(v.rarity, resultCollection);

    if (!resultProto) return { ok: false, reason: 'Не удалось подобрать результат' };

    // Создаём экземпляр предмета
    const resultItem = Object.assign({}, resultProto, {
      uid: 'craft_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7),
      wonAt: Date.now(),
      fromCraft: true,
      craftSource: { collections: counts, rarity: v.rarity }
    });

    // Статистика
    if (stateRef && stateRef.stats && stateRef.stats.craft) {
      stateRef.stats.craft.totalCrafts = (stateRef.stats.craft.totalCrafts || 0) + 1;
      stateRef.stats.craft.byCollection[resultCollection] = (stateRef.stats.craft.byCollection[resultCollection] || 0) + 1;
      const order = (RARITIES[normalizeRarity(v.rarity)] || {}).order || 0;
      const bestOrder = (RARITIES[normalizeRarity(stateRef.stats.craft.bestRarity)] || {}).order || 0;
      if (order > bestOrder) stateRef.stats.craft.bestRarity = v.rarity;
      stateRef.stats.craft.history.unshift({
        from: items.map(it => it.id),
        fromCollections: counts,
        to: resultProto.id,
        collection: resultCollection,
        rarity: v.rarity,
        at: Date.now()
      });
      stateRef.stats.craft.history = stateRef.stats.craft.history.slice(0, 20);
    }

    return {
      ok: true,
      result: resultItem,
      collection: resultCollection,
      counts,
      rarity: v.rarity
    };
  },

  /** Получить бонус крафта от коллекций игрока */
  getCraftBonus(stateRef) {
    let bonus = 0;
    if (!stateRef || !stateRef.inventory) return bonus;
    try {
      const inv = stateRef.inventory;
      for (const colId of Object.keys(COLLECTIONS)) {
        const prog = getCollectionProgress(inv, colId);
        const b = getCollectionBonus(prog.percent);
        bonus += b.craftChance || 0;
      }
      // Глобальные бонусы
      let completed = 0;
      for (const colId of Object.keys(COLLECTIONS)) {
        const prog = getCollectionProgress(inv, colId);
        if (prog.percent >= 100) completed++;
      }
      for (const g of COLLECTION_BONUSES.global) {
        if (completed >= g.collections) bonus += g.bonuses.craftChance || 0;
      }
    } catch (e) {}
    return Math.min(0.5, bonus); // кап 50%
  }
};

/* ---------- Коллекции ---------- */
const CollectionManager = {
  /** Прогресс по всем коллекциям */
  getAllProgress(inventory) {
    const out = {};
    for (const colId of Object.keys(COLLECTIONS)) {
      out[colId] = getCollectionProgress(inventory, colId);
    }
    return out;
  },

  /** Бонус дропа редких предметов от коллекций */
  getRareDropBonus(inventory) {
    let bonus = 0;
    try {
      for (const colId of Object.keys(COLLECTIONS)) {
        const prog = getCollectionProgress(inventory, colId);
        const b = getCollectionBonus(prog.percent);
        bonus += b.dropBonus || 0;
      }
      let completed = 0;
      for (const colId of Object.keys(COLLECTIONS)) {
        const prog = getCollectionProgress(inventory, colId);
        if (prog.percent >= 100) completed++;
      }
      for (const g of COLLECTION_BONUSES.global) {
        if (completed >= g.collections) bonus += g.bonuses.rareDrop || 0;
      }
    } catch (e) {}
    return Math.min(0.5, bonus);
  },

  /** Список завершённых коллекций */
  getCompleted(inventory) {
    const res = [];
    for (const colId of Object.keys(COLLECTIONS)) {
      const prog = getCollectionProgress(inventory, colId);
      if (prog.percent >= 100) res.push(colId);
    }
    return res;
  }
};
