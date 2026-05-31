# Generated manually for SupportInfo.vpr_class

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Generator", "0051_pedagogical_report_models"),
    ]

    operations = [
        migrations.AddField(
            model_name="supportinfo",
            name="vpr_class",
            field=models.PositiveSmallIntegerField(
                blank=True,
                help_text="Если указано — блок показывается только при совпадении класса варианта. Пусто — для всех классов ВПР.",
                null=True,
                verbose_name="Класс (ВПР)",
            ),
        ),
    ]
