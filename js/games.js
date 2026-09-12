/* ==========================================================================
   ШКОЛА ДРОП — js/games.js
   Единое меню мини-игр («Игры» в нижней навигации).

   Модульность: список игр — это массив MINI_GAMES в js/config.js. Чтобы
   добавить новую игру, достаточно дописать туда одну запись:

     MiniGames.register({
       id: 'dice', tab: 'dice', icon: '🎲', name: 'Кости',
       desc: 'Угадай сумму и забери выигрыш',
       enabled: () => true            // false — карточка затемнена
     });

   и добавить панель <main id="viewDice" class="view-panel ... hidden"> в
   index.html + ветку в switchTab(). Меню подхватит игру само.
   ========================================================================== */

const MiniGames = {
  /** Актуальный список игр (с учётом enabled-условий) */
  list() {
    const all = (typeof MINI_GAMES !== 'undefined' && Array.isArray(MINI_GAMES)) ? MINI_GAMES : [];
    return all.filter(g => g && g.id && (!g.enabled || g.enabled() !== false));
  },

  find(id) {
    return (typeof MINI_GAMES !== 'undefined' ? MINI_GAMES : []).find(g => g && g.id === id) || null;
  },

  /** Открыта ли сейчас эта игра */
  isCurrent(game) {
    return !!(game && typeof currentTab !== 'undefined' && currentTab === (game.tab || game.id));
  },

  /** Добавить игру в реестр прямо из кода (например, из её модуля) */
  register(game) {
    if (!game || !game.id) return false;
    if (typeof MINI_GAMES === 'undefined') return false;
    if (MINI_GAMES.some(g => g && g.id === game.id)) return false;
    MINI_GAMES.push(game);
    return true;
  },

  open() {
    this.render();
    if (typeof Modal !== 'undefined') Modal.open('gamesModal');
    audio.init();
    audio.playTick();
  },

  close() {
    if (typeof Modal !== 'undefined') Modal.close('gamesModal');
  },

  render() {
    const box = $('gamesList');
    if (!box) return;
    const games = this.list();
    if (!games.length) {
      box.innerHTML = '<div class="text-[11px] text-slate-400 text-center py-4">Мини-игры скоро появятся 🎮</div>';
      return;
    }
    box.innerHTML = games.map(g => {
      const current = this.isCurrent(g);
      return `
        <button type="button" onclick="selectMiniGame('${escapeHtml(g.id)}')"
                class="mini-game-card ${current ? 'mini-game-card-current' : ''}">
          <span class="mini-game-icon">${escapeHtml(g.icon || '🎮')}</span>
          <span class="flex-1 min-w-0">
            <b>${escapeHtml(g.name || g.id)}</b>
            <small>${escapeHtml(g.desc || '')}</small>
          </span>
          ${current
            ? '<span class="mini-game-tag mini-game-tag-live">▶ играешь</span>'
            : (g.badge ? `<span class="mini-game-tag mini-game-tag-new">${escapeHtml(g.badge)}</span>` : '<span class="text-slate-500">›</span>')}
        </button>`;
    }).join('');
  },

  select(id) {
    const game = this.find(id);
    if (!game) return;
    audio.init();
    audio.playTick();
    this.close();
    // Свой обработчик (например, открыть модалку) имеет приоритет над вкладкой
    if (typeof game.onOpen === 'function') { game.onOpen(); return; }
    if (game.tab && typeof switchTab === 'function') switchTab(game.tab);
  }
};

/* Обёртки для onclick в index.html */
function openGamesModal() { MiniGames.open(); }
function closeGamesModal() { MiniGames.close(); }
function selectMiniGame(id) { MiniGames.select(id); }
