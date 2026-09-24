import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0110_lesson_collections"),
        ("Generator", "0098_collection_trainers"),
    ]

    operations = [
        migrations.RemoveConstraint(
            model_name="lessoncollectionitem",
            name="lcol_item_one_target",
        ),
        migrations.AddField(
            model_name="lessoncollectionitem",
            name="material",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="collection_items",
                to="Cabinet.material",
                verbose_name="Файл",
            ),
        ),
        migrations.AddField(
            model_name="lessoncollectionitem",
            name="variant",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.CASCADE,
                related_name="collection_items",
                to="Generator.variant",
                verbose_name="Вариант",
            ),
        ),
        migrations.AddConstraint(
            model_name="lessoncollectionitem",
            constraint=models.UniqueConstraint(
                condition=models.Q(("material__isnull", False)),
                fields=("collection", "material"),
                name="lcol_item_collection_material_uniq",
            ),
        ),
        migrations.AddConstraint(
            model_name="lessoncollectionitem",
            constraint=models.UniqueConstraint(
                condition=models.Q(("variant__isnull", False)),
                fields=("collection", "variant"),
                name="lcol_item_collection_variant_uniq",
            ),
        ),
        migrations.AddConstraint(
            model_name="lessoncollectionitem",
            constraint=models.CheckConstraint(
                condition=models.Q(
                    models.Q(
                        ("interesting_item__isnull", True),
                        ("lesson__isnull", False),
                        ("material__isnull", True),
                        ("variant__isnull", True),
                    ),
                    models.Q(
                        ("interesting_item__isnull", False),
                        ("lesson__isnull", True),
                        ("material__isnull", True),
                        ("variant__isnull", True),
                    ),
                    models.Q(
                        ("interesting_item__isnull", True),
                        ("lesson__isnull", True),
                        ("material__isnull", False),
                        ("variant__isnull", True),
                    ),
                    models.Q(
                        ("interesting_item__isnull", True),
                        ("lesson__isnull", True),
                        ("material__isnull", True),
                        ("variant__isnull", False),
                    ),
                    _connector="OR",
                ),
                name="lcol_item_one_target",
            ),
        ),
    ]
