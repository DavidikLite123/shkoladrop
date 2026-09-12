# 🛠 Коды админки и секреты сервера

> 🔴 **САМЫЙ ЧУВСТВИТЕЛЬНЫЙ ФАЙЛ.** Здесь коды, дающие полный доступ к админ-панели
> игры и к серверу сообщества. Скачай и удали этот файл из репозитория
> (`git rm codes/admin-codes.md`), а коды — смени (раз они побывали в публичном доступе).

## 1. Коды входа в админ-панель

В проекте они хранятся **только хешами** (`js/config.js`):
`OWNER_CODE_HASH = 2088291795` · `ADMIN_CODE_HASH = 2088507411` (djb2, функция `betaCodeHash`).
Значения ниже подобраны перебором и проверены.

| Роль | Хеш djb2 | **Код** | Что открывает |
|------|----------|---------|----------------|
| 👑 Владелец (owner) | `2088291795` | **`1337`** | все функции: rig, money, cat, maxlevel, players, detail, dm, verify, ban, role, status, delete, chat, server, authorcodes, online, emails |
| 🛡 Администрация (admin) | `2088507411` | **`7331`** | money, players, detail, dm, ban, chat, online |

### Как вводить

1. **Через поле промокода:** `ADMIN1337` (владелец) или `ADMIN7331` (администрация).
   Игра срезает префикс `ADMIN` и сверяет хеш остатка (`js/game.js` → `redeemPromo`).
2. **Или 5 кликов по логотипу** → окно ввода кода → `1337` / `7331`.
3. Перед кодом можно дописать любой из префиксов `SHKOLA`, `ADMIN`, `OWNER`, `STAFF`, `КОТ`
   — они отрезаются: `OWNER1337`, `SHKOLA7331`, `KOT1337` и т.п. работают так же.

## 2. Секреты сервера

Они же — `ADMIN_SECRET` / `STAFF_SECRET` в `server/index.js` (строки 35–36, дефолты).
Передаются в заголовке `x-admin-secret`.

| Назначение | Секрет |
|-----------|--------|
| Владелец (owner), `OWNER_SERVER_SECRET` / `ADMIN_SECRET` | `david-admin-1337` |
| Администрация (admin), `ADMIN_SERVER_SECRET` / `STAFF_SECRET` | `david-staff-7331` |

⚠️ Эти значения уже лежат в открытом коде в публичном репозитории — **смени их**.

### Как сменить

1. Придумай новые значения, например:
   ```bash
   node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
   ```
2. На сервере (Render → Environment, или локально):
   ```bash
   ADMIN_SECRET=<новый> STAFF_SECRET=<новый> node server/index.js
   ```
3. В клиенте замени обе константы в `js/config.js` (строки ~604–605):
   ```js
   const OWNER_SERVER_SECRET = '<новый>';
   const ADMIN_SERVER_SECRET = '<новый>';
   ```
   Менять нужно **одновременно** в двух местах — иначе админка перестанет пускать.

### Как сменить код админки

Посчитай djb2-хеш нового кода и подставь в `js/config.js`:

```bash
node -e "const s=process.argv[1];let h=5381;for(const c of s)h=((h<<5)+h+c.charCodeAt(0))>>>0;console.log(s,'->',h)" НОВЫЙКОД
```

`OWNER_CODE_HASH` / `ADMIN_CODE_HASH` — строки 601–602.
