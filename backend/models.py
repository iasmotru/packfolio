"""
Модели базы данных для packfolio.
SQLAlchemy + SQLite (без отдельного сервера).
"""

import enum
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    Boolean, Column, DateTime, Float, ForeignKey,
    Integer, JSON, String, Text, create_engine, UniqueConstraint
)
from sqlalchemy.orm import DeclarativeBase, relationship, sessionmaker

DATABASE_URL = "sqlite:///./packfolio.db"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False},
    echo=False,
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


# ──────────────────────────────────────────────
# Enums
# ──────────────────────────────────────────────

class DocType(str, enum.Enum):
    PASSPORT           = "PASSPORT"
    HOTEL_BOOKING      = "HOTEL_BOOKING"
    FLIGHT_TICKET      = "FLIGHT_TICKET"
    TRAIN_TICKET       = "TRAIN_TICKET"
    BUS_TICKET         = "BUS_TICKET"
    CAR_RENTAL         = "CAR_RENTAL"
    MEDICAL_INSURANCE  = "MEDICAL_INSURANCE"
    UNKNOWN            = "UNKNOWN"


class TagKind(str, enum.Enum):
    TRIP_TYPE = "tripType"
    CUSTOM    = "custom"


# ──────────────────────────────────────────────
# ORM Models
# ──────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id         = Column(Integer, primary_key=True)   # telegram_id
    first_name = Column(String(128), nullable=False)
    last_name  = Column(String(128), nullable=True)
    username   = Column(String(128), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    trips     = relationship("Trip",     back_populates="user", cascade="all, delete")
    tags      = relationship("Tag",      back_populates="user", cascade="all, delete")
    documents = relationship("Document", back_populates="user", cascade="all, delete")


class Trip(Base):
    __tablename__ = "trips"

    id         = Column(Integer, primary_key=True, autoincrement=True)
    user_id    = Column(Integer, ForeignKey("users.id"), nullable=False)
    title      = Column(String(256), nullable=False)
    locations  = Column(String(512), nullable=True)
    start_date = Column(String(32),  nullable=True)   # ISO date string
    end_date   = Column(String(32),  nullable=True)
    note       = Column(Text,         nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user      = relationship("User",     back_populates="trips")
    documents = relationship("Document", back_populates="trip")


class Tag(Base):
    __tablename__ = "tags"

    id      = Column(Integer, primary_key=True, autoincrement=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    name    = Column(String(128), nullable=False)
    kind    = Column(String(32),  nullable=False, default="custom")  # tripType | custom

    user = relationship("User", back_populates="tags")

    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_user_tag_name"),
    )


class Document(Base):
    __tablename__ = "documents"

    id        = Column(Integer, primary_key=True, autoincrement=True)
    user_id   = Column(Integer, ForeignKey("users.id"), nullable=False)
    trip_id   = Column(Integer, ForeignKey("trips.id"), nullable=True)
    doc_type  = Column(String(32), nullable=False, default="UNKNOWN")
    title     = Column(String(256), nullable=False)
    file_path = Column(String(512), nullable=True)
    file_mime = Column(String(128), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user        = relationship("User",        back_populates="documents")
    trip        = relationship("Trip",        back_populates="documents")
    widget_data = relationship("WidgetData",  back_populates="document",
                               uselist=False, cascade="all, delete")
    doc_tags    = relationship("DocumentTag", back_populates="document",
                               cascade="all, delete")


class WidgetData(Base):
    __tablename__ = "widget_data"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    document_id    = Column(Integer, ForeignKey("documents.id"),
                            nullable=False, unique=True)
    data           = Column(JSON, default=dict)          # текущие (могут быть отредактированы)
    extracted_data = Column(JSON, default=dict)          # то, что извлёк парсер
    confidence     = Column(Float, default=0.0)
    last_parsed_at = Column(DateTime, nullable=True)

    document = relationship("Document", back_populates="widget_data")


class DocumentTag(Base):
    __tablename__ = "document_tags"

    document_id = Column(Integer, ForeignKey("documents.id"), primary_key=True)
    tag_id      = Column(Integer, ForeignKey("tags.id"),      primary_key=True)

    document = relationship("Document", back_populates="doc_tags")
    tag      = relationship("Tag")


# ──────────────────────────────────────────────
# DI helper
# ──────────────────────────────────────────────

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def create_tables():
    Base.metadata.create_all(bind=engine)
