# План внедрения: Матчмейкинг, Арены, Анимации

---

## Содержание

1. [Обзор изменений](#1-обзор-изменений)
2. [Арены (локации)](#2-арены-локации)
3. [Матчмейкинг](#3-матчмейкинг)
4. [Анимации раундов (win/lose)](#4-анимации-раундов-winlose)
5. [Изменения БД](#5-изменения-бд)
6. [Изменения WebSocket API](#6-изменения-websocket-api)
7. [Порядок реализации](#7-порядок-реализации)
8. [Миграции SQL](#8-миграции-sql)

---

## 1. Обзор изменений

### Что меняется

| Компонент | Было | Станет |
|-----------|------|--------|
| Поиск игры | Ручной browse/create/join комнат | Автоматический матчмейкинг по арене + сохранение приватных комнат |
| Локации | Нет | Арены с диапазоном ставок и визуальной темой |
| Анимации | Только экипировка в инвентаре | Экипированная анимация проигрывается при попадании/промахе в раунде |

### Что НЕ меняется

- Приватные комнаты (create_room с паролем) — остаются как есть
- Друзья и инвайты — работают как раньше
- Магазин и покупка предметов — без изменений
- GameEngine (логика бомб, ходов, жизней) — без изменений
- Авторизация — без изменений

---

## 2. Арены (локации)

### Концепция

Арена — это игровая локация с визуальной темой и допустимым диапазоном ставок. Игрок выбирает арену → попадает в очередь матчмейкинга с выбранной ставкой в рамках диапазона этой арены.

### Предустановленные арены

| id | code | name | min_bet | max_bet | Описание |
|----|------|------|---------|---------|----------|
| 1 | `backyard` | Задний двор | 0 | 1000 | Стартовая арена для новичков |
| 2 | `downtown` | Центр города | 1000 | 5000 | Средние ставки |
| 3 | `rooftop` | Крыша | 5000 | 25000 | Высокие ставки |
| 4 | `underground` | Подземелье | 25000 | 100000 | Хайроллеры |

> Арены хранятся в БД — можно добавлять/менять без деплоя кода.

### API: Получить список арен

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

---

## 3. Матчмейкинг

### Концепция

Вместо ручного создания/поиска комнат игрок нажимает **«Найти игру»** → выбирает арену → указывает ставку (в пределах диапазона арены) → попадает в очередь. Сервер подбирает пару игроков с совпадающей ставкой на одной арене.

### Серверная структура очереди

```
matchmakingQueue = Map<arenaId, Map<bet, Array<{ws, userId, joinedAt}>>>
```

Пример состояния:
```
arena 1 (backyard):
  bet 50:  [Player_A, Player_C]   ← мгновенный матч
  bet 100: [Player_B]             ← ждёт
arena 2 (downtown):
  bet 200: [Player_D]             ← ждёт
```

### Алгоритм матчмейкинга

```
1. Игрок отправляет find_match { arenaId, bet }
2. Валидация:
   - Арена существует
   - bet в диапазоне [min_bet, max_bet] арены
   - bet — целое неотрицательное число (>= 0)
   - У игрока достаточно баланса
   - Игрок не в очереди и не в комнате
3. Списать ставку с баланса (резервирование)
4. Добавить в очередь: matchmakingQueue[arenaId][bet].push(player)
5. Проверить очередь:
   - Если в matchmakingQueue[arenaId][bet] >= 2 игроков:
     a. Извлечь двух первых (FIFO)
     b. Создать комнату в БД (status: "playing", arena_id)
     c. Отправить обоим match_found
     d. Запустить game_countdown → game flow как сейчас
   - Иначе: отправить игроку match_searching
```

### Таймаут очереди

- **60 секунд** — если пара не найдена, отправить `match_timeout`, вернуть ставку, удалить из очереди.
- Каждые **10 секунд** — отправлять `match_searching` с `timeElapsed` для UI прогресс-бара.

### API: Найти игру

**CLIENT →**
```json
{
  "type": "find_match",
  "arenaId": 1,
  "bet": 50
}
```

| Поле | Тип | Обязательно | Описание |
|------|-----|-------------|----------|
| `arenaId` | integer | да | ID арены |
| `bet` | integer | да | Ставка (в диапазоне арены) |

**SERVER → match_searching** (игроку, при постановке в очередь)
```json
{
  "type": "match_searching",
  "payload": {
    "arenaId": 1,
    "bet": 50,
    "position": 1
  }
}
```

**SERVER → match_searching** (периодический апдейт каждые 10 сек)
```json
{
  "type": "match_searching",
  "payload": {
    "arenaId": 1,
    "bet": 50,
    "timeElapsed": 20
  }
}
```

**SERVER → match_found** (обоим игрокам при совпадении)
```json
{
  "type": "match_found",
  "payload": {
    "roomId": 42,
    "arenaId": 1,
    "arenaCode": "backyard",
    "bet": 50,
    "opponent": {
      "id": 8,
      "nickname": "Player2",
      "skin_code": "gold_skin",
      "animation_code": "default_anim",
      "effect_code": "default_effect"
    }
  }
}
```

> В `match_found` сразу передаётся кастомизация оппонента, чтобы клиент мог загрузить ассеты до начала игры.

**SERVER → match_timeout** (если пара не найдена за 60 сек)
```json
{
  "type": "match_timeout",
  "payload": {
    "arenaId": 1,
    "bet": 50,
    "refunded": true
  }
}
```

### API: Отменить поиск

**CLIENT →**
```json
{ "type": "cancel_match" }
```

**SERVER → match_cancelled**
```json
{
  "type": "match_cancelled",
  "payload": { "refunded": true }
}
```

> Ставка возвращается при отмене.

**Ошибки find_match:**
| Сообщение | Причина |
|-----------|---------|
| `"Arena not found"` | Арена не существует |
| `"Bet must be between X and Y"` | Ставка вне диапазона арены |
| `"Invalid bet amount"` | Не целое неотрицательное число |
| `"Not enough balance"` | Недостаточно средств |
| `"Already in queue"` | Уже ищет матч |
| `"Already in a room"` | Уже в комнате |

**Ошибки cancel_match:**
| Сообщение | Причина |
|-----------|---------|
| `"Not in queue"` | Игрок не в очереди |

---

### Изменение Game Flow после матча

Текущий flow:
```
create_room → join_room → player_ready (оба) → game_countdown → game_started → ...
```

Новый flow (матчмейкинг):
```
find_match → match_found → game_countdown (автоматически) → game_started → ...
```

**Ключевые отличия:**
1. **Нет этапа ready** — оба согласились играть, когда нажали "Найти игру". После `match_found` сразу `game_countdown`.
2. **Нет ручного создания комнаты** — комната создаётся сервером автоматически.
3. **arena_id привязывается к комнате** — для статистики и визуала.

### Сохранение приватных комнат

`create_room` и `join_room` **остаются** для приватных игр с друзьями. Приватные комнаты:
- Не привязаны к арене (arena_id = NULL)
- Работают по старой схеме (create → join → ready → countdown)
- Доступны через `invite_to_room`

Публичные комнаты из `get_rooms_list` **убираются** — теперь публичный поиск идёт только через матчмейкинг.

---

## 4. Анимации раундов (win/lose)

### Концепция

У каждого игрока экипированы **отдельные анимации** для каждого игрового события. При каждом ходе и завершении игры сервер отправляет конкретный `animation_code` для конкретного события от конкретного игрока. Клиент проигрывает соответствующий визуал.

### Типы анимаций (по событиям)

Каждый тип анимации — это **отдельный предмет** в магазине (`shop_items`), который игрок экипирует независимо.

| Тип в shop_items | Событие | Когда проигрывается | Кто видит |
|------------------|---------|---------------------|-----------|
| `animation_hit` | Попадание в бомбу | Атакующий попал в бомбу оппонента | Оба |
| `animation_miss` | Промах | Атакующий промахнулся | Оба |
| `animation_win` | Победа | Игра окончена, проигрывается победителю | Оба |
| `animation_lose` | Поражение | Игра окончена, проигрывается проигравшему | Оба |

> Пример: игрок может экипировать `fire_strike` на попадание, `smoke_puff` на промах, `victory_dance` на победу и `sad_explosion` на поражение.

### Изменение user_customization

Текущее состояние (3 слота):
```
skin_id, animation_id, effect_id
```

Новое состояние (6 слотов):
```
skin_id, effect_id,
animation_hit_id, animation_miss_id, animation_win_id, animation_lose_id
```

### Изменение user_customization (SERVER → при подключении)

```json
{
  "type": "user_customization",
  "payload": {
    "skin_id": 2,
    "skin_code": "default_skin2",
    "effect_id": 5,
    "effect_code": "default_effect",
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

### Изменение move_result

Текущий `move_result`:
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

Новый `move_result` — **попадание (bomb: true)**:
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

> `animations` — массив, каждый элемент указывает конкретного игрока (`userId`), его роль (`attacker`/`defender`), тип события и коды анимации/эффекта.

Новый `move_result` — **промах (bomb: false)**:
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

### Изменение game_finished

Текущий:
```json
{
  "type": "game_finished",
  "payload": {
    "winnerId": 5,
    "prize": 200
  }
}
```

Новый:
```json
{
  "type": "game_finished",
  "payload": {
    "winnerId": 5,
    "loserId": 8,
    "prize": 200,
    "arenaId": 1,
    "arenaCode": "backyard",
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

### Откуда берутся коды анимаций

При старте игры (`launchGame` / после `match_found`) сервер загружает из `user_customization` + `shop_items` все экипированные анимации обоих игроков и кеширует в `GameEngine`:

```js
// В GameEngine.players[playerId] добавляется:
this.players[playerId].customization = {
  skin_code: "gold_skin",
  effect_code: "explosion_red",
  animation_hit_code: "fire_strike",
  animation_miss_code: "smoke_puff",
  animation_win_code: "victory_dance",
  animation_lose_code: "sad_explosion"
};
```

При формировании `move_result` сервер подставляет:
- **hit** → `animation_hit_code` атакующего
- **miss** → `animation_miss_code` атакующего
- **damaged** → `animation_lose_code` защитника (анимация получения урона)
- **win** → `animation_win_code` победителя
- **lose** → `animation_lose_code` проигравшего

Клиент использует `animation_code` и `effect_code` для отрисовки визуальных эффектов.

---

## 5. Изменения БД

### Новая таблица: arenas

```sql
CREATE TABLE arenas (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    min_bet INTEGER NOT NULL CHECK (min_bet >= 0),
    max_bet INTEGER NOT NULL CHECK (max_bet >= min_bet),
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);
```

### Изменение таблицы rooms

```sql
ALTER TABLE rooms ADD COLUMN arena_id INTEGER REFERENCES arenas(id) DEFAULT NULL;
```

> `arena_id = NULL` для приватных комнат. Заполняется для матчмейкинг-комнат.

### Изменение таблицы user_customization

```sql
-- Удалить старый столбец animation_id (заменяется на 4 отдельных)
ALTER TABLE user_customization DROP COLUMN IF EXISTS animation_id;

-- Добавить 4 отдельных слота анимаций
ALTER TABLE user_customization ADD COLUMN animation_hit_id INTEGER REFERENCES shop_items(id);
ALTER TABLE user_customization ADD COLUMN animation_miss_id INTEGER REFERENCES shop_items(id);
ALTER TABLE user_customization ADD COLUMN animation_win_id INTEGER REFERENCES shop_items(id);
ALTER TABLE user_customization ADD COLUMN animation_lose_id INTEGER REFERENCES shop_items(id);
```

### Изменение таблицы shop_items

Тип `animation` разбивается на 4 подтипа:

| type | Описание |
|------|----------|
| `skin` | Скин (без изменений) |
| `effect` | Эффект (без изменений) |
| `animation_hit` | Анимация попадания |
| `animation_miss` | Анимация промаха |
| `animation_win` | Анимация победы |
| `animation_lose` | Анимация поражения |

> Старые записи с `type = 'animation'` мигрируются в `animation_hit` (или удаляются и пересоздаются).

### Без изменений

- `users` — без изменений
- `user_items` — без изменений
- `friends` — без изменений

---

## 6. Изменения WebSocket API

### Новые сообщения Client → Server

| type | Параметры | Описание |
|------|-----------|----------|
| `get_arenas` | — | Получить список арен |
| `find_match` | `arenaId`, `bet` | Встать в очередь матчмейкинга |
| `cancel_match` | — | Отменить поиск |

### Новые сообщения Server → Client

| type | Кому | Когда |
|------|------|-------|
| `arenas_list` | отправителю | по запросу |
| `match_searching` | отправителю | встал в очередь / периодический апдейт |
| `match_found` | обоим | найдена пара |
| `match_timeout` | отправителю | таймаут поиска (60 сек) |
| `match_cancelled` | отправителю | отмена поиска |
| `arena_queue_update` | broadcast (все) | изменение очереди на арене |

### Изменённые сообщения

| type | Что изменилось |
|------|----------------|
| `move_result` | Добавлено поле `animation` и `cell` |
| `game_finished` | Добавлены `loserId`, `arenaId`, `arenaCode`, `animations` |
| `match_found` | Содержит `opponent` с кастомизацией |

### Убранные / deprecated

| type | Статус |
|------|--------|
| `get_rooms_list` | **Deprecated** — оставить для обратной совместимости, возвращать только приватные комнаты (пустой массив по сути) |
| `player_ready` | Работает только для приватных комнат. В матчмейкинге не используется |

---

## 7. Порядок реализации

### Фаза 1: Арены (БД + API)

**Файлы:** `index.js`, SQL-миграция

1. Создать таблицу `arenas` и заполнить данными
2. Добавить `arena_id` в таблицу `rooms`
3. Реализовать обработчик `get_arenas`
4. Тест: клиент получает список арен

### Фаза 2: Матчмейкинг (ядро)

**Файлы:** `index.js` (или выделить в `matchmaking.js`)

1. Создать структуру очереди `matchmakingQueue`
2. Реализовать `find_match`:
   - Валидация (арена, ставка, баланс, не в очереди/комнате)
   - Списание ставки
   - Добавление в очередь
   - Проверка пары
3. Реализовать `cancel_match`:
   - Удаление из очереди
   - Возврат ставки
4. Реализовать таймаут очереди (60 сек)
5. Реализовать периодический `match_searching` (каждые 10 сек)
6. При нахождении пары:
   - Создать комнату в БД с `arena_id`
   - Загрузить кастомизацию обоих игроков
   - Отправить `match_found`
   - Автоматически запустить `startGameCountdown`
7. Обработать дисконнект во время поиска (вернуть ставку, удалить из очереди)

### Фаза 3: Анимации в move_result и game_finished

**Файлы:** `index.js`, `gameEngine.js`

1. Мигрировать `shop_items`: разбить `type = 'animation'` на 4 подтипа (`animation_hit`, `animation_miss`, `animation_win`, `animation_lose`)
2. Мигрировать `user_customization`: заменить `animation_id` на 4 столбца
3. Обновить `equip_item` — поддержка 4 новых типов анимаций
4. Обновить `user_customization` WS-сообщение при подключении (6 слотов вместо 3)
5. При старте игры (`launchGame`) загрузить все 4 `animation_*_code` + `effect_code` обоих игроков
6. Сохранить в `GameEngine.players[id].customization`
7. В обработчике `make_move` формировать массив `animations` в `move_result` (hit/miss + damaged)
8. В `finishGame` добавить `animations` (win/lose), `loserId`, `arenaId`, `arenaCode` в `game_finished`

### Фаза 4: Очистка и тестирование

1. Deprecate `get_rooms_list` для публичных комнат
2. Убедиться, что приватные комнаты (create_room + join_room) работают как раньше
3. Обработать edge cases:
   - Игрок дисконнектится во время поиска
   - Игрок в очереди пытается создать приватную комнату
   - Два одинаковых запроса find_match от одного игрока
   - Нулевой баланс
4. Обновить `Bomb_Chip.md` документацию

---

## 8. Миграции SQL

### Migration 001: Arenas + Rooms

```sql
-- Создание таблицы арен
CREATE TABLE arenas (
    id SERIAL PRIMARY KEY,
    code VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    min_bet INTEGER NOT NULL CHECK (min_bet >= 0),
    max_bet INTEGER NOT NULL CHECK (max_bet >= min_bet),
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Начальные арены
INSERT INTO arenas (code, name, min_bet, max_bet, sort_order) VALUES
('backyard',     'Задний двор',    0,      1000,    1),
('downtown',     'Центр города',   1000,   5000,    2),
('rooftop',      'Крыша',          5000,   25000,   3),
('underground',  'Подземелье',     25000,  100000,  4);

-- Добавить arena_id в rooms
ALTER TABLE rooms ADD COLUMN arena_id INTEGER REFERENCES arenas(id) DEFAULT NULL;
```

### Migration 002: Анимации (user_customization + shop_items)

```sql
-- Удалить старый единый animation_id
ALTER TABLE user_customization DROP COLUMN IF EXISTS animation_id;

-- Добавить 4 отдельных слота анимаций
ALTER TABLE user_customization ADD COLUMN animation_hit_id INTEGER REFERENCES shop_items(id);
ALTER TABLE user_customization ADD COLUMN animation_miss_id INTEGER REFERENCES shop_items(id);
ALTER TABLE user_customization ADD COLUMN animation_win_id INTEGER REFERENCES shop_items(id);
ALTER TABLE user_customization ADD COLUMN animation_lose_id INTEGER REFERENCES shop_items(id);

-- Миграция старых animation → animation_hit (остальные пусто, заполнятся дефолтами)
UPDATE shop_items SET type = 'animation_hit' WHERE type = 'animation';

-- Добавить дефолтные анимации для новых типов
INSERT INTO shop_items (code, name, type, price, currency) VALUES
('default_anim_miss', 'Default Miss', 'animation_miss', 0, 'coins'),
('default_anim_win',  'Default Win',  'animation_win',  0, 'coins'),
('default_anim_lose', 'Default Lose', 'animation_lose', 0, 'coins');

-- Проставить дефолтные анимации всем пользователям у кого пусто
-- (выполняется в коде при миграции, т.к. нужны id только что вставленных записей)
```

---

## Диаграмма: Новый игровой цикл (матчмейкинг)

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

3. ПОИСК МАТЧА
{type:"find_match",         ──────────────────────>
 arenaId:1, bet:50}
                            <── match_searching {position:1}
                            ... (10 сек) ...
                            <── match_searching {timeElapsed:10}

                                                        {type:"find_match",
                            <───────────────────────     arenaId:1, bet:50}

                            ──> match_found (A) {opponent: B info}
                            ──> match_found (B) {opponent: A info}

4. ОБРАТНЫЙ ОТСЧЁТ (5 сек, автоматически)
                            ──> game_countdown {timeLeft:5} (A+B)
                            ...
                            ──> game_countdown {timeLeft:0} (A+B)

5. СТАРТ
                            ──> game_started (A+B)
                            ──> request_bombs (A+B)

6. ФАЗА БОМБ (20 сек) — без изменений

7. ФАЗА ХОДОВ
{type:"make_move", cell:3}  ──────────────────────>
                            ──> move_result {
                                  cell:3, bomb:true,
                                  explodedPlayer:8, livesLeft:2,
                                  nextTurn:8,
                                  animations: [
                                    {userId:5, role:"attacker", event:"hit",
                                     animation_code:"fire_strike",
                                     effect_code:"explosion_red"},
                                    {userId:8, role:"defender", event:"damaged",
                                     animation_code:"default_anim_lose",
                                     effect_code:"default_effect"}
                                  ]
                                } (A+B)

... (ходы продолжаются) ...

8. КОНЕЦ ИГРЫ
                            ──> game_finished {
                                  winnerId:5, loserId:8, prize:100,
                                  arenaId:1, arenaCode:"backyard",
                                  animations: [
                                    {userId:5, role:"winner", event:"win",
                                     animation_code:"victory_dance", ...},
                                    {userId:8, role:"loser", event:"lose",
                                     animation_code:"sad_explosion", ...}
                                  ]
                                } (A+B)
```

---

## Реалтайм обновление очередей арен

При каждом изменении очереди (игрок встал / вышел / нашёл матч / таймаут) сервер рассылает **всем подключённым клиентам** (которые не в игре и не в очереди) обновлённые счётчики:

**SERVER → arena_queue_update** (broadcast всем)
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

> Дебаунс: не чаще 1 раза в 2 секунды, чтобы не спамить при массовых входах/выходах.

Также `players_in_queue` включается в ответ `arenas_list` при запросе `get_arenas`.

---

## Решения по дизайну (зафиксировано)

| Вопрос | Решение |
|--------|---------|
| Матчинг ставок | Exact match — только одинаковые ставки |
| Количество арен | 4 арены (0-1k, 1k-5k, 5k-25k, 25k-100k) |
| Типы анимаций | 4 отдельных слота: hit, miss, win, lose — экипируются независимо |
| Очередь в реалтайме | Да, broadcast `arena_queue_update` всем клиентам |
