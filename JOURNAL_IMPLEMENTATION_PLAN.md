# Электронный журнал успеваемости — план реализации

Статус: **реализовано**. Основной UI — классическая таблица (ученики × даты/темы), как школьный электронный журнал. SaaS-модели не затрагиваются.

## Ключевые решения

| Решение | Выбор |
|---|---|
| Якорь урока | `ScheduleEvent` (факт занятия), не контент-шаблон `Lesson` |
| Ученик | `Student` (roster учителя), не `User` напрямую |
| Посещаемость | Единый `AttendanceStatus` в журнале; биллинг читает через маппинг → `DeliveryStatus` |
| ДЗ | Связь с существующим `Homework` / `HomeworkSubmission` |
| Telegram | Существующий бот + `NotificationPreference` + `send_telegram_to_user` |
| Приглашения | Без новых ссылок |

## Существующие сущности → использование в журнале

| Существующая сущность | Использование в журнале | Необходимые изменения |
| --------------------- | ----------------------- | --------------------- |
| `User` + `Profile` | Учитель / ученик-аккаунт, права | Без изменений |
| `Student` | Участник записи журнала | FK в `StudentLessonRecord` |
| `StudentGroup` | Групповой журнал, фильтры | FK в `LessonJournal` |
| `Lesson` | Плановая тема / материалы (опц.) | Без изменений |
| `ScheduleEvent` | OneToOne якорь `LessonJournal` | Хук complete → drawer итогов |
| `ScheduleEventParticipant` | Список участников группы | Без изменений |
| `LessonPlanItem` | Плановая тема | Подстановка `planned_topic` |
| `Homework` / `HomeworkTask` | Выданное ДЗ в итогах | FK в `LessonJournal` |
| `HomeworkSubmission` | Статус предыдущего ДЗ | Read-only / infer status |
| `ReviewItem` | Вход из проверки ДЗ | Кнопка «Итоги урока» |
| `MeetingAttendance` | Не источник истины | Не дублируем |
| `DeliveryStatus` / billing | Оплата после посещаемости | Preview подставляет из журнала |
| `NotificationPreference` | Telegram prefs | +4 флага journal |
| Расписание / EventDetailCard | Вход в итоги | Кнопка «Итоги урока» |
| VideoMeetingPage | После «Завершить урок» | Открывает drawer |
| CabinetDashboard | Виджет внимания | Блок «Журнал» |
| Student cabinet | «Мои результаты» | Раздел + API |
| cabinetNav / studentNav | «Журнал» / «Результаты» | Добавлено |

## Новые файлы

### Backend
- `Cabinet/journal_models.py` — модели
- `Cabinet/journal_service.py` — бизнес-логика
- `Cabinet/journal_api.py` — REST API
- `Cabinet/journal_notifications.py` — Telegram/in-app
- `Cabinet/migrations/0031_lesson_journal.py`
- `Cabinet/tests_journal.py` — 21 тест

### Frontend
- `frontend/src/cabinet/components/LessonSummaryDrawer.jsx` — единые «Итоги урока»
- `frontend/src/cabinet/pages/CabinetJournalPage.jsx` — раздел Журнал
- `frontend/src/cabinet/student/pages/StudentResultsPage.jsx`
- `frontend/src/cabinet/journal/journalAutosave.ts` (+ test)
- `frontend/src/cabinet/styles/journal.css`

## API (`/api/cabinet/journal/`)

| Method | Path | Назначение |
|---|---|---|
| GET | `/journal/` | Обзор / внимание |
| GET | `/journal/gradebook/?group_id=` / `student_id=` | Матрица таблицы |
| GET | `/journal/lessons/` | Список по урокам |
| GET/PATCH/POST | `/journal/lessons/<event_id>/` | Деталь / автосохранение |
| POST | `/journal/lessons/<event_id>/complete/` | Завершить итоги |
| POST | `/journal/lessons/<event_id>/publish/` | Опубликовать ученику |
| POST | `/journal/lessons/<event_id>/bulk/` | Массовые действия |
| GET | `/journal/students/` | Сводка по ученикам |
| GET | `/journal/students/<id>/` | Карточка успеваемости |
| GET | `/journal/groups/<id>/` | Журнал группы |
| GET | `/journal/attendance/` | Отчёт посещаемости |
| GET | `/journal/analytics/` | Динамика критериев |
| CRUD | `/journal/criteria/`, `/templates/`, `/tags/` | Настройки |
| GET/PATCH | `/journal/settings/` | Настройки учителя |
| GET | `/journal/export/` | CSV / XLSX / PDF |
| GET | `/student/results/` | Кабинет ученика |
| GET | `/student/results/<id>/` | Деталь (без private_note) |

## Этапы

1. Основа (модели, критерии, API, миграции) — **готово**
2. Завершение урока (единый UI итогов) — **готово**
3. Раздел «Журнал» — **готово**
4. ДЗ и оплаты (интеграция) — **готово**
5. Кабинет ученика — **готово**
6. Аналитика и экспорт — **готово**
7. Telegram — **готово**
8. Адаптивность и тесты — **готово**

## Тесты

- Backend: `python manage.py test Cabinet.tests_journal --keepdb` → **21 OK**
- Frontend: `npm test -- src/cabinet/journal/journalAutosave.test.ts` → **5 OK**
- Production build: `npm run build` → **OK**

## Известные ограничения

1. Полноэкранный/компактный режим таблицы и клавиатурная навигация по ячейкам — базовая поддержка (Ctrl/Cmd+S, sticky-колонка); расширенный spreadsheet-UX можно углубить.
2. Динамика на отдельной вкладке — через карточку ученика; отдельный multi-chart UI минимален.
3. Создание нового ДЗ из drawer ведёт в существующий модуль проверки/выдачи, без отдельного конструктора внутри журнала.
4. PDF-экспорт зависит от WeasyPrint в окружении; при недоступности fallback на CSV.
5. Маркер внимания на дашборде ученика/родителя не показывается (только учителю).
6. Одновременное редактирование разными учителями маловероятно; конфликт версий + tab_token для вкладок.

## Ручные проверки на staging

- [ ] Индивидуальный урок: расписание → Итоги урока → посещаемость → критерии → сохранить → опубликовать
- [ ] Групповой урок: отметить всех → таблица → карточка ученика → следующий ученик
- [ ] Видеовстреча: Завершить урок → открылся drawer итогов
- [ ] Ученик видит только опубликованное, без приватной заметки
- [ ] Telegram: одно сообщение при публикации; автосохранение не шлёт
- [ ] Оплаты: preview подставляет delivery из журнала
- [ ] Mobile 375px: карточки учеников, кнопки ≥ 44px
- [ ] Desktop 1280px: таблица с sticky-именем
