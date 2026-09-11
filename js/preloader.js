/* ==========================================================================
   ШКОЛА ДРОП 3.5 — js/preloader.js
   Прелоадер: закрывает интерфейс до полной готовности DOM, стилей и скриптов.
   Прогресс-бар тянется к 92%, пока не сработает реальное событие window.load,
   затем добивается до 100% и экран плавно исчезает (fade-out).
   Зависимостей нет — модуль работает автономно и грузится первым.
   ========================================================================== */
(function () {
  'use strict';

  var STATUSES = [
    'Проверяем сменку на входе...',
    'Подгружаем свежие котлеты из буфета...',
    'Обходим дневник русички...',
    'Инициализация модулей v3.5...'
  ];
  var SAFETY_MS = 8000; // страховка: даже если window.load завис, экран уберём

  var el, bar, percentEl, statusEl;
  var progress = 0;
  var finished = false;
  var statusIdx = 0;
  var statusTimer = null;
  var t0 = (window.performance && performance.now) ? performance.now() : Date.now();

  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  function paint() {
    var p = Math.max(0, Math.min(100, Math.round(progress)));
    if (bar) bar.style.width = p + '%';
    if (percentEl) percentEl.textContent = p + '%';
  }

  function fadeOut() {
    if (!el) return;
    el.classList.add('preloader-hide');
    var target = el;
    setTimeout(function () {
      if (target && target.parentNode) target.parentNode.removeChild(target);
    }, 600);
    el = null;
  }

  function finish() {
    if (finished) return;
    finished = true;
    if (statusTimer) { clearInterval(statusTimer); statusTimer = null; }
    if (statusEl) statusEl.textContent = 'Готово! Урок начинается ✔';
    // Плавно добиваем прогресс до 100% и гасим экран
    var from = progress;
    var tStart = now();
    (function anim() {
      var k = Math.min(1, (now() - tStart) / 320);
      progress = from + (100 - from) * k;
      paint();
      if (k < 1) {
        (window.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(anim);
      } else {
        setTimeout(fadeOut, 140);
      }
    })();
  }

  function boot() {
    el = document.getElementById('appPreloader');
    if (!el) return;
    bar = document.getElementById('preloaderBar');
    percentEl = document.getElementById('preloaderPercent');
    statusEl = document.getElementById('preloaderStatus');

    // Меняющиеся школьные статусы каждые ~500 мс
    statusTimer = setInterval(function () {
      statusIdx = Math.min(statusIdx + 1, STATUSES.length - 1);
      if (statusEl) statusEl.textContent = STATUSES[statusIdx];
    }, 500);

    // Имитация прогресса: быстро до 70%, затем мягко к 92% пока ждём window.load
    (function tick() {
      if (finished) return;
      var elapsed = now() - t0;
      var target = elapsed < 900
        ? (elapsed / 900) * 70
        : 70 + Math.min(22, ((elapsed - 900) / 1500) * 22);
      progress += (target - progress) * 0.16;
      paint();
      (window.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(tick);
    })();

    if (document.readyState === 'complete') {
      finish();
    } else {
      window.addEventListener('load', function () { finish(); }, { once: true });
      setTimeout(finish, SAFETY_MS);
    }
  }

  boot();
})();
