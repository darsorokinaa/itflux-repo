-- Таблица для импорта из Excel (scripts/import_to_db.py)
-- Выполните один раз в нужной БД:
--   psql "$DATABASE_URL" -f scripts/sql/fipi_part2_import.sql

CREATE TABLE IF NOT EXISTS fipi_part2_import (
    id              BIGSERIAL PRIMARY KEY,
    task_condition  TEXT,
    file_content    TEXT,
    file_url        TEXT,
    imported_at     TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE fipi_part2_import IS 'Сырые строки из Excel (FIPI часть 2), см. scripts/import_to_db.py';
