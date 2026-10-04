from django.db import models
from django.db.models import DO_NOTHING, CASCADE
from datetime import datetime
import os
from uuid import uuid4
from django_ckeditor_5.fields import CKEditor5Field


def task_url(instance, filename):
    ext = filename.split('.')[-1].lower()

    level = instance.task.task.level.level
    subject = instance.task.task.subject.subject_short
    task_number = instance.task.task.task_number
    task_id = instance.task.id

    return os.path.join(
        'tasks_images',
        level,
        subject,
        f'task_{task_number}',
        f'{task_id}_{uuid4().hex[:10]}.{ext}'
    )



class Level(models.Model):
    level = models.CharField(max_length=10, db_index=True)
    level_rus = models.CharField(max_length=50, default="")

    def __str__(self):
        return self.level
    

class Subject(models.Model):
    subject_short = models.CharField(max_length=50)
    subject_name = models.CharField(max_length=200)

    def __str__(self):
        return self.subject_short

class Part(models.Model):
    part_title = models.CharField(max_length=35, blank=True, null=True)
    
    def __str__(self):
        return self.part_title

class TaskList(models.Model):
    subject = models.ForeignKey(Subject, on_delete=CASCADE)
    level = models.ForeignKey(Level, on_delete=CASCADE)
    part = models.ForeignKey(Part, on_delete=CASCADE, blank=True, null=True, default=1)
    task_number = models.IntegerField()
    task_title = models.CharField(max_length=100)
    max_score = models.IntegerField()

    def __str__(self):
        return f'{self.subject} {self.level}: {self.task_number} - {self.task_title}'

# Банк задач
class Task(models.Model):
    task = models.ForeignKey(TaskList, on_delete=CASCADE, null=True, db_index=True)
    task_template = CKEditor5Field("Task text", config_name='default')
    files = models.FileField(upload_to='task_files', blank=True, null=True)

    answer = CKEditor5Field("Ответ", config_name='default', blank=True)
    
    added_at = models.DateTimeField(default=datetime.today)
    created_by =models.CharField(default='ADMIN')

    def __str__(self):
        return f'{self.id}: {self.task_template[:100]}'
    
class Tags(models.Model):
    tag = models.CharField(max_length=20, null=True, blank=True, default="Экзамен")

    def __str__(self):
        return self.tag
    
# Связанные задания (напр. 19–21 в ЕГЭ информатика): один сценарий = одна группа
class LinkedTaskGroup(models.Model):
    """Определяет, какие номера заданий идут одной связанной группой (напр. 19, 20, 21)."""
    subject = models.ForeignKey(Subject, on_delete=CASCADE)
    level = models.ForeignKey(Level, on_delete=CASCADE)
    task_numbers = models.JSONField(default=list)  # [19, 20, 21] — номера в порядке появления

    class Meta:
        unique_together = [("subject", "level")]
        verbose_name = "Связанная группа номеров"

    def __str__(self):
        return f"{self.subject} / {self.level}: {self.task_numbers}"


class TaskGroup(models.Model):
    """Один «набор» связанных задач (один сценарий: напр. три задания 19, 20, 21)."""
    subject = models.ForeignKey(Subject, on_delete=CASCADE)
    level = models.ForeignKey(Level, on_delete=CASCADE)

    class Meta:
        verbose_name = "Группа заданий"

    def __str__(self):
        return f"Группа {self.id} ({self.subject} / {self.level})"


class TaskGroupMember(models.Model):
    """Связь группы с конкретной задачей и её номером в группе (19, 20, 21)."""
    task_group = models.ForeignKey(TaskGroup, on_delete=CASCADE)
    task = models.ForeignKey(Task, on_delete=CASCADE)
    task_number = models.IntegerField()  # номер в варианте: 19, 20, 21

    class Meta:
        ordering = ["task_number"]
        unique_together = [("task_group", "task_number")]
        verbose_name = "Задание в группе"

    def __str__(self):
        return f"Группа {self.task_group_id}: №{self.task_number}"


class Variant(models.Model):
    var_subject = models.ForeignKey(Subject, on_delete=CASCADE)
    level = models.ForeignKey(Level, on_delete=CASCADE)
    created_at = models.DateTimeField(default=datetime.today)
    created_by = models.CharField(max_length=100, default='ADMIN')
    share_token = models.CharField(max_length=20, blank=True, null=True)
    content = models.JSONField(default=dict, blank=True)  # {tasklist_id: count} для поиска дубликатов
    def __str__(self):
        return f'Вариант {self.id} -  {self.var_subject}: {self.level}'
    

class VariantContent(models.Model):
    variant = models.ForeignKey(Variant, on_delete=CASCADE)
    task = models.ForeignKey(Task, on_delete=CASCADE)
    order = models.IntegerField()

    class Meta:
        ordering = ['order']

    def __str__(self):
        return f'Вариант {str(self.variant.id)} задание {self.task_id} ({self.variant.var_subject.subject_name} {self.variant.level})'
    


class TagsList(models.Model):
    tag = models.CharField(max_length=20)

    def __str__(self):
        return self.tag

class Tag(models.Model):
    task = models.ForeignKey(
        Task,
        on_delete=CASCADE,
        related_name='tags'
    )
    taskTag = models.ForeignKey(
        TagsList,
        on_delete=CASCADE,
        related_name='task_items',
        related_query_name='task_item'
    )

    def __str__(self):
        return f'Task: {self.task.id}: {self.taskTag.tag}'

class MarkComment(models.Model):
    comment_text = models.TextField()
    class Meta:
        verbose_name = "Комментарий к баллу"
    def __str__(self):
        return self.comment_text


class Mark(models.Model):
    score = models.IntegerField(default=0)
    score_exam = models.IntegerField(default=0)
    subject = models.ForeignKey(Subject, on_delete=CASCADE)
    level = models.ForeignKey(Level, on_delete=CASCADE)
    comment = models.ForeignKey(MarkComment, on_delete=CASCADE, null=True, blank=True)

    def __str__(self):
        class Meta:
            verbose_name = "Баллы и оценки"


class LessonRoom(models.Model):
    """Комната живого урока из личного кабинета. См. Generator/Generator/models.py."""

    room_id = models.CharField(max_length=200, unique=True, db_index=True)
    jwt_payload = models.JSONField(blank=True, default=dict)
    lesson_ended_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Комната урока (ЛК)"
        verbose_name_plural = "Комнаты уроков (ЛК)"

    def __str__(self):
        return self.room_id


class LessonStudentsAnswer(models.Model):
    room_id = models.CharField(max_length=200, blank=True, default="", db_index=True)
    variant_id = models.PositiveIntegerField(default=0, db_index=True)
    task_number = models.CharField(max_length=32, blank=True, default="")
    teacher = models.CharField(max_length=200, blank=True, default="")
    student = models.CharField(max_length=200, blank=True, default="")
    answer = models.TextField(blank=True, default="")
    is_correct = models.BooleanField(default=False)
    is_empty = models.BooleanField(default=False)
    payload = models.JSONField(blank=True, default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Ответ ученика на уроке"
        verbose_name_plural = "Ответы учеников на уроке"
        indexes = [
            models.Index(fields=["room_id", "variant_id"], name="lesson_answer_room_variant_idx"),
            models.Index(fields=["variant_id", "task_number"], name="lesson_answer_variant_task_idx"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=("room_id", "variant_id", "task_number", "student"),
                name="lesson_answer_unique_per_student_task",
            ),
        ]


class LessonStudentResult(models.Model):
    room_id = models.CharField(max_length=200, blank=True, default="", db_index=True)
    variant_id = models.PositiveIntegerField(default=0, db_index=True)
    teacher = models.CharField(max_length=200, blank=True, default="")
    student = models.CharField(max_length=200, blank=True, default="")
    total_tasks = models.PositiveIntegerField(default=0)
    correct_count = models.PositiveIntegerField(default=0)
    wrong_count = models.PositiveIntegerField(default=0)
    empty_count = models.PositiveIntegerField(default=0)
    teacher_comment = models.TextField(blank=True, default="")
    payload = models.JSONField(blank=True, default=dict)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Результат ученика в уроке"
        verbose_name_plural = "Результаты учеников в уроке"
        indexes = [
            models.Index(fields=["room_id", "variant_id"], name="lesson_result_room_variant_idx"),
            models.Index(fields=["room_id", "student"], name="lesson_result_room_student_idx"),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=("room_id", "variant_id", "student"),
                name="lesson_result_unique_per_student",
            ),
        ]
 
