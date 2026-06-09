from rest_framework import serializers

from .models import (
    Lesson,
    Task,
)


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


class LessonCatalogSerializer(serializers.ModelSerializer):
    cover_image_url = serializers.SerializerMethodField()
    file_url = serializers.SerializerMethodField()

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
            "duration_minutes",
            "difficulty",
            "access_level",
            "status",
            "cover_image_url",
            "file_url",
        ]

    def get_cover_image_url(self, obj):
        request = self.context.get("request")
        if not getattr(obj, "cover_image", None):
            return None
        try:
            url = obj.cover_image.url
        except Exception:
            return None
        if request:
            try:
                return request.build_absolute_uri(url)
            except Exception:
                return url
        return url

    def get_file_url(self, obj):
        request = self.context.get("request")
        if not getattr(obj, "file", None):
            return None
        try:
            url = obj.file.url
        except Exception:
            return None
        if request:
            try:
                return request.build_absolute_uri(url)
            except Exception:
                return url
        return url


class LessonAdminSerializer(serializers.ModelSerializer):
    file_url = serializers.SerializerMethodField()

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
            "file",
            "file_url",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at", "file_url"]
        extra_kwargs = {
            "slug": {"required": False, "allow_blank": True},
        }

    def get_file_url(self, obj):
        return LessonCatalogSerializer(context=self.context).get_file_url(obj)

