# Аудит видеозвонков 8x8 JaaS — «Цифровой поток»

Второй этап (доступность из России, диагностика, восстановление, резервный канал) записан в `JAAS_RUSSIA_CONNECTIVITY_PLAN.md`. Этот файл по-прежнему описывает первый аудит. Раздел 16 внизу фиксирует, что изменилось на втором этапе и чего живой звонок по-прежнему не подтвердил.

Дата: 2026-10-11. Среда: macOS (darwin), репозиторий `itflux`. Production-сервисы не перезапускались, production-конфигурация и секреты не читались и не менялись.

Статусы:

- **PASS** — проверка реально выполнена и результат совпал с ожиданием.
- **FAIL** — дефект подтверждён. Если ниже написано «исправлено», исправление покрыто тестом, но живой звонок этим тестом не доказан.
- **NOT TESTED** — проверка не выполнялась.
- **BLOCKED** — в этой среде проверить нельзя.
- **NOT SUPPORTED** — так устроен браузер или сервис, это не баг платформы.

Разбор исходного кода не считается успешным испытанием реального видеозвонка. Моки Jitsi не доказывают, что звук и видео доходят до второго участника.

## 1. Текущая архитектура

Провайдер выбирается `VIDEO_PROVIDER` (`meet` по умолчанию, `jaas` — 8x8). Комната урока — одно поле `VideoMeeting.room_name`. Для JaaS клиент подключается к `8x8.vc`, комнату External API получает как `{JAAS_APP_ID}/{roomName}`, JWT подписывается на backend (RS256). Свой Jitsi и JaaS не смешиваются в одном ответе `join-config`.

```text
«Присоединиться» / авто-вход в live-урок
        │
        ▼
VideoMeetingPage.initializeJitsi
        │  POST /api/video-meetings/<uuid>/join-config/
        ▼
Django: роль teacher/student, статус live, room_name из БД
        │  JWT (room = локальное имя, moderator = "true"|"false")
        ▼
loadJitsiExternalApi → https://8x8.vc/{appId}/external_api.js
        │
        ▼
new JitsiMeetExternalAPI("8x8.vc", { roomName: appId/room, jwt, configOverwrite })
        │  iframe на 8x8.vc, сигнализация внутри iframe (WebSocket XMPP)
        ▼
ожидание videoConferenceJoined (hint 15 с, fatal 60 с)
        │
        ├─ mute/camera/device/ICE события → watchdog
        ├─ connectionFailed / conferenceFailed → grace 4 с → hard reconnect (новый join-config)
        └─ hangup / уход со страницы → dispose iframe, посещаемость, release вкладки
```

Что делает JaaS, а не наш код: ICE, STUN/TURN, выбор региона моста, DTLS/SRTP, адаптация битрейта, Opus, перезапуск ICE (`enableIceRestart: true` только включает штатный механизм клиента). Своих TURN и медиасерверов в интеграции нет. P2P выключен (`p2p.enabled: false`), медиа идёт через JVB.

## 2. Проверенные компоненты

| Компонент | Файл | Статус проверки |
|---|---|---|
| `VIDEO_PROVIDER`, `JAAS_*` | `Generator/settings.py`, `Generator/Generator/settings.py` | PASS, чтение кода. Значение production env — NOT TESTED |
| JWT RS256, kid, room, moderator | `Cabinet/jaas_service.py` | PASS, `Cabinet/tests_jaas.py` |
| `join-config`, роли, roomName | `Cabinet/video_meeting_service.py`, `Cabinet/video_meeting_api.py` | PASS, тесты JaaS |
| External API, configOverwrite, iframe | `frontend/src/cabinet/jitsiMeet.js` | PASS, модульные тесты |
| Страница урока, dispose, reconnect | `frontend/src/cabinet/pages/VideoMeetingPage.jsx` | PASS, статический разбор. Живой звонок NOT TESTED |
| Док материалов (второй звонок) | `frontend/src/cabinet/components/MeetingCallDock.jsx` | PASS, статический разбор |
| Владение вкладкой | `frontend/src/cabinet/meetingCallOwnership.js` | PASS, статический разбор |
| Watchdog аудио/сети | `frontend/src/cabinet/jitsiMediaWatchdog.js` | PASS, тесты после правок |
| Телеметрия без JWT | `frontend/src/cabinet/jitsiTelemetry.js`, `Cabinet/video_meeting_service.py` | PASS, статический разбор |
| CSP / Permissions-Policy | `deploy/nginx.conf`, `Generator/Generator/middleware.py` | PASS, статический разбор |
| Зависимость `@jitsi/electron-sdk` | `frontend/package.json` | Браузерный урок её не грузит. Electron remote control — NOT TESTED |
| Реальный двусторонний звонок | — | NOT TESTED |

`@jitsi/electron-sdk` 10.0.6 используется для remote control в десктопе. Браузерный урок грузит `external_api.js` с `8x8.vc` на каждый вход, то есть версию клиента задаёт 8x8, не npm. Команды, которые мы вызываем (`toggleAudio`, `toggleVideo`, `setVideoQuality`, `setAudioInputDevice`, `setAudioOutputDevice`, `overwriteConfig`, `hangup`), есть в текущем IFrame API. `setAudioMuted` в документации команд нет, поэтому unmute делается через `toggleAudio` только после проверки `isAudioMuted()`.

## 3. Состояние аудио

Путь: микрофон → `getUserMedia` внутри iframe JaaS → WebRTC → JVB 8x8 → iframe второго участника → устройство вывода. Платформа микрофон сама не захватывает.

| Проверка | Статус |
|---|---|
| Разрешение микрофона, `NotAllowedError` | PASS по коду: `micError` → «Нет разрешения на микрофон», без toggle. Живой диалог браузера NOT TESTED |
| Захват и передача звука | NOT TESTED |
| Mute / unmute | PASS по коду: событие `audioMuteStatusChanged` пишет намерение и sessionStorage. Живой звук NOT TESTED |
| Смена микрофона | PASS по коду: `deviceListChanged` → `setAudioInputDevice`, если текущий id пропал |
| Смена динамиков | PASS по коду: best-effort, если `isDeviceChangeAvailable("output")` ложно — не ошибка. На Safari setSinkId часто NOT SUPPORTED |
| Bluetooth / гарнитура hot-plug | NOT TESTED. Код реагирует на `deviceListChanged`, не на конкретный Bluetooth-стек |
| Повтор после отказа разрешения | NOT TESTED. Повторный `getUserMedia` сам по себе разрешение не возвращает: это жест пользователя в Jitsi |
| Звук после смены сети | NOT TESTED |
| Звук после блокировки экрана | NOT TESTED. На iOS/Android ОС может приостановить WebRTC |
| AEC / NS / AGC | NOT TESTED. Отдельного отключения в `configOverwrite` нет, остаются значения JaaS |
| Индикатор микрофона есть, собеседник не слышит | NOT TESTED как симптом. Код ловит только рассинхрон «хотели включено, а `muted===true`», не тихий трек при `muted===false` |
| Слышит, но не может говорить | NOT TESTED |
| Видео есть, звука нет | NOT TESTED |
| Autoplay | PASS по коду: iframe `allow` содержит `autoplay`. Блокировка браузером NOT TESTED |
| `NotFoundError` / `NotReadableError` / `AbortError` | PASS по классификатору. `AbortError` больше не считается «устройство занято» и не переключает mute |
| Две вкладки урока | PASS по коду: вторая вкладка получает `claim` и вызывает `dispose`. До claim обе могут кратко поднять iframe; `replaceParticipant: true` просит Prosody вытеснить старый вход с тем же user id. Живой сценарий NOT TESTED |

Первый вход специально с выключенным микрофоном (`startWithAudioMuted: true` в `jitsiMeet.js`, около строки 401). Если в этом уроке микрофон уже включали, страница читает sessionStorage и входит без mute. Это не дефект.

## 4. Состояние камеры

| Проверка | Статус |
|---|---|
| Разрешение камеры, `NotAllowedError` | PASS по коду. Живой диалог NOT TESTED |
| Включение / выключение | PASS по коду: `videoMuteStatusChanged` |
| Передача изображения второму участнику | NOT TESTED |
| Передняя / задняя, USB / встроенная | NOT TESTED. Переключение камеры — кнопка Jitsi `toggle-camera` в развёрнутой панели |
| Камера пропала на время | PASS по коду для `track_ended` / `device_busy`: один toggle, не больше двух попыток |
| Чёрный экран, застывший кадр | NOT TESTED |
| Один видит свою камеру, второй — нет | NOT TESTED |
| 1080p и CPU | NOT TESTED. Конфиг просит ideal 1920×1080 и `setVideoQuality(1080)` после входа. На слабом устройстве это нагрузка Jitsi, не отдельный баг жизненного цикла |
| Лишний повторный захват камеры при смене раздела урока | PASS по коду: смена материалов не вызывает `dispose` звонка. Повторный `createJitsiMeetSession` блокируется `jitsiInitRef` / `apiRef` |

## 5. Состояние соединения

| Механизм | Кто им владеет | Статус |
|---|---|---|
| ICE, STUN/TURN, UDP/TCP, DTLS/SRTP | 8x8 JaaS внутри iframe | NOT TESTED в живом звонке |
| Перезапуск ICE | Клиент JaaS, флаг `enableIceRestart: true` | PASS, флаг есть в config и в embed URL. Срабатывание NOT TESTED |
| Сигнализация WebSocket / BOSH | JaaS. Для `8x8.vc` `preferBosh: false` | PASS по коду. Доступность сокета NOT TESTED |
| `connectionFailed` / `conferenceFailed` | Наш watchdog: 4 с, затем один hard reconnect (новый JWT и iframe), максимум 3 попытки с паузами 0 / 3 / 8 с | PASS, модульные тесты. Сеть NOT TESTED |
| `peerConnectionFailure` | Раньше iframe «на месте» считался выздоровлением. Теперь два сбоя подряд без `dataChannelOpened` дают один hard reconnect | PASS, тесты. Живой ICE NOT TESTED |
| `participantLeft` | Не рвёт свой звонок | PASS, тест |
| `readyToClose` | Осознанный выход, reconnect не стартует | PASS, тест |
| Разные комнаты у учителя и ученика | Один `room_name`, JWT `room` совпадает с ним, наружу `appId/room` | PASS, `tests_jaas.py`. Два живых клиента NOT TESTED |
| JWT и роли | Ученик не становится модератором, даже если просит это в теле запроса. Чужой пользователь — 403 | PASS, тесты |

Hard reconnect не реализует ICE restart и не подменяет TURN. Он заново берёт `join-config` и создаёт один iframe, сохраняя намерение по микрофону и камере (`recoveryRemountRef`).

## 6. Сетевые испытания

Обычный Network Throttling в DevTools не режет UDP медиатрафик. Таблица ниже поэтому не подменяется эмуляцией DevTools.

Замер с этой машины 2026-10-11 (не production-сервер, не сеть ученика, без JWT и без медиасессии):

| Цель | Результат |
|---|---|
| DNS и TCP 443 `8x8.vc` | PASS, TCP около 124 мс, HTTPS `200` около 1.1 с |
| DNS `jitsi.net` (корень зоны) | Нет A-записи. Это не блокировка: поддомен relay резолвится |
| TCP 443 `prod-8x8-eu-central-1-turnrelay-oracle.jitsi.net` (Frankfurt, 193.122.11.14) | PASS, около 58 мс |
| DNS US-East relay `prod-8x8-us-east-1-turnrelay-oracle.jitsi.net` | PASS, адрес получен |
| UDP STUN Binding на `stun.l.google.com:19302` | PASS, ответ 32 байта, около 201 мс. С этой сети UDP наружу в принципе ходит |
| UDP STUN Binding на TURN 8x8, порты 443 и 3478 | Таймаут. Сервер мог просто не отвечать на анонимный Binding. Это не доказательство, что UDP до JVB закрыт |

| Условия из задания | Статус |
|---|---|
| 10 / 3 / 1 Мбит/с, 500 / 250 Кбит/с | NOT TESTED |
| Потери 2% / 5% / 10% | NOT TESTED |
| RTT 200 / 400 мс | NOT TESTED |
| Обрыв 5 / 15 / 30 с | NOT TESTED |
| Wi-Fi ↔ 4G/5G | NOT TESTED |
| Звук сохраняется при деградации видео | NOT TESTED. В конфиге `channelLastN: 8` ограничивает видеослои, не аудио. Приоритет аудио на мосту — поведение JVB, мы его не измеряли |
| Микрофон не гасится после короткого разрыва | NOT TESTED. По коду hard reconnect читает «микрофон был включён» и не форсирует mute |

### Почему без VPN бывает хуже

Симптом «без VPN рвётся, с VPN стабильнее» с этой машины не воспроизводился: двустороннего звонка не было. Технически правдоподобная причина на стороне сети ученика, не в коде комнаты:

1. Медиа 8x8 идёт на адреса JVB/TURN из их whitelist (UDP 443 и 49152–65535, плюс TURN over TLS на TCP 443). Часть российских сетей режет или портит UDP до зарубежных адресов и длинные WebSocket. VPN уводит этот трафик в обход.
2. Наш клиент уже не использует P2P, так что прямой UDP между учителем и учеником не является путём по умолчанию.
3. Принудительно подставлять `iceServers` на один регион или `iceTransportPolicy: "relay"` нельзя без замера: неверный регион увеличит задержку у тех, у кого прямой путь к мосту и так работает. Это настройка JaaS, не свой TURN.

Что можно сделать без смены провайдера, когда появятся замеры с проблемного абонента: в аналитике 8x8 или в статистике Jitsi посмотреть, выбран ли relay и `turns:` (TCP/TLS 443). Если UDP-кандидаты умирают, а TCP 443 жив, это фильтр сети. Лечение — разрешение доменов и IP из документа 8x8 «Meetings domains and IP's» на стороне сети ученика, либо штатный TURN-over-TLS, который JaaS уже отдаёт клиенту. Отдельный ICE restart в Django/React писать не нужно.

## 7. Матрица браузеров

Ни один браузер из списка в этой сессии не запускался. Везде **NOT TESTED**. Ограничения браузера, которые нельзя записывать как баг платформы:

| Браузер | Ограничение | Статус функции |
|---|---|---|
| Safari macOS / iOS, Chrome iOS (WebKit) | Смена устройства вывода часто недоступна (`setSinkId`) | NOT SUPPORTED |
| iOS, все браузеры | getUserMedia и WebRTC только через WKWebView; фон и блокировка экрана ставят медиа на паузу | Ограничение ОС, NOT TESTED |
| iOS | Демонстрация экрана из обычной вкладки ограничена системой | NOT SUPPORTED в большинстве случаев |
| Firefox Android | Фоновая вкладка может остановить захват | NOT TESTED |
| Desktop Chrome, Edge, Яндекс, Opera, Firefox, Safari | Вход, микрофон, камера, звук, видео, reconnect, iframe, screen share | NOT TESTED |

Яндекс Браузер на Chromium наследует поведение Chrome, пока не включены отдельные блокировки WebRTC. Это не результат прогона.

## 8. Матрица устройств

Все категории из задания (Windows ПК и ноутбуки, Mac Intel и Apple Silicon, iPhone, iPad, Android телефон и планшет, Bluetooth, AirPods, USB-микрофон, внешняя камера, поворот, входящий звонок, энергосбережение, возврат из фона) — **NOT TESTED**.

Если iOS или Android гасят камеру и PeerConnection в фоне, страница может только заново войти после `visibilitychange` / `pageshow`. Вернуть трек, который убила ОС, до возврата в приложение нельзя. Обещать непрерывный звук в фоне нельзя.

## 9. Интеграция с уроком

| Проверка | Статус |
|---|---|
| tldraw / WebSocket доски | NOT TESTED в браузере. Код доски этим аудитом не менялся |
| Демонстрация экрана, задания, ДЗ, смена раздела, загрузка файлов | NOT TESTED в браузере |
| Звонок уничтожается при смене раздела | PASS по коду: `MeetingCallDock` на странице урока звонок не поднимает (`onMeetingPage`). Материалы в iframe не создают второй `JitsiMeetExternalAPI` |
| Второй iframe / второй микрофон | PASS по коду для штатного перехода в материалы. Две вкладки самого урока — см. аудио, живой прогон NOT TESTED |
| Re-render доски пересоздаёт Jitsi | PASS по коду: экземпляр держится в ref, не в состоянии доски |
| Сворачивание / разворот панели | Меняется toolbar через `overwriteConfig`, без нового iframe. Визуально NOT TESTED |

## 10. Логи и диагностика

Уже пишется, без JWT и без ключей: выдача `join-config` (урок, пользователь, роль, домен, факт JWT, exp), `conference_joined`, `participant_joined/left`, `connection_failed`, `conference_failed`, `peer_connection_failure`, hard reconnect, смена аудиоустройства. В браузерную консоль JWT не кладётся (`sanitizeJitsiEvent`).

На втором этапе выяснилось, что бэкенд принимает только типы из `MeetingTechnicalEvent.EventType`. События `jitsi_hard_reconnect_*`, `mic_error`, `camera_error` и `call_stage` раньше отбрасывались. Теперь `toPersistableTechnicalEvent` кладёт их в уже разрешённые типы и сохраняет исходное имя в `metadata.clientEvent`. Новых типов в базе нет. Классификатор `classifyJoinStop` отдельно помечает этап остановки: скрипт, iframe, сигнализация, ICE, нет медиа, обрыв уже открытого канала, JWT, устройство. Наличие iframe по-прежнему не считается работающим WebRTC. Браузер не отделяет DNS от обрыва HTTPS: оба пишутся как `dns_or_https` с `dnsSeparated: false`.

IFrame API не отдаёт сырой `RTCPeerConnection.getStats` из-за чужого origin. Нельзя честно обещать из нашей страницы RTT, loss, jitter, audio concealment и битрейт, если их нет в официальном событии. Агрегаты — в аналитике 8x8 JaaS, не в обходе iframe.

События, которые API документирует и мы слушаем: `videoConferenceJoined/Left`, `participantJoined/Left`, `audioMuteStatusChanged`, `videoMuteStatusChanged`, `micError`, `cameraError`, `deviceListChanged`, `connectionFailed`, `conferenceFailed`, `peerConnectionFailure`, `dataChannelOpened`, `readyToClose`, `errorOccurred`. `suspendDetected` не подписан: на мобильном фоне это сигнал Jitsi, но без устройства подписка ничего бы не доказала.

## 11. Найденные проблемы

### P0

Живых P0 (нет звука, нельзя войти, обрыв без восстановления, разные комнаты) в этой сессии не подтверждено. Разные комнаты по коду и тестам JWT не воспроизводятся.

### P1 — исправлено в коде

**1. Загрузка `external_api.js` обрывалась через 15 с.**  
Файл: `frontend/src/cabinet/jitsiMeet.js` (теперь константа на строке 56, раньше таймаут был равен hint 15 с).  
Симптом: на медленном канале до 8x8 урок падает с «Не удалось загрузить Jitsi», хотя fatal-ожидание входа — 60 с.  
Причина: таймаут скрипта совпадал с мягким hint.  
Исправление: таймаут скрипта 45 с. Проба связи по-прежнему 15 с (`JOIN_TIMEOUT_MS`).  
Риск: мёртвый CDN теперь показывает ошибку позже.  
Проверка: модульный тест «дольше, чем hint 15 с». Живая загрузка скрипта — NOT TESTED.

**2. `toggleAudio` мог выключить живой микрофон.**  
Файл: `frontend/src/cabinet/jitsiMediaWatchdog.js`, восстановление около строки 636.  
Симптом: индикатор микрофона гаснет сам, собеседник перестаёт слышать, либо unmute и mute срабатывают парой.  
Условие: два вызова восстановления, пока `isAudioMuted()` ещё true (tick, `micError` и смена устройства). `toggleAudio` не устанавливает состояние, а переключает его.  
Исправление: один полёт за раз, свежий `isAudioMuted()` перед командой, сброс замка по событию mute. `AbortError` не запускает toggle.  
Риск: повторная попытка ждёт событие или 1.5 с.  
Проверка: тесты «не два toggle» и «AbortError не включает звук». Живой микрофон — NOT TESTED.

**3. JWT JaaS для урока жил 2 часа, у своего Jitsi — не меньше 4.**  
Файл: `Cabinet/video_meeting_service.py`, строки 1175–1184. Потолок по-прежнему 4 часа в `jaas_ttl_seconds`.  
Симптом: длинный урок, внутреннее переподключение XMPP со старым токеном, `jitsi_auth`.  
Исправление: для live `join-config` тот же пол 4 часа. Диагностическая проба по-прежнему передаёт 180 с явно.  
Риск: токен урока живёт дольше, но не дольше уже существующего потолка и не является wildcard.  
Проверка: `tests_jaas.py`, `exp - iat` около 4 часов. Повторный вход через 2 часа в живой комнате — NOT TESTED.

**4. Сбой PeerConnection считался выздоровлением, если iframe ещё в DOM.**  
Файл: `frontend/src/cabinet/jitsiMediaWatchdog.js`, порог около строки 522.  
Симптом: сигнализация жива, звук и видео нет, баннер восстановления не появляется.  
Причина: `iframe.isConnected` не означает, что ICE жив. Один `peerConnectionFailure` по-прежнему отдаётся штатному ICE restart JaaS. Второй сбой без `dataChannelOpened` один раз пересоздаёт сессию.  
Риск: два ложных `peerConnectionFailure` на здоровом звонке дадут короткий обрыв и новый вход.  
Проверка: модульные тесты. Живой ICE — NOT TESTED.

### P2 — не менялось

**Высокий стартовый битрейт и 1080p.** `startBitrate: 1500` и ideal 1080 в `jitsiMeet.js` около строки 445. На узком uplink видео может забить канал, пока оценка полосы не снизится. JVB обычно бережёт аудио, но это не измерялось. Конфиг не менялся: нет замера на реальном уроке, а тесты камеры фиксируют 1080 как выбранное качество.

**Bluetooth.** Восстановление завязано на список устройств браузера. Поведение AirPods и переключение профиля HFP/A2DP — NOT TESTED.

### P3

Сообщения `micError` / `cameraError` уже на русском для permission, missing, busy, ended, abort. Отдельного индикатора качества полосы нет и из iframe его не из чего честно собрать. Подсказка при слабой сети без метрик была бы гаданием.

### Жизненный цикл, который багом не оказался

- React StrictMode (`frontend/src/main.jsx`) в production эффекты дважды не гоняет. В dev обрыв идёт через `AbortController` и поколение `initGen`. Преждевременный `dispose` до `videoConferenceJoined` отменяет вход и убирает iframe.
- Повторная инициализация при живом `apiRef` не стартует.
- Замена сессии теперь вызывает dispose предыдущей сессии целиком (watchdog и слушатели раскладки), а не только `api.dispose()`.
- Доска tldraw не трогалась.

## 12. Внесённые изменения

| Изменение | Зачем |
|---|---|
| `JITSI_SCRIPT_LOAD_TIMEOUT_MS = 45000` | Не хоронить вход в JaaS на медленной загрузке скрипта |
| Замок и повторное чтение `isAudioMuted` / `isVideoMuted` перед `toggleAudio` / `toggleVideo` | Не переключать уже верное состояние |
| `AbortError` → `capture_aborted`, без toggle | Прерванный захват не равен «устройство занято» |
| Второй `peerConnectionFailure` без `dataChannelOpened` → один hard reconnect | Не считать живой DOM восстановленным медиа |
| Dispose предыдущей сессии вместе с API | Не оставлять watchdog у уничтоженного iframe |
| Срок live JWT JaaS не короче 4 часов и не длиннее уже заданного потолка | Совпадает с собственным Jitsi |
| `decideHardReconnect`: повторный сбой во время уже идущего восстановления возвращает `wait` и не сбрасывает `inFlight` | Не открывать второй iframe и не плодить участника |
| `roomGuardDecision` перед новым iframe | Повторный `join-config` остаётся в комнате этого урока |
| `joinMediaIntent` | Микрофон и камера после обрыва берутся из того, что человек уже включил |
| Первый `peerConnectionFailure` снимает «Подключено», пока нет нового `dataChannelOpened` | Iframe в DOM не считается медиаканалом |
| Алиасы телеметрии на типы, которые бэкенд уже хранит | События восстановления и ошибок микрофона/камеры больше не выбрасываются |
| Кнопка «Только звук» вызывает `setAudioOnly` и `setLowBandwidthMode` только по нажатию | Камера сама не гасится |

Не делалось: свой TURN, свой ICE restart, смена региона 8x8, отключение JWT, правка tldraw, правка production env, перезапуск сервисов, бесконечный reconnect, повторный `getUserMedia` из страницы, установка второго видеопровайдера.

## 13. Проверки после исправлений

| Проверка | Статус |
|---|---|
| `vitest` первого этапа: watchdog, script, join, camera, telemetry, leave, call state — 91 тест | PASS |
| `vitest` второго этапа, 7 файлов (watchdog, telemetry, diagnostics, reachability, link mode, join, leave) — 94 теста | PASS. Это подмножество, не весь frontend |
| `manage.py test Cabinet.tests_jaas --keepdb` — 10 тестов | PASS на первом этапе. На втором этапе бэкенд не менялся, прогон не повторялся |
| Двусторонний звук и видео | NOT TESTED |
| Обрыв сети, смена Wi-Fi/LTE, Bluetooth, мобильный фон | NOT TESTED |
| Регрессия доски, заданий, ДЗ | NOT TESTED в браузере. Эти файлы не менялись |

## 14. Нерешённые проблемы и ограничения 8x8

- Качество звука и факт восстановления после обрыва на сети ученика не измерены.
- Стабильность «без VPN» не доказана и не опровергнута. Единственный замер: с этой машины HTTPS до `8x8.vc` и TCP 443 до франкфуртского TURN открываются, UDP до Google STUN открывается, анонимный STUN до TURN ответа не дал.
- Кросс-доменный iframe не отдаёт getStats. Обход этого ограничения не делался.
- JaaS сам выбирает регион моста и relay. Мы это не переопределяем.
- Фон iOS/Android может убить медиа. Это ограничение ОС.
- Safari не обязан уметь менять устройство вывода.
- `startBitrate` 1500 и 1080p оставлены до замера на слабом канале.
- Opus RED (`enableOpusRed`) в конфиг не включался: ключ есть у Jitsi, но без замера потерь это смена медиасогласования «на всякий случай».

## 15. Что проверить на реальных устройствах

Два участника, учитель и ученик, обычные аккаунты урока, не production-JWT в автотестах.

1. Chrome и Яндекс Браузер на Windows, Safari на Mac, Safari на iPhone: вход, микрофон, камера, взаимный звук, mute, выдёргивание гарнитуры, уход в фон и возврат.
2. Сеть ученика без VPN, где звонок уже рвался: в статистике Jitsi тип выбранного кандидата (host / srflx / relay, udp или tcp). Если остаётся только relay по TCP 443 — причина в фильтре UDP, не в комнате урока.
3. Обрыв канала на 5, 15 и 30 с отдельным шейпером, который режет UDP, не ползунком DevTools. Ожидание: либо штатный ICE restart, либо не больше трёх наших переподключений, микрофон в том же положении, что до обрыва.
4. Две вкладки одного урока: второй микрофон не должен остаться после claim.
5. Открыть доску и задание во время звонка: один iframe, звук не пропадает.
6. Урок длиннее двух часов или повторный вход ближе к концу: JWT должен приниматься (полка 4 часа).

Модульные тесты этого списка не закрывают.

## 16. Второй этап

Подробный разбор — в `JAAS_RUSSIA_CONNECTIVITY_PLAN.md`. Кратко:

- Повторный hard reconnect больше не сбрасывает уже занятую попытку и не создаёт второй iframe. Это подтверждено модульными тестами, не живой конференцией.
- «Подключено» остаётся только после `dataChannelOpened`. Первый сбой PeerConnection эту подпись снимает.
- Повторный вход запрашивает новый `join-config` и отказывается входить, если имя комнаты изменилось.
- Диагностика различает скрипт, iframe, сигнализацию, ICE, отсутствие медиа и обрыв уже открытого канала. DNS и HTTPS из браузера не разделяются. `getStats` из чужого iframe недоступен.
- «Только звук» включается кнопкой через официальные команды iframe API. Глобальные `startBitrate` и 1080p не менялись.
- Сетевой замер по-прежнему один: машина аудита 2026-10-11, без двух участников и без сети ученика. Матрица устройств — NOT TESTED.
- Второй видеопровайдер не устанавливался. Условия, при которых он имел бы смысл, описаны в плане.
