/* ==========================================================================
   ШКОЛА ДРОП 4.1 — js/config.js
   Все игровые данные: редкости, каталоги предметов, кейсы, достижения,
   уровни, награды, промокоды, апгрейды дежурства.

   ЕДИНЫЙ ИСТОЧНИК ПРАВДЫ ПО ВЕРСИЯМ:
     APP_VERSION  — релиз игры (4.1 «Тихая безопасность»);
     SEASON_NUMBER — игровой сезон (3.5; сервер отдаёт season '3.5-apology').
   Меняешь версию — правь только эти две константы, подписи в UI подхватятся.
   ========================================================================== */

const APP_VERSION = '4.1';
const WHATS_NEW_VERSION = 'season-3.5-release-4.1-2026-09'; // релиз 4.1 «Тихая безопасность», игровой сезон 3.5
const SAVE_VERSION = 14;      // v14 = сезон 3.5 / версия 4.1 — подарок-извинение за вайп 3.9 + обязательный онлайн-коннект
const SEASON_NUMBER = 3.5;
const HARD_MODE_THRESHOLD = 100000000;
const HARD_MODE_CASE_DISCOUNT = 0.9;

/* ---------- ЖЁСТКИЕ КЕЙСЫ сезона 3.7 ----------
   Кейсы открываются ВСЕГДА, но «годнота» (предмет дороже самого кейса)
   дополнительно придавлена воротами удачи, а топовые редкости режутся сильнее.
   Штрафы зашиты в casePool(), поэтому таблица «Шансы» показывает честные цифры. */
const CASE_LUCK_GATE = {
  ratio: 1.5, factor: 0.35,       // дороже кейса в 1.5+ раза — режем почти в 3 раза
  hugeRatio: 6, hugeFactor: 0.12, // в 6+ раз — это уже почти чудо
  megaRatio: 25, megaFactor: 0.05 // в 25+ раз — легендарная удача, как золотой мел
};

/* ---------- «Налог миллионера»: чем больше баланс, тем сложнее хороший дроп ----------
   Идея: пока у игрока мало монет — шансы как в таблице кейса. Чем жирнее баланс,
   тем сильнее режется вес дорогих редкостей (и в кейсах, и в колесе апгрейдера).
   Штраф учитывается в casePool()/calculateChance() — то есть в окне «Шансы»
   и на полосе заноса показывается ровно тот шанс, по которому реально крутится рандом. */
const RICH_TAX = {
  freeFrom: 100000,             // до 100 000 ₽ — штрафа нет вообще
  fullAt: HARD_MODE_THRESHOLD,  // к 100 000 000 ₽ — штраф достигает максимума
  maxCut: 0.85,                 // кейсы: вес топовых редкостей падает почти в 7 раз
  wheelMaxCut: 0.45             // колесо апгрейдера: шанс заноса режут максимум на 45%
};

/* Чем редче предмет, тем сильнее на него действует штраф (0 — не действует) */
const RICH_TAX_SENSITIVITY = {
  consumer: 0, milspec: 0.05, restricted: 0.35, classified: 0.65,
  covert: 0.9, gold: 1.15, secret: 0.5
};

/* Базовый штраф по редкости (зашит в casePool).
   Сезон 3.7: сильно ужесточён — годнота из кейсов падает, но редко. */
const RARITY_WEIGHT_PENALTY = {
  consumer: 1, milspec: 0.45, restricted: 0.16, classified: 0.045,
  covert: 0.012, gold: 0.0045, secret: 0.0012
};

const RARITIES = {
  common:    { name: 'Обычный',      short: 'Обычный',     color: '#b0c3d9', bg: 'rgba(176,195,217,0.12)', order: 1, power: 1.0, valueMult: 1.0 },
  uncommon:  { name: 'Необычный',    short: 'Необычный',   color: '#5ee9b5', bg: 'rgba(94,233,181,0.14)', order: 2, power: 1.25, valueMult: 1.3 },
  rare:      { name: 'Редкий',       short: 'Редкий',      color: '#4b69ff', bg: 'rgba(75,105,255,0.14)', order: 3, power: 1.6, valueMult: 1.8 },
  epic:      { name: 'Эпический',    short: 'Эпический',   color: '#8847ff', bg: 'rgba(136,71,255,0.16)', order: 4, power: 2.1, valueMult: 2.5 },
  legendary: { name: 'Легендарный',  short: 'Легендарный', color: '#d32ce6', bg: 'rgba(211,44,230,0.16)', order: 5, power: 2.8, valueMult: 3.5 },
  mythic:    { name: 'Мифический',   short: 'Мифический',  color: '#ffd700', bg: 'rgba(255,215,0,0.20)', order: 6, power: 4.0, valueMult: 6.0 },
  secret:    { name: 'Секретный',    short: 'Секретный',   color: '#00f0ff', bg: 'rgba(0,240,255,0.20)', order: 7, power: 6.0, valueMult: 12.0 }
};
const RARITY_ALIASES = {
  consumer: 'common',
  milspec: 'uncommon',
  restricted: 'rare',
  classified: 'epic',
  covert: 'legendary',
  gold: 'mythic',
  secret: 'secret'
};
RARITIES.consumer = RARITIES.common;
RARITIES.milspec = RARITIES.uncommon;
RARITIES.restricted = RARITIES.rare;
RARITIES.classified = RARITIES.epic;
RARITIES.covert = RARITIES.legendary;
RARITIES.gold = RARITIES.mythic;

function normalizeRarity(r) {
  if (!r) return 'common';
  if (RARITIES[r]) return RARITY_ALIASES[r] || r;
  return 'common';
}

const COLLECTIONS = {
  school:      { id: 'school',      label: 'Школа',        short: 'Школа',  icon: '🎒', color: '#ff7a00', bg: 'rgba(255,122,0,0.15)',  desc: 'Тематические предметы, скины, аксессуары, включая отсылки к Школа Drop CS2' },
  school_drop: { id: 'school_drop', label: 'Школа Drop',   short: 'SD',     icon: '📦', color: '#f97316', bg: 'rgba(249,115,22,0.15)', desc: 'Эксклюзивы Школа Drop CS2' },
  minecraft:   { id: 'minecraft',   label: 'Minecraft',    short: 'MC',     icon: '⛏️', color: '#10b981', bg: 'rgba(16,185,129,0.15)', desc: 'Стилизация и предметы по мотивам Minecraft' },
  rust:        { id: 'rust',        label: 'Rust',         short: 'Rust',   icon: '🔧', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)', desc: 'Тематика выживания, ресурсы и экипировка в стиле Rust' },
  cs2:         { id: 'cs2',         label: 'CS2',          short: 'CS2',    icon: '🔫', color: '#06b6d4', bg: 'rgba(6,182,212,0.15)',  desc: 'Скины CS2 из серии Школа Drop' },
  cat:         { id: 'cat',         label: 'Коты',         short: 'Кот',    icon: '🐱', color: '#ec4899', bg: 'rgba(236,72,153,0.15)', desc: 'Кошачьи предметы и хранители школы' },
  youtube:     { id: 'youtube',     label: 'YouTube',      short: 'YT',     icon: '▶',  color: '#ef4444', bg: 'rgba(239,68,68,0.15)',  desc: 'Кейсы и предметы ютуберов сезона 3' },
  dota:        { id: 'dota',        label: 'Dota 2',       short: 'Dota',   icon: '⚔️', color: '#14b8a6', bg: 'rgba(20,184,166,0.15)', desc: 'Предметы Dota 2' },
  other:       { id: 'other',       label: 'Другое',       short: 'Другое', icon: '🎮', color: '#8b5cf6', bg: 'rgba(139,92,246,0.15)', desc: 'Другие тематические наборы: TF2 и др.' },
  upgrade:     { id: 'upgrade',     label: 'Апгрейд',      short: 'Апгр',   icon: '⚡', color: '#f97316', bg: 'rgba(249,115,22,0.15)', desc: 'Эксклюзивы апгрейдера' },
  beta:        { id: 'beta',        label: 'Бета 3.6',     short: 'Бета',   icon: '🧪', color: '#22d3ee', bg: 'rgba(34,211,238,0.15)', desc: 'Экспериментальные предметы лаборатории' },
  beta41:      { id: 'beta41',      label: 'Бета 4.1',     short: '4.1',    icon: '🚀', color: '#a855f7', bg: 'rgba(168,85,247,0.15)', desc: 'Предметы вне школьной тематики' }
};

const COLLECTION_BONUSES = {
  thresholds: [
    { percent: 25, label: 'Новичок коллекции', bonuses: { craftChance: 0.05, dropBonus: 0.02 } },
    { percent: 50, label: 'Знаток коллекции',  bonuses: { craftChance: 0.10, dropBonus: 0.05, cosmetic: true } },
    { percent: 75, label: 'Мастер коллекции',  bonuses: { craftChance: 0.15, dropBonus: 0.10, cosmetic: true } },
    { percent: 100,label: 'Легенда коллекции', bonuses: { craftChance: 0.25, dropBonus: 0.20, cosmetic: true, buff: true } }
  ],
  global: [
    { collections: 1, label: 'Коллекционер I', bonuses: { craftChance: 0.05 } },
    { collections: 3, label: 'Коллекционер II', bonuses: { craftChance: 0.10, rareDrop: 0.05 } },
    { collections: 5, label: 'Коллекционер III', bonuses: { craftChance: 0.15, rareDrop: 0.10, buff: true } }
  ]
};

const CRAFT_CONFIG = {
  requiredCount: 10,
  resultCount: 1,
  sameRarity: true,
  minCollectionWeight: 0.01
};

const GAME_MODES = {
  easy: {
    id: 'easy',
    label: 'Лёгкий режим',
    short: 'Лёгкий',
    icon: '🌱',
    color: '#22c55e',
    bg: 'from-green-600/30 to-emerald-900/40',
    desc: 'Максимально упрощённые условия: сниженные цены, отсутствие налогов и других усложняющих механик. Онлайн-чат недоступен. Полностью локальный режим, подходит для обучения.',
    priceMult: 0.5,
    tapMoneyValue: 1.5,
    tax: false,
    chat: false,
    local: true,
    sync: false,
    harder: false,
    hardcore: false,
    features: ['Сниженные цены x0.5', 'Нет налогов', 'Нет чата', 'Локально', 'Обучение']
  },
  normal: {
    id: 'normal',
    label: 'Обычный режим',
    short: 'Обычный',
    icon: '🎒',
    color: '#ff7a00',
    bg: 'from-orange-600/30 to-amber-900/40',
    desc: 'Стандартная версия со сбалансированной экономикой и полным набором функций, включая онлайн-чат. Единственный режим, который полностью синхронизируется с сервером.',
    priceMult: 1.0,
    tapMoneyValue: 1.0,
    tax: true,
    chat: true,
    local: false,
    sync: true,
    harder: false,
    hardcore: false,
    features: ['Баланс x1.0', 'Налоги', 'Чат', 'Синхронизация', 'Полный функционал']
  },
  hard: {
    id: 'hard',
    label: 'Сложный режим',
    short: 'Сложный',
    icon: '🔥',
    color: '#ef4444',
    bg: 'from-red-600/30 to-orange-900/40',
    desc: 'Повышенная сложность: цены выше, условия жёстче, испытания сложнее. Только локальный прогресс, без синхронизации.',
    priceMult: 1.8,
    tapMoneyValue: 0.6,
    tax: true,
    taxMult: 1.5,
    chat: false,
    local: true,
    sync: false,
    harder: true,
    hardcore: false,
    features: ['Цены x1.8', 'Жёсткие налоги x1.5', 'Сложнее', 'Локально']
  },
  hardcore: {
    id: 'hardcore',
    label: 'Хардкорный режим',
    short: 'Хардкор',
    icon: '💀',
    color: '#a855f7',
    bg: 'from-violet-600/30 to-purple-900/40',
    desc: 'Максимальная сложность: одна попытка. При полной потере средств — проигрыш. Кредитная карта может попытаться выдать займ, но есть шанс отказа. Только локально.',
    priceMult: 2.2,
    tapMoneyValue: 0.4,
    tax: true,
    taxMult: 2.0,
    chat: false,
    local: true,
    sync: false,
    harder: true,
    hardcore: true,
    oneLife: true,
    creditChance: 0.6,
    permadeath: true,
    features: ['Цены x2.2', 'Одна жизнь', 'Банкротство = конец', 'Кредит 60% шанс', 'Локально']
  }
};

const DEFAULT_GAME_MODE = 'normal';

function getGameMode(id) {
  return GAME_MODES[id] || GAME_MODES[DEFAULT_GAME_MODE];
}
function getModePrice(price, modeId) {
  const mode = getGameMode(modeId);
  return Math.floor(price * (mode.priceMult || 1));
}
function getCollectionProgress(inventory, collection) {
  const all = ALL_MASTER_ITEMS.filter(it => it.collection === collection);
  if (!all.length) return { total: 0, owned: 0, percent: 0 };
  const ownedIds = new Set((inventory || []).map(id => typeof id === 'string' ? id : id.id).filter(Boolean));
  const owned = all.filter(it => ownedIds.has(it.id)).length;
  const total = all.length;
  const percent = total ? (owned / total) * 100 : 0;
  return { total, owned, percent };
}
function getCollectionBonus(percent) {
  let bonus = { craftChance: 0, dropBonus: 0, rareDrop: 0, cosmetic: false, buff: false };
  for (const th of COLLECTION_BONUSES.thresholds) {
    if (percent >= th.percent) {
      bonus.craftChance = Math.max(bonus.craftChance, th.bonuses.craftChance || 0);
      bonus.dropBonus = Math.max(bonus.dropBonus, th.bonuses.dropBonus || 0);
      if (th.bonuses.cosmetic) bonus.cosmetic = true;
      if (th.bonuses.buff) bonus.buff = true;
    }
  }
  return bonus;
}
function collectionOf(item) {
  if (!item) return 'other';
  return item.collection || 'other';
}
function getItemsByCollectionAndRarity(collection, rarity) {
  const r = normalizeRarity(rarity);
  return ALL_MASTER_ITEMS.filter(it => (it.collection === collection) && normalizeRarity(it.rarity) === r);
}
function getItemsByRarity(rarity) {
  const r = normalizeRarity(rarity);
  return ALL_MASTER_ITEMS.filter(it => normalizeRarity(it.rarity) === r);
}




/** 0..1 — насколько «раскулачен» игрок с таким балансом (лог-шкала: важно «во сколько раз», а не «на сколько») */
function richTaxProgress(balance) {
  const bal = Number.isFinite(balance) ? Math.max(0, balance) : 0;
  if (bal <= RICH_TAX.freeFrom) return 0;
  const span = Math.log(RICH_TAX.fullAt / RICH_TAX.freeFrom);
  if (!(span > 0)) return 1;
  return Math.min(1, Math.max(0, Math.log(bal / RICH_TAX.freeFrom) / span));
}

/** Множитель для кейсов: 1 — штрафа нет, 0.15 — максимальный. VIP-игроки всегда получают множитель 1 */
function richTaxFactor(balance) {
  if (typeof state !== 'undefined' && state.stats && state.stats.vipActive) return 1;
  return 1 - RICH_TAX.maxCut * richTaxProgress(richTaxBalanceOf(balance));
}

/** Множитель для колеса апгрейдера (мягче). VIP-игроки всегда получают 1 */
function richTaxWheelFactor(balance) {
  if (typeof state !== 'undefined' && state.stats && state.stats.vipActive) return 1;
  return 1 - RICH_TAX.wheelMaxCut * richTaxProgress(richTaxBalanceOf(balance));
}

/** Переданный баланс или текущий (чтобы casePool() можно было вызывать без аргументов) */
function richTaxBalanceOf(balance) {
  return Number.isFinite(balance) ? balance : richTaxBalance();
}

/** Текущий баланс для расчёта штрафа (state появляется позже config.js — поэтому с проверкой) */
function richTaxBalance() {
  return (typeof state !== 'undefined' && state && Number.isFinite(state.balance)) ? state.balance : 0;
}

/* ---------- Категории ---------- */
const CATEGORIES = {
  school: { label: 'Школа', short: 'Школа', badge: 'bg-amber-950 text-amber-300 border-amber-800' },
  cs2:    { label: 'CS2',   short: 'CS2',   badge: 'bg-cyan-950 text-cyan-300 border-cyan-800' },
  other:  { label: 'Игры',  short: 'Игра',  badge: 'bg-violet-950 text-violet-300 border-violet-800' },
  cat:    { label: '🐱 Коты', short: 'Кот', badge: 'bg-fuchsia-950 text-fuchsia-300 border-fuchsia-800' },
  beta:   { label: '🧪 Бета 3.6', short: 'Бета', badge: 'bg-cyan-950 text-cyan-200 border-cyan-700' },
  beta41: { label: '🚀 Бета 4.1', short: 'Бета 4.1', badge: 'bg-indigo-950 text-indigo-300 border-indigo-700' },
  upgrade:{ label: '⚡ Только апгрейд', short: 'Апгр.', badge: 'bg-orange-950 text-orange-300 border-orange-800' }
};

/* ---------- Школьный каталог ---------- */
const SCHOOL_CATALOG = [
  { id: 'sch_bad_grade',      name: 'Двойка в электронном дневнике', price: 60,    icon: '📝', badgeBg: 'from-rose-600/30 to-red-900/40',           rarity: 'consumer',   category: 'school', desc: 'Мама уже увидела пуш-уведомление' },
  { id: 'sch_chewed_gum',     name: 'Жвачка, прилипшая под партой',  price: 110,   icon: '🫧', badgeBg: 'from-pink-600/30 to-rose-900/40',          rarity: 'consumer',   category: 'school', desc: 'Ей уже три года, но она ещё тянется' },
  { id: 'sch_cold_cutlet',    name: 'Холодная котлета в тесте',      price: 150,   icon: '🥟', badgeBg: 'from-amber-600/30 to-yellow-900/40',       rarity: 'consumer',   category: 'school', desc: 'Легендарный буфетный деликатес' },
  { id: 'sch_chewed_pen',     name: 'Погрызанная синяя ручка',       price: 300,   icon: '🖊️', badgeBg: 'from-blue-600/30 to-indigo-900/40',        rarity: 'milspec',    category: 'school', desc: 'Без колпачка, течет прямо на пальцы' },
  { id: 'sch_broken_compass', name: 'Циркуль без иголки',            price: 380,   icon: '📐', badgeBg: 'from-sky-600/30 to-blue-900/40',           rarity: 'milspec',    category: 'school', desc: 'Иголку забрал трудовик — «в целях безопасности»' },
  { id: 'sch_eraser',         name: 'Ластик с дыркой от циркуля',    price: 500,   icon: '🧼', badgeBg: 'from-cyan-600/30 to-blue-900/40',          rarity: 'milspec',    category: 'school', desc: 'Служил мишенью на всех уроках геометрии' },
  { id: 'sch_banana_peel',    name: 'Банановая кожура из столовой',  price: 700,   icon: '🍌', badgeBg: 'from-yellow-500/30 to-amber-900/40',       rarity: 'milspec',    category: 'school', desc: 'Классическая ловушка на входе в кабинет' },
  { id: 'sch_diary_note',     name: 'Замечание красной пастой',      price: 850,   icon: '📕', badgeBg: 'from-red-600/30 to-rose-900/40',           rarity: 'milspec',    category: 'school', desc: '«Бегал по парте и кидался ластиками»' },
  { id: 'sch_ruler_wood',     name: 'Разбитая деревянная линейка',   price: 1200,  icon: '📏', badgeBg: 'from-amber-700/30 to-amber-900/40',        rarity: 'milspec',    category: 'school', desc: 'Использовалась как меч на перемене' },
  { id: 'sch_rat_journal',    name: 'Журнал с крысой из подвала',    price: 1500,  icon: '🐁', badgeBg: 'from-stone-600/30 to-neutral-900/50',      rarity: 'restricted', category: 'school', desc: 'Крыса Фёкла теперь официально в списке класса' },
  { id: 'sch_chalk',          name: 'Коробка цветного мела',         price: 1800,  icon: '🖍️', badgeBg: 'from-purple-600/30 to-indigo-900/40',      rarity: 'restricted', category: 'school', desc: 'Стырено из учительской на перемене' },
  { id: 'sch_cheat_sheet',    name: 'Шпаргалка под часами на руке',  price: 2900,  icon: '📜', badgeBg: 'from-violet-600/30 to-fuchsia-900/40',     rarity: 'restricted', category: 'school', desc: 'Спасёт на контрольной по химии' },
  { id: 'sch_chemistry_set',  name: 'Набор юного химика (опыты)',    price: 3200,  icon: '⚗️', badgeBg: 'from-lime-600/30 to-emerald-900/40',       rarity: 'restricted', category: 'school', desc: 'После этого опыта кабинет закрывали на ремонт' },
  { id: 'sch_phys_teacher',   name: 'Злая учительница физики',       price: 4500,  icon: '👩‍🏫', badgeBg: 'from-fuchsia-600/30 to-purple-900/40',    rarity: 'restricted', category: 'school', desc: '«Звонок звенит для учителя, сидим!»' },
  { id: 'sch_gym_rope',       name: 'Порванный канат с физры',       price: 5200,  icon: '🪢', badgeBg: 'from-emerald-700/30 to-teal-900/40',       rarity: 'restricted', category: 'school', desc: 'На нём висел весь 9-А, и ничего — держит' },
  { id: 'sch_trudovik',       name: 'Трудовик с напильником',        price: 7500,  icon: '🧔🔧', badgeBg: 'from-amber-600/40 to-stone-900/40',       rarity: 'restricted', category: 'school', desc: 'Учит пилить табуретку строго по ГОСТу' },
  { id: 'sch_teacher_mug',    name: 'Кружка классной руководительницы', price: 8800, icon: '☕', badgeBg: 'from-orange-600/30 to-amber-900/40',     rarity: 'restricted', category: 'school', desc: '«Лучший классный руководитель 2019»' },
  { id: 'sch_parent_meet',    name: 'Экстренное собрание родителей', price: 12000, icon: '🤬', badgeBg: 'from-pink-600/30 to-red-950/40',            rarity: 'classified', category: 'school', desc: 'Дома ждёт жесткий разговор' },
  { id: 'sch_fire_extinguisher', name: 'Огнетушитель после дискотеки', price: 14000, icon: '🧯', badgeBg: 'from-red-600/40 to-orange-900/50',        rarity: 'classified', category: 'school', desc: 'Пенный, пустой, но с историей' },
  { id: 'sch_prom_queen',     name: 'Корона выпускного вечера',      price: 26000, icon: '👑', badgeBg: 'from-amber-400/40 to-rose-800/40',          rarity: 'classified', category: 'school', desc: 'Досталась тому, кто первым успел к микрофону' },
  { id: 'sch_gym_shoes',      name: 'Забытая сменка с физры',        price: 28000, icon: '👟', badgeBg: 'from-emerald-600/30 to-teal-900/40',        rarity: 'classified', category: 'school', desc: 'Пролежала в раздевалке с сентября' },
  { id: 'sch_medal_sport',    name: 'Кубок за победу в эстафете',    price: 45000, icon: '🏆', badgeBg: 'from-yellow-500/30 to-amber-700/40',        rarity: 'classified', category: 'school', desc: 'Стоит в стеклянном шкафу у входа' },
  { id: 'sch_100_points',     name: 'ЕГЭ на 100 баллов',             price: 62000, icon: '📝✨', badgeBg: 'from-cyan-500/40 to-emerald-800/40',      rarity: 'classified', category: 'school', desc: 'Четыре часа боли — и сотка в кармане' },
  { id: 'sch_gold_medal',     name: 'Школьная золотая медаль',       price: 75000, icon: '🥇', badgeBg: 'from-amber-400/40 to-yellow-600/30',        rarity: 'covert',     category: 'school', desc: 'Гордость всей параллели' },
  { id: 'sch_golden_chalk',   name: 'Золотой мел завуча',            price: 130000, icon: '🖍️✨', badgeBg: 'from-amber-300/40 to-yellow-700/40',      rarity: 'covert',     category: 'school', desc: 'Пишет только одни пятёрки в журнал' },
  { id: 'sch_red_diploma',    name: 'Красный аттестат с отличием',   price: 140000, icon: '📜✨', badgeBg: 'from-rose-500/40 to-red-800/40',          rarity: 'covert',     category: 'school', desc: 'Все 5.00 в табеле' },
  { id: 'sch_director_office', name: 'Кабинет директора с завучем',  price: 220000, icon: '🏢', badgeBg: 'from-red-500/40 to-amber-700/30',            rarity: 'covert',     category: 'school', desc: 'Там решается судьба твоего аттестата' },
  { id: 'sch_professor_chair', name: 'Кресло профессора',            price: 320000, icon: '🪑', badgeBg: 'from-indigo-500/40 to-slate-900/50',         rarity: 'covert',     category: 'school', desc: 'Скрипит, но зато кожаное' },
  { id: 'sch_school_bus',     name: 'Школьный автобус №13',          price: 480000, icon: '🚌', badgeBg: 'from-yellow-500/40 to-orange-800/40',        rarity: 'covert',     category: 'school', desc: 'Возит всю параллель, водитель — легенда' },
  { id: 'sch_entire_school',  name: 'ШКОЛА №1337 ЦЕЛИКОМ',           price: 650000, icon: '🏫', badgeBg: 'from-yellow-400/40 to-orange-600/40',        rarity: 'gold',       category: 'school', desc: 'Со всеми 11 классами и столовой' },
  { id: 'sch_golden_diary',   name: 'Дневник отличника (Только 5+)', price: 999999, icon: '⭐', badgeBg: 'from-amber-300/50 to-yellow-500/50',         rarity: 'gold',       category: 'school', desc: 'Супер-редкий лут из Тайника Завуча!' },
  { id: 'sch_timetable_relic', name: 'Расписание без «окон»',        price: 1250000, icon: '🗓️', badgeBg: 'from-cyan-300/40 to-indigo-700/50',         rarity: 'gold',       category: 'school', desc: 'Артефакт, который никто не видел в реальности' },
  { id: 'gift_apology_35',    name: '🎁 Подарок-извинение от администрации', price: 1500000, icon: '🎁', badgeBg: 'from-amber-300/60 to-rose-500/50', rarity: 'gold', category: 'school', desc: 'Дорогой предмет в качестве извинений за то, что все аккаунты были сброшены из-за технических неполадок. Спасибо, что остаётесь с нами! Теперь всё в норме ❤️ Зарегистрируйтесь заново — подарок уже в рюкзаке!' },
  // ===== 4.1 — НОВЫЕ ШКОЛЬНЫЕ ПРЕДМЕТЫ =====
  { id: 'sch_library_card',   name: 'Просроченный читательский билет', price: 900,   icon: '📚', badgeBg: 'from-amber-700/30 to-yellow-900/40',   rarity: 'consumer', category: 'school', desc: 'Долг в библиотеке с 2019 года — 47 книг' },
  { id: 'sch_broken_bell',    name: 'Сломанный школьный звонок',     price: 1300,  icon: '🔔', badgeBg: 'from-zinc-600/30 to-neutral-800/40',   rarity: 'milspec',  category: 'school', desc: 'Звенит только когда хочет, обычно на 10 минут позже' },
  { id: 'sch_lost_socks',     name: 'Потерянные носки из раздевалки',price: 600,   icon: '🧦', badgeBg: 'from-slate-600/30 to-gray-800/40',      rarity: 'consumer', category: 'school', desc: 'Кто-то ищет их уже 2 года' },
  { id: 'sch_chewed_ruler',   name: 'Погрызенная линейка-трансформер',price: 750,  icon: '📏', badgeBg: 'from-cyan-600/30 to-blue-900/40',        rarity: 'milspec',  category: 'school', desc: 'Гнётся в обе стороны, но уже не измеряет' },
  { id: 'sch_glue_stick',     name: 'Клей-карандаш без колпачка',    price: 1100,  icon: '🧴', badgeBg: 'from-yellow-600/30 to-amber-900/40',    rarity: 'milspec',  category: 'school', desc: 'Застыл ещё в прошлом семестре' },
  { id: 'sch_stolen_chalk',   name: 'Кусок мела с доски директора',  price: 2500,  icon: '✏️', badgeBg: 'from-stone-500/30 to-zinc-800/40',       rarity: 'restricted', category: 'school', desc: 'Стырен прямо во время педсовета' },
  { id: 'sch_canteen_ticket', name: 'Талон в столовую на 2015 год',  price: 3200,  icon: '🎟️', badgeBg: 'from-orange-600/30 to-red-900/40',      rarity: 'restricted', category: 'school', desc: 'Срок годности вышел, но буфетчица всё ещё принимает' },
  { id: 'sch_broken_mic',     name: 'Микрофон с линейки',            price: 5600,  icon: '🎤', badgeBg: 'from-purple-600/30 to-indigo-900/40',    rarity: 'restricted', category: 'school', desc: 'Фонит так, что слышно в соседней школе' },
  { id: 'sch_old_globe',      name: 'Глобус с СССР',                 price: 8200,  icon: '🌍', badgeBg: 'from-emerald-700/30 to-teal-900/40',     rarity: 'restricted', category: 'school', desc: 'Ещё показывает Югославию и Чехословакию' },
  { id: 'sch_magic_board',    name: 'Интерактивная доска с трещиной',price: 15000, icon: '🖥️', badgeBg: 'from-blue-600/30 to-cyan-900/40',        rarity: 'classified', category: 'school', desc: 'Сенсор работает только если стукнуть сбоку' },
  { id: 'sch_teacher_diary',  name: 'Журнал учителя с двойками',     price: 18000, icon: '📓', badgeBg: 'from-rose-600/30 to-red-900/40',         rarity: 'classified', category: 'school', desc: 'Там все твои косяки за 11 лет' },
  { id: 'sch_golden_backpack',name: 'Золотой рюкзак отличника',      price: 35000, icon: '🎒✨', badgeBg: 'from-amber-400/40 to-yellow-700/40',    rarity: 'classified', category: 'school', desc: 'В нём помещается вся библиотека' },
  { id: 'sch_director_stamp', name: 'Штамп «ОТЧИСЛЕН»',              price: 42000, icon: '🔴', badgeBg: 'from-red-600/40 to-rose-900/50',          rarity: 'classified', category: 'school', desc: 'Им боятся даже учителя' },
  { id: 'sch_lab_skeleton',   name: 'Скелет из кабинета биологии',   price: 55000, icon: '💀', badgeBg: 'from-stone-500/30 to-neutral-900/50',    rarity: 'covert', category: 'school', desc: 'Зовут Геннадий, знает все кости наизусть' },
  { id: 'sch_chem_lab',       name: 'Кабинет химии после опыта',     price: 95000, icon: '🧪', badgeBg: 'from-lime-600/30 to-emerald-900/40',     rarity: 'covert', category: 'school', desc: 'Пахнет даже через 3 месяца' },
  { id: 'sch_sport_cup_gold', name: 'Золотой кубок спартакиады',     price: 110000, icon: '🏆✨', badgeBg: 'from-yellow-400/40 to-amber-700/40',   rarity: 'covert', category: 'school', desc: 'Выиграл 9-Б, но присвоил завхоз' },
  { id: 'sch_piano_music',    name: 'Пианино из актового зала',      price: 175000, icon: '🎹', badgeBg: 'from-violet-600/30 to-purple-900/40',   rarity: 'covert', category: 'school', desc: 'На нём играют только «Собачий вальс»' },
  { id: 'sch_library_full',   name: 'Школьная библиотека целиком',   price: 300000, icon: '📚✨', badgeBg: 'from-amber-600/40 to-yellow-900/40',   rarity: 'gold', category: 'school', desc: '5000 книг, половина — потерянные сочинения' },
  { id: 'sch_stadium',        name: 'Школьный стадион с трибунами',  price: 500000, icon: '🏟️', badgeBg: 'from-green-600/40 to-emerald-900/40',   rarity: 'gold', category: 'school', desc: 'Тут проходил легендарный матч 11-А против учителей' }
];

/* ---------- CS2 каталог ---------- */
const CS2_CATALOG = [
  { id: 'cs_p250_sand',       name: 'P250 | Песчаная буря',      price: 110,    icon: '🔫', img: 'https://community.cloudflare.steamstatic.com/economy/image/-9a81dlWLwJ2UUGcVs_nsVtzdOEdtWwKGZZLQHTxDZ7I56KU0Zwwo4NUX4oFJZEHLbXH5ApeO4YmlhxYQknCRvCo04DEVlxkKgpopujwezhoyszMdTRH_8i_k4WIkuPzNrfum25V4dB8xLvF8d6s2wXnqkdoZmv7d9fDcwI7YFGB-VTtye3mgpPu7Z_Mm3BkupN2-z-DyP2rGkYQ/200fx200f', rarity: 'consumer', category: 'cs2', wear: 'После полевых' },
  { id: 'cs_usp_torque',      name: 'USP-S | Закрученный',       price: 420,    icon: '🔫', img: 'https://community.cloudflare.steamstatic.com/economy/image/-9a81dlWLwJ2UUGcVs_nsVtzdOEdtWwKGZZLQHTxDZ7I56KU0Zwwo4NUX4oFJZEHLbXH5ApeO4YmlhxYQknCRvCo04DEVlxkKgpoo6m1FBRp3_bGcjhQ09-jq5WYh8j3KqnUjlRd4cJ5nqeWpI-g3Qe3r0s6ZTzzcNXAcwY5aArY8gXtx-rt05S-uZ7Nz3I2vCYr5Hnayxe0iB1POLE7gvCACQLJxH0Gf_4/200fx200f', rarity: 'milspec', category: 'cs2', wear: 'Прямо с завода' },
  { id: 'cs_mp9_star',        name: 'MP9 | Звёздный защитник',    price: 900,    icon: '🔫', badgeBg: 'from-indigo-600/40 to-blue-900/50', rarity: 'milspec', category: 'cs2', desc: 'Космос на стволе и в душе' },
  { id: 'cs_glock_water',     name: 'Glock-18 | Водяной элементаль', price: 1350, icon: '🔫', img: 'https://community.cloudflare.steamstatic.com/economy/image/-9a81dlWLwJ2UUGcVs_nsVtzdOEdtWwKGZZLQHTxDZ7I56KU0Zwwo4NUX4oFJZEHLbXH5ApeO4YmlhxYQknCRvCo04DEVlxkKgposbaqKAxf0v73fyhB4Nm3hr-Yksj4OrzZgiVT68ch2b-R896s0Vfs8kZsYTzzLIWRcgc9MFCD-wLtxum805646svMynJk6yV2-z-DyD-Vq0jC/200fx200f', rarity: 'restricted', category: 'cs2', wear: 'Немного поношенное' },
  { id: 'cs_deagle_print',    name: 'Desert Eagle | Принтстрим',  price: 1600,   icon: '🦅', badgeBg: 'from-lime-500/40 to-emerald-900/50', rarity: 'restricted', category: 'cs2', desc: 'Классика, которая всегда в моде' },
  { id: 'cs_m4a4_buzz',       name: 'M4A4 | Дозор смерти',        price: 3400,   icon: '🔫', img: 'https://community.cloudflare.steamstatic.com/economy/image/-9a81dlWLwJ2UUGcVs_nsVtzdOEdtWwKGZZLQHTxDZ7I56KU0Zwwo4NUX4oFJZEHLbXH5ApeO4YmlhxYQknCRvCo04DEVlxkKgpou-6kejhz2v_Nfz5H_uO1gb-Gw_alIITBhGJf_NZlmOzA-LP5gVO8v11sYm2nLY6Vd1Q3Yl6D-li3kunp0Me4tJqfznBhvnZ35S6IzBfhn1gSOaOaU4gC/200fx200f', rarity: 'classified', category: 'cs2', wear: 'Прямо с завода' },
  { id: 'cs_ak_slate',        name: 'AK-47 | Сланец',             price: 5200,   icon: '🔫', img: 'https://community.cloudflare.steamstatic.com/economy/image/-9a81dlWLwJ2UUGcVs_nsVtzdOEdtWwKGZZLQHTxDZ7I56KU0Zwwo4NUX4oFJZEHLbXH5ApeO4YmlhxYQknCRvCo04DEVlxkKgpot7HxfDhjxszJemkV08y5nY6fqPP9ILrDhGpI18h0juDU-MKmigXm-0Y6MW7yJoecJwBoNFzUrwLskem9jZW8vZzNmnUyuXUmsH-ImkG20hoYbeFxxavJ7sM84e8/200fx200f', rarity: 'restricted', category: 'cs2', wear: 'Прямо с завода' },
  { id: 'cs_ak_redline',      name: 'AK-47 | Красная линия',      price: 9500,   icon: '🩸', badgeBg: 'from-rose-600/40 to-red-950/50', rarity: 'classified', category: 'cs2', desc: 'Тонкая красная черта на всю карьеру' },
  { id: 'cs_awp_asiimov',     name: 'AWP | Азимов',               price: 21000,  icon: '🎯', img: 'https://community.cloudflare.steamstatic.com/economy/image/-9a81dlWLwJ2UUGcVs_nsVtzdOEdtWwKGZZLQHTxDZ7I56KU0Zwwo4NUX4oFJZEHLbXH5ApeO4YmlhxYQknCRvCo04DEVlxkKgpot621FAR17PLfYQJD_9W7m5a0n_L1JaKfzzoGuMlOpu-Voo-h2Qzk-UtvNTr6dYfBeg9sYl7TrQC3wbvth5O1vM7NzyMyu3Nw-z-DyHOx4mF6/200fx200f', rarity: 'classified', category: 'cs2', wear: 'После полевых' },
  { id: 'cs_awp_neonoir',     name: 'AWP | Неонуар',              price: 33000,  icon: '🌌', badgeBg: 'from-violet-600/40 to-indigo-950/60', rarity: 'classified', category: 'cs2', desc: 'Город, дождь и один выстрел' },
  { id: 'cs_ak_vulcan',       name: 'AK-47 | Вулкан',             price: 46000,  icon: '🌋', img: 'https://community.cloudflare.steamstatic.com/economy/image/-9a81dlWLwJ2UUGcVs_nsVtzdOEdtWwKGZZLQHTxDZ7I56KU0Zwwo4NUX4oFJZEHLbXH5ApeO4YmlhxYQknCRvCo04DEVlxkKgpot7HxfDhjxszJemkV08-5lpKKqPrxN7LEmyVQ7MEpiLuSrYmnjQO3-UdsZGHyd4_BdwE2aVCE_VO8k-fs18W76pnInCRr7ygl4WGlm0OxiB5SLrs4vW4Qz8A/200fx200f', rarity: 'covert', category: 'cs2', wear: 'Немного поношенное' },
  { id: 'cs_m4a1_hyper',      name: 'M4A1-S | Гиперзверь',        price: 62000,  icon: '🐆', badgeBg: 'from-orange-600/40 to-fuchsia-900/50', rarity: 'covert', category: 'cs2', desc: 'Дикий зверь на каждой позиции' },
  { id: 'cs_usp_killconf',    name: 'USP-S | Убийство подтверждено', price: 88000, icon: '💀', badgeBg: 'from-slate-500/40 to-slate-950/60', rarity: 'covert', category: 'cs2', desc: 'Тихий выстрел, громкий результат' },
  { id: 'cs_glock_fade',      name: 'Glock-18 | Градиент',        price: 185000, icon: '🌈', badgeBg: 'from-pink-500/40 to-cyan-700/40', rarity: 'covert', category: 'cs2', desc: 'Фейд на пистолете — флекс в каждом раунде' },
  { id: 'cs_karambit_fade',   name: '★ Керамбит | Градиент',      price: 175000, icon: '🔪', img: 'https://community.cloudflare.steamstatic.com/economy/image/-9a81dlWLwJ2UUGcVs_nsVtzdOEdtWwKGZZLQHTxDZ7I56KU0Zwwo4NUX4oFJZEHLbXH5ApeO4YmlhxYQknCRvCo04DEVlxkKgpovbss3vTxfqvmZDpx79b5hoWYg8j5Nr_Yg2YfucFw2r-Vp92j21C2_kE-Z2-hLYaTIwU6NFCE_AK6xOq-gMe86cjLnCRrvCl2-z-DyI4j2d37/200fx200f', rarity: 'gold', category: 'cs2', wear: 'Прямо с завода' },
  { id: 'cs_butterfly_lore',  name: '★ Нож-бабочка | Легенды',    price: 380000, icon: '🦋', img: 'https://community.cloudflare.steamstatic.com/economy/image/-9a81dlWLwJ2UUGcVs_nsVtzdOEdtWwKGZZLQHTxDZ7I56KU0Zwwo4NUX4oFJZEHLbXH5ApeO4YmlhxYQknCRvCo04DEVlxkKgpovbss3vTxfqzgfD595MWkgoWOh-PnJr7um25V4dB8xOiW8Nug2Ffm_EU-Z2vzdoCRdlA2Y1DXrFHrk-rnh8ftu5icmHFivSMr53fYmEezg0lPbeFxxavJd6N3b8Y/200fx200f', rarity: 'gold', category: 'cs2', wear: 'Прямо с завода' },
  { id: 'cs_karambit_dop',    name: '★ Керамбит | Доплер (Сапфир)', price: 620000, icon: '💎', badgeBg: 'from-blue-500/50 to-cyan-900/60', rarity: 'gold', category: 'cs2', desc: 'Сапфировый узор — мечта коллекционера' },
  { id: 'cs_awp_dlore',       name: 'AWP | История о драконе',    price: 890000, icon: '🐉', img: 'https://community.cloudflare.steamstatic.com/economy/image/-9a81dlWLwJ2UUGcVs_nsVtzdOEdtWwKGZZLQHTxDZ7I56KU0Zwwo4NUX4oFJZEHLbXH5ApeO4YmlhxYQknCRvCo04DEVlxkKgpot621FAR17P7NdTRH-t26q4SZlvD7PYTQgXtu5Mx2gv2PoI-n3wDk_hY6YmCiI9CRdQc8NVyBqVW8x-zphZC-us_MmnNmv3Yn-z-DyCGv77-B/200fx200f', rarity: 'gold', category: 'cs2', wear: 'Прямо с завода' },
  { id: 'cs_butterfly_em',    name: '★ Нож-бабочка | Изумруд',    price: 950000, icon: '💚', badgeBg: 'from-emerald-400/50 to-teal-900/60', rarity: 'gold', category: 'cs2', desc: 'Признак высшего флекса на сервере' },
  { id: 'cs_bayonet_ruby',    name: '★ Штык-нож | Рубин',         price: 1250000, icon: '🩸💎', badgeBg: 'from-red-500/50 to-rose-950/60', rarity: 'gold', category: 'cs2', desc: 'Кровавый камень на белой рукояти' },
  { id: 'cs_m4_howl',         name: 'M4A4 | Вой (StatTrak)',      price: 1450000, icon: '🐺', img: 'https://community.cloudflare.steamstatic.com/economy/image/-9a81dlWLwJ2UUGcVs_nsVtzdOEdtWwKGZZLQHTxDZ7I56KU0Zwwo4NUX4oFJZEHLbXH5ApeO4YmlhxYQknCRvCo04DEVlxkKgpou-6kejhz2v_Nfz5H_uO1gb-Gw_alIITBhGJf_NZlmOzA-LP5gVO8v11sYm2nLY6Vd1Q3Yl6D-li3kunp0Me4tJqfznBhvnZ35S6IzBfhn1gSOaOaU4gC/200fx200f', rarity: 'covert', category: 'cs2', wear: 'Прямо с завода' }
];

/* ---------- Каталог других игр ---------- */
const OTHER_GAMES_CATALOG = [
  { id: 'gm_mc_pickaxe',  name: 'Алмазная кирка (Удача III)',      price: 1400,   icon: '⛏️', badgeBg: 'from-cyan-500/40 to-blue-900/50',     rarity: 'milspec',    category: 'other', game: 'Minecraft', desc: 'Добывает обсидиан за считанные секунды' },
  { id: 'gm_rust_ak',     name: 'Штурмовая винтовка (Калаш)',      price: 8200,   icon: '💥', badgeBg: 'from-orange-700/40 to-stone-900/50',   rarity: 'restricted', category: 'other', game: 'Rust', desc: 'С зажимом на 100 метров' },
  { id: 'gm_mc_apple',    name: 'Зачарованное золотое яблоко',     price: 9500,   icon: '🍏✨', badgeBg: 'from-amber-400/40 to-yellow-600/50',  rarity: 'restricted', category: 'other', game: 'Minecraft', desc: 'Дает регенерацию V и огнестойкость' },
  { id: 'gm_rust_c4',     name: 'С4 (Взрывчатка с таймером)',      price: 24000,  icon: '💣', badgeBg: 'from-red-600/40 to-stone-950/60',      rarity: 'classified', category: 'other', game: 'Rust', desc: 'Сносит любую железную стену' },
  { id: 'gm_mc_sword',    name: 'Незеритовый меч (Острота V)',     price: 32000,  icon: '🗡️', badgeBg: 'from-slate-700/50 to-neutral-900/60',  rarity: 'classified', category: 'other', game: 'Minecraft', desc: 'Урон по боссам на максималках' },
  { id: 'gm_dota_arcana', name: 'Manifold Paradox (PA Arcana)',    price: 42000,  icon: '⚔️', badgeBg: 'from-teal-500/40 to-cyan-900/50',      rarity: 'covert',     category: 'other', game: 'Dota 2', desc: 'Клинки Мортред с кровавым следом' },
  { id: 'gm_mc_totem',    name: 'Тотем бессмертия',                price: 120000, icon: '🗿', badgeBg: 'from-yellow-600/40 to-amber-900/50',   rarity: 'covert',     category: 'other', game: 'Minecraft', desc: 'Спасает от смерти. Работает один раз' },
  { id: 'gm_rust_rocket', name: 'Ракетница (Rust)',                price: 180000, icon: '🚀', badgeBg: 'from-orange-600/40 to-red-950/50',     rarity: 'covert',     category: 'other', game: 'Rust', desc: 'Открывает любые двери. Вежливо' },
  { id: 'gm_dota_hook',   name: 'Dragonclaw Hook (Pudge)',         price: 320000, icon: '🪝', badgeBg: 'from-amber-600/40 to-stone-900/50',    rarity: 'gold',       category: 'other', game: 'Dota 2', desc: 'Легендарный хук из костей дракона' },
  { id: 'gm_tf2_unusual', name: 'Burning Flames Team Captain',     price: 540000, icon: '🔥👑', badgeBg: 'from-orange-500/40 to-red-900/50',    rarity: 'gold',       category: 'other', game: 'TF2', desc: 'Король всех Unusual шапок Team Fortress' },
  { id: 'gm_dota_aegis',  name: 'Аегис Возрождения',               price: 1400000, icon: '🛡️', badgeBg: 'from-amber-300/50 to-yellow-800/50',  rarity: 'gold',      category: 'other', game: 'Dota 2', desc: 'Второй шанс, который дают раз в году' }
];

/* ---------- Кошачий каталог (секретная ветка) ---------- */
const CAT_CATALOG = [
  { id: 'cat_black_physics', name: 'Чёрный кот из кабинета физики', price: 350000,  icon: '🐈‍⬛', badgeBg: 'from-slate-700/60 to-neutral-950/70', rarity: 'covert', category: 'cat', desc: 'Спит на учебнике физики и приносит удачу на контрольной' },
  { id: 'cat_curator',       name: 'Кот-Завуч с валерьянской настойкой', price: 900000, icon: '😼', badgeBg: 'from-fuchsia-600/50 to-purple-950/60', rarity: 'gold', category: 'cat', desc: 'Требует дневник, но принимает его только для вида' },
  { id: 'cat_canteen',       name: 'Кот-Сметанный Барон из столовой', price: 1600000, icon: '😻', badgeBg: 'from-amber-400/50 to-orange-900/60', rarity: 'gold', category: 'cat', desc: 'Официально самый упитанный житель школы' },
  { id: 'cat_diary_eater',   name: 'Кот, который съел дневник',    price: 2500000, icon: '🙀', badgeBg: 'from-rose-500/50 to-red-950/60', rarity: 'gold', category: 'cat', desc: 'Спас тебя от родительского собрания. Герой!' },
  { id: 'cat_murka',         name: 'Мурка — учительница мурчания', price: 4000000, icon: '🐱', badgeBg: 'from-pink-400/50 to-fuchsia-900/60', rarity: 'gold', category: 'cat', desc: 'Ведёт факультатив по обнимашкам на перемене' },
  { id: 'cat_professor',     name: 'Кот Профессор Алгебры',        price: 6500000, icon: '🐈', badgeBg: 'from-cyan-400/50 to-blue-950/60', rarity: 'secret', category: 'cat', desc: 'Решает уравнения, когда никто не смотрит' },
  { id: 'cat_gora_bogdan',   name: '🐱 ГОРА БОГДАНА — ЛЕГЕНДАРНЫЙ КОТИК', price: 10000000, icon: '🏔️🐱', badgeBg: 'from-cyan-300/50 to-fuchsia-500/70', rarity: 'secret', category: 'cat', desc: 'Легендарный котик Гора Богдана! Его нельзя продать, но можно апгрейднуть', noSell: true, promoOnly: true },
  { id: 'cat_keeper',        name: 'КОТ-ХРАНИТЕЛЬ ШКОЛЫ ★ СЕКРЕТНЫЙ', price: 10000000, icon: '🐱', img: 'assets/secret-cat.png', badgeBg: 'from-cyan-400/60 to-fuchsia-900/70', rarity: 'secret', category: 'cat', desc: 'Легенда школы. Появляется лишь тем, кто дошёл до секретного кейса' }
];

/* ---------- 4.1 — ЗОЛОТАЯ КОЛЛЕКЦИЯ (особняк, яхта, вертолёт) ---------- */
const GOLDEN_CATALOG = [
  { id: 'gold_mansion',   name: 'Золотой особняк директора', price: 5000000000, icon: '🏰', badgeBg: 'from-amber-300/60 to-yellow-600/50', rarity: 'gold', category: 'school', desc: 'Трёхэтажный особняк из чистого золота — в нём живёт только директор. Можно взять в кредит по радужной карте!' },
  { id: 'gold_yacht',     name: 'Золотая яхта выпускников',  price: 12000000000, icon: '🛥️', badgeBg: 'from-yellow-300/60 to-amber-700/50', rarity: 'gold', category: 'school', desc: 'Яхта, на которой уплывает 11 класс после последнего звонка. Полностью золотая, даже якорь.' },
  { id: 'gold_helicopter',name: 'Золотой вертолёт завуча',   price: 25000000000, icon: '🚁', badgeBg: 'from-amber-400/60 to-orange-700/50', rarity: 'secret', category: 'school', desc: 'Вертолёт завуча — летает над школой и следит, чтобы никто не сбежал с уроков. Золотой корпус, кожаные сиденья.' },
  { id: 'gold_school_ring', name: 'Золотое кольцо школы',    price: 1000000000, icon: '💍', badgeBg: 'from-yellow-200/60 to-amber-600/50', rarity: 'gold', category: 'school', desc: 'Кольцо с гербом школы — носят только легенды' },
  { id: 'gold_statue',    name: 'Золотая статуя отличника',  price: 3000000000, icon: '🗿', badgeBg: 'from-amber-300/50 to-yellow-700/50', rarity: 'gold', category: 'school', desc: 'Статуя в холле школы — отлита из золота медалистов' }
];

/* ---------- Ультра-экономика: предметы для поздней игры ---------- */
const ULTRA_CATALOG = [
  { id: 'ultra_school_city', name: 'Школьный город-миллиардер', price: 25000000000, icon: '🏙️', badgeBg: 'from-indigo-500/60 to-cyan-500/40', rarity: 'secret', category: 'school', desc: 'Целый город с кампусом школы и стадионом' },
  { id: 'ultra_creator_empire', name: 'Империя ютуберов', price: 100000000000, icon: '🌐', badgeBg: 'from-red-500/60 to-purple-600/50', rarity: 'secret', category: 'other', game: 'YouTube', desc: 'Все каналы сезона 3 в одном владении' },
  { id: 'ultra_diamond_studio', name: 'Алмазная студия David Lite', price: 1000000000000, icon: '💠', badgeBg: 'from-cyan-200/70 to-blue-700/60', rarity: 'secret', category: 'other', game: 'YouTube', desc: 'Студия, где каждый кадр стоит состояния' },
  { id: 'ultra_multiverse', name: 'Мультивселенная Школы Дроп', price: 10000000000000, icon: '🌌', badgeBg: 'from-violet-400/70 to-fuchsia-700/60', rarity: 'secret', category: 'other', game: 'Школа Дроп', desc: 'Абсолютный предмет для баланса в десятки триллионов' },
  /* Мемориальный предмет: 1 миллиард триллионов = 10^21 ₽. Самый дорогой предмет игры. */
  { id: 'ultra_legend_hamster', name: 'ЛЕГЕНДАРНЫЙ ХОМЯК ★ ВЕЧНАЯ ПАМЯТЬ', price: 1000000000000000000000, icon: '🐹', img: 'assets/legend-hamster.jpg', badgeBg: 'from-amber-200/70 to-slate-700/70', rarity: 'secret', category: 'cat', game: 'Школа Дроп', desc: 'Он жил в пенале и грел лапками весь проект. Ушёл на радугу, но остался легендой Школы Дроп. Стоит миллиард триллионов — потому что бесценен. 🕊️' }
];

/* ---------- Сезон 3: кейсы ютуберов ---------- */
const SEASON3_CATALOG = [
  { id: 'yt_creator_award', name: 'Золотая кнопка YouTube', price: 2000000, icon: '🏆', badgeBg: 'from-yellow-400/50 to-orange-700/50', rarity: 'covert', category: 'other', game: 'YouTube', desc: 'Миллион подписчиков и ни одного страйка' },
  { id: 'yt_diamond_award', name: 'Бриллиантовая кнопка YouTube', price: 100000000, icon: '💎', badgeBg: 'from-cyan-200/60 to-blue-700/60', rarity: 'secret', category: 'other', game: 'YouTube', desc: '100 миллионов подписчиков. Ультра-легендарный предмет сезона 3' },
  { id: 'yt_play_button', name: 'Серебряная кнопка YouTube', price: 450000, icon: '🥈', badgeBg: 'from-slate-300/50 to-slate-700/50', rarity: 'gold', category: 'other', game: 'YouTube', desc: 'Первая большая награда автора' },
  { id: 'yt_creator_camera', name: 'Камера ночного блогера', price: 1200000, icon: '📹', badgeBg: 'from-violet-500/50 to-indigo-900/60', rarity: 'covert', category: 'other', game: 'YouTube', desc: 'Снимает даже когда света в кабинете нет' },
  { id: 'yt_stream_deck', name: 'Пульт стримера', price: 700000, icon: '🎛️', badgeBg: 'from-fuchsia-500/50 to-purple-900/60', rarity: 'classified', category: 'other', game: 'YouTube', desc: 'Одна кнопка — и весь класс в прямом эфире' }
];

/* ---------- ⚡ АПГРЕЙД-ЭКСКЛЮЗИВЫ (сезон 3.7) ----------
   Эти предметы НЕЛЬЗЯ выбить из кейсов и НЕЛЬЗЯ купить в лавке —
   только занести в честном апгрейдере. Целая лестница целей. */
const UPGRADE_CATALOG = [
  { id: 'upg_pero_zavuch',   name: 'Перо завуча (трофейное)',       price: 3300,    icon: '🪶', badgeBg: 'from-violet-600/30 to-purple-900/40',  rarity: 'restricted', category: 'upgrade', upgradeExclusive: true, desc: 'Им подписывали лучшие характеристики школы. Только апгрейд!' },
  { id: 'upg_silver_whistle', name: 'Серебряный свисток физрука',   price: 7700,    icon: '🥈', badgeBg: 'from-slate-400/30 to-slate-800/40',    rarity: 'classified', category: 'upgrade', upgradeExclusive: true, desc: 'Прозвенит — и эстафета считается выигранной. Только апгрейд!' },
  { id: 'upg_cabinet_key',   name: 'Запасной ключ от 4 кабинета',   price: 15500,   icon: '🗝️', badgeBg: 'from-amber-600/30 to-yellow-900/40',   rarity: 'covert',     category: 'upgrade', upgradeExclusive: true, desc: 'Там хранятся ответы ВСЕХ контрольных. Только апгрейд!' },
  { id: 'upg_eagle_badge',   name: 'Значок «Гордость школы»',       price: 42000,   icon: '🦅', badgeBg: 'from-orange-500/30 to-rose-900/40',    rarity: 'covert',     category: 'upgrade', upgradeExclusive: true, desc: 'Выдают раз в 10 лет самому достойному. Только апгрейд!' },
  { id: 'upg_radio_zavuch',  name: 'Рация завуча с подслушкой',     price: 95000,   icon: '📻', badgeBg: 'from-emerald-600/30 to-teal-900/40',   rarity: 'covert',     category: 'upgrade', upgradeExclusive: true, desc: 'Слышно, что шепчут в учительской. Только апгрейд!' },
  { id: 'upg_gold_whistle',  name: 'Золотой свисток главного судьи', price: 240000,  icon: '🥇', badgeBg: 'from-amber-300/40 to-yellow-700/40',   rarity: 'gold',       category: 'upgrade', upgradeExclusive: true, desc: 'Судья всех школьных споров. Только апгрейд!' },
  { id: 'upg_director_seal', name: 'Печать директора школы',        price: 777000,  icon: '🔏', badgeBg: 'from-red-500/40 to-amber-800/40',      rarity: 'gold',       category: 'upgrade', upgradeExclusive: true, desc: 'Один оттиск — и любое «нет» превращается в «да». Только апгрейд!' },
  { id: 'upg_time_bell',     name: 'Колокол, останавливающий время', price: 2600000, icon: '🕰️', badgeBg: 'from-cyan-400/30 to-indigo-800/40',      rarity: 'gold',       category: 'upgrade', upgradeExclusive: true, desc: 'Прозвенел — и перемена длится вечность. Только апгрейд!' },
  { id: 'upg_legend_pack',   name: 'Рюкзак Легенды 11 «А»',         price: 8800000, icon: '🎒', badgeBg: 'from-fuchsia-500/40 to-purple-900/50', rarity: 'gold',       category: 'upgrade', upgradeExclusive: true, desc: 'В нём лежал самый первый золотой мел завуча. Только апгрейд!' },
  { id: 'upg_phoenix_student', name: 'Призрак вечного отличника',   price: 24000000, icon: '👻', badgeBg: 'from-cyan-300/50 to-fuchsia-700/50',  rarity: 'secret',     category: 'upgrade', upgradeExclusive: true, desc: 'Ультимативный трофей апгрейдера. Ходят слухи, он до сих пор делает уроки.' }
];

/* В лавке теперь продаются ТОЛЬКО 4 базовые вещицы — всё ценное добывается
   в кейсах (жёстко!) или заносится в апгрейдере (эксклюзивы выше). */
const SHOP_ITEM_IDS = ['sch_cold_cutlet', 'sch_chewed_pen', 'sch_eraser', 'sch_banana_peel'];

/* ---------- Каталог Лаборатории 3.6 Beta (экспериментальные предметы) ----------
   Предметы физически живут в общем каталоге, чтобы рюкзак и сейвы не ломались
   при выключении беты. Дропаются они только из бета-кейсов тестовой ветки. */
const BETA_CATALOG = [
  { id: 'beta_holo_diary',    name: 'Голографический дневник',     price: 3600,    icon: '📘', badgeBg: 'from-cyan-600/30 to-sky-900/40',          rarity: 'restricted', category: 'beta', desc: 'Двойки в нём рассеиваются ещё в облаке' },
  { id: 'beta_antimatter',    name: 'Антиматерия из буфета',       price: 9600,    icon: '🥪', badgeBg: 'from-fuchsia-600/30 to-purple-900/40',    rarity: 'classified', category: 'beta', desc: 'Бутерброд массой минус 12 грамм' },
  { id: 'beta_quantum_cheat', name: 'Квантовая шпаргалка 3.6',     price: 36000,   icon: '🌀', badgeBg: 'from-sky-600/30 to-indigo-900/40',        rarity: 'classified', category: 'beta', desc: 'Правильный ответ существует во всех вариантах сразу' },
  { id: 'beta_robo_bell',     name: 'Робозвонок с первого этажа',  price: 96000,   icon: '⏰', badgeBg: 'from-amber-600/30 to-orange-900/40',       rarity: 'covert',     category: 'beta', desc: 'Прозвенел на урок — урока больше нет' },
  { id: 'beta_nuclear_mel',   name: 'Ядерный мел физика',          price: 360000,  icon: '☢️', badgeBg: 'from-lime-600/30 to-emerald-900/40',      rarity: 'covert',     category: 'beta', desc: 'Одна формула — и доска светится до утра' },
  { id: 'beta_cyber_cat',     name: 'Кибер-Кот 3.6',               price: 3600000, icon: '🤖', badgeBg: 'from-cyan-500/40 to-fuchsia-800/40',      rarity: 'secret',     category: 'cat',  desc: 'Хранитель тестовой ветки. Мурлычет на частоте 3.6 ГГц' }
];

/* ---------- 4.1 Beta — предметы вне школьной тематики (включается тумблером beta41) ---------- */
const BETA41_CATALOG = [
  { id: 'b41_neon_sneakers',  name: 'Неоновые кроссовки будущего', price: 15000,   icon: '👟', badgeBg: 'from-cyan-400/40 to-fuchsia-600/40',      rarity: 'restricted', category: 'beta41', desc: 'Светятся в темноте, но не школьная тема — только в бете 4.1' },
  { id: 'b41_holo_watch',     name: 'Голографические часы',        price: 45000,   icon: '⌚', badgeBg: 'from-sky-400/40 to-indigo-700/40',       rarity: 'classified', category: 'beta41', desc: 'Показывают время в 12 измерениях' },
  { id: 'b41_cyber_dragon',   name: 'Кибер-дракон',                price: 120000,  icon: '🐉', badgeBg: 'from-emerald-500/40 to-teal-900/40',      rarity: 'covert',     category: 'beta41', desc: 'Дракон из неонового города, не имеет отношения к школе' },
  { id: 'b41_space_pizza',    name: 'Космическая пицца',           price: 8000,    icon: '🍕', badgeBg: 'from-orange-500/40 to-red-800/40',       rarity: 'restricted', category: 'beta41', desc: 'Пицца с марсианским сыром' },
  { id: 'b41_alien_pet',      name: 'Питомец-инопланетянин',       price: 250000,  icon: '👽', badgeBg: 'from-lime-400/40 to-emerald-800/40',     rarity: 'covert',     category: 'beta41', desc: 'Говорит на языке, которого нет в школьной программе' },
  { id: 'b41_time_machine',   name: 'Машина времени (сломана)',    price: 750000,  icon: '⏳', badgeBg: 'from-violet-500/40 to-purple-900/40',    rarity: 'gold',       category: 'beta41', desc: 'Может вернуть в 1 класс, но батарейка села' },
  { id: 'b41_nft_rock',       name: 'NFT-камень за миллион',       price: 1000000, icon: '🪨', badgeBg: 'from-zinc-500/30 to-neutral-800/40',    rarity: 'gold',       category: 'beta41', desc: 'Просто камень, но в блокчейне' },
  { id: 'b41_magic_wand',     name: 'Волшебная палочка',           price: 500000,  icon: '🪄', badgeBg: 'from-fuchsia-400/40 to-pink-800/40',     rarity: 'gold',       category: 'beta41', desc: 'Превращает двойки в пятёрки, но только в бете' },
  { id: 'b41_flying_car',     name: 'Летающая машина',             price: 5000000, icon: '🚀', badgeBg: 'from-cyan-300/50 to-blue-800/50',        rarity: 'secret',     category: 'beta41', desc: 'Не школьный автобус, а летающий — из будущего' }
];

const ALL_MASTER_ITEMS = [...SCHOOL_CATALOG, ...GOLDEN_CATALOG, ...CS2_CATALOG, ...OTHER_GAMES_CATALOG, ...CAT_CATALOG, ...SEASON3_CATALOG, ...ULTRA_CATALOG, ...BETA_CATALOG, ...BETA41_CATALOG, ...UPGRADE_CATALOG];
const ITEMS_BY_ID = ALL_MASTER_ITEMS.reduce((acc, it) => { acc[it.id] = it; return acc; }, {});

/* ---------- Кейсы (веса = честные шансы, нормализуются автоматически) ---------- */
const CASES_LIST = [
  {
    id: 'case_penal', name: 'Пенал отличника', price: 90, icon: '✏️', color: '#b0c3d9',
    desc: 'Ручки, ластики и первые двойки',
    items: [ { id: 'sch_bad_grade', w: 40 }, { id: 'sch_cold_cutlet', w: 30 }, { id: 'sch_chewed_pen', w: 20 }, { id: 'sch_eraser', w: 10 } ]
  },
  {
    id: 'case_breakfast', name: 'Завтрак второгодника', price: 250, icon: '🥪', color: '#4b69ff',
    desc: 'Котлеты, булки и погрызанные ручки',
    items: [ { id: 'sch_cold_cutlet', w: 24 }, { id: 'sch_chewed_pen', w: 24 }, { id: 'sch_chewed_gum', w: 18 }, { id: 'sch_eraser', w: 18 }, { id: 'sch_diary_note', w: 16 } ]
  },
  {
    id: 'case_lost', name: 'Портфель забытых вещей', price: 600, icon: '🎒', color: '#4b69ff',
    desc: 'Всё, что теряли в раздевалке с сентября',
    items: [ { id: 'sch_chewed_gum', w: 28 }, { id: 'sch_eraser', w: 24 }, { id: 'sch_broken_compass', w: 22 }, { id: 'sch_diary_note', w: 16 }, { id: 'sch_banana_peel', w: 10 } ]
  },
  {
    id: 'case_rusichka', name: 'Гнев русички', price: 1500, icon: '📚', color: '#8847ff',
    desc: 'Замечания, мел, шпоры и злые учителя',
    items: [ { id: 'sch_diary_note', w: 28 }, { id: 'sch_ruler_wood', w: 26 }, { id: 'sch_chalk', w: 22 }, { id: 'sch_cheat_sheet', w: 18 }, { id: 'sch_phys_teacher', w: 6 } ]
  },
  {
    id: 'case_chem', name: 'Кабинет химии', price: 2800, icon: '⚗️', color: '#8847ff',
    desc: 'Опыты, дым и журнал с крысой Фёклой',
    items: [ { id: 'sch_chalk', w: 24 }, { id: 'sch_chemistry_set', w: 28 }, { id: 'sch_cheat_sheet', w: 18 }, { id: 'sch_rat_journal', w: 16 }, { id: 'sch_teacher_mug', w: 11 }, { id: 'sch_fire_extinguisher', w: 3 } ]
  },
  {
    id: 'case_gym', name: 'Спортзал и канат', price: 4200, icon: '🤸', color: '#8847ff',
    desc: 'Канат, сменка и кубок в стеклянном шкафу',
    items: [ { id: 'sch_ruler_wood', w: 22 }, { id: 'sch_gym_rope', w: 28 }, { id: 'sch_gym_shoes', w: 22 }, { id: 'sch_medal_sport', w: 20 }, { id: 'sch_trudovik', w: 8 } ]
  },
  {
    id: 'case_trud', name: 'Подвал трудовика', price: 5500, icon: '🪚', color: '#d32ce6',
    desc: 'Линейки, табуретки, трудовик и забытая сменка',
    items: [ { id: 'sch_ruler_wood', w: 22 }, { id: 'sch_gym_rope', w: 12 }, { id: 'sch_phys_teacher', w: 18 }, { id: 'sch_trudovik', w: 26 }, { id: 'sch_gym_shoes', w: 22 } ]
  },
  {
    id: 'case_teachers', name: 'Учительская (18+)', price: 9000, icon: '☕', color: '#d32ce6',
    desc: 'Кружки, огнетушитель и родительские собрания',
    items: [ { id: 'sch_phys_teacher', w: 20 }, { id: 'sch_trudovik', w: 18 }, { id: 'sch_teacher_mug', w: 24 }, { id: 'sch_fire_extinguisher', w: 24 }, { id: 'sch_parent_meet', w: 14 } ]
  },
  {
    id: 'case_director', name: 'Сейф директора', price: 15000, icon: '💼', color: '#d32ce6',
    desc: 'Сменка, родительские собрания и медали',
    items: [ { id: 'sch_teacher_mug', w: 30 }, { id: 'sch_parent_meet', w: 22 }, { id: 'sch_gym_shoes', w: 14 }, { id: 'sch_medal_sport', w: 12 }, { id: 'sch_gold_medal', w: 14 }, { id: 'sch_director_office', w: 8 } ]
  },
  {
    id: 'case_party', name: 'Новогодний утренник', price: 22000, icon: '🎄', color: '#eb4b4b',
    desc: 'Праздник, корона выпускницы и пенный огнетушитель',
    items: [ { id: 'sch_parent_meet', w: 32 }, { id: 'sch_fire_extinguisher', w: 20 }, { id: 'sch_prom_queen', w: 22 }, { id: 'sch_medal_sport', w: 16 }, { id: 'sch_gold_medal', w: 16 }, { id: 'sch_golden_chalk', w: 8 } ]
  },
  {
    id: 'case_attestat', name: 'Аттестат с отличием', price: 45000, icon: '🎓', color: '#eb4b4b',
    desc: 'Медали, кубки, красный диплом и директор',
    items: [ { id: 'sch_prom_queen', w: 30 }, { id: 'sch_gym_shoes', w: 30 }, { id: 'sch_medal_sport', w: 18 }, { id: 'sch_gold_medal', w: 10 }, { id: 'sch_red_diploma', w: 8 }, { id: 'sch_director_office', w: 6 }, { id: 'sch_golden_chalk', w: 3 } ]
  },
  {
    id: 'case_ege', name: 'ЕГЭ на 100 баллов', price: 70000, icon: '📝', color: '#ffd700',
    desc: 'Сотка, кресло профессора и золотой мел',
    items: [ { id: 'sch_medal_sport', w: 26 }, { id: 'sch_100_points', w: 26 }, { id: 'sch_gold_medal', w: 18 }, { id: 'sch_red_diploma', w: 16 }, { id: 'sch_director_office', w: 8 }, { id: 'sch_golden_chalk', w: 9 }, { id: 'sch_professor_chair', w: 4 } ]
  },
  {
    id: 'case_legend', name: 'Тайник завуча №1337', price: 120000, icon: '👑', color: '#ffd700',
    desc: 'Школа целиком и секретный Золотой Дневник!',
    items: [ { id: 'sch_100_points', w: 30 }, { id: 'sch_gold_medal', w: 26 }, { id: 'sch_golden_chalk', w: 18 }, { id: 'sch_red_diploma', w: 12 }, { id: 'sch_school_bus', w: 10 }, { id: 'sch_director_office', w: 10 }, { id: 'sch_entire_school', w: 10 }, { id: 'sch_golden_diary', w: 6 }, { id: 'sch_professor_chair', w: 4 } ]
  },
  {
    id: 'case_professor', name: 'Коллекция профессора', price: 650000, icon: '🧪', color: '#00f0ff',
    desc: 'Артефакты школы и топовые ножи CS2 в одном сундуке',
    items: [
      { id: 'sch_entire_school', w: 24 }, { id: 'sch_golden_diary', w: 20 }, { id: 'sch_professor_chair', w: 18 },
      { id: 'sch_timetable_relic', w: 20 }, { id: 'cs_m4_howl', w: 10 }, { id: 'cs_karambit_dop', w: 8 }
    ]
  },
  {
    id: 'case_creator', name: 'Кейс начинающего ютубера', price: 2000000, icon: '🎥', color: '#d32ce6',
    season: 3, desc: 'Камеры, стримы и первая кнопка автора',
    items: [ { id: 'yt_stream_deck', w: 34 }, { id: 'yt_creator_camera', w: 28 }, { id: 'yt_play_button', w: 22 }, { id: 'yt_creator_award', w: 16 } ]
  },
  {
    id: 'case_streamer', name: 'Кейс большого стрима', price: 8000000, icon: '📡', color: '#eb4b4b',
    season: 3, desc: 'Большая аудитория и очень редкий дроп',
    items: [ { id: 'yt_stream_deck', w: 28 }, { id: 'yt_creator_camera', w: 25 }, { id: 'yt_creator_award', w: 30 }, { id: 'yt_diamond_award', w: 2 }, { id: 'cat_murka', w: 15 } ]
  },
  {
    id: 'case_influencer', name: 'Кейс инфлюенсера', price: 25000000, icon: '🌟', color: '#ffd700',
    season: 3, desc: 'Только для тех, кто собрал огромную аудиторию',
    items: [ { id: 'yt_play_button', w: 20 }, { id: 'yt_creator_award', w: 38 }, { id: 'yt_creator_camera', w: 25 }, { id: 'yt_diamond_award', w: 3 }, { id: 'cat_professor', w: 14 } ]
  },
  {
    id: 'case_legend_creator', name: 'Кейс легенды YouTube', price: 60000000, icon: '👑', color: '#00f0ff',
    season: 3, desc: 'Почти финальная ступень к бриллиантовой кнопке',
    items: [ { id: 'yt_creator_award', w: 38 }, { id: 'yt_diamond_award', w: 7 }, { id: 'yt_creator_camera', w: 20 }, { id: 'sch_timetable_relic', w: 15 }, { id: 'cat_keeper', w: 20 } ]
  },
  {
    id: 'case_my_diamond', name: 'МОЙ КЕЙС: Бриллиантовая кнопка', price: 100000000, icon: '💎', color: '#67e8f9',
    season: 3, ultra: true, desc: 'Ультра-легендарный кейс. Внутри может выпасть бриллиантовая кнопка YouTube',
    items: [ { id: 'yt_creator_award', w: 32 }, { id: 'yt_diamond_award', w: 8 }, { id: 'cat_keeper', w: 20 }, { id: 'sch_timetable_relic', w: 20 }, { id: 'cs_karambit_dop', w: 20 } ]
  },
  {
    id: 'case_billion_school', name: 'КЕЙС МИЛЛИАРДЕРА: ШКОЛЬНАЯ КОМАНДА', price: 1000000000, icon: '💎', image: 'assets/season3-billion-case.jpg', color: '#f8fafc',
    season: 3, ultra: true, desc: 'Самый дорогой кейс сезона. Ультра-легендарный дроп для настоящей команды',
    items: [ { id: 'yt_diamond_award', w: 10 }, { id: 'cat_keeper', w: 22 }, { id: 'cs_karambit_dop', w: 22 }, { id: 'sch_timetable_relic', w: 18 }, { id: 'yt_creator_award', w: 20 }, { id: 'ultra_school_city', w: 5 }, { id: 'ultra_creator_empire', w: 2 }, { id: 'ultra_diamond_studio', w: 1 }, { id: 'ultra_multiverse', w: 0.2 }, { id: 'ultra_legend_hamster', w: 0.0001 } ]
  },
  {
    id: 'case_cat_secret', name: 'СЕКРЕТНЫЙ КЕЙС: КОТ-ХРАНИТЕЛЬ', price: 10000000, icon: '🐱', color: '#00f0ff',
    secret: true,
    desc: 'Легендарный кейс за 10 000 000 ₽. Внутри живёт Кот и вся его школьная свита',
    items: [
      { id: 'cat_black_physics', w: 20 }, { id: 'cat_curator', w: 20 }, { id: 'cat_canteen', w: 18 },
      { id: 'cat_diary_eater', w: 14 }, { id: 'cat_murka', w: 10 }, { id: 'cat_professor', w: 10 },
      { id: 'cat_keeper', w: 8 }
    ]
  },

  /* ---------- Кейсы Лаборатории 3.6 Beta ----------
     beta: true — видны ТОЛЬКО при включённой тестовой ветке 3.6 Beta.
     Плашка «🧪 ЭКСПЕРИМЕНТАЛЬНО» рисуется в renderCasesUI(). */
  {
    id: 'beta_case_lab36', name: 'Кофр Химика-Экспериментатора', price: 36000, icon: '🧫', color: '#22d3ee',
    beta: true,
    desc: 'Пробирки, дым и первые опыты Лаборатории 3.6',
    items: [
      { id: 'beta_holo_diary', w: 30 }, { id: 'beta_antimatter', w: 26 }, { id: 'beta_quantum_cheat', w: 20 },
      { id: 'beta_robo_bell', w: 14 }, { id: 'beta_nuclear_mel', w: 8 }, { id: 'beta_cyber_cat', w: 2 }
    ]
  },
  {
    id: 'beta_case_cybercat', name: 'Кейс Кибер-Кота 3.6', price: 360000, icon: '🤖', color: '#67e8f9',
    beta: true,
    desc: 'Главный кейс тестовой ветки — внутри мурчит будущее',
    items: [
      { id: 'beta_quantum_cheat', w: 24 }, { id: 'beta_robo_bell', w: 22 }, { id: 'cat_black_physics', w: 14 },
      { id: 'beta_nuclear_mel', w: 20 }, { id: 'cat_murka', w: 14 }, { id: 'beta_cyber_cat', w: 6 }
    ]
  },
  {
    id: 'beta_case_nuclear', name: 'Тайник Физика-Ядерщика', price: 3600000, icon: '☢️', color: '#a3e635',
    beta: true,
    desc: 'Свинцовый сейф кабинета физики. Дозиметр не входит в комплект',
    items: [
      { id: 'beta_antimatter', w: 20 }, { id: 'sch_100_points', w: 24 }, { id: 'beta_robo_bell', w: 18 },
      { id: 'beta_nuclear_mel', w: 26 }, { id: 'beta_cyber_cat', w: 12 }
    ]
  },

  /* ---------- 4.1 — ЗОЛОТЫЕ КЕЙСЫ (особняк, яхта, вертолёт) ---------- */
  {
    id: 'case_golden_vault', name: 'Золотой сейф директора', price: 500000, icon: '🏦', color: '#ffd700',
    desc: 'Внутри золотые предметы — особняк, яхта, вертолёт. Можно взять в кредит по карте!',
    items: [
      { id: 'sch_golden_backpack', w: 24 }, { id: 'sch_golden_chalk', w: 20 }, { id: 'sch_sport_cup_gold', w: 18 },
      { id: 'gold_school_ring', w: 14 }, { id: 'gold_statue', w: 10 }, { id: 'gold_mansion', w: 8 },
      { id: 'gold_yacht', w: 4 }, { id: 'gold_helicopter', w: 2 }
    ]
  },
  {
    id: 'case_golden_legend', name: 'ЛЕГЕНДАРНЫЙ ЗОЛОТОЙ КЕЙС', price: 5000000, icon: '👑', color: '#ffea00',
    desc: 'Самый дорогой золотой кейс — только золото, только хардкор',
    items: [
      { id: 'gold_mansion', w: 30 }, { id: 'gold_yacht', w: 25 }, { id: 'gold_helicopter', w: 20 },
      { id: 'gold_statue', w: 15 }, { id: 'sch_entire_school', w: 10 }
    ]
  },

  /* ---------- 4.1 Beta — кейсы вне школьной тематики (тумблер beta41) ---------- */
  {
    id: 'beta41_case_future', name: 'Кейс из будущего 4.1', price: 50000, icon: '🚀', color: '#a855f7',
    beta41: true,
    desc: 'Предметы не из школы — неон, кибер, космос. Только при включённой бете 4.1',
    items: [
      { id: 'b41_neon_sneakers', w: 28 }, { id: 'b41_space_pizza', w: 22 }, { id: 'b41_holo_watch', w: 20 },
      { id: 'b41_cyber_dragon', w: 14 }, { id: 'b41_alien_pet', w: 8 }, { id: 'b41_magic_wand', w: 5 },
      { id: 'b41_flying_car', w: 3 }
    ]
  },
  {
    id: 'beta41_case_legend', name: 'ЛЕГЕНДАРНЫЙ КЕЙС 4.1', price: 1000000, icon: '🌈', color: '#f472b6',
    beta41: true,
    desc: 'Топовый кейс беты 4.1 — летающие машины, машины времени, NFT',
    items: [
      { id: 'b41_alien_pet', w: 24 }, { id: 'b41_magic_wand', w: 20 }, { id: 'b41_nft_rock', w: 18 },
      { id: 'b41_time_machine', w: 16 }, { id: 'b41_flying_car', w: 12 }, { id: 'gold_helicopter', w: 10 }
    ]
  }
];

const SECRET_CASE = CASES_LIST.find(c => c.secret);

/* ---------- Уровни и титулы ---------- */
const RANKS = [
  { level: 1,  xp: 0,       name: 'Первоклассник',    reward: 0 },
  { level: 2,  xp: 250,     name: 'Пятиклассник',     reward: 2500 },
  { level: 3,  xp: 700,     name: 'Староста класса',  reward: 5000 },
  { level: 4,  xp: 1500,    name: 'Отличник',         reward: 10000 },
  { level: 5,  xp: 3000,    name: 'Активист школы',   reward: 20000 },
  { level: 6,  xp: 6000,    name: 'Гордость школы',   reward: 40000 },
  { level: 7,  xp: 12000,   name: 'Медалист',         reward: 80000 },
  { level: 8,  xp: 24000,   name: 'Завуч',            reward: 150000 },
  { level: 9,  xp: 48000,   name: 'Директор школы',   reward: 300000 },
  { level: 10, xp: 90000,   name: 'ЛЕГЕНДА ШКОЛЫ',    reward: 600000 },
  { level: 11, xp: 180000,  name: 'Профессор дропа',  reward: 1200000 },
  { level: 12, xp: 400000,  name: 'Хранитель Кота',   reward: 2500000 },
  { level: 13, xp: 800000,  name: 'БЕССМЕРТНЫЙ ДРОПЕР', reward: 5000000 },
  // 4.1 — уровни перерождения (сохраняют престиж, дают множитель)
  { level: 14, xp: 1500000, name: 'ПЕРЕРОЖДЁННЫЙ I',  reward: 10000000 },
  { level: 15, xp: 3000000, name: 'ПЕРЕРОЖДЁННЫЙ II', reward: 20000000 },
  { level: 16, xp: 6000000, name: 'ПЕРЕРОЖДЁННЫЙ III',reward: 40000000 },
  { level: 17, xp: 12000000,name: 'ХРАНИТЕЛЬ КАРТ',   reward: 80000000 },
  { level: 18, xp: 25000000,name: 'ВЛАДЕЛЕЦ РАДУГИ',  reward: 150000000 },
  { level: 19, xp: 50000000,name: 'БОГ ШКОЛОДРОПА',   reward: 300000000 },
  { level: 20, xp: 100000000,name:'АБСОЛЮТ',         reward: 1000000000 }
];

const XP_REWARDS = {
  caseOpen: 12,
  upgradeAttempt: 8,
  upgradeWin: 30,
  sell: 3,
  miniGamePoint: 1,
  miniGameEnd: 20,
  crashRound: 4,      // 🚀 сыгранный раунд
  crashWin: 12,       // 🚀 успешный вывод
  bottleSpin: 4,      // 🍾 сыгранное вращение бутылочки
  bottleWin: 12,      // 🍾 выигрыш в бутылочке
  idleCollect: 5
};

/* ---------- Достижения ---------- */
const ACHIEVEMENTS = [
  { id: 'first_case',   icon: '📦', name: 'Первый кейс',            desc: 'Открой свой первый кейс',         metric: 'casesOpened',  target: 1,          money: 1000,    xp: 20 },
  { id: 'case_10',      icon: '🎁', name: 'Десяточка',              desc: 'Открой 10 кейсов',                metric: 'casesOpened',  target: 10,         money: 3000,    xp: 40 },
  { id: 'case_50',      icon: '🧨', name: 'Кейс-маньяк',            desc: 'Открой 50 кейсов',                metric: 'casesOpened',  target: 50,         money: 15000,   xp: 100 },
  { id: 'case_200',     icon: '🏭', name: 'Дроп-легенда',           desc: 'Открой 200 кейсов',               metric: 'casesOpened',  target: 200,        money: 80000,   xp: 300 },
  { id: 'case_500',     icon: '⚙️', name: 'Фабрика кейсов',          desc: 'Открой 500 кейсов',               metric: 'casesOpened',  target: 500,        money: 300000,  xp: 800 },
  { id: 'secret_case',  icon: '🐱', name: 'Тайна секретного кейса', desc: 'Открой кейс Кота-Хранителя',      metric: 'secretCases',  target: 1,          money: 50000,   xp: 200 },
  { id: 'upg_1',        icon: '⚡', name: 'Первый занос',           desc: 'Выиграй апгрейд',                 metric: 'upgradesWon',  target: 1,          money: 1000,    xp: 25 },
  { id: 'upg_25',       icon: '🔥', name: 'Двадцать пять заносов',  desc: 'Выиграй 25 апгрейдов',            metric: 'upgradesWon',  target: 25,         money: 20000,   xp: 120 },
  { id: 'upg_100',      icon: '💯', name: 'Сотка заносов',          desc: 'Выиграй 100 апгрейдов',           metric: 'upgradesWon',  target: 100,        money: 120000,  xp: 400 },
  { id: 'risky_win',    icon: '🎯', name: 'Мясной занос',           desc: 'Затащи апгрейд с шансом меньше 5%', metric: 'riskyWins',  target: 1,          money: 100000,  xp: 250 },
  { id: 'sold_50',      icon: '🛒', name: 'Барахольщик',            desc: 'Продай 50 предметов',             metric: 'itemsSold',    target: 50,         money: 25000,   xp: 100 },
  { id: 'sold_500',     icon: '🏬', name: 'Оптовик',                desc: 'Продай 500 предметов',            metric: 'itemsSold',    target: 500,        money: 200000,  xp: 400 },
  { id: 'earn_1m',      icon: '💰', name: 'Первый миллион',         desc: 'Заработай 1 000 000 ₽ за всё время', metric: 'earnedTotal', target: 1000000,   money: 100000,  xp: 300 },
  { id: 'earn_10m',     icon: '🏦', name: 'Десятимиллионник',       desc: 'Заработай 10 000 000 ₽ за всё время', metric: 'earnedTotal', target: 10000000, money: 1000000, xp: 1000 },
  { id: 'bal_10m',      icon: '🐾', name: 'Кот уже рядом',          desc: 'Накопи 10 000 000 ₽ на балансе',  metric: 'balanceMax',   target: 10000000,   money: 500000,  xp: 500 },
  { id: 'lvl_5',        icon: '🥉', name: 'Активист',               desc: 'Достигни 5 уровня',               metric: 'level',        target: 5,          money: 20000,   xp: 100 },
  { id: 'lvl_10',       icon: '🏅', name: 'Легенда школы',          desc: 'Достигни 10 уровня',              metric: 'level',        target: 10,         money: 500000,  xp: 600 },
  { id: 'daily_7',      icon: '📅', name: 'Неделя без прогулов',    desc: 'Забери награду 7 дней подряд',    metric: 'dailyStreak',  target: 7,          money: 50000,   xp: 200 },
  { id: 'mini_50k',     icon: '🍩', name: 'Перемена удалась',       desc: 'Поймай 50 000 ₽ за одну перемену', metric: 'miniBest',    target: 50000,      money: 30000,   xp: 150 },
  { id: 'idle_1m',      icon: '🧹', name: 'Дежурный по школе',      desc: 'Собери 1 000 000 ₽ с дежурства',  metric: 'idleCollected', target: 1000000,   money: 150000,  xp: 300 },
  { id: 'promo_1',      icon: '🎫', name: 'Халявщик',               desc: 'Активируй промокод',              metric: 'promosUsed',   target: 1,          money: 5000,    xp: 50 },
  { id: 'drop_gold',    icon: '🌟', name: 'Золотой дроп',           desc: 'Получи предмет дороже 500 000 ₽', metric: 'biggestDrop',  target: 500000,     money: 100000,  xp: 250 },
  { id: 'cat_found',    icon: '🐈', name: 'КОТ-ХРАНИТЕЛЬ',          desc: 'Найди легендарного Кота школы',   metric: 'catFound',     target: 1,          money: 2500000, xp: 2000, secret: true },
  /* 🚀 Ракета (Crash) */
  { id: 'crash_1',       icon: '🚀', name: 'Первый полёт',           desc: 'Сыграй первый раунд в «Ракете»',  metric: 'crashRounds',  target: 1,          money: 5000,    xp: 30 },
  { id: 'crash_10x',     icon: '🛰', name: 'Выше крыши школы',       desc: 'Забери выигрыш на 10.00× и выше', metric: 'crashBestMult', target: 10,        money: 50000,   xp: 150 },
  { id: 'crash_50x',     icon: '🌌', name: 'Космический отличник',   desc: 'Долети до 50.00×',                metric: 'crashBestMult', target: 50,        money: 500000,  xp: 600 },
  { id: 'crash_25wins',  icon: '🪂', name: 'Парашютист',             desc: 'Успешно забери 25 раундов',       metric: 'crashWins',    target: 25,         money: 100000,  xp: 250 }
];

/* ---------- Мини-игра «Ракета» (Crash) ----------
   Честная математика: точка краша считается на устройстве игрока через
   crypto.getRandomValues (RNG.float) ДО старта полёта — подкрутить по ходу нельзя.

   Распределение — «коридор + хвост» (щедрый профиль, просил сам автор игры):
     • ранний взрыв (earlyChance = 10% раундов) — равномерно в коридоре
       [minCrash … earlyEdge], то есть МЕЖДУ 1.20× и 1.60×. Ниже minCrash
       ракета не взрывается НИКОГДА — у игрока всегда есть время среагировать;
     • основной хвост (90% раундов) — степенной:
           P(долететь до X) = (1 − earlyChance) · (earlyEdge / X)^tailAlpha
       Показатель tailAlpha чуть больше 1, поэтому хвост убывает быстро и
       бесконечных полётов не бывает, но средние и высокие иксы частые.

   Во сколько это выливается (при текущих настройках):
       P(≥1.5×) ≈ 93%   P(≥2×) ≈ 70%   P(≥3×) ≈ 45%   P(≥4×) ≈ 32%
       P(≥10×)  ≈ 12%   P(≥50×) ≈ 1.9%   медиана краша ≈ 2.7×
   Средний возврат при выводе на фиксированном X: crashRtpAt(X) = X · P(≥X),
   максимум ≈ 145% около 1.6–1.8× (игру сделали щедрее осознанно: хочешь
   «честные» 95% — верни tailAlpha = 1.0 и earlyChance = 0.05, earlyEdge = 0.95,
   minCrash = 1.0, получится классическая формула (1 − edge)/(1 − roll)).

   Тайминг раунда:
     0 … takeoffSec  — гарантированный РАЗГОН: множитель держится 1.00×,
                       краш в этой фазе невозможен (ракета ещё на старте);
     дальше          — рост по кривой exp(k1·τ + k2·τ²), τ = t − takeoffSec.
   Минимум времени до возможного взрыва = takeoffSec + время роста до minCrash
   (1,2 c + ~1,2 c ≈ 2,4 секунды на самый ранний взрыв). */
const CRASH_CONFIG = {
  minCrash: 1.20,           // ПОЛ: ниже 1.20× ракета не взрывается никогда
  earlyChance: 0.10,        // доля «ранних» раундов (взрыв в коридоре до earlyEdge)
  earlyEdge: 1.60,          // верхняя граница раннего коридора
  tailAlpha: 1.12,          // показатель хвоста: >1 — хвост тоньше, <1 — жирнее
  minBet: 100,              // минимальная ставка
  maxBet: 50000000,         // максимальная ставка (50 млн ₽)
  takeoffSec: 1.2,          // гарантированный разгон: раньше краша быть не может
  growthLinear: 0.14,       // множитель = exp(k1·τ + k2·τ²) — плавный старт…
  growthQuad: 0.012,        // …и ускорение на высоких иксах
  windowSec: 9,             // сколько секунд полёта помещается в поле по горизонтали
  maxMultiplier: 1000000,   // жёсткий потолок, чтобы полёт не длился вечно
  minAutoCashout: 1.01,     // автовывод ниже 1.01× бессмысленен
  maxAutoCashout: 1000000,
  historySize: 12,          // сколько последних краш-точек храним
  quickBets: [1000, 10000, 100000, 1000000],
  quickAuto: [1.5, 2, 3, 5, 10]
};

/* Чистая математика ракеты (без DOM и без внешних зависимостей — чтобы её мог
   поднять и автотест в Node). Её же гоняют тесты: tests/crash-math.test.js */

/** roll → [0,1) с защитой от мусора на входе */
function crashNormRoll(roll) {
  const raw = Number(roll);
  if (!isFinite(raw)) return 0;
  return Math.min(Math.max(raw, 0), 0.999999999999);
}

/**
 * Точка краша по честному roll ∈ [0,1).
 *   roll < earlyChance  → равномерно в коридоре [minCrash … earlyEdge] (ранний взрыв);
 *   иначе               → степенной хвост от earlyEdge:
 *                         x = earlyEdge · (1 − u)^(−1/tailAlpha), u ∈ [0,1).
 * Ниже CRASH_CONFIG.minCrash результат не опускается никогда.
 */
function crashPointFromRoll(roll) {
  const c = CRASH_CONFIG;
  const r = crashNormRoll(roll);
  const alpha = Math.max(0.05, Number(c.tailAlpha) || 1);

  if (c.earlyChance > 0 && r < c.earlyChance) {
    const u = r / c.earlyChance;                       // 0…1
    const x = c.minCrash + (c.earlyEdge - c.minCrash) * u;
    return Math.min(Math.max(x, c.minCrash), c.maxMultiplier);
  }

  const u = (r - c.earlyChance) / Math.max(1e-12, 1 - c.earlyChance);
  const x = c.earlyEdge * Math.pow(Math.max(1e-12, 1 - u), -1 / alpha);
  if (!isFinite(x)) return c.maxMultiplier;
  return Math.min(Math.max(x, c.minCrash), c.maxMultiplier);
}

/**
 * Теоретическая вероятность долететь до X (точная, не Монте-Карло).
 * Совпадает с crashPointFromRoll — её же проверяют тесты.
 */
function crashReachChance(x) {
  const c = CRASH_CONFIG;
  const v = Number(x);
  if (!isFinite(v) || v <= c.minCrash) return 1;
  const alpha = Math.max(0.05, Number(c.tailAlpha) || 1);
  if (v <= c.earlyEdge) {
    const span = Math.max(1e-9, c.earlyEdge - c.minCrash);
    return Math.min(1, Math.max(0, 1 - c.earlyChance * (v - c.minCrash) / span));
  }
  const s = (1 - c.earlyChance) * Math.pow(c.earlyEdge / Math.min(v, c.maxMultiplier), alpha);
  return Math.min(1, Math.max(0, s));
}

/** Средний возврат при стратегии «всегда забирать на X»: RTP(X) = X · P(долететь до X) */
function crashRtpAt(x) {
  const v = Math.min(CRASH_CONFIG.maxMultiplier, Math.max(1, Number(x) || 1));
  return v * crashReachChance(v);
}

/** Сколько секунд ракета уже «набирает высоту» (без фазы разгона) */
function crashGrowthTime(elapsedSec) {
  return Math.max(0, (Number(elapsedSec) || 0) - CRASH_CONFIG.takeoffSec);
}

/**
 * Множитель в момент времени t (секунды от нажатия «Запустить»).
 * Пока длится разгон (t < takeoffSec) — ровно 1.00×, дальше растёт по кривой
 * exp(k1·τ + k2·τ²): в начале почти линейно и предсказуемо, потом всё быстрее.
 */
function crashMultiplierAt(elapsedSec) {
  const tau = crashGrowthTime(elapsedSec);
  return Math.exp(CRASH_CONFIG.growthLinear * tau + CRASH_CONFIG.growthQuad * tau * tau);
}

/**
 * Через сколько секунд от старта ракета дойдёт до множителя x.
 * Минимум — takeoffSec: быстрее разгона взрыв случиться не может.
 */
function crashTimeToMultiplier(x) {
  const ln = Math.log(Math.max(1, Number(x) || 1));
  const a = CRASH_CONFIG.growthQuad;
  const b = CRASH_CONFIG.growthLinear;
  const tau = a > 0 ? (-b + Math.sqrt(b * b + 4 * a * ln)) / (2 * a) : ln / b;
  return CRASH_CONFIG.takeoffSec + (isFinite(tau) ? Math.max(0, tau) : 0);
}

/** Выплата при выводе: ставка × текущий множитель (вниз до целого ₽) */
function crashPayout(bet, mult) {
  return Math.floor(Math.max(0, Number(bet) || 0) * Math.max(1, Number(mult) || 1));
}

/* ---------- Реестр мини-игр (единое меню «Игры») ----------
   Модульность: чтобы добавить новую мини-игру, достаточно дописать сюда одну
   запись и добавить её панель <main id="view..."> в index.html (+ обработку в
   switchTab). Поля:
     id       — уникальный код игры;
     icon/name/desc/badge — как игра выглядит в меню;
     iconSvg   — ключ встроенной SVG-иконки (js/icons.js); рисуется вместо эмодзи,
                 чтобы на ОС без эмодзи-шрифтов не было пустых квадратов;
     tab      — какую панель открывать (view + Tab);
     enabled  — можно ли сейчас играть (false = карточка затемнена);
     onOpen   — необязательный свой обработчик вместо switchTab (например, модалка).
   Порядок в массиве = порядок карточек в меню. Первая игра — стартовая вкладка. */
const MINI_GAMES = [
  {
    id: 'upgrade', tab: 'upgrade', icon: '⚡', iconSvg: 'zap', name: 'Апгрейд',
    desc: 'Занеси свой предмет на цель дороже — шанс считается честно по ценам',
    enabled: () => true
  },
  {
    id: 'cases', tab: 'cases', icon: '📦', iconSvg: 'package', name: 'Кейсы',
    desc: 'Крути школьные, CS2, кошачьи и ютубер-кейсы — дроп честный, шансы открыты',
    enabled: () => true
  },
  {
    id: 'crash', tab: 'crash', icon: '🚀', iconSvg: 'rocket', name: 'Ракета', badge: 'NEW',
    desc: 'Ставь, следи за множителем и успевай забрать выигрыш до взрыва',
    enabled: () => true
  },
  {
    id: 'bottle', tab: 'bottle', icon: '🍾', iconSvg: 'bottle', name: 'Бутылочка', badge: 'NEW',
    desc: 'Выложи скины на стол и крути бутылочку — укажет на скин дороже ставки, забираешь выигрыш',
    enabled: () => true
  },
  {
    /* Не мини-игра, а настройка игр: раньше висела отдельной кнопкой в нижнем меню,
       теперь живёт здесь — меню осталось на 4 понятные кнопки (сезон 4.1). */
    id: 'modes', tab: 'modes', icon: '🎮', iconSvg: 'gamepad', name: 'Режимы',
    desc: 'Хардкор, песочница и другие режимы игры — у каждого свой прогресс и свои сохранения',
    liveTag: false, // это экран выбора, а не игра: плашку «играешь» не показываем
    enabled: () => true
  }
];

/* ---------- Мини-игра «Бутылочка» (Bottle spin) ----------
   Честная математика: точка остановки бутылочки считается на устройстве игрока
   через crypto.getRandomValues (RNG.float) ДО запуска вращения — подкрутить
   по ходу нельзя. Остановка равновероятна: каждый выложенный предмет занимает
   равный сектор круга (1/K шанс на предмет).

   Механика:
     • игрок выкладывает minItems..maxItems предметов из рюкзака (они становятся
       «на кону» и снимаются с рюкзака на время вращения);
     • один из них отмечается СТАВКОЙ (то, чем рискует игрок);
     • бутылочка останавливается на одном из выложенных предметов:
         — цена выпавшего > цена ставки → ВЫИГРЫШ: все предметы возвращаются,
           а разница (цена выпавшего − цена ставки) начисляется деньгами;
         — цена выпавшего ≤ цена ставки (в т.ч. сама ставка) → ПРОИГРЫШ:
           ставка сгорает, остальные предметы возвращаются.

   Шанс выигрыша честно равен доле предметов дороже ставки: поставил дёшево —
   выигрываешь часто, но по чуть-чуть; поставил дорого — рискуешь крупно. */
const BOTTLE_CONFIG = {
  minItems: 2,        // минимум предметов на столе
  maxItems: 6,        // максимум предметов на столе
  spinDurationSec: 3.2, // сколько секунд крутится бутылочка
  fullSpins: 4,       // сколько полных оборотов делает бутылочка до остановки
  historySize: 12,    // сколько последних результатов помнить
  tickMs: 140         // интервал «тика» бутылочки при вращении
};

/* ---------- Апгрейды «Дежурство по школе» (пассивный доход) ---------- */
const IDLE_LEVELS = [
  { level: 1, cost: 5000,       aps: 25 },
  { level: 2, cost: 30000,      aps: 150 },
  { level: 3, cost: 150000,     aps: 900 },
  { level: 4, cost: 750000,     aps: 5500 },
  { level: 5, cost: 4000000,    aps: 30000 },
  { level: 6, cost: 20000000,   aps: 180000 },
  { level: 7, cost: 100000000,  aps: 1000000 }
];
/* Доход считается по РЕАЛЬНОМУ времени (Date.now), а не по тикам setInterval:
   в свёрнутой вкладке / на заблокированном телефоне браузер душит таймеры
   до 1 раза в минуту, и «по тикам» игрок получал бы ~1% дохода. */
const IDLE_OFFLINE_RATE = 1;        // оффлайн-доход идёт с полной (100%) скоростью
const IDLE_OFFLINE_CAP_H = 12;      // максимум 12 часов накоплений за одно отсутствие
const IDLE_OFFLINE_NOTICE_S = 60;   // отсутствовал дольше минуты — показать «пока тебя не было…»
const IDLE_NAMES = [
  'Помыть доску', 'Протереть парты', 'Полить цветы у завуча', 'Разобрать шкаф с наглядками',
  'Помочь столовой с котлетами', 'Подменить трудовика', 'Стать официальным Хранителем Кота'
];

/* ---------- Ежедневные награды ---------- */
const DAILY_REWARDS = [
  { day: 1, money: 1500,   icon: '🥟', label: 'Котлета' },
  { day: 2, money: 3000,   icon: '🖊️', label: 'Ручка' },
  { day: 3, money: 6000,   icon: '📕', label: 'Дневник' },
  { day: 4, money: 12000,  icon: '📏', label: 'Линейка' },
  { day: 5, money: 25000,  icon: '🥇', label: 'Медаль' },
  { day: 6, money: 50000,  icon: '👑', label: 'Корона' },
  { day: 7, money: 100000, icon: '🏫', label: 'ДЖЕКПОТ' }
];
const DAILY_STREAK_RESET_HOURS = 48;

/* ---------- Промокоды (сезон 3.5 / версия 4.0: +10 кодов для ютубера) ---------- */
/* ---------- Промокоды ----------
   Вид у кодов намеренно «машинный»: случайные буквы и цифры блоками по 4
   (XXXX-XXXX-XXXX), без читаемых слов — чтобы их нельзя было угадать перебором
   по смыслу. Алфавит без похожих символов: нет 0/O и 1/I.
   Актуальный список кодов и их наград — в файле codes/promo-codes.md (в GitHub).
   Регистр и пробелы не важны: игра сама приводит ввод к верхнему регистру. */
const PROMO_CODES = {
  'ZBWK-T7GX-5MS4': { money: 25000   , xp: 50  , label: 'Стартовый капитал сезона' },
  'VDWJ-H5EF-2MJ9': { money: 50000   , xp: 75  , label: 'Награда за перемену' },
  '2N6Y-4ZVL-QD99': { money: 100000  , xp: 150 , label: 'Код от автора проекта' },
  'N9EP-CLZZ-VVFE': { money: 250000  , xp: 200 , label: 'Мурка советует копить на кота' },
  'KTLF-BUBR-V72G': { money: 1000000 , xp: 400 , label: 'Кот поделился заначкой 🐱' },
  'M7RR-KTBH-TC4C': { money: 2026    , xp: 25  , label: 'Приветственные монеты обновления' },
  'DACA-6BMR-BNNV': { item: 'cat_gora_bogdan', xp: 500 , label: 'ЛЕГЕНДАРНЫЙ КОТИК ГОРА БОГДАНА! 🏔️🐱' },
  'SF9H-Q8FT-94X7': { money: 500000  , xp: 300 , label: 'Промокод от ютубера Легенда_пх (1 канал Школа Дроп) ▶' },
  'TWJJ-E2H6-BYZ2': { money: 400000  , xp: 400 , label: 'Версия 4.0 сезон 3.5 — код от Давида 🎒' },
  '2FE3-TWU9-CNS3': { money: 350000  , xp: 350 , label: 'Подарок-извинение за вайп 3.9 ❤️ Сезон 3.5' },
  'WVFQ-5AZ6-WEUR': { money: 39000   , xp: 100 , label: 'Сорри за сброс аккаунтов — теперь всё в норме 😔' },
  'UCMU-TEFZ-RX7A': { money: 150000  , xp: 200 , label: 'Обязательный онлайн 3.5 — сервер на связи 🌐' },
  'Q9EC-EUMM-J79K': { money: 100000  , item: 'upg_gold_whistle', xp: 250 , label: 'Золотой свисток судьи 🥇 + 100k' },
  '6LGG-RPHR-8SVS': { money: 100000  , xp: 150 , label: 'ШКОЛА ДРОП 4.0 — живём!' },
  'FWXU-NHHF-WA8T': { money: 250000  , xp: 300 , label: 'Возвращение после вайпа — welcome back 🎒✨' },
  'UNDV-8GZ6-R2MZ': { money: 200000  , xp: 250 , label: 'Облачное сохранение 4.0 ☁️' },
  'PHDV-J68F-LHAQ': { money: 35000   , xp: 100 , label: 'Чат всегда включён 🔔 Сезон 3.5' },
  'XD72-TP98-TH8B': { money: 150000  , xp: 200 , label: 'Спасибо за поддержку сезона 3.5 ❤️' }
};

/* ---------- Админка: два уровня доступа (5 кликов по логотипу + код) ----------
   СЕЗОН 4.1 (безопасность): в клиенте НЕТ ни кодов админки, ни серверных секретов.
   Панель логинится на сервере: POST /api/admin/login {code} → подписанный токен
   роли на 12 часов (заголовок x-admin-token). Коды задаются на сервере:
   OWNER_ADMIN_CODE / STAFF_ADMIN_CODE (env). Если они не заданы — сервер
   печатает сгенерированные коды в лог при старте (Render → Logs).
   Здесь остались только права ролей — это НЕ секрет, это список того, какие
   блоки панели показывать. */
/* Права ролей — что показывать в панели (data-admin-perm="...") */
const ADMIN_PERMS = {
  owner: ['rig', 'money', 'cat', 'maxlevel', 'players', 'detail', 'dm', 'verify', 'ban', 'role', 'status', 'delete', 'chat', 'server', 'authorcodes', 'online', 'emails'],
  admin: ['money', 'players', 'detail', 'dm', 'ban', 'chat', 'online']
};

/* (хеш-функция кодов админки и сами хеши удалены: коды проверяет сервер,
   в клиенте их больше нет — см. js/netplay.js → AdminAuth.) */

/* ---------- VIP-коды (покупка за 150 ₽ через почту) ----------
   Схема работы:
   1. Игрок пишет на почту shkoladrop.contact@gmail.com (ник + уникальный ID).
   2. Ты отвечаешь реквизитами карты, игрок переводит 150 ₽, ты отправляешь ему
      УНИКАЛЬНЫЙ код из СВОЕГО списка vip_codes_funpay.txt (один код = один покупатель).
   3. Игрок вводит код в разделе «Промокоды» — активируется вечный VIP.

   ВАЖНО (исправление утечки, дважды): сначала коды лежали здесь открытым текстом, а потом
   список из 100 кодов лежал в файле codes/vip-codes.md — и сайт раздавал его публично.
   Теперь в клиенте хранятся ТОЛЬКО SHA-256-хеши (первые 24 hex-символа от 'shkoladrop-vip:' + код),
   сам список открытых кодов живёт в vip_codes_funpay.txt и в git НЕ попадает (он в .gitignore),
   а файлы codes/ больше не публикуются (см. .vercelignore и белый список статики в server/index.js).
   Все ранее опубликованные коды АННУЛИРОВАНЫ: VIP, активированный ими, снимается при входе
   (см. auditVip в game.js). Ротация новых кодов: `node tools/rotate-vip-codes.js`. */
const VIP_PRICE_RUB = 150;
const VIP_CODE_HASHES = [
  '219aa6f8bdccded761070d69',
  'c66d87a1e326334be71f6dac',
  'b3953d4211995f47a3a9a74a',
  'c44639455928f745f59a86f1',
  '7a430a7d278da780a0306b03',
  '5a5f0ae676d16532dc61f4fc',
  'd256242eebae50b15fef34e8',
  '93463f3c8b5e9af7ab5f8cf8',
  'ea80de450c8b08edf12e5c9d',
  '4e5874e2d6980e2cc46cdfc8',
  'dfc7208e16aa9f1a33759352',
  '8a6cd4bcce2c1a0da56c442f',
  '79b6a1bbfa9098a859429bae',
  '384df0359276ba213db4cc41',
  'ae24146b43720b4f0af65d3e',
  'cac676b1c60cf0e0e43d576d',
  '792ca51b1d9f78ae9036bdc8',
  'b606634a805fe8bd9b751195',
  '2b2e008ceefc83f50296498b',
  '0daac259c208ac00335c2f42',
  '27e9e6d256186f5662f5e502',
  '857f218a879b2c9a4c88de3d',
  'b718e65a592f685996eeb769',
  '2b0e0b40e37114f792b8c8ee',
  'a920dfa3dfb4e5a5c491cf1c',
  '63e60b9b69d5b64cb9ff7a8f',
  '7d4d293d4da3f4b8491295ff',
  '14bbeeefea44ba3d05e5fbd4',
  '089c56f36a8bcc057f12feef',
  '9fb6dad13b733922c97a94ed',
  '0cba98800de08cbcbd64d0ef',
  'e19dc8f0abe612308776897e',
  'c2ce0962b6b055284e0b5460',
  '31768a84a31b8d0a78eaa3de',
  'a914391b282d11285353142f',
  '41d8a1f6fa842afa1019237a',
  '75e6895443f4b56c17c84b4e',
  '512744a4cb39f5fe9454e85d',
  'a28de1728165d2f457b3e3ef',
  '8aa5adca0956d6f5adae47c7',
  '6c222892a9b1f395f0d734b8',
  'da7a5b8284cdbb3bbac5c733',
  '3053182055996a9b43f6c3b4',
  'e997c7b3f73d27a36fa2ee22',
  '622e5a6cc38a707dc3371ac4',
  '3975d441b0133e076982563f',
  '2857d29497941d82ec94113a',
  'c525968b56880f3ff098097d',
  '1f8ec089da0a8c2d638f765c',
  '4eab5f0098149ace5f478ae4',
  '09d243fcd2080aa9e3b355d1',
  '9f81342e34fbfd3b28d835b5',
  'cac513313a2443be1ab7cde2',
  '2d0a6b05536afbe481869143',
  '3c9486d1cbf2410e442d2551',
  '13e7845c0231ce16a20bfde7',
  'ba632478abc7d4233836aa1f',
  '3c41b0e4a69aa2dc992b096c',
  '1a4ae49bc0f0a96bb491f235',
  '0cfa45c6167cad5b695a0ace',
  '7e326790d75a28cddb71e06d',
  'c992d225bc8281bec69fff2c',
  '759998c873d706f8e58a0793',
  '28444b987cf34717ca0c7a4c',
  'd6ca9a96d7953634a1902a9f',
  '911fd912b52e6177c9351c83',
  'c3fe4690a6cc6ed5c22c8ed1',
  '246b291e953cf9f9ea12ef40',
  '6b214117e7e5f4da33116632',
  '45d10d8f222c90e796322430',
  'fa2eb2e9f307eea2572992d4',
  'e092e86c05a2415474cdf619',
  '480ed4251cef5750c9b227be',
  'b4af407d7ffaafa72e381a4f',
  '598aa3cb2a7829b9de711562',
  '1316671a5b41dd24ab8918b1',
  '1af28430f5dd62f55e536ab1',
  '0ede11ec5a43ce2a4477437f',
  '298be7fda19575875e1c705a',
  '1940f622a7d7bbc2cb9e8d3e',
  '944827777dc51cf935ad5de1',
  '3ecf88e1712aabd73409ad2b',
  '17c1494b504809e6d6e00f0e',
  '590320fefbff258576c1bfa6',
  '832aeef5a69f450bc17ab64e',
  'ab5ea90528f1381c7effabd7',
  '17c5df62a1a6f5af03a4bf29',
  '49970fcfb976b3ff73420877',
  '67b647d5b733f294b2b927b8',
  '9f0e5cd933e22ee937dd633f',
  '234c2ab26ed34f3830f3082b',
  '4795083dc5ed7f142d800cf7',
  'e9d25d6ac953d8df63077152',
  'baa36977d54389f98e4289af',
  'e214ccf779f64d4e8e0be556',
  '188170c33f5bcf019767d2d8',
  '1090347f45f84f8f154867cf',
  '109f16c3c11d466759e83ec8',
  '7b7eb505805d9a564af40e75',
  '610b97c7138532614fae68a9'
  /* Ротация от 2026-09-14: 100 новых кодов. Старый список утёк публично и аннулирован.
     Открытые коды — в vip_codes_funpay.txt (в .gitignore, в git не попадает). */

];
const VIP_CODES = [];  // устарело: открытых кодов в клиенте больше нет

/* ---------- Настройки по умолчанию ---------- */
const DEFAULT_SETTINGS = {
  sound: true,
  volume: 70,
  fastOpen: false,
  reduceMotion: false,
  accent: 'orange',
  quality: 'auto',  // 'auto' — под возможности устройства, 'high' / 'low' — вручную
  /* Эксперименты (⚙️ Настройки → Эксперименты) + Resilient 4.0 */
  autoWake: true,    // 4.0: телефон сам будит сервер полностью — всегда включено
  chatNotify: true,  // сезон 3.5: уведомления из общего чата включены по умолчанию, можно выключить в настройках
  beta41: false      // 4.1: бета с предметами вне школьной тематики — включается тумблером в настройках
};

/* Статусы игроков, которые выдаёт владелец (плашка у ника в чате и профиле) + перерождение */
const PLAYER_STATUS_META = {
  owner:    { label: '👑 ВЛАДЕЛЕЦ', cls: 'bg-amber-500/20 border-amber-500/60 text-amber-300' },
  admin:    { label: '🛡 АДМИН',    cls: 'bg-sky-500/20 border-sky-500/60 text-sky-300' },
  vip:      { label: '💎 VIP',      cls: 'bg-fuchsia-500/20 border-fuchsia-500/60 text-fuchsia-300' },
  youtuber: { label: '▶ ЮТУБЕР',   cls: 'bg-red-500/20 border-red-500/60 text-red-300' },
  legend:   { label: '🏆 ЛЕГЕНДА',  cls: 'bg-yellow-500/20 border-yellow-500/60 text-yellow-200' },
  test:     { label: '🧪 ТЕСТ',     cls: 'bg-cyan-500/20 border-cyan-500/60 text-cyan-300' },
  scam:     { label: '⚠ СКАМ',      cls: 'bg-rose-500/20 border-rose-500/60 text-rose-300' },
  spam:     { label: '🚫 СПАМ',     cls: 'bg-orange-500/20 border-orange-500/60 text-orange-300' },
  // Перерождение — титулы по цвету карточки
  bronze:   { label: '🥉 БРОНЗА',   cls: 'bg-orange-900/30 border-orange-700/60 text-orange-300' },
  silver:   { label: '🥈 СЕРЕБРО',  cls: 'bg-slate-500/20 border-slate-400/60 text-slate-200' },
  gold:     { label: '🥇 ЗОЛОТО',   cls: 'bg-amber-500/20 border-amber-400/60 text-amber-300' },
  platinum: { label: '💿 ПЛАТИНА',  cls: 'bg-zinc-300/20 border-zinc-200/60 text-zinc-100' },
  diamond:  { label: '💎 АЛМАЗ',    cls: 'bg-cyan-300/20 border-cyan-200/60 text-cyan-100' },
  emerald:  { label: '💚 ИЗУМРУД',  cls: 'bg-emerald-500/20 border-emerald-400/60 text-emerald-300' },
  sapphire: { label: '💙 САПФИР',   cls: 'bg-blue-600/20 border-blue-500/60 text-blue-300' },
  ruby:     { label: '❤️ РУБИН',    cls: 'bg-rose-600/20 border-rose-500/60 text-rose-300' },
  black:    { label: '🖤 ЧЁРНАЯ',   cls: 'bg-neutral-900/50 border-neutral-700/60 text-neutral-200' },
  rainbow:  { label: '🌈 РАДУГА',   cls: 'bg-gradient-to-r from-pink-500/20 via-cyan-500/20 to-yellow-500/20 border-fuchsia-400/60 text-fuchsia-200' },
  bankrupt: { label: '💸 БАНКРОТ',  cls: 'bg-rose-950/50 border-rose-800/60 text-rose-400 line-through' },
  vozduhan: { label: '🌬 ВОЗДУХАН', cls: 'bg-sky-950/30 border-sky-800/50 text-sky-300 italic' }
};

/* ---------- ПЕРЕРОЖДЕНИЕ 4.1 — 10 уровней, кредитные карты ---------- */
const REBIRTH_MAX = 10;
const REBIRTH_CARDS = [
  { level: 1, id: 'card_bronze',   name: 'Бронзовая карта',   color: '#cd7f32', bg: 'from-orange-800/40 to-amber-900/40', icon: '🥉', limit: 1000,          title: 'Бронза',   desc: 'Кредитка новичка — 1 000 ₽ в долг, если баланс пуст' },
  { level: 2, id: 'card_silver',   name: 'Серебряная карта',  color: '#c0c0c0', bg: 'from-slate-500/40 to-zinc-600/40',   icon: '🥈', limit: 10000,         title: 'Серебро',  desc: '10 000 ₽ кредитного лимита' },
  { level: 3, id: 'card_gold',     name: 'Золотая карта',     color: '#ffd700', bg: 'from-amber-400/40 to-yellow-600/40', icon: '🥇', limit: 100000,        title: 'Золото',   desc: '100 000 ₽ — уже можно взять мел завуча в кредит' },
  { level: 4, id: 'card_platinum', name: 'Платиновая карта',  color: '#e5e4e2', bg: 'from-zinc-300/40 to-slate-400/40',  icon: '💿', limit: 1000000,       title: 'Платина',  desc: '1 000 000 ₽ лимита' },
  { level: 5, id: 'card_diamond',  name: 'Алмазная карта',    color: '#b9f2ff', bg: 'from-cyan-200/40 to-blue-400/40',   icon: '💎', limit: 10000000,      title: 'Алмаз',    desc: '10M — школа начинает уважать' },
  { level: 6, id: 'card_emerald',  name: 'Изумрудная карта',  color: '#50c878', bg: 'from-emerald-500/40 to-teal-700/40', icon: '💚', limit: 100000000,     title: 'Изумруд',  desc: '100M — почти как кот-хранитель' },
  { level: 7, id: 'card_sapphire', name: 'Сапфировая карта',  color: '#0f52ba', bg: 'from-blue-600/40 to-indigo-800/40', icon: '💙', limit: 1000000000,    title: 'Сапфир',   desc: '1B — можно купить автобус в кредит' },
  { level: 8, id: 'card_ruby',     name: 'Рубиновая карта',   color: '#e0115f', bg: 'from-rose-600/40 to-red-800/40',    icon: '❤️', limit: 10000000000,   title: 'Рубин',    desc: '10B — уровень директора' },
  { level: 9, id: 'card_black',    name: 'Чёрная карта',      color: '#111111', bg: 'from-neutral-800/60 to-black/60',   icon: '🖤', limit: 50000000000,   title: 'Чёрная',   desc: '50B — для тех, кто видел всё' },
  { level: 10,id: 'card_rainbow',  name: 'Радужная карта',    color: '#ff00ff', bg: 'from-pink-500/50 via-cyan-400/50 to-yellow-400/50', icon: '🌈', limit: 100000000000, title: 'Радуга', desc: '100B — максимум! Можно взять золотой особняк в кредит, но долг надо вернуть' }
];

/* ---------- ЗАДАНИЯ ДЛЯ ПЕРЕРОЖДЕНИЯ (4.1) ----------
   Каждое перерождение требует выполнить набор ЗАДАНИЙ. Задание — это пара
   «метрика + цель»: метрика читается из state.stats / state.balance,
   цель — сколько нужно набрать. Список заданий на уровень — массив tasks.
   Виды заданий (rebirthTaskCurrent в js/game.js умеет читать каждый):
     level        — достигни уровня            (state.stats.level)
     cases        — открой кейсов              (state.stats.casesOpened)
     upgrades     — выиграй апгрейдов          (state.stats.upgradesWon)
     money        — накопи на балансе          (state.balance, спишется при перерождении)
     sell         — продай предметов           (state.stats.itemsSold)
     idle         — собери с дежурства         (state.stats.idleCollected)
     crash        — забери раундов в «Ракете»  (state.stats.crashWins)
     daily        — забирай награду подряд     (state.stats.dailyStreak)
     achievements — получи достижений          (state.stats.achievements.length) */
const REBIRTH_TASK_META = {
  level:        { label: 'Достигни уровня',           money: false },
  cases:        { label: 'Открой кейсов',             money: false },
  upgrades:     { label: 'Выиграй апгрейдов',         money: false },
  money:        { label: 'Накопи на балансе',         money: true },
  sell:         { label: 'Продай предметов',          money: false },
  idle:         { label: 'Собери с дежурства',        money: true },
  crash:        { label: 'Забери раундов в «Ракете»', money: false },
  daily:        { label: 'Забирай награду подряд',    money: false },
  achievements: { label: 'Получи достижений',         money: false }
};

const REBIRTH_REQUIREMENTS = [
  { level: 1,  tasks: [ { key: 'level', target: 10 }, { key: 'cases', target: 25 }, { key: 'upgrades', target: 5 } ] },
  { level: 2,  tasks: [ { key: 'level', target: 11 }, { key: 'cases', target: 75 }, { key: 'upgrades', target: 15 }, { key: 'money', target: 500000 } ] },
  { level: 3,  tasks: [ { key: 'level', target: 12 }, { key: 'cases', target: 150 }, { key: 'upgrades', target: 40 }, { key: 'sell', target: 60 }, { key: 'money', target: 2000000 } ] },
  { level: 4,  tasks: [ { key: 'level', target: 13 }, { key: 'cases', target: 300 }, { key: 'money', target: 10000000 }, { key: 'idle', target: 1000000 }, { key: 'crash', target: 25 } ] },
  { level: 5,  tasks: [ { key: 'level', target: 13 }, { key: 'cases', target: 500 }, { key: 'money', target: 50000000 }, { key: 'achievements', target: 15 }, { key: 'upgrades', target: 100 } ] },
  { level: 6,  tasks: [ { key: 'level', target: 13 }, { key: 'cases', target: 800 }, { key: 'money', target: 250000000 }, { key: 'sell', target: 250 }, { key: 'daily', target: 10 } ] },
  { level: 7,  tasks: [ { key: 'level', target: 13 }, { key: 'cases', target: 1200 }, { key: 'money', target: 1000000000 }, { key: 'upgrades', target: 300 }, { key: 'crash', target: 75 } ] },
  { level: 8,  tasks: [ { key: 'level', target: 13 }, { key: 'cases', target: 2000 }, { key: 'money', target: 10000000000 }, { key: 'idle', target: 100000000 }, { key: 'achievements', target: 20 } ] },
  { level: 9,  tasks: [ { key: 'level', target: 13 }, { key: 'cases', target: 3500 }, { key: 'money', target: 50000000000 }, { key: 'upgrades', target: 750 }, { key: 'sell', target: 1000 } ] },
  { level: 10, tasks: [ { key: 'level', target: 13 }, { key: 'cases', target: 5000 }, { key: 'money', target: 100000000000 }, { key: 'achievements', target: 23 }, { key: 'idle', target: 1000000000 } ] }
];

const CREDIT_BANKRUPT_AFTER_MS = 60 * 60 * 1000; // 1 час
const CREDIT_BANKRUPT_CHANCE = 0.15; // 15% шанс получить титул воздухан, иначе банкрот

/* ---------- Стартовый инвентарь ---------- */
const START_ITEMS = ['sch_bad_grade', 'sch_cold_cutlet', 'sch_chewed_pen', 'sch_eraser'];

/* ---------- Категории cookie ---------- */
const COOKIE_CATEGORIES_DEFAULT = { save: true, functional: true, analytics: true };
const COOKIE_MAX_CHUNK = 3500;   // безопасный размер одного cookie-блока
const COOKIE_MAX_CHUNKS = 3;     // максимум блоков резервной копии

/* ---------- Хелперы данных ---------- */
/** Взвешенный пул кейса.
 *  opts = { ignoreRichTax: true }  — таблица «как в описании кейса», без налога миллионера
 *  opts = { balance: 5000000 }     — посчитать для произвольного баланса                        */
function casePool(caseObj, opts) {
  if (!caseObj) return [];
  const o = opts || {};
  const factor = o.ignoreRichTax ? 1 : richTaxFactor(o.balance);
  return caseObj.items
    .map(entry => {
      const item = ITEMS_BY_ID[entry.id];
      if (!item) return { item: null, weight: 0 };
      const rarity = item.rarity || 'consumer';
      // 1) Чем выше редкость, тем сильнее базовый штраф — хороший дроп и так редкий.
      // 2) Плюс «налог миллионера»: богатые проворачивают кейс заметно хуже.
      const base = entry.w * (RARITY_WEIGHT_PENALTY[rarity] != null ? RARITY_WEIGHT_PENALTY[rarity] : 0.01);
      const sens = RICH_TAX_SENSITIVITY[rarity] != null ? RICH_TAX_SENSITIVITY[rarity] : 1;
      let weight = base * Math.pow(factor, sens);
      // ЖЁСТКИЕ КЕЙСЫ 3.7: «годнота» (предмет заметно дороже кейса) дополнительно
      // режется ярусными воротами удачи — кейс открывается всегда, но окупается редко.
      const cp  = (caseObj.price || 0) * (opts && opts.discount ? 1 : 1);
      const rel = cp > 0 ? item.price / cp : 0;
      if (rel >= CASE_LUCK_GATE.megaRatio)      weight *= CASE_LUCK_GATE.megaFactor;
      else if (rel >= CASE_LUCK_GATE.hugeRatio) weight *= CASE_LUCK_GATE.hugeFactor;
      else if (rel >= CASE_LUCK_GATE.ratio)     weight *= CASE_LUCK_GATE.factor;
      return { item: item, weight: weight > 0 ? weight : base * 1e-6 };
    })
    .filter(e => e.item);
}

function caseTotalWeight(caseObj, opts) {
  return casePool(caseObj, opts).reduce((sum, e) => sum + e.weight, 0);
}

function caseOdds(caseObj, opts) {
  const pool = casePool(caseObj, opts);
  const total = pool.reduce((sum, e) => sum + e.weight, 0) || 1;
  return pool.map(e => ({
    item: e.item,
    weight: e.weight,
    chance: (e.weight / total) * 100
  }));
}

/** Как «налог миллионера» подрезал топовые редкости в кейсе:
 *  { factor, fairShare, topShare, topCut } — доли шансов в % и «насколько режут» */
function caseRichTaxInfo(caseObj, opts) {
  const o = opts || {};
  const factor = o.ignoreRichTax ? 1 : richTaxFactor(o.balance);
  const TOP_RARITY = { classified: 1, covert: 1, gold: 1, secret: 1 };
  const topShare = list => {
    const total = list.reduce((s, e) => s + e.weight, 0) || 1;
    const top = list.filter(e => TOP_RARITY[(e.item.rarity || 'consumer')])
      .reduce((s, e) => s + e.weight, 0);
    return (top / total) * 100;
  };
  const fairShare = topShare(casePool(caseObj, Object.assign({}, o, { ignoreRichTax: true })));
  const topShareNow = topShare(casePool(caseObj, o));
  return {
    factor: factor,
    fairShare: fairShare,
    topShare: topShareNow,
    topCut: fairShare > 0 ? Math.max(0, ((fairShare - topShareNow) / fairShare) * 100) : 0
  };
}

function itemDisplayCategory(item) {
  if (!item) return 'Игра';
  if (item.category === 'other') return item.game || 'Игра';
  return (CATEGORIES[item.category] || CATEGORIES.other).short;
}

function rarityOf(item) {
  return RARITIES[(item && item.rarity) || ''] || RARITIES.consumer;
}
