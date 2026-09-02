# Исходники интерактивов (не public/)

Папки отсюда **не копируются** в `dist/` при сборке Vite.

Не кладите материалы в `frontend/public/interesting/`: на проде nginx
считает `dist/interesting/` статическим каталогом без `index.html` и
отдаёт **403** на SPA-маршрут `/interesting/` (в том числе после кнопки
«Обновить» с `?_itflux_v=`).
