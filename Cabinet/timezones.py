"""Часовые пояса кабинета: каталог для UI и подписи городов."""

from __future__ import annotations

from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


DEFAULT_TIMEZONE = "Europe/Moscow"

# (iana, город, смещение) — учитель вводит время в своём поясе, ученик видит в своём.
SCHEDULE_TIMEZONES = (
    ("Europe/Kaliningrad", "Калининград", "UTC+2"),
    ("Europe/Kyiv", "Киев", "UTC+2"),
    ("Europe/Moscow", "Москва, Санкт-Петербург", "UTC+3"),
    ("Europe/Simferopol", "Симферополь", "UTC+3"),
    ("Europe/Minsk", "Минск", "UTC+3"),
    ("Europe/Istanbul", "Стамбул", "UTC+3"),
    ("Europe/Samara", "Самара, Ижевск", "UTC+4"),
    ("Europe/Astrakhan", "Астрахань", "UTC+4"),
    ("Europe/Saratov", "Саратов", "UTC+4"),
    ("Europe/Ulyanovsk", "Ульяновск", "UTC+4"),
    ("Asia/Baku", "Баку", "UTC+4"),
    ("Asia/Yerevan", "Ереван", "UTC+4"),
    ("Asia/Tbilisi", "Тбилиси", "UTC+4"),
    ("Asia/Yekaterinburg", "Екатеринбург, Пермь, Челябинск", "UTC+5"),
    ("Asia/Qyzylorda", "Кызылорда", "UTC+5"),
    ("Asia/Almaty", "Алматы, Астана", "UTC+5"),
    ("Asia/Tashkent", "Ташкент", "UTC+5"),
    ("Asia/Omsk", "Омск", "UTC+6"),
    ("Asia/Novosibirsk", "Новосибирск, Барнаул", "UTC+7"),
    ("Asia/Tomsk", "Томск", "UTC+7"),
    ("Asia/Krasnoyarsk", "Красноярск", "UTC+7"),
    ("Asia/Novokuznetsk", "Новокузнецк", "UTC+7"),
    ("Asia/Irkutsk", "Иркутск, Улан-Удэ", "UTC+8"),
    ("Asia/Chita", "Чита", "UTC+9"),
    ("Asia/Yakutsk", "Якутск", "UTC+9"),
    ("Asia/Vladivostok", "Владивосток, Хабаровск", "UTC+10"),
    ("Asia/Magadan", "Магадан", "UTC+11"),
    ("Asia/Sakhalin", "Южно-Сахалинск", "UTC+11"),
    ("Asia/Kamchatka", "Петропавловск-Камчатский", "UTC+12"),
    ("Asia/Anadyr", "Анадырь", "UTC+12"),
)

_BY_NAME = {item[0]: item for item in SCHEDULE_TIMEZONES}


def timezone_option_label(tz_name: str, city: str, offset: str) -> str:
    return f"{city} ({offset})"


def timezone_city_label(tz_name: str | None) -> str:
    name = (tz_name or "").strip() or DEFAULT_TIMEZONE
    item = _BY_NAME.get(name)
    if item:
        return item[1].split(",")[0].strip()
    return name.split("/")[-1].replace("_", " ")


def timezone_select_options() -> list[dict]:
    return [
        {
            "value": tz_name,
            "label": timezone_option_label(tz_name, city, offset),
            "city": city,
            "offset": offset,
        }
        for tz_name, city, offset in SCHEDULE_TIMEZONES
    ]


def normalize_timezone_name(name: str | None) -> str | None:
    text = (name or "").strip()
    if not text:
        return None
    try:
        ZoneInfo(text)
    except ZoneInfoNotFoundError:
        return None
    return text
