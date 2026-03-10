# Bomb Chip — API документация

Полная документация по всем запросам клиент-сервер для разработки клиентской части игры.

---

## Оглавление

1. [HTTP API (авторизация)](#1-http-api-авторизация)
2. [WebSocket подключение](#2-websocket-подключение)
3. [Автоматические сообщения при подключении](#3-автоматические-сообщения-при-подключении)
4. [Комнаты](#4-комнаты)
5. [Игровой процесс](#5-игровой-процесс)
6. [Магазин и кастомизация](#6-магазин-и-кастомизация)
7. [Друзья и инвайты](#7-друзья-и-инвайты)
8. [Реконнект](#8-реконнект)
9. [Ошибки](#9-ошибки)
10. [Полный игровой цикл (пошагово)](#10-полный-игровой-цикл)

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
    "skin_id": 2,
    "animation_id": 4,
    "effect_id": 5,
    "skin_code": "default_skin2",
    "animation_code": "default_anim",
    "effect_code": "default_effect",
    "skin_index": "2",
    "animation_index": "1",
    "effect_index": "1"
  }
}
```

---

## 4. Комнаты

### 4.1 Получить список комнат

**CLIENT →**
```json
{ "type": "get_rooms_list" }
```

**SERVER → rooms_list**
```json
{
  "type": "rooms_list",
  "payload": [
    {
      "id": 1,
      "bet": 100,
      "status": "waiting",
      "host_id": 5,
      "host_nickname": "Player1"
    }
  ]
}
```

> Возвращает только открытые комнаты (status=waiting, без гостя).

---

### 4.2 Создать комнату

**CLIENT →**
```json
{
  "type": "create_room",
  "bet": 100,
  "password": "secret"
}
```

| Поле | Тип | Обязательно | Описание |
|------|-----|-------------|----------|
| `bet` | integer | да | Ставка (> 0, целое число) |
| `password` | string | нет | Пароль для приватной комнаты |

**SERVER → room_created**
```json
{
  "type": "room_created",
  "payload": {
    "id": 1,
    "host_id": 5,
    "bet": 100,
    "status": "waiting",
    "host_ready": false,
    "guest_ready": false,
    "created_at": "2026-03-10T12:00:00.000Z"
  }
}
```

Далее автоматически приходит [room_info](#45-информация-о-комнате-broadcast) всем в комнате.

**Возможные ошибки:**
- `"You are already in a room"` — уже в комнате
- `"Invalid bet amount"` — ставка не целое положительное число
- `"Not enough balance"` — недостаточно средств

---

### 4.3 Войти в комнату

**CLIENT →**
```json
{
  "type": "join_room",
  "roomId": 1,
  "password": "secret"
}
```

| Поле | Тип | Обязательно | Описание |
|------|-----|-------------|----------|
| `roomId` | integer | да | ID комнаты |
| `password` | string | нет | Пароль (если комната приватная) |

**SERVER → room_joined** (отправителю)
```json
{
  "type": "room_joined",
  "payload": { "roomId": 1 }
}
```

**SERVER → play_request** (broadcast обоим игрокам)
```json
{ "type": "play_request" }
```

Далее автоматически приходит [room_info](#45-информация-о-комнате-broadcast) всем в комнате.

**Возможные ошибки:**
- `"You are already in a room"` — уже в комнате
- `"Room not found"` — комната не найдена
- `"Room requires password"` — нужен пароль
- `"Wrong password"` — неверный пароль
- `"You are already in this room"` — уже в этой комнате
- `"Not enough balance"` — недостаточно средств
- `"Room is full"` — комната занята

---

### 4.4 Запросить информацию о комнате

**CLIENT →**
```json
{ "type": "get_room_info" }
```

> Требует, чтобы клиент был в комнате (`ws.roomId` установлен).

**SERVER → room_info** (только отправителю)
```json
{
  "type": "room_info",
  "payload": {
    "id": 1,
    "status": "waiting",
    "bet": 100,
    "host": {
      "id": 5,
      "nickname": "Player1",
      "ready": false
    },
    "guest": {
      "id": 8,
      "nickname": "Player2",
      "ready": true
    }
  }
}
```

> `guest` будет `null`, если в комнате один игрок.

---

### 4.5 Информация о комнате (broadcast)

Сервер автоматически рассылает `room_info` всем игрокам в комнате при любом изменении состояния (вход, выход, ready, кик и т.д.).

**SERVER → room_info**
```json
{
  "type": "room_info",
  "payload": {
    "id": 1,
    "status": "waiting",
    "bet": 100,
    "isPrivate": true,
    "host": {
      "id": 5,
      "nickname": "Player1",
      "ready": false
    },
    "guest": null
  }
}
```

---

### 4.6 Готовность (ready)

**CLIENT →**
```json
{
  "type": "player_ready",
  "ready": true
}
```

| Поле | Тип | Описание |
|------|-----|----------|
| `ready` | boolean | `true` — готов, `false` — не готов |

**Результат:** обновлённый `room_info` broadcast. Если оба готовы — запускается [обратный отсчёт](#51-обратный-отсчёт).

---

### 4.7 Выйти из комнаты

**CLIENT →**
```json
{ "type": "leave_room" }
```

**SERVER → left_room** (отправителю)
```json
{ "type": "left_room" }
```

**Логика:**
- **Комната в ожидании (waiting):** ставка возвращается. Если хост уходит и есть гость — гость становится хостом.
- **Игра идёт (playing):** противник автоматически побеждает и получает `bet × 2`. Противнику приходит `game_finished` с `reason: "opponent_left"`.

**Ошибки:**
- `"You are not in a room"`

---

### 4.8 Кикнуть игрока

Только хост может кикнуть гостя. Только до начала игры.

**CLIENT →**
```json
{
  "type": "kick_player",
  "playerId": 8
}
```

**SERVER → kicked_from_room** (кикнутому игроку)
```json
{ "type": "kicked_from_room" }
```

Кикнутому возвращается ставка. Всем в комнате приходит обновлённый `room_info`.

**Ошибки:**
- `"Only host can kick"`
- `"Invalid target"`
- `"Cannot kick during game"`

---

## 5. Игровой процесс

### Общая схема

```
player_ready (оба) → game_countdown → game_started → request_bombs
→ place_bombs (оба) → bombs_phase_finished → request_move / opponent_move
→ make_move → move_result → ... → game_finished
```

### 5.1 Обратный отсчёт

Когда оба игрока нажали ready, начинается 5-секундный countdown.

**SERVER → game_countdown** (broadcast, каждую секунду)
```json
{
  "type": "game_countdown",
  "payload": { "timeLeft": 5 }
}
```

> `timeLeft` уменьшается: 5, 4, 3, 2, 1, 0. При 0 — запускается игра.

**SERVER → countdown_cancelled** (если кто-то снял ready или вышел)
```json
{ "type": "countdown_cancelled" }
```

---

### 5.2 Старт игры

**SERVER → game_started** (broadcast)
```json
{ "type": "game_started" }
```

---

### 5.3 Фаза установки бомб (20 секунд)

Сразу после `game_started` приходит:

**SERVER → request_bombs** (broadcast)
```json
{ "type": "request_bombs" }
```

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
| `bombs` | integer[] | Ровно 3 уникальных числа от 0 до 11 |

**Валидация:**
- Массив из 3 целых чисел
- Каждое число от 0 до 11 включительно
- Все числа уникальны

**Ошибки:**
- `"Invalid bombs: must be 3 integers 0-11"` — невалидный формат
- `"Game already started"` — фаза уже закончилась
- `"Exactly 3 bombs required"` — не 3 бомбы
- `"Bombs must be unique"` — дубликаты
- `"Invalid cell index"` — число вне диапазона

**SERVER → bombs_placed** (broadcast, когда ОБА расставили бомбы до таймера)
```json
{ "type": "bombs_placed" }
```

**SERVER → bombs_phase_finished** (broadcast, когда таймер истёк ИЛИ оба расставили)
```json
{ "type": "bombs_phase_finished" }
```

> Если игрок не расставил все 3 бомбы за 20 секунд — недостающие расставляются случайно.

---

### 5.4 Фаза ходов (по 15 секунд на ход)

После `bombs_phase_finished` начинается пошаговая фаза. Первым ходит хост.

**SERVER → request_move** (игроку, чей ход)
```json
{
  "type": "request_move",
  "payload": {
    "lives": {
      "you": 3,
      "opponent": 3
    },
    "availableCells": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
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

### 5.5 Сделать ход

**CLIENT → make_move**
```json
{
  "type": "make_move",
  "cell": 3
}
```

| Поле | Тип | Описание |
|------|-----|----------|
| `cell` | integer | Номер клетки (0-11) на поле ПРОТИВНИКА |

**SERVER → move_result** (broadcast)

Промах:
```json
{
  "type": "move_result",
  "payload": {
    "bomb": false,
    "nextTurn": 8
  }
}
```

Попадание:
```json
{
  "type": "move_result",
  "payload": {
    "bomb": true,
    "explodedPlayer": 8,
    "livesLeft": 2,
    "nextTurn": 8
  }
}
```

Победа (у противника 0 жизней):
```json
{
  "type": "move_result",
  "payload": {
    "bomb": true,
    "explodedPlayer": 8,
    "livesLeft": 0,
    "winner": 5
  }
}
```

**Ошибки:**
- `"Invalid cell"` — невалидная клетка
- `"Game not started"` — игра не идёт
- `"Not your turn"` — не ваш ход
- `"Cell already opened"` — клетка уже открыта

> Если игрок не делает ход за 15 секунд — ход делается автоматически на случайную доступную клетку.

---

### 5.6 Конец игры

**SERVER → game_finished** (broadcast)

Победа по очкам:
```json
{
  "type": "game_finished",
  "payload": {
    "winnerId": 5,
    "prize": 200
  }
}
```

Победа по выходу противника:
```json
{
  "type": "game_finished",
  "payload": {
    "winnerId": 5,
    "reason": "opponent_left"
  }
}
```

> `prize` = `bet × 2`. Выигрыш начисляется на баланс победителя автоматически.

---

## 6. Магазин и кастомизация

### 6.1 Получить список предметов

**CLIENT →**
```json
{ "type": "get_shop_items" }
```

**SERVER → shop_items**
```json
{
  "type": "shop_items",
  "payload": [
    {
      "id": 1,
      "code": "default_skin1",
      "name": "Default Skin 1",
      "type": "skin",
      "price": 0,
      "currency": "coins",
      "owned": true,
      "active": true
    },
    {
      "id": 6,
      "code": "gold_skin",
      "name": "Gold Skin",
      "type": "skin",
      "price": 500,
      "currency": "coins",
      "owned": false,
      "active": false
    }
  ]
}
```

| Поле | Тип | Описание |
|------|-----|----------|
| `type` | string | `"skin"`, `"animation"` или `"effect"` |
| `owned` | boolean | `true` если куплен или бесплатный |
| `active` | boolean | `true` если экипирован |

---

### 6.2 Купить предмет

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
  "payload": { "itemId": 6 }
}
```

**Ошибки:**
- `"Item is free"` — бесплатный предмет
- `"Item already owned"` — уже куплен
- `"Not enough balance"` — недостаточно средств
- `"Purchase failed"` — внутренняя ошибка

---

### 6.3 Экипировать предмет

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

**Ошибки:**
- `"Item not found"` — предмет не существует
- `"You do not own this item"` — не куплен
- `"Invalid item type"` — неизвестный тип

---

## 7. Друзья и инвайты

### 7.1 Список друзей

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

### 7.2 Отправить заявку в друзья

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

### 7.3 Принять заявку в друзья

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

### 7.4 Пригласить друга в комнату

Отправитель должен быть в комнате.

**CLIENT →**
```json
{
  "type": "invite_to_room",
  "friendId": 8
}
```

**SERVER → game_invite_received** (приглашённому, если онлайн)
```json
{
  "type": "game_invite_received",
  "payload": {
    "roomId": 1,
    "from": "Player1"
  }
}
```

> Приглашённый может войти в комнату через обычный `join_room` с полученным `roomId`.

---

## 8. Реконнект

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
    "roomId": 1
  }
}
```

Если игра активна, дополнительно приходит:

**SERVER → game_state_restore**
```json
{
  "type": "game_state_restore",
  "payload": {
    "phase": "playing",
    "turn": 5,
    "bombsTimeLeft": 0,
    "moveTimeLeft": 12
  }
}
```

| Поле | Тип | Значения |
|------|-----|----------|
| `phase` | string | `"placing_bombs"`, `"playing"`, `"finished"` |
| `turn` | integer | userId текущего ходящего |
| `bombsTimeLeft` | integer | Оставшееся время фазы бомб |
| `moveTimeLeft` | integer | Оставшееся время на ход |

После `game_state_restore` также приходит `request_move` или `opponent_move` с актуальным состоянием.

Далее также приходит `room_info` с текущим состоянием комнаты.

> **Тайм-аут дисконнекта:** 30 секунд. Если игрок не реконнектится за 30 секунд во время активной игры — противник автоматически побеждает.

---

## 9. Ошибки

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

## 10. Полный игровой цикл

Пошаговая последовательность сообщений для одной полной партии:

```
КЛИЕНТ A                    СЕРВЕР                      КЛИЕНТ B
─────────                   ──────                      ─────────

1. ПОДКЛЮЧЕНИЕ
ws://host:3000?token=...    ──────────────────────>
                            <── authSuccess
                            <── user_customization

2. СОЗДАНИЕ КОМНАТЫ
{type:"create_room",        ──────────────────────>
 bet:100}
                            <── room_created
                            <── room_info

3. ВХОД В КОМНАТУ
                                                        {type:"join_room",
                            <───────────────────────     roomId:1}
                            ──> room_joined (B)
                            ──> play_request (A+B)
                            ──> room_info (A+B)

4. ГОТОВНОСТЬ
{type:"player_ready",       ──────────────────────>
 ready:true}
                            ──> room_info (A+B)

                                                        {type:"player_ready",
                            <───────────────────────     ready:true}
                            ──> room_info (A+B)

5. ОБРАТНЫЙ ОТСЧЁТ (5 сек)
                            ──> game_countdown {timeLeft:5} (A+B)
                            ──> game_countdown {timeLeft:4} (A+B)
                            ──> game_countdown {timeLeft:3} (A+B)
                            ──> game_countdown {timeLeft:2} (A+B)
                            ──> game_countdown {timeLeft:1} (A+B)
                            ──> game_countdown {timeLeft:0} (A+B)

6. СТАРТ
                            ──> game_started (A+B)
                            ──> request_bombs (A+B)

7. ФАЗА БОМБ (20 сек)
                            ──> bombs_phase_update {timeLeft:18} (A+B)

{type:"place_bombs",        ──────────────────────>
 bombs:[0,5,11]}

                            ──> bombs_phase_update {timeLeft:16} (A+B)

                                                        {type:"place_bombs",
                            <───────────────────────     bombs:[3,7,9]}

                            ──> bombs_placed (A+B)
                            ──> bombs_phase_finished (A+B)

8. ФАЗА ХОДОВ
                            ──> request_move (A, хост ходит первым)
                            ──> opponent_move (B)
                            ──> move_timer_update {timeLeft:13} (A+B)

{type:"make_move",          ──────────────────────>
 cell:3}
                            ──> move_result {bomb:true, explodedPlayer:8,
                                            livesLeft:2, nextTurn:8} (A+B)

                            ──> request_move (B)
                            ──> opponent_move (A)

                                                        {type:"make_move",
                            <───────────────────────     cell:0}
                            ──> move_result {bomb:true, explodedPlayer:5,
                                            livesLeft:2, nextTurn:5} (A+B)

... (ходы продолжаются) ...

9. КОНЕЦ ИГРЫ
{type:"make_move",          ──────────────────────>
 cell:9}
                            ──> move_result {bomb:true, explodedPlayer:8,
                                            livesLeft:0, winner:5} (A+B)
                            ──> game_finished {winnerId:5, prize:200} (A+B)
```

---

## Справочная таблица всех сообщений

### Клиент → Сервер

| type | Параметры | Описание |
|------|-----------|----------|
| `get_user_stats` | — | Запрос профиля |
| `get_rooms_list` | — | Список открытых комнат |
| `create_room` | `bet`, `password?` | Создать комнату |
| `join_room` | `roomId`, `password?` | Войти в комнату |
| `get_room_info` | — | Запросить инфо о текущей комнате |
| `leave_room` | — | Выйти из комнаты |
| `kick_player` | `playerId` | Кикнуть гостя (только хост) |
| `player_ready` | `ready` | Установить готовность |
| `place_bombs` | `bombs` (int[3]) | Расставить 3 бомбы |
| `make_move` | `cell` (int 0-11) | Сделать ход |
| `get_shop_items` | — | Список предметов магазина |
| `buy_item` | `itemId` | Купить предмет |
| `equip_item` | `itemId` | Экипировать предмет |
| `get_friends` | — | Список друзей |
| `send_friend_request` | `userId` | Отправить заявку в друзья |
| `accept_friend_request` | `requestId` | Принять заявку |
| `invite_to_room` | `friendId` | Пригласить друга в комнату |
| `reconnect` | — | Восстановить состояние |

### Сервер → Клиент

| type | Кому | Когда |
|------|------|-------|
| `authSuccess` | отправителю | при подключении |
| `user_customization` | отправителю | при подключении |
| `user_stats` | отправителю | по запросу |
| `rooms_list` | отправителю | по запросу |
| `room_created` | отправителю | комната создана |
| `room_joined` | отправителю | вошёл в комнату |
| `room_info` | broadcast (комната) | при изменении состояния комнаты |
| `play_request` | broadcast (комната) | оба игрока в комнате |
| `kicked_from_room` | кикнутому | кик из комнаты |
| `left_room` | отправителю | вышел из комнаты |
| `game_countdown` | broadcast (комната) | обратный отсчёт (5 сек) |
| `countdown_cancelled` | broadcast (комната) | отсчёт отменён |
| `game_started` | broadcast (комната) | игра началась |
| `request_bombs` | broadcast (комната) | запрос на расстановку бомб |
| `bombs_phase_update` | broadcast (комната) | таймер фазы бомб |
| `bombs_placed` | broadcast (комната) | оба расставили бомбы |
| `bombs_phase_finished` | broadcast (комната) | фаза бомб окончена |
| `request_move` | ходящему | запрос хода |
| `opponent_move` | ожидающему | оппонент ходит |
| `move_timer_update` | broadcast (комната) | таймер хода |
| `move_result` | broadcast (комната) | результат хода |
| `game_finished` | broadcast (комната) | игра окончена |
| `shop_items` | отправителю | список предметов |
| `purchase_success` | отправителю | покупка успешна |
| `equip_success` | отправителю | экипировка успешна |
| `friends_list` | отправителю | список друзей |
| `friend_request_sent` | отправителю | заявка отправлена |
| `friend_request_received` | получателю | входящая заявка |
| `friend_added` | принявшему | друг добавлен |
| `friend_request_accepted` | отправителю заявки | заявка принята |
| `game_invite_received` | приглашённому | приглашение в комнату |
| `reconnect_ok` | отправителю | результат реконнекта |
| `game_state_restore` | отправителю | восстановление состояния игры |
| `error` | отправителю | ошибка |
