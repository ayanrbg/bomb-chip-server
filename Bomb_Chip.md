# Bomb Chip — API документация

Полная документация по всем запросам клиент-сервер для разработки клиентской части игры.

---

## Оглавление

1. [HTTP API (авторизация)](#1-http-api-авторизация)
2. [WebSocket подключение](#2-websocket-подключение)
3. [Автоматические сообщения при подключении](#3-автоматические-сообщения-при-подключении)
4. [Арены (локации)](#4-арены-локации)
5. [Матчмейкинг](#5-матчмейкинг)
6. [Игровой процесс](#6-игровой-процесс)
7. [Реиграбельность (Rematch)](#7-реиграбельность-rematch)
8. [Магазин и кастомизация](#8-магазин-и-кастомизация)
9. [Друзья и инвайты](#9-друзья-и-инвайты)
10. [Реконнект](#10-реконнект)
11. [Ошибки](#11-ошибки)
12. [Полный игровой цикл — Публичная игра](#12-полный-игровой-цикл--публичная-игра)
13. [Полный игровой цикл — Игра с другом](#13-полный-игровой-цикл--игра-с-другом)
14. [Полный игровой цикл — Игра с ботом](#14-полный-игровой-цикл--игра-с-ботом)

---

## 1. HTTP API (авторизация)

Базовый URL: `http://<host>:3000`

### POST /register

Регистрация нового пользователя. Возвращает JWT токен.

**Запрос:**
```json
{
  "email": "player@example.com",
  "password": "mypassword",
  "nickname": "Player1"
}
```

**Валидация:**
- `email` — строка, содержит `@`, макс. 255 символов
- `password` — строка, 6-128 символов
- `nickname` — строка, 1-30 символов

**Успех (200):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Ошибки:**
| Код | Тело | Причина |
|-----|------|---------|
| 400 | `{"error": "Invalid email"}` | Некорректный email |
| 400 | `{"error": "Password must be 6-128 characters"}` | Неверная длина пароля |
| 400 | `{"error": "Nickname must be 1-30 characters"}` | Неверная длина никнейма |
| 400 | `{"error": "Email already exists"}` | Email уже зарегистрирован |
| 500 | `{"error": "Server error"}` | Внутренняя ошибка |

---

### POST /login

Вход по email и паролю. Возвращает JWT токен.

**Запрос:**
```json
{
  "email": "player@example.com",
  "password": "mypassword"
}
```

**Успех (200):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Ошибки:**
| Код | Тело | Причина |
|-----|------|---------|
| 400 | `{"error": "Email and password required"}` | Пустые поля |
| 401 | `{"error": "User not found"}` | Email не найден |
| 401 | `{"error": "Wrong password"}` | Неверный пароль |

---

### POST /firebase-login

Авторизация через Firebase. Если пользователь не существует — создаётся автоматически.

**Запрос:**
```json
{
  "idToken": "firebase_id_token_here"
}
```

**Успех (200):**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs..."
}
```

**Ошибки:**
| Код | Тело | Причина |
|-----|------|---------|
| 400 | `{"error": "Missing idToken"}` | Нет токена |
| 401 | `{"error": "Invalid Firebase token"}` | Невалидный токен |

---

## 2. WebSocket подключение

```
ws://<host>:3000?token=<JWT_TOKEN>
```

Токен передаётся как query-параметр. При невалидном или отсутствующем токене соединение закрывается.

**Формат всех WS-сообщений (JSON):**
```json
{
  "type": "имя_сообщения",
  "payload": { ... },
  ...
}
```

Клиент отправляет: `{ "type": "...", ... доп. поля }`
Сервер отвечает: `{ "type": "...", "payload": { ... } }`

> **Примечания к формату:**
> - `payload` — **опциональное** поле. Некоторые сообщения приходят без него (например, `searching_opponent`, `game_started`, `request_bombs`, `bombs_placed`, `bombs_phase_finished`). Клиент должен обрабатывать `payload` как необязательное.
> - Ошибки имеют **особый формат**: `{ "type": "error", "message": "..." }` — поле `message` в корне объекта, не внутри `payload`. Это intentional.
> - Поле `skin_index` в `user_customization` может приходить как **строка** (особенность pg-драйвера для `COUNT(*)`). Приводите к числу на клиенте.

---

## 3. Автоматические сообщения при подключении

Сразу после успешного WS-подключения сервер отправляет два сообщения:

### SERVER → authSuccess

```json
{
  "type": "authSuccess",
  "payload": {
    "userId": 1,
    "balance": 1000,
    "nickname": "Player1"
  }
}
```

### SERVER → user_customization

```json
{
  "type": "user_customization",
  "payload": {
    "model_code": "model_default_1",
    "item_model_code": "item_default_chip",
    "skin_id": 2,
    "skin_code": "default_skin2",
    "skin_index": "2",
    "effect_id": 5,
    "effect_code": "default_effect",
    "effect_index": "1",
    "animation_hit_id": 10,
    "animation_hit_code": "fire_strike",
    "animation_miss_id": 11,
    "animation_miss_code": "smoke_puff",
    "animation_win_id": 12,
    "animation_win_code": "victory_dance",
    "animation_lose_id": 13,
    "animation_lose_code": "sad_explosion"
  }
}
```

> 8 слотов кастомизации: модель персонажа, модель предмета на столе, скин, эффект, и 4 анимации (hit, miss, win, lose).
> `model_code` — код 3D-модели персонажа игрока (спавнится за столом).
> `item_model_code` — код 3D-модели предмета на столе (вместо стандартного чипа — тортик, яблоко, кристалл и т.д.).

---

## 4. Арены (локации)

### Концепция

Арена — это игровая локация с визуальной темой и допустимым диапазоном ставок. Игрок выбирает арену → нажимает Play → попадает в комнату с выбранной ставкой.

### Предустановленные арены

| id | code | name | min_bet | max_bet | Описание |
|----|------|------|---------|---------|----------|
| 1 | `backyard` | Задний двор | 0 | 1000 | Стартовая арена для новичков |
| 2 | `downtown` | Центр города | 1000 | 5000 | Средние ставки |
| 3 | `rooftop` | Крыша | 5000 | 25000 | Высокие ставки |
| 4 | `underground` | Подземелье | 25000 | 100000 | Хайроллеры |

> Арены хранятся в БД — можно добавлять/менять без деплоя кода.

### 4.1 Получить список арен

**CLIENT →**
```json
{ "type": "get_arenas" }
```

**SERVER → arenas_list**
```json
{
  "type": "arenas_list",
  "payload": [
    {
      "id": 1,
      "code": "backyard",
      "name": "Задний двор",
      "min_bet": 0,
      "max_bet": 1000,
      "players_in_queue": 3
    },
    {
      "id": 2,
      "code": "downtown",
      "name": "Центр города",
      "min_bet": 1000,
      "max_bet": 5000,
      "players_in_queue": 1
    }
  ]
}
```

> `players_in_queue` — количество игроков, ожидающих матч на этой арене (для UI индикации активности).

### 4.2 Реалтайм обновление очередей арен

При каждом изменении очереди сервер рассылает **всем свободным клиентам** (не в комнате) обновлённые счётчики:

**SERVER → arena_queue_update** (broadcast)
```json
{
  "type": "arena_queue_update",
  "payload": [
    { "arenaId": 1, "players_in_queue": 5 },
    { "arenaId": 2, "players_in_queue": 2 },
    { "arenaId": 3, "players_in_queue": 0 },
    { "arenaId": 4, "players_in_queue": 1 }
  ]
}
```

> Дебаунс: не чаще 1 раза в 2 секунды.

---

## 5. Матчмейкинг

### Концепция

Игрок нажимает **«Play»** → выбирает арену и ставку → создаётся персональная комната. В течение **5 секунд** (окно приглашений) можно сделать комнату приватной и пригласить друга. Если окно истекло без приглашения — комната переходит в публичный поиск. Сервер подбирает оппонента с **точно совпадающей ставкой** на той же арене. Если за 5 секунд в очереди никого нет — подключается **бот**.

**Ключевые принципы:**
- Нет владельца комнаты — оба игрока равны
- Игрок не может кикать другого, только выйти сам
- Если кто-то покинул комнату до старта — countdown обнуляется, комната снова открыта для поиска
- Бот играет как обычный игрок (ставит бомбы, делает ходы с задержками)

### 5.1 Play — начать игру

**CLIENT →**
```json
{
  "type": "play",
  "arenaId": 1,
  "bet": 50
}
```

| Поле | Тип | Обязательно | Описание |
|------|-----|-------------|----------|
| `arenaId` | integer | да | ID арены |
| `bet` | integer | да | Ставка (в диапазоне арены, >= 0) |

**Логика:**
1. Валидация арены, ставки, баланса
2. Ставка списывается с баланса
3. Создаётся комната
4. Запускается 5-секундное окно приглашений

**SERVER → room_created** (отправителю)
```json
{
  "type": "room_created",
  "payload": {
    "roomId": 42,
    "arenaId": 1,
    "bet": 50,
    "newBalance": 950
  }
}
```

**SERVER → invite_window_start** (отправителю)
```json
{
  "type": "invite_window_start",
  "payload": { "seconds": 5 }
}
```

> Ставка списывается сразу при нажатии Play (резервирование). Возвращается при отмене.

**Ошибки play:**
| Сообщение | Причина |
|-----------|---------|
| `"Arena not found"` | Арена не существует |
| `"Bet must be between X and Y"` | Ставка вне диапазона арены |
| `"Invalid bet amount"` | Не целое неотрицательное число |
| `"Not enough balance"` | Недостаточно средств |
| `"Already in a room"` | Уже в комнате |

---

### 5.2 Окно приглашений (5 секунд)

В течение 5 секунд после `invite_window_start` игрок может:

#### Сделать комнату приватной

**CLIENT →**
```json
{ "type": "make_private" }
```

**SERVER → room_updated** (отправителю)
```json
{
  "type": "room_updated",
  "payload": { "isPrivate": true }
}
```

> Приватная комната НЕ попадает в публичный поиск. После окна она переходит в `private_waiting` и ждёт приглашённого друга.

**Ошибки:**
- `"Not in a room"` — не в комнате
- `"Can only make private during invite window"` — окно уже закрылось

#### Пригласить друга

**CLIENT →**
```json
{
  "type": "invite_friend",
  "friendId": 8
}
```

| Поле | Тип | Описание |
|------|-----|----------|
| `friendId` | integer | ID друга из списка друзей |

**SERVER → invite_sent** (отправителю)
```json
{ "type": "invite_sent" }
```

**SERVER → game_invite_received** (приглашённому, если онлайн)
```json
{
  "type": "game_invite_received",
  "payload": {
    "roomId": 42,
    "from": "Player1",
    "fromId": 5,
    "bet": 50,
    "arenaId": 1
  }
}
```

**Ошибки:**
- `"Not in a room"` — не в комнате
- `"Cannot invite now"` — окно закрылось или комната уже в другом статусе
- `"Invalid friend"` — невалидный ID
- `"Not your friend"` — не в списке друзей

#### Друг принимает инвайт

**CLIENT →** (от приглашённого)
```json
{
  "type": "accept_invite",
  "roomId": 42
}
```

**Логика:**
1. Ставка списывается с баланса приглашённого
2. Приглашённому отправляется `balance_update` с `newBalance`
3. Приглашённый добавляется в комнату
4. Окно приглашений отменяется
5. Начинается countdown к старту

**SERVER → balance_update** (приглашённому)
```json
{
  "type": "balance_update",
  "payload": { "newBalance": 900 }
}
```

**SERVER → opponent_joined** (обоим игрокам, далее см. [5.5](#55-оппонент-найден))

**Ошибки:**
- `"Already in a room"` — уже в комнате
- `"Room not available"` — комната недоступна
- `"No invite for this room"` — нет инвайта
- `"Not enough balance"` — недостаточно средств

---

### 5.3 Окно закрылось

Через 5 секунд после `invite_window_start` сервер отправляет:

**SERVER → invite_window_end** (отправителю)

Публичная комната:
```json
{
  "type": "invite_window_end",
  "payload": { "status": "searching" }
}
```

Приватная комната:
```json
{
  "type": "invite_window_end",
  "payload": { "status": "private_waiting" }
}
```

Для публичной комнаты сразу после `invite_window_end` приходит:

**SERVER → searching_opponent** (отправителю)
```json
{ "type": "searching_opponent" }
```

> После этого сервер ищет оппонента с той же ставкой на той же арене. Если за 5 секунд оппонент не найден — подключается бот.

---

### 5.4 Отменить поиск / выйти до игры

**CLIENT →**
```json
{ "type": "cancel_play" }
```

**SERVER → play_cancelled**
```json
{
  "type": "play_cancelled",
  "payload": { "refunded": true, "newBalance": 1000 }
}
```

> Ставка возвращается. Работает на любом этапе до начала игры (invite_window, searching, private_waiting, countdown).

**Ошибки:**
- `"Not in a room"` — не в комнате
- `"No room state"` — нет состояния комнаты
- `"Game already started"` — игра уже идёт (используйте `leave_room`)

---

### 5.5 Оппонент найден

Когда оппонент (реальный или бот) подключается к комнате, оба игрока получают:

**SERVER → opponent_joined** (обоим)
```json
{
  "type": "opponent_joined",
  "payload": {
    "roomId": 42,
    "arenaId": 1,
    "arenaCode": "backyard",
    "bet": 50,
    "opponent": {
      "id": 8,
      "nickname": "Player2",
      "model_code": "model_premium_3",
      "item_model_code": "item_premium_2",
      "skin_code": "default_skin2",
      "effect_code": "default_effect"
    },
    "gridRows": 3,
    "gridCols": 5,
    "bombCount": 3
  }
}
```

> В `opponent_joined` сразу передаётся кастомизация оппонента (`model_code`, `item_model_code`, `skin_code`, `effect_code`), чтобы клиент мог загрузить ассеты до начала игры.
> `model_code` — модель персонажа оппонента. `item_model_code` — модель предметов оппонента на столе.
> `gridRows`, `gridCols` — размер игровой сетки для каждой стороны (например 3×5 = 15 клеток). Определяется сервером (может зависеть от арены).
> `bombCount` — количество бомб, которые каждый игрок должен расставить.

> Если оппонент — бот, его `id` будет отрицательным числом. Бот имеет рандомный никнейм, модель, предмет, скин и эффект.

Сразу после `opponent_joined` начинается [обратный отсчёт](#61-обратный-отсчёт).

---

### 5.6 Боты

Если через 5 секунд после начала публичного поиска оппонент не найден — подключается бот.

**Поведение бота:**
- Рандомный никнейм из пула (напр. `"CoolBot742"`, `"NeonWolf158"`)
- Рандомная модель из дефолтных: `"model_default_1"` или `"model_default_2"`
- Дефолтный предмет на столе: `"item_default_chip"`
- Рандомный скин из дефолтных
- Дефолтные эффекты и анимации
- Размещает бомбы с задержкой 2-4 секунды
- Делает ходы с задержкой 1-3 секунды на рандомную доступную клетку
- Играет по тем же правилам, что и обычный игрок

**Экономика бота:**
- Победа игрока над ботом: игрок получает `bet × 2` (дом оплачивает долю бота)
- Поражение игрока от бота: игрок теряет свою ставку (уже списана при нажатии Play)
- При дисконнекте во время игры с ботом — мгновенный проигрыш (без 30-секундного grace period)

---

### 5.7 Выйти из комнаты

**CLIENT →**
```json
{ "type": "leave_room" }
```

**SERVER → left_room** (отправителю)
```json
{
  "type": "left_room",
  "payload": { "newBalance": 1000 }
}
```

**Логика по статусам:**

| Статус | Поведение |
|--------|-----------|
| **invite_window / searching / private_waiting** | Ставка возвращается. Комната удаляется. |
| **matched (countdown)** | Ставка уходящему возвращается. Countdown отменяется. Оставшийся игрок получает `countdown_cancelled` и переходит обратно в поиск. Если оппонент был бот — комната удаляется. |
| **playing** | Противник автоматически побеждает и получает `bet × 2`. Противнику приходит `game_finished` с `reason: "opponent_left"`. Против бота — игрок проигрывает. |
| **rematch_countdown** | Ставка возвращается **обоим**. Countdown отменяется. Уходящий получает `left_room`. Оставшийся получает `rematch_cancelled` и отправляется в меню. Комната удаляется. |

**Ошибки:**
- `"You are not in a room"`

---

### 5.8 Информация о комнате

**CLIENT →**
```json
{ "type": "get_room_info" }
```

> Требует, чтобы клиент был в комнате.

**SERVER → room_info**
```json
{
  "type": "room_info",
  "payload": {
    "id": 42,
    "status": "searching",
    "bet": 50,
    "arenaId": 1,
    "gridRows": 3,
    "gridCols": 5,
    "bombCount": 3,
    "player1": {
      "id": 5,
      "nickname": "Player1",
      "model_code": "model_default_1",
      "item_model_code": "item_default_chip"
    },
    "player2": null
  }
}
```

С ботом:
```json
{
  "type": "room_info",
  "payload": {
    "id": 42,
    "status": "matched",
    "bet": 50,
    "arenaId": 1,
    "gridRows": 3,
    "gridCols": 5,
    "bombCount": 3,
    "player1": {
      "id": 5,
      "nickname": "Player1",
      "model_code": "model_default_1",
      "item_model_code": "item_default_chip"
    },
    "player2": {
      "id": -1,
      "nickname": "NeonWolf158",
      "model_code": "model_default_2",
      "item_model_code": "item_default_chip",
      "isBot": true
    }
  }
}
```

> `status` — одно из: `"invite_window"`, `"private_waiting"`, `"searching"`, `"matched"`, `"playing"`, `"rematch_countdown"`
> `player2` — `null` если в комнате один игрок. Поле `isBot: true` если оппонент — бот.
> Нет понятия «хост» — оба игрока равны.

**Ошибки:**
- `"You are not in a room"`

---

## 6. Игровой процесс

### Общая схема

```
play → room_created → invite_window_start → (5 сек) → invite_window_end
→ searching_opponent → opponent_joined → game_countdown → game_started
→ request_bombs → place_bombs (оба) → bombs_phase_finished
→ request_move / opponent_move → make_move → move_result → ... → game_finished
→ rematch_countdown_start → game_countdown (5 сек) → game_started → ... (новая игра)
```

### 6.1 Обратный отсчёт

Начинается автоматически когда оба игрока в комнате (`opponent_joined`). 5 секунд.

**SERVER → game_countdown** (broadcast, каждую секунду)
```json
{
  "type": "game_countdown",
  "payload": { "timeLeft": 5 }
}
```

> `timeLeft` уменьшается: 5, 4, 3, 2, 1, 0. При 0 — запускается игра.

**SERVER → countdown_cancelled** (если кто-то покинул комнату до старта)
```json
{
  "type": "countdown_cancelled",
  "payload": { "reason": "opponent_left" }
}
```

После `countdown_cancelled` оставшийся игрок переходит обратно в поиск и получает `searching_opponent`.

---

### 6.2 Старт игры

**SERVER → game_started** (broadcast)
```json
{ "type": "game_started" }
```

> Первый ход выбирается **случайно** — нет преимущества у какого-либо игрока.

---

### 6.3 Фаза установки бомб (20 секунд)

Сразу после `game_started` приходит:

**SERVER → request_bombs** (broadcast)
```json
{
  "type": "request_bombs",
  "payload": {
    "gridRows": 3,
    "gridCols": 5,
    "bombCount": 3,
    "timeLeft": 20
  }
}
```

> `gridRows`, `gridCols` — размер сетки (дублируется из `opponent_joined` для удобства). Общее число клеток = `gridRows × gridCols`.
> `bombCount` — количество бомб для расстановки.
> `timeLeft` — начальное время на фазу бомб (в секундах).

**SERVER → bombs_phase_update** (broadcast, каждые 2 секунды)
```json
{
  "type": "bombs_phase_update",
  "payload": { "timeLeft": 18 }
}
```

> Обратный отсчёт: 20, 18, 16, ..., 2, 0.

**CLIENT → place_bombs**
```json
{
  "type": "place_bombs",
  "bombs": [0, 5, 11]
}
```

| Поле | Тип | Описание |
|------|-----|----------|
| `bombs` | integer[] | Ровно `bombCount` уникальных чисел от 0 до `gridRows × gridCols - 1` |

**Валидация:**
- Массив из `bombCount` целых чисел (по умолчанию 3)
- Каждое число от 0 до `gridRows × gridCols - 1` включительно (по умолчанию 0-14)
- Все числа уникальны

**Ошибки:**
- `"Invalid bombs"` — невалидный формат
- `"Game already started"` — фаза уже закончилась
- `"Exactly N bombs required"` — неверное количество бомб
- `"Bombs must be unique"` — дубликаты
- `"Invalid cell index"` — число вне диапазона

**SERVER → bombs_accepted** (отправителю, сразу после успешной установки)
```json
{
  "type": "bombs_accepted",
  "payload": {
    "bombs": [0, 5, 11]
  }
}
```

> Приходит игроку сразу после того, как сервер принял его бомбы. Содержит массив установленных позиций. Позволяет клиенту подтвердить, что бомбы приняты, не дожидаясь второго игрока.

**SERVER → bombs_placed** (broadcast, когда ОБА расставили бомбы до таймера)
```json
{ "type": "bombs_placed" }
```

> Если оба игрока расставили бомбы до истечения таймера — таймер сбрасывается и игра начинается сразу, без ожидания оставшегося времени.

**SERVER → bombs_phase_finished** (broadcast, когда таймер истёк ИЛИ оба расставили)
```json
{ "type": "bombs_phase_finished" }
```

> Если игрок (или бот) не расставил все `bombCount` бомб за отведённое время — недостающие расставляются случайно сервером.

---

### 6.4 Фаза ходов (по 15 секунд на ход)

После `bombs_phase_finished` начинается пошаговая фаза. Первый ход выбран случайно при старте.

**SERVER → request_move** (игроку, чей ход)
```json
{
  "type": "request_move",
  "payload": {
    "lives": {
      "you": 3,
      "opponent": 3
    },
    "availableCells": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14],  // 0 .. gridRows*gridCols-1
    "timeLeft": 15
  }
}
```

**SERVER → opponent_move** (ожидающему игроку)
```json
{
  "type": "opponent_move",
  "payload": {
    "opponentId": 5,
    "lives": {
      "you": 3,
      "opponent": 3
    },
    "timeLeft": 15
  }
}
```

**SERVER → move_timer_update** (broadcast, каждые 2 секунды)
```json
{
  "type": "move_timer_update",
  "payload": {
    "timeLeft": 13,
    "currentTurn": 5
  }
}
```

> Обратный отсчёт: 15, 13, 11, ..., 1, 0.

---

### 6.5 Сделать ход

**CLIENT → make_move**
```json
{
  "type": "make_move",
  "cell": 3
}
```

| Поле | Тип | Описание |
|------|-----|----------|
| `cell` | integer | Номер клетки (0 .. gridRows×gridCols-1) на поле ПРОТИВНИКА |

**SERVER → move_result** (broadcast)

Попадание (bomb: true):
```json
{
  "type": "move_result",
  "payload": {
    "cell": 3,
    "bomb": true,
    "explodedPlayer": 8,
    "livesLeft": 2,
    "nextTurn": 8,
    "animations": [
      {
        "userId": 5,
        "role": "attacker",
        "event": "hit",
        "animation_code": "fire_strike",
        "effect_code": "explosion_red"
      },
      {
        "userId": 8,
        "role": "defender",
        "event": "damaged",
        "animation_code": "default_anim_lose",
        "effect_code": "default_effect"
      }
    ]
  }
}
```

Промах (bomb: false):
```json
{
  "type": "move_result",
  "payload": {
    "cell": 7,
    "bomb": false,
    "nextTurn": 8,
    "animations": [
      {
        "userId": 5,
        "role": "attacker",
        "event": "miss",
        "animation_code": "smoke_puff",
        "effect_code": "explosion_red"
      }
    ]
  }
}
```

> При промахе — только анимация атакующего. Защитник не затронут.

Победа (у противника 0 жизней):
```json
{
  "type": "move_result",
  "payload": {
    "cell": 9,
    "bomb": true,
    "explodedPlayer": 8,
    "livesLeft": 0,
    "winner": 5,
    "animations": [
      {
        "userId": 5,
        "role": "attacker",
        "event": "hit",
        "animation_code": "fire_strike",
        "effect_code": "explosion_red"
      },
      {
        "userId": 8,
        "role": "defender",
        "event": "damaged",
        "animation_code": "default_anim_lose",
        "effect_code": "default_effect"
      }
    ]
  }
}
```

**Поля `animations`:**

| Поле | Тип | Описание |
|------|-----|----------|
| `userId` | integer | ID игрока |
| `role` | string | `"attacker"`, `"defender"`, `"winner"`, `"loser"` |
| `event` | string | `"hit"`, `"miss"`, `"damaged"`, `"win"`, `"lose"` |
| `animation_code` | string | Код экипированной анимации игрока |
| `effect_code` | string | Код экипированного эффекта игрока |

**Откуда берутся коды анимаций:**
- **hit** → `animation_hit_code` атакующего
- **miss** → `animation_miss_code` атакующего
- **damaged** → `animation_lose_code` защитника (анимация получения урона)
- **win** → `animation_win_code` победителя
- **lose** → `animation_lose_code` проигравшего

**Ошибки:**
- `"Invalid cell"` — невалидная клетка
- `"Game not started"` — игра не идёт
- `"Not your turn"` — не ваш ход
- `"Cell already opened"` — клетка уже открыта

> Если игрок не делает ход за 15 секунд — ход делается автоматически на случайную доступную клетку.

---

### 6.6 Конец игры

**SERVER → game_finished** (broadcast)

Победа по очкам:
```json
{
  "type": "game_finished",
  "payload": {
    "winnerId": 5,
    "loserId": 8,
    "prize": 100,
    "arenaId": 1,
    "arenaCode": "backyard",
    "newBalance": 1100,
    "animations": [
      {
        "userId": 5,
        "role": "winner",
        "event": "win",
        "animation_code": "victory_dance",
        "effect_code": "explosion_red"
      },
      {
        "userId": 8,
        "role": "loser",
        "event": "lose",
        "animation_code": "sad_explosion",
        "effect_code": "default_effect"
      }
    ]
  }
}
```

> `newBalance` приходит **только победителю**. Проигравший не получает `newBalance` (его баланс не изменился — ставка уже была списана при `play`).

Победа по выходу противника:
```json
{
  "type": "game_finished",
  "payload": {
    "winnerId": 5,
    "loserId": 8,
    "prize": 100,
    "reason": "opponent_left",
    "arenaId": 1,
    "arenaCode": "backyard",
    "newBalance": 1100
  }
}
```

> `prize` = `bet × 2`. Выигрыш начисляется на баланс победителя автоматически. При `reason: "opponent_left"` анимации не отправляются.
> После `game_finished` автоматически запускается [Реиграбельность (Rematch)](#7-реиграбельность-rematch), если игра завершилась в обычном порядке (не по дисконнекту).

---

## 7. Реиграбельность (Rematch)

### Концепция

После завершения игры (`game_finished`) комната **не удаляется**. Вместо этого автоматически запускается обратный отсчёт рематча — аналогично `game_countdown` при первом старте. Оба игрока остаются в комнате и могут выйти во время countdown. Если оба остались — новая игра стартует автоматически с той же ставкой на той же арене.

**Ключевые принципы:**
- Рематч запускается автоматически после любого завершения игры (победа по очкам, включая игры с ботом)
- При завершении по дисконнекту — рематч **не** запускается (игрок уже отключён)
- При завершении по `leave_room` во время игры — рематч **не** запускается (игрок ушёл сам, `game_finished` с `reason: "opponent_left"`)
- Ставка списывается заново с обоих игроков перед countdown
- Если у кого-то не хватает баланса — оба отправляются в меню
- Во время countdown любой игрок может выйти (`leave_room`) — ставка возвращается **обоим**, оба в меню

### 7.1 Начало rematch countdown

Сразу после `game_finished` сервер проверяет балансы обоих игроков. Если хватает — списывает ставки и запускает countdown.

**SERVER → rematch_countdown_start** (обоим)
```json
{
  "type": "rematch_countdown_start",
  "payload": {
    "seconds": 5,
    "bet": 50,
    "newBalance": 950
  }
}
```

| Поле | Тип | Описание |
|------|-----|----------|
| `seconds` | integer | Длительность countdown (5 секунд) |
| `bet` | integer | Ставка (та же, что была в комнате) |
| `newBalance` | integer | Баланс после списания ставки |

> Ставка списывается **сразу** при старте rematch countdown (аналогично `play`). Возвращается при выходе.

Сразу после `rematch_countdown_start` начинается обратный отсчёт:

**SERVER → game_countdown** (broadcast, каждую секунду)
```json
{
  "type": "game_countdown",
  "payload": { "timeLeft": 5 }
}
```

> `timeLeft` уменьшается: 5, 4, 3, 2, 1, 0. При 0 — запускается новая игра (`game_started`).
> Используется тот же тип сообщения `game_countdown`, что и при первом старте — клиент может обрабатывать одинаково.

---

### 7.2 Рематч невозможен (не хватает баланса)

Если у одного или обоих игроков не хватает баланса на повторную ставку:

**SERVER → rematch_failed** (обоим)
```json
{
  "type": "rematch_failed",
  "payload": {
    "reason": "not_enough_balance",
    "balance": 30
  }
}
```

| Поле | Тип | Описание |
|------|-----|----------|
| `reason` | string | Причина (см. ниже) |
| `balance` | integer | Текущий баланс игрока |

**Значения `reason`:**

| reason | Описание |
|--------|----------|
| `"not_enough_balance"` | У вас не хватает баланса |
| `"opponent_not_enough_balance"` | У оппонента не хватает баланса |

> После `rematch_failed` оба игрока отправляются в меню. Комната удаляется. `roomId` очищается.

---

### 7.3 Выход во время rematch countdown

Любой игрок может выйти из комнаты во время rematch countdown через `leave_room`.

**CLIENT →**
```json
{ "type": "leave_room" }
```

**SERVER → left_room** (уходящему)
```json
{
  "type": "left_room",
  "payload": { "newBalance": 1000 }
}
```

**SERVER → rematch_cancelled** (оставшемуся)
```json
{
  "type": "rematch_cancelled",
  "payload": {
    "reason": "opponent_left",
    "newBalance": 1000
  }
}
```

> Ставка возвращается **обоим** игрокам. Оба отправляются в меню. Комната удаляется.
> `cancel_play` **не работает** во время rematch countdown — используйте `leave_room`.

---

### 7.4 Disconnect во время rematch countdown

При дисконнекте одного из игроков во время rematch countdown:
- Ставка возвращается обоим
- Оставшийся получает `rematch_cancelled` с `reason: "opponent_left"` и отправляется в меню
- Комната удаляется

> Поведение аналогично `leave_room` во время rematch countdown.

---

### 7.5 После countdown — новая игра

Если оба игрока остались в комнате до конца countdown (`timeLeft: 0`), автоматически запускается новая игра:

1. `game_started` — аналогично первому старту
2. `request_bombs` — новая фаза расстановки бомб
3. Далее — стандартный игровой процесс (фаза ходов, `move_result`, `game_finished`)
4. После следующего `game_finished` — снова rematch countdown

> Цикл повторяется бесконечно, пока оба игрока остаются в комнате и имеют достаточный баланс.

---

## 8. Магазин и кастомизация

### 8.1 Получить список предметов

**CLIENT →**
```json
{ "type": "get_shop_items" }
```

Опционально — фильтр по категории:
```json
{ "type": "get_shop_items", "category": "model" }
```

| Поле | Тип | Описание |
|------|-----|----------|
| `category` | string (опционально) | Фильтр: `"model"`, `"item_model"`, `"skin"`, `"effect"`, `"animation_hit"`, `"animation_miss"`, `"animation_win"`, `"animation_lose"`. Если не передан — все предметы. |

**SERVER → shop_items**
```json
{
  "type": "shop_items",
  "payload": [
    {
      "id": 13,
      "code": "model_default_1",
      "name": "Model #1",
      "type": "model",
      "price": 0,
      "currency": "coins",
      "owned": true,
      "active": true
    },
    {
      "id": 15,
      "code": "model_premium_3",
      "name": "Model #3",
      "type": "model",
      "price": 500,
      "currency": "coins",
      "owned": false,
      "active": false
    },
    {
      "id": 18,
      "code": "item_default_chip",
      "name": "Chip #1",
      "type": "item_model",
      "price": 0,
      "currency": "coins",
      "owned": true,
      "active": true
    }
  ]
}
```

### Каталог предметов

**Модели персонажа (type = `model`):**

| code | name | price | Примечание |
|------|------|-------|------------|
| `model_default_1` | Model #1 | 0 | Бесплатная (даётся при регистрации случайно) |
| `model_default_2` | Model #2 | 0 | Бесплатная (даётся при регистрации случайно) |
| `model_premium_3` | Model #3 | 500 | Покупается в магазине |
| `model_premium_4` | Model #4 | 800 | Покупается в магазине |
| `model_premium_5` | Model #5 | 1200 | Покупается в магазине |

**Предметы на столе (type = `item_model`):**

| code | name | price | Примечание |
|------|------|-------|------------|
| `item_default_chip` | Chip #1 | 0 | Бесплатная (дефолт) |
| `item_premium_2` | Chip #2 | 400 | Покупается в магазине |
| `item_premium_3` | Chip #3 | 700 | Покупается в магазине |

> При регистрации игрок получает случайную модель из двух бесплатных (`model_default_1` или `model_default_2`) и дефолтный предмет (`item_default_chip`). Остальные можно купить в магазине.

### Типы предметов

| type | Описание |
|------|----------|
| `model` | 3D-модель персонажа (спавнится за столом) |
| `item_model` | 3D-модель предмета на столе (тортик, яблоко, кристалл и т.д.) |
| `skin` | Скин персонажа |
| `effect` | Визуальный эффект |
| `animation_hit` | Анимация попадания |
| `animation_miss` | Анимация промаха |
| `animation_win` | Анимация победы |
| `animation_lose` | Анимация поражения |

| Поле | Тип | Описание |
|------|-----|----------|
| `type` | string | Один из 8 типов выше |
| `owned` | boolean | `true` если куплен или бесплатный |
| `active` | boolean | `true` если экипирован |

### Типы анимаций (по событиям)

Каждый тип анимации — это **отдельный предмет** в магазине, который игрок экипирует независимо.

| Тип в shop_items | Событие | Когда проигрывается | Кто видит |
|------------------|---------|---------------------|-----------|
| `animation_hit` | Попадание в бомбу | Атакующий попал в бомбу оппонента | Оба |
| `animation_miss` | Промах | Атакующий промахнулся | Оба |
| `animation_win` | Победа | Игра окончена, проигрывается победителю | Оба |
| `animation_lose` | Поражение | Игра окончена, проигрывается проигравшему | Оба |

---

### 8.2 Получить текущую кастомизацию (для меню)

**CLIENT →**
```json
{ "type": "get_my_customization" }
```

**SERVER → my_customization**
```json
{
  "type": "my_customization",
  "payload": {
    "model_id": 13,
    "model_code": "model_default_1",
    "model_name": "Model #1",
    "item_model_id": 18,
    "item_model_code": "item_default_chip",
    "item_model_name": "Chip #1",
    "skin_id": 2,
    "skin_code": "default_skin2",
    "effect_id": 5,
    "effect_code": "default_effect",
    "animation_hit_code": "default_anim",
    "animation_miss_code": "default_anim_miss",
    "animation_win_code": "default_anim_win",
    "animation_lose_code": "default_anim_lose"
  }
}
```

> Используйте для отрисовки персонажа в меню. Отличие от `user_customization` (при подключении): содержит `model_name`, `item_model_name` и `model_id`, `item_model_id` для удобства UI.

---

### 8.3 Купить предмет

**CLIENT →**
```json
{
  "type": "buy_item",
  "itemId": 6
}
```

**SERVER → purchase_success**
```json
{
  "type": "purchase_success",
  "payload": { "itemId": 6, "newBalance": 500 }
}
```

**Ошибки:**
- `"Item is free"` — бесплатный предмет
- `"Item already owned"` — уже куплен
- `"Not enough balance"` — недостаточно средств
- `"Purchase failed"` — внутренняя ошибка

---

### 8.4 Экипировать предмет

**CLIENT →**
```json
{
  "type": "equip_item",
  "itemId": 6
}
```

**SERVER → equip_success**
```json
{
  "type": "equip_success",
  "payload": { "itemId": 6 }
}
```

> Бесплатные предметы можно экипировать без покупки. Платные — только после покупки.
> Предмет экипируется в слот, соответствующий его типу (`model` → слот модели персонажа, `item_model` → слот предмета на столе, `skin` → слот скина, `animation_hit` → слот анимации попадания и т.д.).

**Ошибки:**
- `"Item not found"` — предмет не существует
- `"You do not own this item"` — не куплен
- `"Invalid item type"` — неизвестный тип

---

## 9. Друзья и инвайты

### 9.1 Список друзей

**CLIENT →**
```json
{ "type": "get_friends" }
```

**SERVER → friends_list**
```json
{
  "type": "friends_list",
  "payload": [
    { "id": 8, "nickname": "Player2" },
    { "id": 12, "nickname": "Player3" }
  ]
}
```

---

### 9.2 Отправить заявку в друзья

**CLIENT →**
```json
{
  "type": "send_friend_request",
  "userId": 8
}
```

**SERVER → friend_request_sent** (отправителю)
```json
{ "type": "friend_request_sent" }
```

**SERVER → friend_request_received** (получателю, если онлайн)
```json
{
  "type": "friend_request_received",
  "payload": {
    "id": 1,
    "requester_id": 5,
    "addressee_id": 8,
    "status": "pending",
    "created_at": "2026-03-10T12:00:00.000Z"
  }
}
```

**Ошибки:**
- `"Request already sent"` — заявка уже отправлена

> Нельзя отправить заявку самому себе (игнорируется без ошибки).

---

### 9.3 Принять заявку в друзья

**CLIENT →**
```json
{
  "type": "accept_friend_request",
  "requestId": 1
}
```

| Поле | Тип | Описание |
|------|-----|----------|
| `requestId` | integer | `id` из таблицы `friends` (приходит в `friend_request_received`) |

**SERVER → friend_added** (принявшему)
```json
{ "type": "friend_added" }
```

**SERVER → friend_request_accepted** (отправителю заявки, если онлайн)
```json
{ "type": "friend_request_accepted" }
```

---

## 10. Реконнект

При повторном подключении клиент может восстановить состояние:

**CLIENT →**
```json
{ "type": "reconnect" }
```

**SERVER → reconnect_ok** (не в комнате)
```json
{
  "type": "reconnect_ok",
  "payload": { "inRoom": false }
}
```

**SERVER → reconnect_ok** (в комнате)
```json
{
  "type": "reconnect_ok",
  "payload": {
    "inRoom": true,
    "roomId": 42,
    "status": "playing"
  }
}
```

> `status` — текущий статус комнаты: `"invite_window"`, `"private_waiting"`, `"searching"`, `"matched"`, `"playing"`, `"rematch_countdown"`.

Если игра активна, дополнительно приходит:

**SERVER → game_state_restore**
```json
{
  "type": "game_state_restore",
  "payload": {
    "phase": "playing",
    "turn": 5,
    "bombsTimeLeft": 0,
    "moveTimeLeft": 12,
    "gridRows": 3,
    "gridCols": 5,
    "bombCount": 3,
    "opponent": {
      "id": 8,
      "nickname": "Player2",
      "model_code": "model_premium_3",
      "item_model_code": "item_premium_2",
      "skin_code": "default_skin2",
      "effect_code": "default_effect"
    },
    "board": {
      "yourLives": 3,
      "opponentLives": 2,
      "yourBombs": [0, 5, 11],
      "yourAttacks": [
        { "cell": 3, "bomb": true },
        { "cell": 7, "bomb": false }
      ],
      "opponentAttacks": [
        { "cell": 0, "bomb": false },
        { "cell": 5, "bomb": true }
      ]
    }
  }
}
```

| Поле | Тип | Значения |
|------|-----|----------|
| `phase` | string | `"placing_bombs"`, `"playing"`, `"finished"` |
| `turn` | integer | userId текущего ходящего |
| `bombsTimeLeft` | integer | Оставшееся время фазы бомб |
| `moveTimeLeft` | integer | Оставшееся время на ход |
| `gridRows` | integer | Количество строк сетки |
| `gridCols` | integer | Количество столбцов сетки |
| `bombCount` | integer | Количество бомб на игрока |
| `opponent` | object | Данные оппонента (для восстановления моделей) |
| `board` | object | Полное состояние доски (см. ниже) |

**Поля `opponent`:**

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | integer | ID оппонента (отрицательный = бот) |
| `nickname` | string | Никнейм |
| `model_code` | string | Код модели персонажа |
| `item_model_code` | string | Код модели предмета на столе |
| `skin_code` | string | Код скина |
| `effect_code` | string | Код эффекта |

**Поля `board`:**

| Поле | Тип | Описание |
|------|-----|----------|
| `yourLives` | integer | Оставшиеся жизни игрока |
| `opponentLives` | integer | Оставшиеся жизни оппонента |
| `yourBombs` | integer[] | Позиции бомб игрока (0 .. gridRows×gridCols-1) |
| `yourAttacks` | array | Клетки, атакованные игроком на доске оппонента |
| `opponentAttacks` | array | Клетки, атакованные оппонентом на доске игрока |

> `yourAttacks[].cell` — индекс клетки, `yourAttacks[].bomb` — была ли там бомба.

После `game_state_restore` также приходит `request_move` или `opponent_move` с актуальным состоянием и `room_info`.

> **Тайм-аут дисконнекта:** 30 секунд для реальных оппонентов. При игре с ботом — мгновенный проигрыш при дисконнекте.

---

## 11. Ошибки

Все ошибки приходят в формате:
```json
{
  "type": "error",
  "message": "описание ошибки"
}
```

### Общие ошибки

| Сообщение | Когда |
|-----------|-------|
| `"Invalid JSON"` | Невалидный JSON в WS-сообщении |

### Прочее

**CLIENT → get_user_stats**
```json
{ "type": "get_user_stats" }
```

**SERVER → user_stats**
```json
{
  "type": "user_stats",
  "payload": {
    "id": 5,
    "email": "player@example.com",
    "nickname": "Player1",
    "created_at": "2026-03-01T10:00:00.000Z"
  }
}
```

---

## 12. Полный игровой цикл — Публичная игра

Пошаговая последовательность сообщений для одной полной партии:

```
КЛИЕНТ A                    СЕРВЕР                      КЛИЕНТ B
─────────                   ──────                      ─────────

1. ПОДКЛЮЧЕНИЕ
ws://host:3000?token=...    ──────────────────────>
                            <── authSuccess
                            <── user_customization

2. ВЫБОР АРЕНЫ
{type:"get_arenas"}         ──────────────────────>
                            <── arenas_list

3. НАЖАТИЕ PLAY
{type:"play",               ──────────────────────>
 arenaId:1, bet:50}
                            <── room_created {roomId:42}
                            <── invite_window_start {seconds:5}

4. ОКНО ПРИГЛАШЕНИЙ (5 сек) — игрок может пригласить друга или ничего не делать

5. ОКНО ЗАКРЫЛОСЬ
                            <── invite_window_end {status:"searching"}
                            <── searching_opponent

6. ПОИСК ОППОНЕНТА
                                                        {type:"play",
                            <───────────────────────     arenaId:1, bet:50}
                                                        <── room_created
                                                        <── invite_window_start
                                                        ... (5 сек) ...
                                                        <── invite_window_end
                                                        <── searching_opponent

7. МАТЧ НАЙДЕН (один игрок перемещается в комнату другого)
                            ──> opponent_joined (A) {opponent: B info}
                            ──> opponent_joined (B) {opponent: A info}

8. ОБРАТНЫЙ ОТСЧЁТ (5 сек, автоматически)
                            ──> game_countdown {timeLeft:5} (A+B)
                            ...
                            ──> game_countdown {timeLeft:0} (A+B)

9. СТАРТ
                            ──> game_started (A+B)
                            ──> request_bombs (A+B)

10. ФАЗА БОМБ (20 сек)
                            ──> bombs_phase_update {timeLeft:18} (A+B)

{type:"place_bombs",        ──────────────────────>
 bombs:[0,5,11]}
                            <── bombs_accepted {bombs:[0,5,11]} (A)

                            ──> bombs_phase_update {timeLeft:16} (A+B)

                                                        {type:"place_bombs",
                            <───────────────────────     bombs:[3,7,9]}
                            ──> bombs_accepted {bombs:[3,7,9]} (B)

                            ──> bombs_placed (A+B)          ← оба поставили, таймер сброшен
                            ──> bombs_phase_finished (A+B)

11. ФАЗА ХОДОВ (первый ход — случайный)
                            ──> request_move (A)
                            ──> opponent_move (B)
                            ──> move_timer_update {timeLeft:13} (A+B)

{type:"make_move",          ──────────────────────>
 cell:3}
                            ──> move_result {
                                  cell:3, bomb:true,
                                  explodedPlayer:8, livesLeft:2,
                                  nextTurn:8,
                                  animations: [...]
                                } (A+B)

                            ──> request_move (B)
                            ──> opponent_move (A)

                                                        {type:"make_move",
                            <───────────────────────     cell:0}
                            ──> move_result {
                                  cell:0, bomb:false,
                                  nextTurn:5,
                                  animations: [...]
                                } (A+B)

... (ходы продолжаются) ...

12. КОНЕЦ ИГРЫ
{type:"make_move",          ──────────────────────>
 cell:9}
                            ──> move_result {
                                  cell:9, bomb:true,
                                  explodedPlayer:8, livesLeft:0,
                                  winner:5,
                                  animations: [...]
                                } (A+B)
                            ──> game_finished {
                                  winnerId:5, loserId:8, prize:100,
                                  arenaId:1, arenaCode:"backyard",
                                  animations: [...]
                                } (A+B)

13. REMATCH COUNTDOWN (автоматически после game_finished)
                            ──> rematch_countdown_start {
                                  seconds:5, bet:50, newBalance:...
                                } (A+B)
                            ──> game_countdown {timeLeft:5} (A+B)
                            ...
                            ──> game_countdown {timeLeft:0} (A+B)

14. НОВАЯ ИГРА (если оба остались)
                            ──> game_started (A+B)
                            ──> request_bombs (A+B)
                            ... (повторяется с шага 10) ...

    ИЛИ: ВЫХОД ВО ВРЕМЯ COUNTDOWN
{type:"leave_room"}         ──────────────────────>
                            <── left_room {newBalance:1000}
                            ──> rematch_cancelled (B) {
                                  reason:"opponent_left",
                                  newBalance:1000
                                }

    ИЛИ: НЕ ХВАТАЕТ БАЛАНСА
                            ──> rematch_failed {
                                  reason:"not_enough_balance",
                                  balance:30
                                } (A и/или B)
```

---

## 13. Полный игровой цикл — Игра с другом

Пошаговая последовательность для приватной игры с приглашением друга:

```
КЛИЕНТ A                    СЕРВЕР                      КЛИЕНТ B
─────────                   ──────                      ─────────

1. ПОДКЛЮЧЕНИЕ
ws://host:3000?token=...    ──────────────────────>
                            <── authSuccess
                            <── user_customization

2. НАЖАТИЕ PLAY
{type:"play",               ──────────────────────>
 arenaId:1, bet:100}
                            <── room_created {roomId:42}
                            <── invite_window_start {seconds:5}

3. ДЕЛАЕМ КОМНАТУ ПРИВАТНОЙ
{type:"make_private"}       ──────────────────────>
                            <── room_updated {isPrivate:true}

4. ПРИГЛАШАЕМ ДРУГА
{type:"invite_friend",      ──────────────────────>
 friendId:8}
                            <── invite_sent
                            ──> game_invite_received (B) {roomId:42, bet:100}

5. ДРУГ ПРИНИМАЕТ ИНВАЙТ
                                                        {type:"accept_invite",
                            <───────────────────────     roomId:42}
                            ──> opponent_joined (A) {opponent: B info}
                            ──> opponent_joined (B) {opponent: A info}

6. ОБРАТНЫЙ ОТСЧЁТ (5 сек)
                            ──> game_countdown {timeLeft:5} (A+B)
                            ...
                            ──> game_countdown {timeLeft:0} (A+B)

7. СТАРТ + БОМБЫ + ХОДЫ — аналогично публичной игре (раздел 12)

8. КОНЕЦ ИГРЫ
                            ──> game_finished {
                                  winnerId:5, loserId:8, prize:200,
                                  arenaId:1, arenaCode:"backyard",
                                  animations: [...]
                                } (A+B)

9. REMATCH — аналогично публичной игре (раздел 12, шаги 13-14)
```

---

## 14. Полный игровой цикл — Игра с ботом

Если оппонент не найден — подключается бот через 5 секунд:

```
КЛИЕНТ A                    СЕРВЕР
─────────                   ──────

1. НАЖАТИЕ PLAY
{type:"play",               ──────────────────────>
 arenaId:1, bet:50}
                            <── room_created {roomId:42}
                            <── invite_window_start {seconds:5}

2. ОКНО ЗАКРЫЛОСЬ
                            <── invite_window_end {status:"searching"}
                            <── searching_opponent

3. 5 СЕКУНД ПОИСКА — НИКОГО НЕТ → БОТ

                            <── opponent_joined {
                                  opponent: {
                                    id: -1,
                                    nickname: "NeonWolf158",
                                    model_code: "model_default_2",
                                    item_model_code: "item_default_chip",
                                    skin_code: "default_skin2",
                                    effect_code: "default_effect"
                                  },
                                  gridRows: 3, gridCols: 4, bombCount: 3
                                }

4. ОБРАТНЫЙ ОТСЧЁТ
                            <── game_countdown {timeLeft:5}
                            ...
                            <── game_countdown {timeLeft:0}

5. СТАРТ
                            <── game_started
                            <── request_bombs

6. БОМБЫ — бот расставляет с задержкой 2-4 сек
{type:"place_bombs",        ──────────────────────>
 bombs:[0,5,11]}
                            <── bombs_accepted {bombs:[0,5,11]}
                            ... (бот ставит бомбы) ...
                            <── bombs_placed              ← оба поставили, таймер сброшен
                            <── bombs_phase_finished

7. ХОДЫ — бот ходит с задержкой 1-3 сек
                            <── request_move (A)
{type:"make_move",          ──────────────────────>
 cell:3}
                            <── move_result {...}

                            ... (бот делает ход с задержкой) ...
                            <── move_result {...} (ход бота)

... (ходы продолжаются) ...

8. КОНЕЦ ИГРЫ
                            <── game_finished {
                                  winnerId:5, loserId:-1, prize:100,
                                  arenaId:1, arenaCode:"backyard",
                                  animations: [...]
                                }

9. REMATCH COUNTDOWN (автоматически)
                            <── rematch_countdown_start {
                                  seconds:5, bet:50, newBalance:...
                                }
                            <── game_countdown {timeLeft:5}
                            ...
                            <── game_countdown {timeLeft:0}

10. НОВАЯ ИГРА (если игрок остался и хватает баланса)
                            <── game_started
                            <── request_bombs
                            ... (повторяется с шага 5) ...

    ИЛИ: ВЫХОД ВО ВРЕМЯ COUNTDOWN
{type:"leave_room"}         ──────────────────────>
                            <── left_room {newBalance:1000}
```

---

## Справочная таблица всех сообщений

### Клиент → Сервер

| type | Параметры | Описание |
|------|-----------|----------|
| `get_user_stats` | — | Запрос профиля |
| `get_arenas` | — | Список арен |
| `play` | `arenaId`, `bet` | Начать игру (создать комнату + окно приглашений) |
| `make_private` | — | Сделать комнату приватной (во время invite window) |
| `invite_friend` | `friendId` | Пригласить друга в комнату |
| `accept_invite` | `roomId` | Принять инвайт в комнату |
| `cancel_play` | — | Отменить поиск / выйти до игры |
| `leave_room` | — | Выйти из комнаты |
| `get_room_info` | — | Запросить инфо о текущей комнате |
| `place_bombs` | `bombs` (int[bombCount]) | Расставить бомбы (кол-во из request_bombs) |
| `make_move` | `cell` (int 0..gridRows×gridCols-1) | Сделать ход |
| `get_shop_items` | `category` (опционально) | Список предметов магазина (фильтр по категории) |
| `get_my_customization` | — | Текущая кастомизация игрока (для меню) |
| `buy_item` | `itemId` | Купить предмет |
| `equip_item` | `itemId` | Экипировать предмет |
| `get_friends` | — | Список друзей |
| `send_friend_request` | `userId` | Отправить заявку в друзья |
| `accept_friend_request` | `requestId` | Принять заявку |
| `reconnect` | — | Восстановить состояние |

### Сервер → Клиент

| type | Кому | Когда |
|------|------|-------|
| `authSuccess` | отправителю | при подключении |
| `user_customization` | отправителю | при подключении (8 слотов: model, item_model, skin, effect, 4 анимации) |
| `user_stats` | отправителю | по запросу |
| `arenas_list` | отправителю | по запросу |
| `arena_queue_update` | broadcast (свободные) | изменение очереди на арене |
| `room_created` | отправителю | комната создана при нажатии Play |
| `invite_window_start` | отправителю | начало 5-сек окна приглашений |
| `invite_window_end` | отправителю | окно приглашений закрылось |
| `room_updated` | отправителю | комната обновлена (напр. стала приватной) |
| `invite_sent` | отправителю | инвайт другу отправлен |
| `searching_opponent` | отправителю | начат публичный поиск оппонента |
| `opponent_joined` | обоим | оппонент подключился (с model_code, item_model_code, gridRows, gridCols, bombCount) |
| `balance_update` | отправителю | баланс обновлён (при accept_invite) |
| `play_cancelled` | отправителю | поиск отменён, ставка возвращена (с newBalance) |
| `room_info` | broadcast (комната) | при запросе get_room_info |
| `game_countdown` | broadcast (комната) | обратный отсчёт (5 сек) |
| `countdown_cancelled` | broadcast (комната) | отсчёт отменён (оппонент ушёл) |
| `game_started` | broadcast (комната) | игра началась |
| `request_bombs` | broadcast (комната) | запрос на расстановку бомб (с gridRows, gridCols, bombCount, timeLeft) |
| `bombs_phase_update` | broadcast (комната) | таймер фазы бомб |
| `bombs_accepted` | отправителю | бомбы приняты сервером (с массивом bombs) |
| `bombs_placed` | broadcast (комната) | оба расставили бомбы, таймер сброшен |
| `bombs_phase_finished` | broadcast (комната) | фаза бомб окончена |
| `request_move` | ходящему | запрос хода |
| `opponent_move` | ожидающему | оппонент ходит |
| `move_timer_update` | broadcast (комната) | таймер хода |
| `move_result` | broadcast (комната) | результат хода (с анимациями) |
| `game_finished` | broadcast (комната) | игра окончена (с анимациями) |
| `rematch_countdown_start` | broadcast (комната) | начало countdown рематча (с seconds, bet, newBalance) |
| `rematch_failed` | broadcast (комната) | рематч невозможен — не хватает баланса (с reason, balance) |
| `rematch_cancelled` | оставшемуся | оппонент вышел во время rematch countdown (с reason, newBalance) |
| `left_room` | отправителю | вышел из комнаты (с newBalance) |
| `shop_items` | отправителю | список предметов (8 типов: model, item_model, skin, effect, 4 анимации) |
| `my_customization` | отправителю | текущая кастомизация (model_code, item_model_code, model_name, item_model_name и др.) |
| `purchase_success` | отправителю | покупка успешна (с newBalance) |
| `equip_success` | отправителю | экипировка успешна |
| `friends_list` | отправителю | список друзей |
| `friend_request_sent` | отправителю | заявка отправлена |
| `friend_request_received` | получателю | входящая заявка |
| `friend_added` | принявшему | друг добавлен |
| `friend_request_accepted` | отправителю заявки | заявка принята |
| `game_invite_received` | приглашённому | приглашение в комнату |
| `reconnect_ok` | отправителю | результат реконнекта |
| `game_state_restore` | отправителю | восстановление состояния игры (с grid, opponent, board) |
| `error` | отправителю | ошибка |
