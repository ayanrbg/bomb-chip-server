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
```json{
  "type": "rooms_list",
  "payload": [
    {
      "id": 5,
      "bet": 100,
      "status": "waiting",
      "host_id": 1,
      "host_nickname": "Player1"
    },
    {
      "id": 6,
      "bet": 250,
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
```json
{
    "type": "create_room",
    "bet": 300 //сумма ставки
}
```
## Игра
### Готовность к игре


#### ОТ КЛИЕНТА
```json
{
    "type": "player_ready",
    "ready": true
}
```
#### ОТ СЕРВЕРА
```json
{
    "type": "room_info"
}
```



#### ОТ КЛИЕНТА
```json
{
  "type": "place_bombs",
  "bombs": [1, 5, 8]
}
```
#### ОТ СЕРВЕРА

