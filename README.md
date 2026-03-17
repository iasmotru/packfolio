# Packfolio

Telegram Mini App для хранения трэвел-документов: авиабилеты, отели, страховки, аренда авто и другое. Автоматически извлекает данные из загруженных PDF и фотографий.

---

## Запуск

### Бэкенд

```bash
cd backend
python -m venv venv
source venv/bin/activate      # macOS / Linux
# venv\Scripts\activate       # Windows

pip install -r requirements.txt

cp .env.example .env          # при необходимости отредактируйте

uvicorn main:app --reload --port 8000
```

После запуска приложение доступно по адресу **http://localhost:8000/app**

### Фронтенд

Фронтенд раздаётся бэкендом автоматически — отдельный запуск не нужен.

Откройте в браузере: **http://localhost:8000/app**

---

## Переменные окружения

Скопируйте `backend/.env.example` в `backend/.env`. Для локальной разработки достаточно значений по умолчанию.

| Переменная | Описание |
|------------|----------|
| `ENV` | `dev` — без проверки токена Telegram; `prod` — с проверкой HMAC |
| `SECRET_KEY` | Секрет для подписи JWT (обязательно сменить в prod) |
| `BOT_TOKEN` | Токен Telegram-бота (нужен только в prod) |
| `ENABLE_OCR` | `1` — включить OCR через Tesseract (требует установки) |
