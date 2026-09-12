/* ==========================================================================
   ШКОЛА ДРОП 3.5 — js/preloader.js
   Прелоадер сезона 3.5: обязательное подключение к серверу перед игрой.

   Логика:
   • Показывает прогресс загрузки (до 92% пока window.load не сработал)
   • Параллельно пингует сервер сообщества (https://shkoladrop.onrender.com)
   • Внизу пишет: "Подключение к серверу, подождите..." → "Сервер спит, будим..." → "Подключение успешно! Добро пожаловать"
   • Игра НЕ пускает дальше, пока сервер не ответит — каждый аккаунт должен отобразиться на сервере
   • После успеха — плавный fade-out
   ========================================================================== */
(function () {
  'use strict';

  var STATUSES = [
    'Проверяем сменку на входе...',
    'Подгружаем свежие котлеты из буфета...',
    'Обходим дневник русички...',
    'Инициализация модулей v3.5...'
  ];
  var SERVER_URLS = [
    '/api/ping', // локальный сервер (если игра запущена через node server/index.js)
    'https://shkoladrop.onrender.com/api/ping' // прод сервер сообщества
  ];
  var SAFETY_MS = 12000;
  var RETRY_MS = 4000;

  var el, bar, percentEl, statusEl, serverEl;
  var progress = 0;
  var finished = false;
  var windowLoaded = false;
  var serverConnected = false;
  var statusIdx = 0;
  var statusTimer = null;
  var t0 = (window.performance && performance.now) ? performance.now() : Date.now();
  var retryCount = 0;

  function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  function paint() {
    var p = Math.max(0, Math.min(100, Math.round(progress)));
    if (bar) bar.style.width = p + '%';
    if (percentEl) percentEl.textContent = p + '%';
  }

  function setServerStatus(text, cls) {
    if (!serverEl) return;
    serverEl.textContent = text;
    serverEl.className = 'pre-server' + (cls ? ' ' + cls : '');
    try { window.__preloaderRetry = retryCount; window.__preloaderServerText = text; } catch (e) {}
  }

  function fadeOut() {
    if (!el) return;
    el.classList.add('preloader-hide');
    var target = el;
    setTimeout(function () {
      if (target && target.parentNode) target.parentNode.removeChild(target);
    }, 600);
    el = null;
    // Флаг для остальной игры
    try { window.__shkoladropServerReady = true; window.__shkoladropServerConnectedAt = Date.now(); } catch (e) {}
  }

  function tryFinish() {
    if (finished) return;
    if (!windowLoaded) return;
    if (!serverConnected) return; // ОБЯЗАТЕЛЬНЫЙ онлайн — не пускаем без сервера
    finished = true;
    if (statusTimer) { clearInterval(statusTimer); statusTimer = null; }
    if (statusEl) statusEl.textContent = 'Готово! Урок начинается ✔';
    setServerStatus('Подключение успешно! Добро пожаловать 🎒', 'pre-server-ok');
    // Плавно добиваем прогресс до 100%
    var from = progress;
    var tStart = now();
    (function anim() {
      var k = Math.min(1, (now() - tStart) / 320);
      progress = from + (100 - from) * k;
      paint();
      if (k < 1) {
        (window.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(anim);
      } else {
        setTimeout(fadeOut, 400);
      }
    })();
  }

  function pingServer() {
    if (serverConnected || finished) return;
    retryCount++;
    var url = SERVER_URLS[retryCount % 2 === 1 ? 0 : 1]; // чередуем локальный и прод
    if (retryCount === 1) {
      setServerStatus('Подключение к серверу, подождите...', '');
    } else if (retryCount > 2) {
      setServerStatus('Сервер спит, будим... ⏳ попытка ' + retryCount + ' — подождите ~минуту', 'pre-server-wake');
    }

    var ctrl = null;
    var timer = null;
    try {
      if (typeof AbortController !== 'undefined') {
        ctrl = new AbortController();
        timer = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, 6000);
      }
    } catch (e) {}

    var fetchOpts = { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined };
    fetch(url, fetchOpts).then(function (res) {
      if (timer) clearTimeout(timer);
      if (!res.ok) throw new Error('bad status ' + res.status);
      return res.json().catch(function () { return { ok: true }; });
    }).then(function (data) {
      if (data && data.ok === false && data.banned) {
        // даже забаненный — сервер ответил, считаем подключением
        serverConnected = true;
        setServerStatus('Подключение успешно! Добро пожаловать 🎒', 'pre-server-ok');
        try { window.__shkoladropServerOnline = true; } catch (e) {}
        tryFinish();
        return;
      }
      serverConnected = true;
      setServerStatus('Подключение успешно! Добро пожаловать 🎒', 'pre-server-ok');
      try { window.__shkoladropServerOnline = true; } catch (e) {}
      tryFinish();
    }).catch(function () {
      if (timer) clearTimeout(timer);
      // не подключились — пробуем ещё
      setServerStatus(retryCount <= 2 ? 'Подключение к серверу, подождите... сервер просыпается' : 'Сервер спит, будим... ⏳ подождите, подключение скоро будет', 'pre-server-wake');
      setTimeout(pingServer, RETRY_MS);
    });
  }

  function boot() {
    el = document.getElementById('appPreloader');
    if (!el) return;
    bar = document.getElementById('preloaderBar');
    percentEl = document.getElementById('preloaderPercent');
    statusEl = document.getElementById('preloaderStatus');
    serverEl = document.getElementById('preloaderServer');

    try { window.__shkoladropServerReady = false; window.__shkoladropServerOnline = false; } catch (e) {}

    setServerStatus('Подключение к серверу, подождите...', '');

    // Меняющиеся школьные статусы
    statusTimer = setInterval(function () {
      statusIdx = Math.min(statusIdx + 1, STATUSES.length - 1);
      if (statusEl) statusEl.textContent = STATUSES[statusIdx];
    }, 500);

    // Имитация прогресса до 85% пока ждём window.load + сервер
    (function tick() {
      if (finished) return;
      var elapsed = now() - t0;
      var target = elapsed < 900
        ? (elapsed / 900) * 60
        : 60 + Math.min(25, ((elapsed - 900) / 2000) * 25);
      // если сервер не подключен — не даём уйти выше 88%
      if (!serverConnected) target = Math.min(target, 88);
      // если window не загружен — не даём выше 92%
      if (!windowLoaded) target = Math.min(target, 92);
      progress += (target - progress) * 0.12;
      paint();
      (window.requestAnimationFrame || function (f) { return setTimeout(f, 16); })(tick);
    })();

    // Стартуем пинг сразу
    setTimeout(pingServer, 200);

    // window.load
    function onWindowLoad() {
      windowLoaded = true;
      tryFinish();
    }
    if (document.readyState === 'complete') {
      windowLoaded = true;
      tryFinish();
    } else {
      window.addEventListener('load', function () { onWindowLoad(); }, { once: true });
      setTimeout(function () {
        if (!windowLoaded) {
          windowLoaded = true;
          tryFinish();
        }
      }, SAFETY_MS);
    }

    // Если через 15 сек сервер так и не ответил — продолжаем ретраи, но прогресс уже 88%
    setTimeout(function () {
      if (!serverConnected) {
        setServerStatus('Сервер долго просыпается... ⏳ подождите, мы его будим', 'pre-server-wake');
      }
    }, 15000);
  }

  boot();
})();
