from rest_framework import serializers
from .models import Task


class TaskSerializer(serializers.ModelSerializer):
    task_title = serializers.CharField(source='task.task_title', read_only=True)
    task_number = serializers.IntegerField(source='task.task_number', read_only=True)
    subtopic_title = serializers.CharField(source='subtopic.title', read_only=True)

    class Meta:
        model = Task
        fields = ['id', 'task_template', 'answer', 'author', 'max_score', 
                  'task_title', 'task_number', 'subtopic_title']