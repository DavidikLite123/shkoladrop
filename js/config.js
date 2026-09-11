/* ==========================================================================
   ШКОЛА ДРОП 2.0 — js/config.js
   Все игровые данные: редкости, каталоги предметов, кейсы, достижения,
   уровни, награды, промокоды, апгрейды дежурства.
   ========================================================================== */

const APP_VERSION = '3.5';
const BETA_VERSION = '3.6';   // тестовая ветка «3.6 Beta» (Лаборатория)
const SAVE_VERSION = 11;
const SEASON_NUMBER = 3;
const HARD_MODE_THRESHOLD = 100000000;
const HARD_MODE_CASE_DISCOUNT = 0.9;

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

/* Базовый штраф по редкости (был зашит в casePool) */
const RARITY_WEIGHT_PENALTY = {
  consumer: 1, milspec: 0.55, restricted: 0.22, classified: 0.08,
  covert: 0.025, gold: 0.01, secret: 0.004
};

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

/* ---------- Редкости ---------- */
const RARITIES = {
  consumer:   { name: 'Ширпотреб',            short: 'Ширпотреб', color: '#b0c3d9', bg: 'rgba(176, 195, 217, 0.12)', order: 1 },
  milspec:    { name: 'Армейское качество',   short: 'Армейское', color: '#4b69ff', bg: 'rgba(75, 105, 255, 0.14)',  order: 2 },
  restricted: { name: 'Запрещённое',          short: 'Запрещённое', color: '#8847ff', bg: 'rgba(136, 71, 255, 0.16)', order: 3 },
  classified: { name: 'Засекреченное',        short: 'Засекреченное', color: '#d32ce6', bg: 'rgba(211, 44, 230, 0.16)', order: 4 },
  covert:     { name: 'Тайное',               short: 'Тайное', color: '#eb4b4b', bg: 'rgba(235, 75, 75, 0.18)',  order: 5 },
  gold:       { name: '★ Чрезвычайно редкое', short: '★ Редкое', color: '#ffd700', bg: 'rgba(255, 215, 0, 0.2)',   order: 6 },
  secret:     { name: '☠ СЕКРЕТНОЕ (Кошачье)', short: '☠ Секрет', color: '#00f0ff', bg: 'rgba(0, 240, 255, 0.2)',   order: 7 }
};

/* ---------- Категории ---------- */
const CATEGORIES = {
  school: { label: 'Школа', short: 'Школа', badge: 'bg-amber-950 text-amber-300 border-amber-800' },
  cs2:    { label: 'CS2',   short: 'CS2',   badge: 'bg-cyan-950 text-cyan-300 border-cyan-800' },
  other:  { label: 'Игры',  short: 'Игра',  badge: 'bg-violet-950 text-violet-300 border-violet-800' },
  cat:    { label: '🐱 Коты', short: 'Кот', badge: 'bg-fuchsia-950 text-fuchsia-300 border-fuchsia-800' },
  beta:   { label: '🧪 Бета 3.6', short: 'Бета', badge: 'bg-cyan-950 text-cyan-200 border-cyan-700' }
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
  { id: 'sch_timetable_relic', name: 'Расписание без «окон»',        price: 1250000, icon: '🗓️', badgeBg: 'from-cyan-300/40 to-indigo-700/50',         rarity: 'gold',       category: 'school', desc: 'Артефакт, который никто не видел в реальности' }
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

/* ---------- Ультра-экономика: предметы для поздней игры ---------- */
const ULTRA_CATALOG = [
  { id: 'ultra_school_city', name: 'Школьный город-миллиардер', price: 25000000000, icon: '🏙️', badgeBg: 'from-indigo-500/60 to-cyan-500/40', rarity: 'secret', category: 'school', desc: 'Целый город с кампусом школы и стадионом' },
  { id: 'ultra_creator_empire', name: 'Империя ютуберов', price: 100000000000, icon: '🌐', badgeBg: 'from-red-500/60 to-purple-600/50', rarity: 'secret', category: 'other', game: 'YouTube', desc: 'Все каналы сезона 3 в одном владении' },
  { id: 'ultra_diamond_studio', name: 'Алмазная студия David Lite', price: 1000000000000, icon: '💠', badgeBg: 'from-cyan-200/70 to-blue-700/60', rarity: 'secret', category: 'other', game: 'YouTube', desc: 'Студия, где каждый кадр стоит состояния' },
  { id: 'ultra_multiverse', name: 'Мультивселенная Школы Дроп', price: 10000000000000, icon: '🌌', badgeBg: 'from-violet-400/70 to-fuchsia-700/60', rarity: 'secret', category: 'other', game: 'Школа Дроп', desc: 'Абсолютный предмет для баланса в десятки триллионов' }
];

/* ---------- Сезон 3: кейсы ютуберов ---------- */
const SEASON3_CATALOG = [
  { id: 'yt_creator_award', name: 'Золотая кнопка YouTube', price: 2000000, icon: '🏆', badgeBg: 'from-yellow-400/50 to-orange-700/50', rarity: 'covert', category: 'other', game: 'YouTube', desc: 'Миллион подписчиков и ни одного страйка' },
  { id: 'yt_diamond_award', name: 'Бриллиантовая кнопка YouTube', price: 100000000, icon: '💎', badgeBg: 'from-cyan-200/60 to-blue-700/60', rarity: 'secret', category: 'other', game: 'YouTube', desc: '100 миллионов подписчиков. Ультра-легендарный предмет сезона 3' },
  { id: 'yt_play_button', name: 'Серебряная кнопка YouTube', price: 450000, icon: '🥈', badgeBg: 'from-slate-300/50 to-slate-700/50', rarity: 'gold', category: 'other', game: 'YouTube', desc: 'Первая большая награда автора' },
  { id: 'yt_creator_camera', name: 'Камера ночного блогера', price: 1200000, icon: '📹', badgeBg: 'from-violet-500/50 to-indigo-900/60', rarity: 'covert', category: 'other', game: 'YouTube', desc: 'Снимает даже когда света в кабинете нет' },
  { id: 'yt_stream_deck', name: 'Пульт стримера', price: 700000, icon: '🎛️', badgeBg: 'from-fuchsia-500/50 to-purple-900/60', rarity: 'classified', category: 'other', game: 'YouTube', desc: 'Одна кнопка — и весь класс в прямом эфире' }
];

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

const ALL_MASTER_ITEMS = [...SCHOOL_CATALOG, ...CS2_CATALOG, ...OTHER_GAMES_CATALOG, ...CAT_CATALOG, ...SEASON3_CATALOG, ...ULTRA_CATALOG, ...BETA_CATALOG];
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
    items: [ { id: 'sch_parent_meet', w: 22 }, { id: 'sch_gym_shoes', w: 20 }, { id: 'sch_medal_sport', w: 22 }, { id: 'sch_gold_medal', w: 24 }, { id: 'sch_director_office', w: 12 } ]
  },
  {
    id: 'case_party', name: 'Новогодний утренник', price: 22000, icon: '🎄', color: '#eb4b4b',
    desc: 'Праздник, корона выпускницы и пенный огнетушитель',
    items: [ { id: 'sch_fire_extinguisher', w: 22 }, { id: 'sch_prom_queen', w: 26 }, { id: 'sch_medal_sport', w: 18 }, { id: 'sch_gold_medal', w: 22 }, { id: 'sch_golden_chalk', w: 12 } ]
  },
  {
    id: 'case_attestat', name: 'Аттестат с отличием', price: 45000, icon: '🎓', color: '#eb4b4b',
    desc: 'Медали, кубки, красный диплом и директор',
    items: [ { id: 'sch_medal_sport', w: 22 }, { id: 'sch_gold_medal', w: 26 }, { id: 'sch_red_diploma', w: 26 }, { id: 'sch_director_office', w: 20 }, { id: 'sch_golden_chalk', w: 6 } ]
  },
  {
    id: 'case_ege', name: 'ЕГЭ на 100 баллов', price: 70000, icon: '📝', color: '#ffd700',
    desc: 'Сотка, кресло профессора и золотой мел',
    items: [ { id: 'sch_red_diploma', w: 28 }, { id: 'sch_director_office', w: 20 }, { id: 'sch_100_points', w: 28 }, { id: 'sch_golden_chalk', w: 18 }, { id: 'sch_professor_chair', w: 6 } ]
  },
  {
    id: 'case_legend', name: 'Тайник завуча №1337', price: 120000, icon: '👑', color: '#ffd700',
    desc: 'Школа целиком и секретный Золотой Дневник!',
    items: [ { id: 'sch_red_diploma', w: 20 }, { id: 'sch_school_bus', w: 16 }, { id: 'sch_director_office', w: 18 }, { id: 'sch_entire_school', w: 22 }, { id: 'sch_golden_diary', w: 20 }, { id: 'sch_professor_chair', w: 4 } ]
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
    items: [ { id: 'yt_diamond_award', w: 10 }, { id: 'cat_keeper', w: 22 }, { id: 'cs_karambit_dop', w: 22 }, { id: 'sch_timetable_relic', w: 18 }, { id: 'yt_creator_award', w: 20 }, { id: 'ultra_school_city', w: 5 }, { id: 'ultra_creator_empire', w: 2 }, { id: 'ultra_diamond_studio', w: 1 }, { id: 'ultra_multiverse', w: 0.2 } ]
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
  { level: 13, xp: 800000,  name: 'БЕССМЕРТНЫЙ ДРОПЕР', reward: 5000000 }
];

const XP_REWARDS = {
  caseOpen: 12,
  upgradeAttempt: 8,
  upgradeWin: 30,
  sell: 3,
  miniGamePoint: 1,
  miniGameEnd: 20,
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
  { id: 'cat_found',    icon: '🐈', name: 'КОТ-ХРАНИТЕЛЬ',          desc: 'Найди легендарного Кота школы',   metric: 'catFound',     target: 1,          money: 2500000, xp: 2000, secret: true }
];

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
const IDLE_OFFLINE_RATE = 0.4;      // оффлайн-доход идёт с 40% скорости
const IDLE_OFFLINE_CAP_H = 12;      // максимум 12 часов оффлайн-накоплений
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

/* ---------- Промокоды ---------- */
const PROMO_CODES = {
  SHKOLA2:        { money: 25000,    xp: 50,  label: 'Сезон 2 — стартовый капитал' },
  PEREMENA:       { money: 50000,    xp: 75,  label: 'Награда за перемену' },
  DAVIDLITE:      { money: 100000,   xp: 150, label: 'Код от автора проекта' },
  MURKA1337:      { money: 250000,   xp: 200, label: 'Мурка советует копить на кота' },
  KOT10M:         { money: 1000000,  xp: 400, label: 'Кот поделился заначкой 🐱' },
  'NEWUPDATE2026':{ money: 2026,     xp: 25,  label: 'Обновление 3.0.2 — приветственные монеты!' },
  GORABOGDAN5G:   { item: 'cat_gora_bogdan', xp: 500, label: 'ЛЕГЕНДАРНЫЙ КОТИК ГОРА БОГДАНА! 🏔️🐱' }
};

/* Код для скрытой панели разработчика (5 кликов по логотипу + код) */
const ADMIN_CODE = '1337';

/* ---------- Закрытый бета-тест ----------
   Код доступа НИГДЕ не хранится и не показывается в открытом виде:
   здесь лежит только его djb2-хеш. Введённый игроком код хешируется
   на клиенте и сравнивается с BETA_CODE_HASH, поэтому подсмотреть
   код в исходниках нельзя. Чтобы сменить код — посчитай betaCodeHash()
   от нового значения в консоли и подставь сюда. */
const BETA_CODE_HASH = 2088368086;
const BETA_REWARD = { money: 250000, xp: 500 };
const BETA_TITLE = '🧪 Бета-тестер';
function betaCodeHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h;
}

/* ---------- VIP-коды (для покупки на FunPay за 150 ₽) ----------
   Схема работы:
   1. Создаёшь лот на FunPay за 150 ₽ с автовыдачей.
   2. Каждый покупатель получает УНИКАЛЬНЫЙ код из этого списка
      (один код = один покупатель, копируешь пачкой в автовыдачу FunPay).
   3. Игрок вводит код в разделе «Промокоды» — активируется вечный VIP:
      • «Налог миллионера» полностью отключается навсегда
      • Шансы в кейсах и апгрейдере всегда как при балансе < 100к
      • В профиле появляется корона 👑 и статус VIP
   4. Когда 100 кодов закончатся — выпусти обновление с новой пачкой кодов
      (старые использованные коды уже не сработают, т.к. сохраняются в stats.usedVipCodes).
---------------------------------------------------------------------------------- */
const VIP_PRICE_RUB = 150;
const VIP_CODES = [
  'VIP-J5PA-BUPF',
  'VIP-G3XF-8N22',
  'VIP-M4AL-K6F4',
  'VIP-P8JN-WC43',
  'VIP-NZS7-RE7C',
  'VIP-YF4Q-N3EB',
  'VIP-ZZKQ-5LAB',
  'VIP-4MEV-YP88',
  'VIP-NYMM-MMMJ',
  'VIP-2SVH-K9HS',
  'VIP-86C3-T7AY',
  'VIP-AC3G-WVHR',
  'VIP-UQUQ-RMMQ',
  'VIP-QVVM-7C6T',
  'VIP-FYGK-6B37',
  'VIP-Y7G6-GXEF',
  'VIP-3BGZ-SRL5',
  'VIP-48J7-G2Z3',
  'VIP-3ZSN-UFA6',
  'VIP-FSEE-RXFA',
  'VIP-7JY3-RV7E',
  'VIP-63SL-VK4N',
  'VIP-5ZU2-4Y4H',
  'VIP-EECM-CVE4',
  'VIP-HMT2-DQFR',
  'VIP-BZNP-DRB8',
  'VIP-TMEK-HTCE',
  'VIP-WHMS-PG6S',
  'VIP-TGUB-8X6S',
  'VIP-N84Y-LRJ8',
  'VIP-SWFV-CB8G',
  'VIP-592J-K4CJ',
  'VIP-MZ32-TZ7J',
  'VIP-7AJX-Z3JM',
  'VIP-86L7-TJKD',
  'VIP-2TA2-6YTE',
  'VIP-ULNS-9V9S',
  'VIP-F3K6-3RQP',
  'VIP-YRD4-9S5G',
  'VIP-5LL7-NL4U',
  'VIP-P6S8-8H28',
  'VIP-RR74-4RYA',
  'VIP-SP5Z-BD98',
  'VIP-JX93-LQJH',
  'VIP-LHQ6-GT56',
  'VIP-YCSL-KXNM',
  'VIP-64KW-DMGA',
  'VIP-RUVX-XDQD',
  'VIP-KDTK-GV6B',
  'VIP-KR5W-85BF',
  'VIP-X6AT-6LS5',
  'VIP-C7D6-YT5X',
  'VIP-BSYP-W4WB',
  'VIP-GF6H-A24N',
  'VIP-X2B7-32Z3',
  'VIP-JG7T-C6B7',
  'VIP-ZWNY-4Z5W',
  'VIP-UUCD-A364',
  'VIP-6F97-29LE',
  'VIP-64B6-V2M8',
  'VIP-NUCB-N6TE',
  'VIP-M8AL-72DV',
  'VIP-PH39-4JG9',
  'VIP-7GRR-HYL9',
  'VIP-56R2-DV9M',
  'VIP-BNPZ-LML9',
  'VIP-XPRW-9JBW',
  'VIP-HBY9-LXP8',
  'VIP-JBNV-SJWM',
  'VIP-ZYG7-RJMR',
  'VIP-KWLF-5FXJ',
  'VIP-2K9L-R78W',
  'VIP-5E4X-2CPK',
  'VIP-MF6V-P8KN',
  'VIP-YNG9-DYJS',
  'VIP-4JYV-GAFY',
  'VIP-KZHH-4NTE',
  'VIP-TBRE-FT2R',
  'VIP-C83D-74BX',
  'VIP-QXES-W26P',
  'VIP-7M9T-G883',
  'VIP-PQFK-NFSQ',
  'VIP-DM8E-KNVQ',
  'VIP-FAVA-PW3X',
  'VIP-KY67-KKK2',
  'VIP-MWSV-VJUN',
  'VIP-YHMZ-SCFF',
  'VIP-DRMT-LJUR',
  'VIP-JCKE-3WLF',
  'VIP-956W-GWTY',
  'VIP-T8HN-WVUW',
  'VIP-3DHH-9MJZ',
  'VIP-N2DN-S9LL',
  'VIP-XLEL-G6HQ',
  'VIP-3CB9-73LC',
  'VIP-YMDB-VBDM',
  'VIP-H24S-ZFT9',
  'VIP-L9MF-ND8U',
  'VIP-ZHFY-3JHG',
  'VIP-FRHN-RQWW',
];

/* ---------- Настройки по умолчанию ---------- */
const DEFAULT_SETTINGS = {
  sound: true,
  volume: 70,
  fastOpen: false,
  reduceMotion: false,
  accent: 'orange',
  quality: 'auto'   // 'auto' — под возможности устройства, 'high' / 'low' — вручную
};

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
      const weight = base * Math.pow(factor, sens);
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
