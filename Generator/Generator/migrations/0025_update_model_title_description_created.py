# Generated manually for Update model: title, description, created

import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('Generator', '0024_add_update_model'),
    ]

    operations = [
        migrations.AddField(
            model_name='update',
            name='title',
            field=models.CharField(default='', max_length=255, verbose_name='Заголовок'),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name='update',
            name='description',
            field=models.TextField(blank=True, default='', verbose_name='Краткое описание'),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name='update',
            name='created',
            field=models.DateTimeField(auto_now_add=True, default=django.utils.timezone.now, editable=False, verbose_name='Время добавления'),
            preserve_default=False,
        ),
        migrations.RemoveField(
            model_name='update',
            name='text',
        ),
        migrations.RemoveField(
            model_name='update',
            name='date',
        ),
        migrations.AlterModelOptions(
            name='update',
            options={'ordering': ['-created'], 'verbose_name': 'Обновление', 'verbose_name_plural': 'Обновления'},
        ),
    ]
