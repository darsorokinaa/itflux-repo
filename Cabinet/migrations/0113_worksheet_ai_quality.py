from django.db import migrations, models


INSTRUCTIONS = (
    {
        "code": "math-fractions",
        "title": "Дроби: проверяемое вычисление",
        "kind": "structure",
        "topic": "Дроби",
        "grade_from": 5,
        "grade_to": 7,
        "priority": 40,
        "subjects": ("Математика", "Алгебра"),
        "body": (
            "Задание на обыкновенные или десятичные дроби с одним числовым ответом. "
            "Числа в условии и ответ согласованы: если нужно сократить дробь, это следует из самих чисел. "
            "Не добавляй сюжет к чистому вычислению. Короткий пример не превращай в текстовую задачу. "
            "В решении достаточно тех действий, без которых ответ не получается."
        ),
    },
    {
        "code": "math-linear-equations",
        "title": "Линейные уравнения",
        "kind": "structure",
        "topic": "Линейные уравнения",
        "grade_from": 7,
        "grade_to": 9,
        "priority": 40,
        "subjects": ("Алгебра", "Математика"),
        "body": (
            "Линейное уравнение с одним корнем. Коэффициент при неизвестном не равен нулю. "
            "Ответ — число. Не заменяй уравнение текстовым сюжетом и не меняй коэффициенты. "
            "Если уравнение задано готовым, сохрани его запись."
        ),
    },
    {
        "code": "math-logarithms",
        "title": "Логарифмы",
        "kind": "structure",
        "topic": "Логарифмы",
        "grade_from": 10,
        "grade_to": 11,
        "priority": 40,
        "subjects": ("Алгебра", "Математика"),
        "body": (
            "Основание логарифма положительное и не равно 1, аргумент положительный. "
            "Ответ — число или корень, который удовлетворяет области допустимых значений. "
            "Если отбор корней зависит от области допустимых значений, она должна быть видна в условии или решении. "
            "Не подменяй формулу логарифма и не превращай уравнение в сюжет."
        ),
    },
    {
        "code": "ege-profile-13",
        "title": "ЕГЭ профиль, задание 13",
        "kind": "fipi",
        "topic": "Уравнения",
        "exam": "ege_profile",
        "task_type": "solution",
        "grade_from": 10,
        "grade_to": 11,
        "priority": 80,
        "subjects": ("Алгебра", "Математика"),
        "body": (
            "Задание №13 профильного ЕГЭ: уравнение, обычно показательное, логарифмическое или тригонометрическое. "
            "Сначала находятся корни, затем из них отбираются те, что принадлежат заданному промежутку, если промежуток есть. "
            "Промежуток, основание и коэффициенты не меняются. Уравнение не заменяется текстовым сюжетом. "
            "Область допустимых значений нужна, если без неё в ответ попадают посторонние значения. "
            "Ответ совпадает с формулировкой: корни, их количество или отобранные значения."
        ),
    },
    {
        "code": "story-percentages",
        "title": "Проценты: сюжет и величины",
        "kind": "method",
        "topic": "Проценты",
        "grade_from": 5,
        "grade_to": 9,
        "priority": 35,
        "subjects": ("Математика", "Алгебра"),
        "body": (
            "Текстовая задача на проценты. Сюжет можно сменить, но проценты, исходные величины и единицы остаются теми же. "
            "Не меняй, от какой величины берётся процент и что является целым. "
            "Причинная связь сохраняется: что было сначала, что увеличилось или уменьшилось. "
            "Ответ — число с той же единицей, что в условии. Если условие уже нельзя тематизировать без смены данных, оставь его как есть."
        ),
    },
    {
        "code": "story-motion",
        "title": "Движение: сюжет и величины",
        "kind": "method",
        "topic": "Движение",
        "grade_from": 5,
        "grade_to": 9,
        "priority": 35,
        "subjects": ("Математика", "Алгебра"),
        "body": (
            "Задача на движение. Скорость, время, расстояние и их единицы не меняются. "
            "Направление и кто кого догоняет остаются теми же: нельзя превратить движение навстречу во движение вдогонку. "
            "Сюжетные имена и место можно заменить, способ решения — нет. "
            "Если в условии уравнение, график или таблица, не разворачивай их в новую историю."
        ),
    },
    {
        "code": "physics-quantities",
        "title": "Физика: величины и единицы",
        "kind": "method",
        "topic": "Физика",
        "grade_from": 7,
        "grade_to": 11,
        "priority": 30,
        "subjects": ("Физика",),
        "body": (
            "Физическая задача. Числа, единицы и формула закона не меняются. "
            "Нельзя заменить килограммы на литры, метры в секунду на километры в час или поменять, какая величина известна, а какая ищется. "
            "Сюжет можно слегка переоформить, но причинная связь и ход решения остаются прежними. "
            "Ответ сохраняет единицу измерения из условия."
        ),
    },
)


def seed_knowledge(apps, schema_editor):
    Instruction = apps.get_model("Cabinet", "KnowledgeInstruction")
    Subject = apps.get_model("Generator", "Subject")
    for item in INSTRUCTIONS:
        subject = None
        for name in item["subjects"]:
            subject = Subject.objects.filter(subject_name__iexact=name).first()
            if subject:
                break
        Instruction.objects.get_or_create(
            code=item["code"],
            defaults={
                "title": item["title"],
                "kind": item["kind"],
                "topic": item["topic"],
                "exam": item.get("exam", ""),
                "task_type": item.get("task_type", ""),
                "grade_from": item["grade_from"],
                "grade_to": item["grade_to"],
                "priority": item["priority"],
                "body": item["body"],
                "is_active": True,
                "subject": subject,
            },
        )


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0112_worksheet_ai_cost_and_scope"),
        ("Generator", "0100_task_ai_candidate"),
    ]

    operations = [
        migrations.AddField(
            model_name="worksheetaigeneration",
            name="pricing_snapshot",
            field=models.JSONField(blank=True, default=dict, verbose_name="Снимок цены"),
        ),
        migrations.AddField(
            model_name="worksheetaigeneration",
            name="quality",
            field=models.JSONField(blank=True, default=dict, verbose_name="Качество генерации"),
        ),
        migrations.RunPython(seed_knowledge, migrations.RunPython.noop),
    ]
