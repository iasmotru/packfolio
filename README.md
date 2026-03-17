# Packfolio — Telegram Mini App для трэвел-документов

Хранение и структурирование документов для путешествий: авиабилеты, отели, страховки, аренда авто и другое.

## Структура проекта

```
packfolio/
├── backend/
│   ├── main.py               # FastAPI приложение + startup + auth endpoint + seed
│   ├── models.py             # SQLAlchemy модели (SQLite)
│   ├── auth.py               # Telegram initData HMAC + JWT
│   ├── parser.py             # Парсинг PDF/изображений, определение типа
│   ├── wallet.py             # Генерация Apple Wallet .pkpass
│   ├── routes/
│   │   ├── trips.py          # CRUD поездок
│   │   ├── tags.py           # CRUD тегов
│   │   ├── documents.py      # Загрузка, редактирование, превью документов
│   │   ├── calendar.py       # Построение событий из виджетов
│   │   └── wallet_routes.py  # Endpoint для .pkpass
│   ├── requirements.txt
│   └── .env.example
└── frontend/
    ├── index.html            # Single-page app (Telegram WebApp SDK)
    ├── app.js                # Весь JS: роутинг, API, UI
    └── styles.css            # Mobile-first стили (Telegram theme vars)
```

---

## Быстрый старт

### 1. Backend

```bash
cd packfolio/backend

# Создаём виртуальное окружение
python -m venv venv
source venv/bin/activate       # macOS / Linux
# venv\Scripts\activate        # Windows

# Устанавливаем зависимости
pip install -r requirements.txt

# Копируем и настраиваем .env
cp .env.example .env
# Отредактируйте .env — минимум нужен ENV=dev

# Запускаем сервер
uvicorn main:app --reload --port 8000
```

После запуска:
- API документация: http://localhost:8000/docs
- Health check: http://localhost:8000/api/health
- В `ENV=dev` автоматически создаются тестовые данные (1 поездка, 2 тега, 2 документа)

### 2. Frontend

**Вариант А — через Python http.server:**
```bash
cd packfolio/frontend
python -m http.server 3000
# Открыть: http://localhost:3000
```

**Вариант Б — через npx serve:**
```bash
cd packfolio/frontend
npx serve -p 3000
```

**Вариант В — просто открыть index.html в браузере**
> В `ENV=dev` авторизация работает без BOT_TOKEN (dev fallback)

### 3. Telegram Bot (для настоящего Mini App)

1. Создайте бота через [@BotFather](https://t.me/BotFather)
2. Получите `BOT_TOKEN`
3. Настройте Web App URL у бота: `/newapp` или через настройки бота
4. Укажите URL вашего задеплоенного фронтенда
5. Установите `BOT_TOKEN` в `.env`

---

## Переменные окружения

Скопируйте `backend/.env.example` в `backend/.env`:

```env
# Среда: dev (без проверки HMAC) или prod
ENV=dev

# Секрет для JWT — обязательно поменяйте в prod!
SECRET_KEY=your-super-secret-key

# Telegram Bot Token (обязателен в prod)
BOT_TOKEN=123456789:AAF...

# OCR через Tesseract (опционально)
# Требует: pip install pytesseract Pillow + системный tesseract-ocr
ENABLE_OCR=0

# Apple Wallet (опционально)
PASS_TYPE_ID=
TEAM_ID=
CERT_P12_BASE64=
CERT_P12_PASSWORD=
WWDR_CERT_BASE64=
APP_BASE_URL=http://localhost:8000
```

---

## API эндпоинты

### Авторизация
| Метод | URL | Описание |
|-------|-----|----------|
| POST | `/api/auth/telegram` | Валидация initData, получение JWT |
| GET  | `/api/me` | Данные текущего пользователя |

### Поездки
| Метод | URL |
|-------|-----|
| GET    | `/api/trips` |
| POST   | `/api/trips` |
| PUT    | `/api/trips/{id}` |
| DELETE | `/api/trips/{id}` |

### Документы
| Метод | URL | Описание |
|-------|-----|----------|
| POST   | `/api/documents` | Загрузка + автопарсинг |
| GET    | `/api/documents` | Список (фильтры: q, doc_type, trip_id, tag_id) |
| GET    | `/api/documents/{id}` | Детали + виджет |
| PUT    | `/api/documents/{id}` | Обновление мета + теги |
| PUT    | `/api/documents/{id}/widget` | Патч полей виджета |
| POST   | `/api/documents/{id}/replace` | Замена файла + перепарсинг |
| GET    | `/api/documents/{id}/file` | Скачать / просмотреть файл |
| DELETE | `/api/documents/{id}` | Удаление |

### Теги
| Метод | URL |
|-------|-----|
| GET    | `/api/tags` |
| POST   | `/api/tags` |
| PUT    | `/api/tags/{id}` |
| DELETE | `/api/tags/{id}` |

### Календарь
| Метод | URL |
|-------|-----|
| GET | `/api/calendar?month=YYYY-MM` |

### Wallet
| Метод | URL |
|-------|-----|
| GET | `/api/wallet/{doc_id}.pkpass` |

### Dev
| Метод | URL |
|-------|-----|
| POST | `/api/dev/seed` (только ENV=dev) |

---

## Включение OCR

```bash
# Установить системный Tesseract
# macOS:
brew install tesseract tesseract-lang

# Ubuntu/Debian:
apt-get install tesseract-ocr tesseract-ocr-rus tesseract-ocr-eng

# Установить Python пакеты (раскомментируйте в requirements.txt)
pip install pytesseract Pillow

# В .env:
ENABLE_OCR=1
```

## Настройка Apple Wallet

1. Зарегистрируйтесь в [Apple Developer Program](https://developer.apple.com)
2. Создайте **Pass Type ID** в Certificates, Identifiers & Profiles
3. Создайте и скачайте сертификат `.p12`
4. Скачайте [WWDR Certificate](https://www.apple.com/certificateauthority/) (AppleWWDRCAG3.cer)
5. Конвертируйте в Base64:
   ```bash
   openssl base64 -in certificate.p12 | tr -d '\n'
   openssl base64 -in AppleWWDRCAG3.cer | tr -d '\n'
   ```
6. Вставьте в `.env`

Если Wallet не настроен, кнопка «🍎 Wallet» показывает инструкцию — приложение не падает.

---

## UX-описание: основные сценарии

### Добавление документа
1. Нажать **«+»** на вкладке Документы
2. Выбрать PDF или фото (или перетащить в зону дропа)
3. Бэкенд анализирует файл: извлекает текст, определяет тип, заполняет поля
4. Показывается экран проверки: тип документа + уверенность в %
   - Если уверенность < 35% — **обязателен** выбор типа вручную
5. Задать название, поездку, теги (с автодополнением)
6. **«Сохранить»** — документ появляется в списке

### Редактирование виджета
1. Открыть документ из списка
2. В секции **«Данные документа»** нажать **«изм.»** рядом с любым полем
3. Ввести значение, нажать Enter или кликнуть вне поля — сохраняется мгновенно
4. Незаполненные поля показываются курсивом «не заполнено»

### Добавление в Apple Wallet
1. Открыть документ
2. Нажать **«🍎 Wallet»**
   - Если сертификаты настроены — скачивается `.pkpass`, iOS/macOS предложит добавить
   - Если не настроены — открывается экран с инструкцией по настройке (приложение не падает)

### Работа с поездками
1. Вкладка Поездки → **«+»** → форма (название, места, даты, заметка)
2. В карточке поездки видны прикреплённые документы
3. Документ прикрепляется к поездке при загрузке или через редактирование

### Календарь
1. Вкладка Календарь — сетка текущего месяца
2. Даты с событиями отмечены точкой
3. Клик по дню — список событий для этого дня
4. События строятся из дат виджетов (заезд/выезд отеля, даты рейса, страховки и т.д.)
5. Листать месяцы кнопками **‹ ›**

---

## Технологии

| Компонент | Технология |
|-----------|-----------|
| Backend   | Python 3.11+, FastAPI, Uvicorn |
| БД        | SQLite (через SQLAlchemy) |
| Файлы     | Локально в `./uploads` |
| Парсинг   | pypdf, python-dateutil, regex |
| OCR       | pytesseract + Pillow (опционально) |
| Auth      | HMAC-SHA256 (Telegram), JWT (PyJWT) |
| Wallet    | cryptography (pkcs7 подпись) |
| Frontend  | Чистый HTML/CSS/JS, без фреймворков |
| Стили     | Telegram WebApp CSS vars, mobile-first |
