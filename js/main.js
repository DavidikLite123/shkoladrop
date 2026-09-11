/* ==========================================================================
   ШКОЛА ДРОП 2.0 — js/main.js
   Точка входа: запуск игры, приветственное окно, защита от падений.
   ========================================================================== */

function bootShkolaDrop() {
  try {
    initGame();

    // Подбираем графику под устройство и замеряем реальный FPS
    Quality.init(state.settings.quality);
    applyQualityToUI();
    Quality.probe(() => applyQualityToUI());

    checkStylesLoaded();

    // Приветственное окно показываем только в первый раз.
    // Баннер cookie не наслаиваем: он появится после закрытия приветствия.
    const meta = MetaStore.read();
    const welcome = $('welcomeDisclaimerModal');
    if (welcome && meta.welcomeSeen) {
      welcome.remove();
      // Обязательно пересинхронизируемся: initGame() успел заблокировать прокрутку
      // под приветствием, и без этого страница осталась бы нескроллящейся навсегда.
      if (typeof resyncModalState === 'function') resyncModalState();
      showCookieBannerIfNeeded();
    } else if (!welcome) {
      if (typeof resyncModalState === 'function') resyncModalState();
      showCookieBannerIfNeeded();
    }

    console.log(`%c🎒 ШКОЛА ДРОП v${APP_VERSION} Stable`, 'color:#ff5500;font-weight:bold', '— David Lite Studio · Сезон 3');
    console.log(`Сохранение: localStorage «${SAVE_KEY}» + cookie-бэкап · согласие: ${Consent.isSet() ? 'получено' : 'нет'}`);
  } catch (err) {
    console.error('[ШКОЛА ДРОП] Ошибка запуска:', err);
    try {
      Toast.error('Что-то пошло не так при запуске. Попробуй обновить страницу (F5). Пароль не помог :(');
    } catch (e) {}
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootShkolaDrop);
} else {
  bootShkolaDrop();
}

/* --------------------------------------------------------------------------
   Проверка, что CDN-стили Tailwind загрузились (офлайн / блокировщик)
   -------------------------------------------------------------------------- */
function checkStylesLoaded() {
  try {
    const maxW = window.getComputedStyle(document.body).maxWidth;
    if (maxW === '448px' || maxW === '28rem') return; // max-w-md применился — всё ок
    const warn = document.createElement('div');
    warn.className = 'fixed left-3 right-3 bottom-3 z-[95] bg-amber-950/95 border border-amber-500/60 text-amber-100 text-[11px] rounded-xl p-3 leading-relaxed';
    warn.innerHTML = '⚠️ <b>Стили оформления не загрузились</b> (Tailwind CDN). Проверь интернет или отключи блокировщик: игра работает, но оформление упрощённое.';
    document.body.appendChild(warn);
    setTimeout(() => warn.remove(), 14000);
  } catch (e) {}
}

