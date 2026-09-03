from rest_framework import serializers

from .models import (
    InterestingItem,
    Lesson,
    Task,
)


class CatalogAccessMixin:
    """Метаданные карточки + access gate. Файлы закрытого контента не отдаём."""

    def to_representation(self, instance):
        data = super().to_representation(instance)
        request = self.context.get("request")
        user = getattr(request, "user", None) if request else None
        if user is not None and not getattr(user, "is_authenticated", False):
            user = None
        from Cabinet.subscription_access import SubscriptionAccessService

        if instance._meta.app_label == "Generator" and instance._meta.model_name == "lesson":
            from Cabinet.lesson_access import LessonAccessService

            result = LessonAccessService.get_access(user, instance)
            data["access"] = {
                "allowed": result.is_full,
                "min_plan": result.required_plan,
                "access_level": getattr(instance, "access_level", "free"),
                **result.to_dict(),
            }
            if not result.is_full:
                data["file_url"] = None
                data["archive_url"] = None
            return data

        gate = SubscriptionAccessService.serialize_access_gate(user, instance)
        data["access"] = gate
        if not gate["allowed"]:
            data["file_url"] = None
            data["archive_url"] = None
        return data


class TaskSerializer(serializers.ModelSerializer):
    task_title = serializers.CharField(source="task.task_title", read_only=True)
    task_number = serializers.IntegerField(source="task.task_number", read_only=True)
    subtopic_title = serializers.CharField(source="subtopic.title", read_only=True)

    class Meta:
        model = Task
        fields = [
            "id",
            "task_template",
            "answer",
            "author",
            "max_score",
            "task_title",
            "task_number",
            "subtopic_title",
        ]


class LessonCatalogSerializer(CatalogAccessMixin, serializers.ModelSerializer):
    cover_image_url = serializers.SerializerMethodField()
    card_background_image_url = serializers.SerializerMethodField()
    file_url = serializers.SerializerMethodField()
    archive_url = serializers.SerializerMethodField()
    views_count = serializers.IntegerField(read_only=True)
    likes_count = serializers.SerializerMethodField()
    is_liked = serializers.SerializerMethodField()

    class Meta:
        model = Lesson
        fields = [
            "id",
            "title",
            "slug",
            "subject",
            "grade",
            "level",
            "exam_type",
            "task_number",
            "topic",
            "subtopic",
            "short_description",
            "teacher_goal",
            "student_result",
            "duration_minutes",
            "difficulty",
            "access_level",
            "status",
            "cover_image_url",
            "card_background_image_url",
            "card_background_color",
            "file_url",
            "archive_url",
            "views_count",
            "likes_count",
            "is_liked",
        ]

    def get_likes_count(self, obj):
        return int(getattr(obj, "likes_count", 0) or 0)

    def get_is_liked(self, obj):
        return bool(getattr(obj, "user_has_liked", False))

    def _absolute_file_url(self, obj, field_name: str):
        request = self.context.get("request")
        file_field = getattr(obj, field_name, None)
        if not file_field:
            return None
        try:
            url = file_field.url
        except Exception:
            return None
        if request:
            try:
                return request.build_absolute_uri(url)
            except Exception:
                return url
        return url

    def get_cover_image_url(self, obj):
        return self._absolute_file_url(obj, "cover_image")

    def get_card_background_image_url(self, obj):
        return self._absolute_file_url(obj, "card_background_image")

    def get_file_url(self, obj):
        return self._absolute_file_url(obj, "file")

    def get_archive_url(self, obj):
        return self._absolute_file_url(obj, "archive")


class LessonAdminSerializer(serializers.ModelSerializer):
    file_url = serializers.SerializerMethodField()
    archive_url = serializers.SerializerMethodField()

    class Meta:
        model = Lesson
        fields = [
            "id",
            "title",
            "slug",
            "subject",
            "grade",
            "level",
            "exam_type",
            "task_number",
            "topic",
            "subtopic",
            "short_description",
            "teacher_goal",
            "student_result",
            "duration_minutes",
            "difficulty",
            "status",
            "access_level",
            "cover_image",
            "card_background_image",
            "card_background_color",
            "file",
            "archive",
            "file_url",
            "archive_url",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "file_url", "archive_url"]
        extra_kwargs = {
            "slug": {"required": False, "allow_blank": True},
        }

    def get_file_url(self, obj):
        return LessonCatalogSerializer(context=self.context).get_file_url(obj)

    def get_archive_url(self, obj):
        return LessonCatalogSerializer(context=self.context).get_archive_url(obj)


class InterestingCatalogSerializer(CatalogAccessMixin, serializers.ModelSerializer):
    cover_image_url = serializers.SerializerMethodField()
    file_url = serializers.SerializerMethodField()
    archive_url = serializers.SerializerMethodField()
    views_count = serializers.IntegerField(read_only=True)
    likes_count = serializers.SerializerMethodField()
    is_liked = serializers.SerializerMethodField()

    class Meta:
        model = InterestingItem
        fields = [
            "id",
            "title",
            "slug",
            "short_description",
            "tag",
            "accent_color",
            "status",
            "access_level",
            "sort_order",
            "cover_image_url",
            "file_url",
            "archive_url",
            "views_count",
            "likes_count",
            "is_liked",
        ]

    def get_likes_count(self, obj):
        return int(getattr(obj, "likes_count", 0) or 0)

    def get_is_liked(self, obj):
        return bool(getattr(obj, "user_has_liked", False))

    def _absolute_file_url(self, obj, field_name: str):
        request = self.context.get("request")
        file_field = getattr(obj, field_name, None)
        if not file_field:
            return None
        try:
            url = file_field.url
        except Exception:
            return None
        if request:
            try:
                return request.build_absolute_uri(url)
            except Exception:
                return url
        return url

    def get_cover_image_url(self, obj):
        return self._absolute_file_url(obj, "cover_image")

    def get_file_url(self, obj):
        return self._absolute_file_url(obj, "file")

    def get_archive_url(self, obj):
        return self._absolute_file_url(obj, "archive")

