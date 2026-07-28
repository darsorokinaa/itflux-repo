from django.db import migrations, models


def migrate_legacy_avatars(apps, schema_editor):
    Profile = apps.get_model("Cabinet", "Profile")
    from Cabinet.avatar_crypto import encrypt_avatar_bytes, normalize_avatar_image
    from django.utils import timezone

    for profile in Profile.objects.exclude(avatar="").exclude(avatar__isnull=True).iterator():
        if profile.avatar_encrypted:
            continue
        try:
            with profile.avatar.open("rb") as fh:
                raw = fh.read()
        except (OSError, ValueError, FileNotFoundError):
            continue
        if not raw:
            continue
        try:
            normalized, mime = normalize_avatar_image(raw, "image/jpeg")
            profile.avatar_encrypted = encrypt_avatar_bytes(normalized)
            profile.avatar_content_type = mime
            profile.avatar_updated_at = timezone.now()
            profile.save(update_fields=["avatar_encrypted", "avatar_content_type", "avatar_updated_at"])
        except Exception:
            continue


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ("Cabinet", "0041_cleanup_live_meeting_review_items"),
    ]

    operations = [
        migrations.AddField(
            model_name="profile",
            name="avatar_content_type",
            field=models.CharField(blank=True, default="", max_length=64, verbose_name="MIME аватара"),
        ),
        migrations.AddField(
            model_name="profile",
            name="avatar_encrypted",
            field=models.BinaryField(
                blank=True,
                help_text="JPEG в Fernet-шифре; ключ из SECRET_KEY",
                null=True,
                verbose_name="Аватар (зашифрованный)",
            ),
        ),
        migrations.AddField(
            model_name="profile",
            name="avatar_updated_at",
            field=models.DateTimeField(blank=True, null=True, verbose_name="Аватар обновлён"),
        ),
        migrations.AlterField(
            model_name="profile",
            name="avatar",
            field=models.ImageField(
                blank=True,
                help_text="Устаревшее файловое поле; новые аватары хранятся зашифрованно в avatar_encrypted",
                null=True,
                upload_to="cabinet/avatars/",
                verbose_name="Аватар (legacy)",
            ),
        ),
        migrations.RunPython(migrate_legacy_avatars, noop_reverse),
    ]
