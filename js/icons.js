/* ==========================================================================
   ШКОЛА ДРОП — js/icons.js
   Встроенные векторные иконки (inline SVG, без CDN и внешних шрифтов).

   Зачем: системные эмодзи на части ОС/браузеров не грузятся и показываются
   пустыми квадратами (особенно в <canvas> и на старых Windows/Linux).
   Здесь — обычные пути SVG в координатной сетке 24×24, которые рисуются
   всегда и одинаково на любой платформе.

   Как использовать:
     Icons.svg('rocket', { size: 18 })          → готовая строка SVG
     <i data-icon="rocket" class="crash-icon"></i>  → Icons.hydrate(document)
     Icons.has('rocket')
   ========================================================================== */

const Icons = {
  /* Все иконки рисуются в сетке 24×24 текущим цветом (currentColor) */
  set: {
    /* 🚀 Ракета */
    rocket:
      '<path d="M12 2.6c3.3 2.6 5 6.2 5 10.1 0 1.1-.3 2.1-.9 3H7.9c-.6-.9-.9-1.9-.9-3 0-3.9 1.7-7.5 5-10.1Z"/>' +
      '<path d="M7.4 10.9 3.6 12.7l3.8 1.2"/>' +
      '<path d="M16.6 10.9l3.8 1.8-3.8 1.2"/>' +
      '<circle cx="12" cy="9.4" r="1.8"/>',

    /* 📦 Кейсы */
    package:
      '<path d="M20.5 7.4 12 3 3.5 7.4v9.2L12 21l8.5-4.4V7.4Z"/>' +
      '<path d="M3.5 7.4 12 11.8l8.5-4.4"/>' +
      '<path d="M12 11.8V21"/>',

    /* ⚡ Апгрейд */
    zap: '<path d="M13 2.2 4.6 13.6H11l-1 8.2 8.4-11.4H12l1-8.2Z"/>',

    /* 🎮 Меню игр */
    gamepad:
      '<rect x="2.5" y="7" width="19" height="10.5" rx="3.2"/>' +
      '<path d="M7 10.6v3.3M5.4 12.25h3.2"/>' +
      '<circle cx="16" cy="11.4" r="1.1" fill="currentColor" stroke="none"/>' +
      '<circle cx="18.4" cy="13.7" r="1.1" fill="currentColor" stroke="none"/>',

    /* 💰 Деньги / ставка */
    banknote:
      '<rect x="2.5" y="6" width="19" height="12" rx="2.2"/>' +
      '<circle cx="12" cy="12" r="2.6"/>' +
      '<path d="M6.4 9.6v4.8M17.6 9.6v4.8"/>',

    /* 🎯 Автовывод */
    target:
      '<circle cx="12" cy="12" r="8.5"/>' +
      '<circle cx="12" cy="12" r="4.4"/>' +
      '<circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>',

    /* ▶ Старт */
    play: '<path d="M7.5 4.6 19 12 7.5 19.4V4.6Z" fill="currentColor" stroke="none"/>',

    /* 💸 Забрать выигрыш */
    cashout:
      '<path d="M12 3.4v9.8"/>' +
      '<path d="M8 9.8l4 4 4-4"/>' +
      '<path d="M4.6 17.4v1.1a1.6 1.6 0 0 0 1.6 1.6h11.6a1.6 1.6 0 0 0 1.6-1.6v-1.1"/>',

    /* 💥 Взрыв */
    burst:
      '<path d="M12 2.8v3.4M12 17.8v3.4M2.8 12h3.4M17.8 12h3.4"/>' +
      '<path d="M5.5 5.5l2.4 2.4M16.1 16.1l2.4 2.4M18.5 5.5l-2.4 2.4M7.9 16.1l-2.4 2.4"/>' +
      '<circle cx="12" cy="12" r="4.2"/>',

    /* 📈 График роста */
    chart:
      '<path d="M3.4 20.6h17.2"/>' +
      '<path d="M6 15.6l4.6-5.2 3.4 3.2 5.2-7"/>',

    /* 🛡 Честность */
    shield:
      '<path d="M12 2.8 4.6 6v5.9c0 4.4 3.1 8 7.4 9.3 4.3-1.3 7.4-4.9 7.4-9.3V6L12 2.8Z"/>' +
      '<path d="M9.3 12.2l2 2 3.6-3.9"/>',

    /* 🕘 История раундов */
    history:
      '<path d="M3.6 12a8.4 8.4 0 1 0 2.6-6.1"/>' +
      '<path d="M3.6 4.6V10h5.4"/>' +
      '<path d="M12 7.8v4.5l3.1 1.9"/>',

    /* 🏆 Рекорд */
    trophy:
      '<path d="M7.6 3.8h8.8v5.1a4.4 4.4 0 0 1-8.8 0V3.8Z"/>' +
      '<path d="M7.6 5.4H5a2.5 2.5 0 0 0 2.6 2.5M16.4 5.4H19a2.5 2.5 0 0 1-2.6 2.5"/>' +
      '<path d="M10 20.2h4M12 13.4v6.8"/>',

    /* 📊 Профит */
    trending:
      '<path d="M3.4 16.6 9 11l3.5 3.5L20.6 6.4"/>' +
      '<path d="M15.4 6.4h5.2v5.2"/>',

    /* ⏱ Тайминг / разгон */
    timer:
      '<circle cx="12" cy="13" r="8.2"/>' +
      '<path d="M12 8.8V13l3 1.8"/>' +
      '<path d="M9.4 2.8h5.2"/>'
  },

  has(name) { return !!(name && this.set[name]); },

  /**
   * Готовая строка SVG.
   * @param {string} name  ключ из Icons.set
   * @param {{size?:number, cls?:string, stroke?:number, fill?:string}} opts
   */
  svg(name, opts = {}) {
    const body = this.set[name];
    if (!body) return '';
    const size = Number(opts.size) || 20;
    const stroke = Number(opts.stroke) || 1.7;
    const cls = opts.cls ? ` class="${opts.cls}"` : '';
    return `<svg${cls} viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" ` +
      `stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" ` +
      `stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;
  },

  /** Наполняет все <i data-icon="..."> внутри root готовыми SVG */
  hydrate(root) {
    const nodes = (root || document).querySelectorAll('[data-icon]');
    nodes.forEach(node => {
      const name = node.getAttribute('data-icon');
      if (!this.has(name)) return;
      const size = Number(node.getAttribute('data-icon-size')) || 18;
      node.innerHTML = this.svg(name, { size });
      node.setAttribute('data-icon-done', '1');
    });
    return nodes.length;
  }
};
