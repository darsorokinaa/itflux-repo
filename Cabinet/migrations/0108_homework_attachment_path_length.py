from django.db import migrations, models
import Cabinet.models


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0107_homework_attachment_notebook"),
    ]

    operations = [
        migrations.AlterField(
            model_name="homeworkattachment",
            name="file",
            field=models.FileField(
                blank=True,
                max_length=1024,
                null=True,
                upload_to=Cabinet.models.homework_attachment_upload_to,
                verbose_name="Файл",
            ),
        ),
        migrations.AlterField(
            model_name="homeworkattachment",
            name="original_filename",
            field=models.CharField(blank=True, max_length=512, verbose_name="Исходное имя"),
        ),
        migrations.AlterField(
            model_name="homeworkattachment",
            name="task_key",
            field=models.CharField(
                db_index=True,
                help_text="Стабильный id задания варианта или PK HomeworkTask. Не номер и не URL.",
                max_length=255,
                verbose_name="Идентификатор задания",
            ),
        ),
        migrations.AlterField(
            model_name="homeworkattachment",
            name="task_number",
            field=models.CharField(blank=True, max_length=64, verbose_name="Номер задания (метаданные)"),
        ),
        migrations.AlterField(
            model_name="homeworknotebook",
            name="task_key",
            field=models.CharField(db_index=True, max_length=255, verbose_name="Идентификатор задания"),
        ),
        migrations.AlterField(
            model_name="homeworknotebookpage",
            name="background_file",
            field=models.FileField(
                blank=True,
                max_length=1024,
                null=True,
                upload_to=Cabinet.models.homework_notebook_page_background_upload_to,
                verbose_name="Растр фона",
            ),
        ),
        migrations.AlterField(
            model_name="homeworknotebookrevision",
            name="export_file",
            field=models.FileField(
                blank=True,
                max_length=1024,
                null=True,
                upload_to=Cabinet.models.homework_notebook_export_upload_to,
                verbose_name="PDF-снимок",
            ),
        ),
    ]
