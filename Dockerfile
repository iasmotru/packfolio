FROM python:3.11-slim

WORKDIR /app

COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ ./backend/
COPY frontend/ ./frontend/

RUN mkdir -p /data/uploads

ENV UPLOAD_DIR=/data/uploads
ENV DATABASE_URL=sqlite:////data/packfolio.db

EXPOSE 8000

WORKDIR /app/backend

CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
