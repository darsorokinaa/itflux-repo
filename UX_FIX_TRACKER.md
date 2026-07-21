# UX Fix Tracker

| № | Страница | Проблема | Файлы | Решение | Приоритет | Статус | Комментарий |
| - | -------- | -------- | ----- | ------- | --------- | ------ | ----------- |
| 1 | Регистрация | Роль parent ведёт в кабинет учителя | CabinetAuthPage.jsx, cabinetAuth.js, App.jsx, Cabinet/views.py | Роль убрана из UI; API отклоняет регистрацию parent; stub удалён | Critical | Completed | Родитель временно полностью отключён |
| 2 | Для учителей | Фейковый success при отсутствии API | ForTeachersPage.jsx, teacherLinks.ts, Cabinet/views.py, models, admin | Реальный POST `/api/teacher-applications/` + admin | Critical | Completed | Модель TeacherApplication |
| 3 | Отчёты | Фиктивные карточки и кнопки | CabinetReportsPage.jsx | Блок «Раздел находится в разработке» + ссылка в Проверку | Critical | Completed | |
| 4 | Уроки | «Открыть» → notifySoon | CabinetLessonsPage.jsx, CabinetSchedulePage.jsx | Переход в расписание с `openEventId` | Critical | Completed | |
| 5 | Библиотека | Фиктивные карточки банка задач | CabinetLibraryPage.jsx | CTA в `/tasks` | Critical | Completed | |
| 6 | Задание ученика | Потеря ответа при возврате фокуса | StudentAssignmentDetailPage.jsx | `isDirty` + preserveLocal | Critical | Completed | + «Убрать файл» |
| 7 | Ученики | «Запланировать урок» открывает редактирование | CabinetStudentsPage.jsx, CabinetSchedulePage.jsx | `createWithGroupId` → CreateScheduleLessonModal | High | Completed | |
| 8 | Видеовстреча | Нет подтверждения завершения | VideoMeetingPage.jsx | ConfirmActionModal | High | Completed | |
| 9 | Layout | Выход по клику на аватар | CabinetLayout.jsx, StudentCabinetLayout.jsx | Аватар → профиль; confirm на «Выйти» | High | Completed | |
| 10 | Layout | Кнопка «Настройки» без реакции | CabinetLayout.jsx, CabinetMorePage.jsx | Ссылка на `/cabinet/settings/notifications/` | High | Completed | Страница уже есть |
| 11 | ИИ | soon/disabled при рабочей странице | cabinetNav.js | Убраны soon/disabled | High | Completed | |
| 12 | Проверка | Метрика «Просрочено» = 0 | CabinetReviewPage.jsx, homework_api.py | Счёт по overdue + due_at в API | High | Completed | |
| 13 | Кабинет ученика | Декоративный поиск | StudentCabinetLayout.jsx | Поле поиска удалено | High | Completed | |
| 14 | Мобильная навигация | Двойная навигация st-layout | cabinet-dashboard.css | Sidebar скрыт ≤900px | High | Already fixed | Проверено в CSS |
| 15 | Дашборд учителя | Быстрые действия — только Link | CabinetDashboard.jsx | HomeworkAssignModal + `?invite=1` | Medium | Completed | |
| 16 | Расписание | Конфликты без деталей | CreateScheduleLessonModal.jsx | Список пересечений с временем/названием | Medium | Completed | |
| 17 | Расписание | «Дублировать» → notifySoon | CabinetSchedulePage.jsx | Черновик копии без автосохранения | Medium | Completed | |
| 18 | Кабинет | window.confirm() | Students, Groups, Review, Boards, Plans, Interactives… | ConfirmActionModal везде в cabinet | Medium | Completed | В `frontend/src/cabinet` confirm больше нет |
| 19 | Доски | window.prompt() для переименования | CabinetBoardsPage.jsx | CabinetModal с полем | Medium | Completed | |
| 20 | Интерактивы | Удаление карточек без undo | CabinetInteractiveEditorPage.jsx | undo-toast 6с | Medium | Completed | |
| 21 | Расписание | Техтекст YANDEX_… | CabinetSchedulePage.jsx | Понятная формулировка | Medium | Completed | |
| 22 | Задание ученика | Нет «Убрать файл» | StudentAssignmentDetailPage.jsx | Кнопка очистки | Medium | Completed | |
| 23 | Материалы ученика | Некликабельные выглядят кликабельно | StudentMaterialsPage.jsx | disabled + «Файл не прикреплён» | Medium | Completed | |
| 24 | Тарифы | Disabled «Оставить заявку» | CabinetUpgradePage.jsx | Telegram TEACHERS_TELEGRAM_URL | Medium | Completed | |
| 25 | Профиль ученика | Toast success/error одинаковые | StudentProfilePage.jsx | Типы + иконки + CSS | Low | Completed | |
| 26 | Дашборды | Дублирующие быстрые действия | CabinetDashboard, StudentDashboard | Оставлены контекстные CTA | Low | Completed | |
| 27 | Группы | Иконка ⋯ вместо карандаша | CabinetStudentsPage.jsx | pencil + aria-label | Low | Completed | |
| 28 | Кнопки | Локальные семейства классов | Schedule, Plan editor, CSS | JSX → `.cb-btn*`; алиасы `.cb-sch-btn`/`.cb-pe-btn` оставлены | Low | Completed | Layout-модификаторы `--add/--today/--create` сохранены |
| 29 | Мёртвые страницы ученика | Неиспользуемые компоненты | Student*Page.jsx, App.jsx | Удалены 4 файла | Low | Completed | |

## Легенда статусов

- **Pending** — ещё не начато
- **In progress** — в работе
- **Completed** — исправлено в этом цикле
- **Already fixed** — уже было исправлено ранее
- **Rejected with reason** — отклонено с причиной
