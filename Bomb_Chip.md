# Документация Bomb Chip Arena

## Авторизация

### Получение токена JWT

POST запрос для получения токена

``` http://localhost:3000/login ```

```json
{
  "email": "player@test.com",
  "password": "123456",
  "nickname": "Player1"
}
```

``` http://localhost:3000/register ```

```json
{
  "email": "player@test.com",
  "password": "123456",
  "nickname": "Player1"
}
```

### Вход с логином

#### Подключаемся с токеном к вебсокету

``` ws://localhost:3000?token={YOUR_TOKEN_JWT} ```

Теперь можем слать запросы


## Получение данных пользователя

### От КЛИЕНТА К СЕРВЕРУ

```json 
{
    "type": "get_user_stats"
}
```

### ОТ СЕРВЕРА К КЛИЕНТУ
```json 
{
    {
    "type": "user_stats",
    "payload": {
        "id": 1,
        "email": "player@test.com",
        "nickname": "Player1",
        "created_at": "2026-02-19T14:34:45.837Z"
    }
}
}
```

## Комнаты
### Список комнат
От клиента
```json
{
  "type": "get_rooms_list"
}
```

От сервера
```json
{
  "type": "rooms_list",
  "payload": [
    {
      "id": 5,
      "bet": 100,
      "isPrivate": true,
      "status": "waiting",
      "host_id": 1,
      "host_nickname": "Player1"
    },
    {
      "id": 6,
      "bet": 250,
      "isPrivate": true,
      "status": "waiting",
      "host_id": 3,
      "host_nickname": "ProGamer"
    }
  ]
}
```

### Подключение к комнате
#### ОТ КЛИЕНТА
```json
{
    "type": "join_room",
    "roomId": 4
}
```
#### ОТ СЕРВЕРА
```json
{
    "type": "room_joined",
    "payload": {
        "roomId": 4
    }
}
```
ИНФА о комнате при входе
```json
{
    "type": "room_info",
    "payload": {
        "id": 4,
        "status": "playing",
        "host": {
            "id": 2,
            "nickname": "Player2"
        },
        "guest": {
            "id": 1,
            "nickname": "Player1"
        }
    }
}
```
### Создание комнаты
ОТ КЛИЕНТА
```json
{
    "type": "create_room",
    "bet": 300, //сумма ставки
    "password": "1234"   // необязательно
}
```
ОТ СЕРВЕРА
```json
{
    "type": "room_created",
    "payload": {
        "id": 12,
        "host_id": 5,
        "guest_id": null,
        "status": "waiting",
        "created_at": "2026-03-02T12:39:44.852Z",
        "bet": 300,
        "host_ready": false,
        "guest_ready": false
    }
}
```
### Подключение к комнате
ОТ КЛИЕНТА
```json
{
    "type": "join_room",
    "roomId": 11,
    "password": "1234" // если приватная
}
```
ОТ СЕРВЕРА
```json
{
    "type": "room_joined",
    "payload": {
        "roomId": 13
    }
}
```
ОТ СЕРВЕРА
```json
{
    "type": "room_info",
    "payload": {
        "id": 13,
        "status": "waiting",
        "bet": 300,
        "host": {
            "id": 5,
            "nickname": "Ayan2",
            "ready": false
        },
        "guest": {
            "id": 4,
            "nickname": "Ayan",
            "ready": false
        }
    }
}
```
## Игра

### Готовность к игре
ОТ КЛИЕНТА
```json
{
    "type": "player_ready",
    "ready": true
}
```
ОТ СЕРВЕРА
```json
{
    "type": "room_info",
    "payload": {
        "id": 13,
        "status": "waiting",
        "bet": 300,
        "host": {
            "id": 5,
            "nickname": "Ayan2",
            "ready": false
        },
        "guest": {
            "id": 4,
            "nickname": "Ayan",
            "ready": true
        }
    }
}
```
### Старт игры
ОТ СЕРВЕРА
```json
{
    "type": "game_started"
}
```
ОТ СЕРВЕРА
```json
{
  "type": "play_request"
}
```
ОТ КЛИЕНТА
```json
{
  "type": "play_confirm",
  "accept": true
}
```
###КИК ИГРОКА
ОТ КЛИЕНТА
```json
{
  "type": "kick_player",
  "playerId": 123
}
```
ОТ СЕРВЕРА
```json
{
    "type": "room_info",
    "payload": {
        "id": 13,
        "status": "playing",
        "bet": 300,
        "host": {
            "id": 5,
            "nickname": "Ayan2",
            "ready": true
        },
        "guest": {
            "id": 4,
            "nickname": "Ayan",
            "ready": true
        }
    }
}
```
### Запрос на бомбы
ОТ СЕРВЕРА
```json
{
    "type": "request_bombs"
}
```
ОТ КЛИЕНТА
```json
{
  "type": "place_bombs",
  "bombs": [1, 5, 8]
}
```
### Фаза бомб (таймер)
ОТ СЕРВЕРА
```json
{
    "type": "bombs_phase_update",
    "payload": {
        "timeLeft": 18 // таймер каждые 2 сек
    }
}
```
### Окончание фазы бомб
ОТ СЕРВЕРА
```json
{
    "type": "bombs_phase_finished"
}
```
### Запрос хода 
ОТ СЕРВЕРА
```json
{
    "type": "request_move",
    "payload": {
        "lives": {
            "you": 3,
            "opponent": 3
        },
        "availableCells": [
            0,
            1,
            2,
            3,
            4,
            5,
            6,
            7,
            8,
            9,
            10,
            11
        ],
        "timeLeft": 15
    }
}
```
ОТ КЛИЕНТА
```json
{
    "type": "make_move",
    "cell": 1
}
```
### Таймер хода
ОТ СЕРВЕРА
```json
{
    "type": "move_timer_update",
    "payload": {
        "timeLeft": 15,
        "currentTurn": 5
    }
}
```
### Результат хода
ОТ СЕРВЕРА
```json
{
    "type": "move_result",
    "payload": {
        "bomb": false,
        "nextTurn": 4
    }
}
```
ОТ СЕРВЕРА
ЕСЛИ ВЗОВРАЛСЯ
```json
{
    "type": "move_result",
    "payload": {
        "bomb": true,
        "explodedPlayer": 5,
        "livesLeft": 2,
        "nextTurn": 5
    }
}
```
### Запрос хода сопернику
ОТ СЕРВЕРА
```json
{
    "type": "opponent_move",
    "payload": {
        "opponentId": 4,
        "lives": {
            "you": 3,
            "opponent": 3
        },
        "timeLeft": 15
    }
}
```

### Выявление победителя
ОТ СЕРВЕРА
```json
{
    "type": "game_finished",
    "payload": {
        "winnerId": 4,
        "prize": 600
    }
}
```
## Друзья

### Отправить заявку
ОТ КЛИЕНТА
```json
{ "type": "send_friend_request", "userId": 5 }
```

ОТ СЕРВЕРА
```json
{
  "type": "friend_request_received",
  "payload": {
    "id": 12,
    "requester_id": 3,
    "addressee_id": 5,
    "status": "pending",
    "created_at": "2026-03-01T10:00:00Z"
  }
}
```
### ПРИНЯТЬ ЗАЯВКУ
ОТ КЛИЕНТА
```json
{ "type": "accept_friend_request", "requestId": 10 }
```
ОТ СЕРВЕРА ПРИНЯВШЕМУ
```json
{
  "type": "friend_added"
}
{
  "type": "friend_request_accepted"
}
```
### ОТКЛОНИТЬ ЗАЯВКУ
ОТ КЛИЕНТА
```json
{ "type": "decline_friend_request", "requestId": 10 }
```
### Получить список друзей
ОТ КЛИЕНТА
```json
{ "type": "get_friends" }
```
ОТ СЕРВЕРА
```json
{
  "type": "friends_list",
  "payload": [
    {
      "id": 5,
      "nickname": "Alex"
    },
    {
      "id": 9,
      "nickname": "ProPlayer"
    }
  ]
}
```
### Инвайт в комнату
ОТ КЛИЕНТА
```json
{ "type": "invite_to_room", "friendId": 8 }
```
ОТ СЕРВЕРА
```json
{
  "type": "game_invite_received",
  "payload": {
    "roomId": 10,
    "fromUserId": 3,
    "fromNickname": "BombMaster"
  }
}
```
ОТ СЕРВЕРА ПРИГЛАСИВШЕМУ
```json
{
  "type": "friend_joined_room",
  "payload": {
    "roomId": 10,
    "friendId": 5
  }
}
```
ЕСЛИ ОТКЛОНИЛ ТО СЕРВЕР ПРИШЛЕТ
```json
{
  "type": "game_invite_declined",
  "payload": {
    "friendId": 5
  }
}
```
### Принять инвайт
ОТ КЛИЕНТА
```json
{ "type": "accept_game_invite", "roomId": 3 }
```
## Магазин
### При входе в игру отсылается что надел
```json
{
  "type": "user_customization",
  "payload": {
    "skin_id": 1,
    "animation_id": 3,
    "effect_id": 7,
    "skin_code": "default_skin",
    "animation_code": "spin_anim",
    "effect_code": "fire_effect"
  }
}
```
### Экипировка предмета
ОТ КЛИЕНТА
```json
{
  "type": "equip_item",
  "itemId": 5
}
```
ОТ СЕРВЕРА
```json
{
  "type": "equip_success",
  "payload": {
    "itemId": 5
  }
}
```
### Покупка предмета
ОТ КЛИЕНТА
```json
{
  "type": "buy_item",
  "itemId": 5
}
```
ОТ СЕРВЕРА 
УСПЕХ
```json
{
  "type": "purchase_success",
  "payload": {
    "itemId": 5
  }
}
```
Ошибка
```json
{
  "type": "error",
  "message": "Not enough balance"
}
```

### Получение предметов
ОТ КЛИЕНТА
```json
{
  "type": "get_shop_items"
}
```

ОТ СЕРВЕРА 
```json
{
  "type": "shop_items",
  "payload": [
    {
      "id": 1,
      "code": "default_skin",
      "name": "Default",
      "type": "skin",
      "price": 0,
      "currency": "coins",
      "owned": true,
      "active": true
    },
    {
      "id": 5,
      "code": "gold_skin",
      "name": "Golden Skin",
      "type": "skin",
      "price": 500,
      "currency": "coins",
      "owned": false,
      "active": false
    }
  ]
}
```
