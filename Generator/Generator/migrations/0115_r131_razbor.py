from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("Generator", "0114_r129_variant_title")]

    operations = [
        migrations.CreateModel(
            name="Razbor",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("exam", models.CharField(choices=[("oge", "ОГЭ"), ("ege", "ЕГЭ")], db_index=True, max_length=10, verbose_name="Экзамен")),
                ("subject", models.CharField(db_index=True, max_length=50, verbose_name="Предмет (subject_short)")),
                ("number", models.PositiveIntegerField(verbose_name="Номер задания")),
                ("title", models.CharField(max_length=255, verbose_name="Заголовок")),
                ("content_md", models.TextField(verbose_name="Текст (Markdown + LaTeX)")),
                ("published", models.BooleanField(db_index=True, default=False, verbose_name="Опубликован")),
                ("source_file", models.CharField(blank=True, default="", max_length=255, verbose_name="Файл-источник")),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={"verbose_name": "Разбор", "verbose_name_plural": "Разборы", "ordering": ["exam", "subject", "number"]},
        ),
        migrations.AddConstraint(
            model_name="razbor",
            constraint=models.UniqueConstraint(fields=("exam", "subject", "number"), name="razbor_unique_exam_subject_number"),
        ),
    ]
