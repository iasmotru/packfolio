# Packfolio

Telegram Mini App для хранения трэвел-документов: авиабилеты, отели, страховки, аренда авто и другое. Автоматически извлекает данные из загруженных PDF и фотографий.

---

## Запуск

### Бэкенд

```bash
cd backend

python3 -m venv .venv
source .venv/bin/activate        # macOS / Linux
# .venv\Scripts\activate         # Windows

pip install -r requirements.txt

cp .env.example .env             # при необходимости отредактируйте

uvicorn main:app --host 127.0.0.1 --port 8000 --reload --reload-exclude '.venv'
```

После запуска приложение доступно по адресу **http://127.0.0.1:8000/app**

### Фронтенд

Фронтенд раздаётся бэкендом автоматически — отдельный запуск не нужен.

Откройте в браузере: **http://127.0.0.1:8000/app**

> Используйте именно `127.0.0.1`, а не `localhost` — во избежание проблем с IPv6-резолвингом в браузере.

---

## Конфигурация (.env)

| Переменная | Описание |
|---|---|
| `ENV` | Режим запуска: `dev` или `production` |
| `SECRET_KEY` | Секрет для подписи JWT-токенов |
| `BOT_TOKEN` | Токен Telegram-бота (для проверки подписи initData); в `dev` можно оставить пустым |
| `DATABASE_URL` | URL базы данных (по умолчанию `sqlite:///./packfolio.db`) |
| `UPLOAD_DIR` | Папка для загруженных файлов (по умолчанию `./uploads`) |

В режиме `dev` с пустым `BOT_TOKEN` проверка подписи Telegram пропускается — приложение работает без бота.
