"""Тексты VK-воронки. Обращение на «Вы», от лица Дарьи, без хэштегов и обещаний результата."""
from django.conf import settings

SIGN = "Дарья, «Цифровой поток»"
GROUP_URL = "https://vk.com/itfluxacademy"
TARIFFS_ARTICLE = "https://vk.ru/@itfluxacademy-tarify-cifrovogo-potoka-kakoi-vybrat"
SITE = "https://itflux-academy.ru"


def contact_email():
    return getattr(settings, "VK_FUNNEL_CONTACT_EMAIL", "") or "itflux.academy@yandex.com"


TOPICS = {
    "oge_math": "ОГЭ математика",
    "oge_inf": "ОГЭ информатика",
    "ege_math": "ЕГЭ математика",
    "ege_inf": "ЕГЭ информатика",
    "diag": "Диагностики 5–11",
}

# Только бесплатные материалы; все ссылки проверены (HTTP 200, урок published) 21.10.2026.
GIFTS = {
    "oge_math": [
        ("Входная диагностика по математике, 9 класс", f"{SITE}/lessons/vhodnaya-diagnostika-po-matematike-9-klass/view"),
        ("Медовый пробник № 1 (математика)", f"{SITE}/lessons/medovyj-probnik-1-matematika/view"),
        ("Ореховый пробник № 2 (математика)", f"{SITE}/lessons/orehovyj-probnik-2-matematika/view"),
        ("Теория вероятности: введение", f"{SITE}/lessons/teoriya-veroyatnosti-vvedenie/view"),
        ("Графики функций", f"{SITE}/lessons/grafiki-funkci/view"),
        ("Все номера ОГЭ по математике с темами", f"{SITE}/zadaniya/oge/math"),
    ],
    "oge_inf": [
        ("Медовый пробник № 1 (информатика)", f"{SITE}/lessons/medovyj-probnik-1-informatika/view"),
        ("Кодирование информации: единицы измерения", f"{SITE}/lessons/kodirovanie-informacii-edinicy-izmereniya-informacii/view"),
        ("Файлы и каталоги", f"{SITE}/lessons/fajly-i-katalogi-informatika-7-klass/view"),
        ("Поисковые запросы (круги Эйлера)", f"{SITE}/lessons/poiskovye-zaprosy/view"),
        ("Все номера ОГЭ по информатике с темами", f"{SITE}/zadaniya/oge/inf"),
    ],
    "ege_math": [
        ("Входная диагностика по математике, 10 класс", f"{SITE}/lessons/vhodnaya-diagnostika-po-matematike-10-klass/view"),
        ("Входная диагностика по математике, 11 класс", f"{SITE}/lessons/vhodnaya-diagnostika-po-matematike-11-klass/view"),
        ("Стереометрия: введение", f"{SITE}/lessons/stereometriya-vvedenie/view"),
        ("Показательные уравнения", f"{SITE}/lessons/pokazatelnye-uravneniya/view"),
        ("Все номера ЕГЭ по математике с темами", f"{SITE}/zadaniya/ege/math"),
    ],
    "ege_inf": [
        ("Летнее приключение: задание № 1", f"{SITE}/lessons/01-ege-inf-modelirovanie/view"),
        ("Алгебра логики: таблицы истинности", f"{SITE}/lessons/algebra-logiki-bazovye-ponyatiya-i-tablicy-istinnosti/view"),
        ("Летний кодовый пляж: № 4", f"{SITE}/lessons/letnij-kodovyj-plyazh-4/view"),
        ("Комбинаторика и перебор в Python: задание 8", f"{SITE}/lessons/kombinatorika-i-perebor-variantov-v-python-reshenie-zadaniya-8-ege-po-informatike/view"),
        ("IP-адреса и сети: задание 13", f"{SITE}/lessons/ip-adresa-i-seti-analiticheskoe-reshenie-zadaniya-13-ege/view"),
        ("Все номера ЕГЭ по информатике с темами", f"{SITE}/zadaniya/ege/inf"),
    ],
    "diag": [(f"{g} класс", f"{SITE}/lessons/vhodnaya-diagnostika-po-matematike-{g}-klass/view") for g in range(5, 12)],
}


def welcome():
    return ("Здравствуйте! Я Дарья, делаю платформу «Цифровой поток» для подготовки к ОГЭ, ЕГЭ "
            "и уроков с 5 по 11 класс.\n\nВыберите, пожалуйста, что Вам интересно, — я пришлю подборку "
            f"бесплатных материалов.\n\n{SIGN}")


def please_subscribe(topic_label):
    return (f"Подборка «{topic_label}» уже готова. Я отправляю её подписчикам сообщества — "
            f"подпишитесь, пожалуйста: {GROUP_URL}\n\nПосле этого нажмите «Я подписался», и я сразу всё пришлю.\n\n{SIGN}")


def still_not_subscribed():
    return (f"Пока не вижу Вашей подписки. Возможно, VK ещё не обновил данные — подпишитесь здесь: {GROUP_URL} "
            f"и нажмите «Я подписался» ещё раз.\n\n{SIGN}")


def gift(topic):
    head = ("Спасибо, что Вы с нами! Вот входные диагностики по математике для 5–11 классов:"
            if topic == "diag" else f"Спасибо, что Вы с нами! Вот подборка «{TOPICS[topic]}»:")
    lines = "\n".join(f"• {t} — {u}" for t, u in GIFTS[topic])
    tail = ("Материалы бесплатные, открываются в браузере. Если что-то не откроется или будут вопросы — "
            f"напишите сюда или на {contact_email()}.")
    return f"{head}\n\n{lines}\n\n{tail}\n\n{SIGN}"


def followup1():
    return ("Здравствуйте! Вчера я присылала Вам подборку материалов. Получилось ли посмотреть? "
            "Буду рада, если напишете, что пригодилось, а чего не хватило.\n\n"
            "Если Вы преподаёте: эти материалы можно назначать ученикам прямо на платформе, "
            f"и тариф «Старт» для этого бесплатный — {SITE}/pricing\n\n{SIGN}")


def followup2():
    return ("Здравствуйте! Если Вы занимаетесь с учениками, можно 14 дней бесплатно попробовать тариф «Профи» — "
            "он включается один раз на аккаунт преподавателя на странице тарифов: "
            f"{SITE}/pricing\n\nЧем тарифы отличаются и какой выбрать, я разобрала в статье: {TARIFFS_ARTICLE}\n\n"
            f"Если не актуально — просто не отвечайте, больше писать об этом не буду.\n\n{SIGN}")
