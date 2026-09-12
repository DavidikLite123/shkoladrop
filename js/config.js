/* ==========================================================================
   ШКОЛА ДРОП 2.0 — js/config.js
   Все игровые данные: редкости, каталоги предметов, кейсы, достижения,
   уровни, награды, промокоды, апгрейды дежурства.
   ========================================================================== */

const APP_VERSION = '4.0';
const WHATS_NEW_VERSION = 'season-3.5-apology-4.0-2026-09'; // версия 4.0, сезон 3.5 — извинительный подарок + обязательный онлайн
const SAVE_VERSION = 14;      // v14 = сезон 3.5 / версия 4.0 — подарок-извинение за вайп 3.9 + обязательный онлайн-коннект
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
   Распределение: P(ракета долетит до X) = (1 - houseEdge) / X.
   То есть при выводе на фиксированномX средний возврат = 1 - houseEdge (RTP 95%):
   «максимальная вероятность краша на низких иксах» заложена самой формулой.
   Формула: roll ∈ [0, 1) → crash = (1 - houseEdge) / (1 - roll), но не ниже 1.00×. */
const CRASH_CONFIG = {
  houseEdge: 0.05,          // 5% — преимущество школы. RTP = 95%
  minBet: 100,              // минимальная ставка
  maxBet: 1000000000,       // страховка от опечаток в вводе
  growth: 0.18,             // множитель растёт как exp(growth * t): 2.00× ≈ за 3,9 сек
  maxMultiplier: 1000000,   // жёсткий потолок, чтобы полёт не длился вечно
  minAutoCashout: 1.01,     // автовывод ниже 1.01× бессмысленен
  maxAutoCashout: 1000000,
  historySize: 12,          // сколько последних краш-точек храним
  quickBets: [1000, 10000, 100000, 1000000],
  quickAuto: [1.5, 2, 3, 5, 10]
};

/* Чистая математика ракеты (без DOM и без внешних зависимостей — чтобы её мог
   поднять и автотест в Node). Её же гоняют тесты: tests/crash-math.test.js */
function crashPointFromRoll(roll) {
  const raw = Number(roll);
  const r = !isFinite(raw) ? 0 : Math.min(Math.max(raw, 0), 0.999999999999);
  const x = (1 - CRASH_CONFIG.houseEdge) / (1 - r);
  if (!isFinite(x)) return CRASH_CONFIG.maxMultiplier;
  return Math.min(Math.max(x, 1), CRASH_CONFIG.maxMultiplier);
}

/** Множитель в момент времени t (секунды от старта): экспоненциальный рост от 1.00× */
function crashMultiplierAt(elapsedSec) {
  return Math.exp(CRASH_CONFIG.growth * Math.max(0, Number(elapsedSec) || 0));
}

/** Через сколько секунд ракета дойдёт до множителя x (для анимации и авто-вывода) */
function crashTimeToMultiplier(x) {
  return Math.log(Math.max(1, Number(x) || 1)) / CRASH_CONFIG.growth;
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
     tab      — какую панель открывать (view + Tab);
     enabled  — можно ли сейчас играть (false = карточка затемнена);
     onOpen   — необязательный свой обработчик вместо switchTab (например, модалка).
   Порядок в массиве = порядок карточек в меню. Первая игра — стартовая вкладка. */
const MINI_GAMES = [
  {
    id: 'upgrade', tab: 'upgrade', icon: '⚡', name: 'Апгрейд',
    desc: 'Занеси свой предмет на цель дороже — шанс считается честно по ценам',
    enabled: () => true
  },
  {
    id: 'cases', tab: 'cases', icon: '📦', name: 'Кейсы',
    desc: 'Крути школьные, CS2, кошачьи и ютубер-кейсы — дроп честный, шансы открыты',
    enabled: () => true
  },
  {
    id: 'crash', tab: 'crash', icon: '🚀', name: 'Ракета', badge: 'NEW',
    desc: 'Ставь, следи за множителем и успевай забрать выигрыш до взрыва',
    enabled: () => true
  }
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
   Коды НЕ хранятся в открытом виде — только djb2-хеши (см. betaCodeHash ниже).
   Введённый код хешируется и сравнивается: если совпал с OWNER — открываются
   ВСЕ функции (владелец), если с ADMIN — только функции администрации
   (модерация чата, онлайн, деньги себе). Остальные блоки просто не показываются.
   Сменить код: посчитай betaCodeHash('новый код') в консоли и подставь сюда. */
const OWNER_CODE_HASH = 2088291795;   // код владельца — знает только David Lite
const ADMIN_CODE_HASH = 2088507411;   // код администрации — выдаётся модераторам
/* Секреты для серверных запросов должны совпадать с ADMIN_SECRET / STAFF_SECRET на сервере */
const OWNER_SERVER_SECRET = 'david-admin-1337';
const ADMIN_SERVER_SECRET = 'david-staff-7331';
/* Права ролей — что показывать в панели (data-admin-perm="...") */
const ADMIN_PERMS = {
  owner: ['rig', 'money', 'cat', 'maxlevel', 'players', 'detail', 'dm', 'verify', 'ban', 'role', 'status', 'delete', 'chat', 'server', 'authorcodes', 'online', 'emails'],
  admin: ['money', 'players', 'detail', 'dm', 'ban', 'chat', 'online']
};

/* djb2-хеш: используется для кодов админки (коды в открытом виде не хранятся) */
function betaCodeHash(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0;
  return h;
}

/* ---------- VIP-коды (покупка за 150 ₽ через почту) ----------
   Схема работы:
   1. Игрок пишет на почту shkoladrop.contact@gmail.com (ник + уникальный ID).
   2. Ты отвечаешь реквизитами карты, игрок переводит 150 ₽, ты отправляешь ему
      УНИКАЛЬНЫЙ код из СВОЕГО списка vip_codes_funpay.txt (один код = один покупатель).
   3. Игрок вводит код в разделе «Промокоды» — активируется вечный VIP.

   ВАЖНО (исправление утечки): раньше сами коды лежали здесь в открытом виде, а репозиторий
   публичный — любой мог взять код с GitHub и «автоматически» получить VIP. Теперь в клиенте
   хранятся ТОЛЬКО SHA-256-хеши (первые 24 hex-символа от 'shkoladrop-vip:' + код).
   Все старые коды (VIP-J5PA-BUPF и т.д.) АННУЛИРОВАНЫ: VIP, активированный ими, снимается
   при входе (см. auditVip в game.js). Настоящим покупателям выдай код из нового списка.
   Файл vip_codes_funpay.txt с открытыми кодами НЕ КОММИТЬ — он в .gitignore. */
const VIP_PRICE_RUB = 150;
const VIP_CODE_HASHES = [
  'd1baad0fce17fdeae0697348',
  '09ff6dd6b1eb6863afa867c0',
  'cbd61b73b97b9d63f6354a01',
  'b60ae22235766bc374584e05',
  'f5c16318209f7ce8dcddafdd',
  'a69566de97112c3062714bb7',
  'a7243cc51ac4345038aae494',
  '7ce494fe26ac2295cab69b74',
  '1c8e422f807836c9d481f287',
  '802dd5324998768194c171eb',
  '7d5be1349079c27fe4a3ab3f',
  'e1803307a5004bc146de91cd',
  '7720c07191c86873c7fc50ba',
  'ebeecc2a7aaeb8b6c956e544',
  '61ce0a281617fcaebb0d8543',
  '424a33c9ffbe5cd2f5034f37',
  '04e97c185f512fdff81ad8b8',
  '982a77d6272c0fdbebc47450',
  '615d9b6685eb1db08a5a493e',
  '66be805e789a74445ff9fb6a',
  '0e1b94b0942106417c73a700',
  '9e1412852fe35382623dcd26',
  'f506ef8cce78a57fdce444ab',
  '31c934d79588dea15aead020',
  'f4c56dfb174be48d3928cad0',
  '28ba6b386bee4409a94997aa',
  '615bce027f8898bcdcf0c049',
  '335ffa4581e68b82a462e39b',
  '772081d5cf1d60b8f0f69eee',
  '51e9e63a56ef3ee06e9e2efb',
  'f5c6d8f7da019a597057bcce',
  '760bc6b4fb07b9b0a621f5b3',
  '8d911eeee317acee7b45d850',
  'f2856c050e7075b66bbd05dd',
  'be51f841f1cbf7b60f2eb02d',
  'f743a2135ea062e667f91493',
  '608b0dfda6a949924d57cc5b',
  '0282208a1924a30e59d75f2a',
  '23324d57d243bd81aa8b5e43',
  'ab4889d5e79af7cd0137b62a',
  '514f46e7cb5f9132763ac76c',
  '2fa3c37767944be77747bcce',
  '213275c6b285cf502e351f14',
  '007eaf502f1ffc2b963d5485',
  'a61c458dc54bd443be9ba9a7',
  'ba69f3d63682adec1af00c00',
  '254ae5f03fa33aa52dd0eda1',
  'b69dd4decd76364dcbc5e387',
  '3d8187bc5abd8c98c7ac9f01',
  '478b0eb7258f16204f46101a',
  'd489afbdc71fc40878d28e2f',
  'a20884e8035c752f9b7303ef',
  '232df7fd6b3bd9d9053675c9',
  'bceda107755b0663a0c0d1ca',
  '7f439dcc253cda896e55c071',
  '52ba40b3bb78c7fa467d9621',
  '99cc8c3034cd6ec26e3b74f6',
  '121e44485055b5a11efd8c99',
  'b84f2036b4555afd794b1c93',
  'b6a47742d4986bd8e68bf1e0',
  'c29020cc5703134310444fb4',
  'de247bf0516cf8237c72f241',
  'f6f53c4af349cc2b10379d19',
  'd9a1cafd926c8d1f81108262',
  '51ee4dec1f4ea29ae28e5804',
  'fa13a29873c7e300cd1ee244',
  '20840c4413237a0da1bd767c',
  '2eceb5d1f0a4e038a948b066',
  'd62d2973f3abd34fa8cd7470',
  'b4ec19e6f91e7626b8252c19',
  'edb0a628a32ed1803427117e',
  'b726ecbb5c8edc81d07a0c54',
  '41dd54514a83572dcc76527c',
  '3b7cc79bdde88eb04ac481a5',
  '1b118d09539b4246d3aaa917',
  '39a4ea93d90116adaebc6a1a',
  '4c3dbd677fa607e88cc4ddf0',
  '5e4a961b4fd66f831655c31c',
  '1a95a3c334a9a7c876475385',
  '800b0b0e2232c4a7f08a432e',
  '84ba28f93ba1ebff909d5245',
  '5b24ec467fe3418e7210057e',
  '5d404e0f50579ee9fbc8e986',
  '565b8357ceac674859439e28',
  'daa81fcb244c872b5825604e',
  'c16ba74b4d231672024778b3',
  '9a945e7cacdb5909c3bad164',
  '36e4d5a8d6f180ebbb442031',
  'f7caa339ca6083b0796dfed1',
  '38e74763d2665aaf08f070b2',
  'f1e6330b1213f568a806562f',
  '1005232d85fde1d1cea780fb',
  '3c40f676c61f7009bd132101',
  'fcadb4975af5d75e776e8efd',
  '8d60dac247d5eaf98bd65085',
  'e497290beae506c2b627edf8',
  '74982ee81cf2fd2e0dd7195b',
  'c2a5633c81aed751cd7a0006',
  '7f93ecd00cd89d1349c6245a',
  '5b94d01020fe47c532f686ed',
  /* Новая сотня кодов (генерация 2026-09-12) — открытые коды: codes/vip-codes.md */
  '9fe76d744c9e1a4beef09e78', '831bd6138df2a26a586f85a5',
  '7bd6ba3667c7c582cff08b09', 'a5c12a29324a617ff8456269',
  '5c52deb83f56656bc8bb1c58', '1f1d1e3f4177c345b3023909',
  'fc6793e13f649ff6b2bc2942', '721a90a35a786ca0b2d92d05',
  '13e36a200281c31956c4ba98', 'd995d5efc8ba6b7a3d6ff47c',
  '55ca3c2ff17a43288c034ba5', 'd0daef0738e5abe1d3f7817a',
  '98ebd688f30140b4a14e3dbe', '25c13cf49057e4d93713a7c6',
  '3562601cfb62762b7b3dad2c', '1e43e9361caeee2034f0b26f',
  '4a28f5f2e16ae4e5a3293c04', '2f36e3d9179634e60b1aa125',
  'd75f522a4d9ad6ef9166fbad', '38af1c65b820152e1ca48f6f',
  'f7c9b9442fbd57f82f440d4c', 'fdb9bdfda4f5fedbeb928063',
  'e7b7616e4c063efc7cc41887', 'c895b8eef9b196deb73f477a',
  '62dcb4c5e9314b5f8e98194a', '7d59cfd863be64748be78a0c',
  '04a6e1a64a59ea80d9055859', 'b45fb179f3771df33d6bd25e',
  'd893d535238acbafb9c74f28', '56fd7c2683701f30c45450c8',
  '17b5108e6f11911fe4191cfa', '7368165b0ae63b6316f1084d',
  '354dca3c4013ffb529ce0ac9', '96a8890c4e8df725a3d6a831',
  '425fc92bc5b4e5b28798428f', 'ec1ec529b909fb4fd65ccbd0',
  '8de1f1356463b67ad498d968', 'ee234c69ece72fb9d5c66949',
  'c5e6c98009e4391a54c0ff23', 'dd7c7e4ea4b6c5b8549562cd',
  '6ca04e7a2be95d2fadab618a', '174516cc293c2c858bcbef44',
  '4840953597bda78cb4028829', 'f1f1b02ba22e6c2b3999d93c',
  'd1eed9288ff05740ddcf0e1b', 'f53d001bc71fab90eb0604dc',
  '13599f46a0a76ea6fb9beeef', 'd024f4a02bea7afa015241f0',
  '49009b521ed2d844a8a65329', '63d55d078c50d3374e852abd',
  'bc1bcaa8a5e095c28bb0da70', '59e5bfcf09e0278c6a0031f3',
  '54499b7c00b8211d2855c0cd', 'b72f293f8a81b80aeb45b150',
  'efae1af1fde6379fb6c242b3', '00af02bf1e3f8ac1296b8fc6',
  'c324f813cd9a940bba1d8cf7', 'ca9a0c33044ec07fe725df8f',
  '14ff4154a9fb21a72ac96ef4', '86f3c3d9412056ff83960b7b',
  'f49e5806535e9657bbd19e24', 'cc4946de5e3a11db9e984edc',
  'cfa2c3f9f86cc3a69357d8aa', '400f39aea0f6b9bc9118ea33',
  '881959f291eb81a02ec1739f', '6a7098defb76fd7f7cce980b',
  '03091cc16165af5cec29b35c', '29440894da848ecab144a38c',
  '3c998a7ef0c5b3be5bd8d665', 'de77d0214740cbad156e1ce0',
  'a627d74188cd7c1dd577593d', 'ec87ef3d69312e42eb6e19e9',
  'eace5642109b3dfa22365a0d', 'ea5243725c36be8e0b763e37',
  '63dbdb63f118945df71a944f', '438deda5301231665b5fae09',
  '6b63f1add0bd206dd88a7beb', '80bfe43c551c9b179913a58a',
  '43449ee1d52a1b1cb1d35cff', '2cb8db475c98cf5d62d2711e',
  'f6420aea59d3175eadbce034', '3c063f1c59f0edbd1ea86dfb',
  '8500cedfb3784efe045f9ceb', '2839437062d6eb3b7ffdae30',
  '404db12b1ca3932ae52eb1dc', 'fea7d7ffbb1188aa61b2e59b',
  '08cfc913b338980d0817d353', 'bd28a0a8836e1167a785c877',
  '73fdc40cce309b865864a58d', 'da6964eea668a5c698fc4545',
  '70525427a9e9138ea2fedf85', 'e58fdb948c5b8ad318593841',
  '5b295c17e608c10be51fb7ba', 'd37e5cc162b11751a9185dfa',
  'da0ad40885a7c882167d5844', '7570673ac79ebb6103875a0e',
  '80e840e9659e0ab256b8f13a', '562b917b68ce77389db3e7ae',
  '4a7ea6e0d30f2e6103c0cd4d', '1ba1171869bbda281239a7e9'
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

const REBIRTH_REQUIREMENTS = [
  { level: 1, needLevel: 10, needMoney: 0,          needCases: 25 },
  { level: 2, needLevel: 11, needMoney: 500000,     needCases: 75 },
  { level: 3, needLevel: 12, needMoney: 2000000,    needCases: 150 },
  { level: 4, needLevel: 13, needMoney: 10000000,   needCases: 300 },
  { level: 5, needLevel: 13, needMoney: 50000000,   needCases: 500 },
  { level: 6, needLevel: 13, needMoney: 250000000,  needCases: 800 },
  { level: 7, needLevel: 13, needMoney: 1000000000, needCases: 1200 },
  { level: 8, needLevel: 13, needMoney: 10000000000, needCases: 2000 },
  { level: 9, needLevel: 13, needMoney: 50000000000, needCases: 3500 },
  { level: 10,needLevel: 13, needMoney: 100000000000, needCases: 5000 }
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
