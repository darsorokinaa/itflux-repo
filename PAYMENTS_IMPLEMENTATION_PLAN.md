# Учёт оплат репетитора — план реализации

Статус: **реализовано (MVP управленческого учёта)**. SaaS-модели `Payment` / `TariffPlan` / `TeacherSubscription` не затронуты.

## Существующие сущности → роль в биллинге

| Сущность | Роль |
|---|---|
| `User` + `Profile` | Автор операций, права, timezone |
| `Student` | Ученик биллинга |
| `StudentGroup` | Групповые цены / отчёты |
| `StudentInvitation` | Без изменений (одна ссылка) |
| `ScheduleEvent` | Основная биллируемая сущность урока |
| `ScheduleEventParticipant` | Построчный биллинг группы |
| `Lesson` | Шаблон; не хранит оплату |
| `NotificationPreference` + Telegram | Флаги и сводки оплат |
| `Payment` (SaaS) | Не используется |

## Новые сущности (`Cabinet/billing_models.py`)

- `TeacherBillingSettings`
- `BillingAccount`
- `StudentBillingSettings`
- `TeacherPriceRule`
- `LessonPackage` (Decimal units)
- `EventBillingRecord`
- `BillingTransaction` (append-only)
- `StudentPayment` + `StudentPaymentAllocation`
- `BillingAuditLog`
- `PaymentReminderLog`
- `MonthlyBillingPeriod`

Разделение: **начислено** / **оплачено** / **остаток** — через журнал.

## API (`/api/cabinet/billing/`)

См. `Cabinet/billing_api.py`, `Cabinet/billing_service.py`.

## Frontend

- `/cabinet/payments` — раздел «Оплаты»
- Навигация: пункт «Оплаты»
- Дашборд — виджет внимания
- Расписание — badge + finalize/оплата
- Карточка ученика — блок оплаты
- Создание урока — preview цены/абонемента
- Настройки уведомлений — секция «Оплаты»
- Профиль ученика — read-only при разрешении учителя

## Миграции

1. `0030_student_billing` — модели + prefs Telegram для оплат

Старые уроки: `financial_status=not_specified`, backfill через API `legacy-backfill`.

## Этапы

1. Финансовая основа — done
2. Разовые оплаты + UI — done
3. Абонементы — done
4. Завершение/отмена — done
5. Раздел «Оплаты» + отчёты — done
6. Telegram — done (prefs + digests command + reminders)
7. Mobile — done (CSS cards / FAB)
8. Тесты — `Cabinet/tests_billing.py`, `billingFormat.test.js`

## Риски / совместимость

- Имена: `StudentPayment` ≠ SaaS `Payment`
- Двойное списание: idempotency + `select_for_update`
- Группы: отдельный `EventBillingRecord` на ученика
- Смена тарифа не меняет исторические snapshot
- Invite и Telegram-connect без новых ссылок
