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
