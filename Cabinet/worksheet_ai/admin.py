from django.contrib import admin

from .models import (
    AITaskCandidate,
    AITokenAccount,
    AITransaction,
    KnowledgeInstruction,
    WorksheetAIGeneration,
    WorksheetAIPricing,
    WorksheetAIQuote,
    WorksheetDocument,
)


@admin.register(WorksheetAIPricing)
class WorksheetAIPricingAdmin(admin.ModelAdmin):
    list_display = ("code", "is_active", "updated_at")
    fields = ("code", "is_active", "config", "updated_at")
    readonly_fields = ("updated_at",)


@admin.register(KnowledgeInstruction)
class KnowledgeInstructionAdmin(admin.ModelAdmin):
    list_display = (
        "title", "kind", "subject", "exam", "grade_from", "grade_to",
        "topic", "task_type", "priority", "is_active",
    )
    list_filter = ("is_active", "kind", "exam", "subject")
    search_fields = ("title", "topic", "subtopic", "body", "code")


@admin.register(AITokenAccount)
class AITokenAccountAdmin(admin.ModelAdmin):
    list_display = ("user", "balance", "updated_at")
    search_fields = ("user__username", "user__email")
    readonly_fields = ("user", "balance", "updated_at")


@admin.register(AITransaction)
class AITransactionAdmin(admin.ModelAdmin):
    list_display = (
        "created_at", "user", "operation_type", "amount",
        "balance_before", "balance_after", "status",
    )
    list_filter = ("operation_type", "status")
    search_fields = ("user__username", "description", "idempotency_key")
    readonly_fields = [field.name for field in AITransaction._meta.fields]


@admin.register(AITaskCandidate)
class AITaskCandidateAdmin(admin.ModelAdmin):
    list_display = ("id", "topic", "grade", "difficulty", "review_status", "source", "created_at")
    list_filter = ("review_status", "difficulty", "source")
    search_fields = ("topic", "text", "answer")
    actions = ("mark_approved", "mark_rejected")

    @admin.action(description="Одобрить и добавить в банк задач")
    def mark_approved(self, request, queryset):
        from .promote import PromoteError, promote_candidate

        done = 0
        problems = []
        for candidate in queryset:
            try:
                promote_candidate(candidate)
                done += 1
            except PromoteError as exc:
                problems.append(exc.message)
        message = f"В банк добавлено заданий: {done}."
        if problems:
            message += " " + " ".join(problems)
        self.message_user(request, message)

    @admin.action(description="Отклонить")
    def mark_rejected(self, request, queryset):
        queryset.update(review_status=AITaskCandidate.Review.REJECTED)


@admin.register(WorksheetDocument)
class WorksheetDocumentAdmin(admin.ModelAdmin):
    list_display = ("title", "teacher", "status", "updated_at")
    list_filter = ("status",)
    search_fields = ("title", "teacher__username")
    readonly_fields = ("id", "created_at", "updated_at")


@admin.register(WorksheetAIQuote)
class WorksheetAIQuoteAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "price", "status", "expires_at", "created_at")
    list_filter = ("status",)
    readonly_fields = ("id", "created_at")


@admin.register(WorksheetAIGeneration)
class WorksheetAIGenerationAdmin(admin.ModelAdmin):
    list_display = (
        "id", "user", "status", "quoted_cost", "cost", "provider_cost",
        "input_tokens", "output_tokens", "provider_calls", "model", "created_at",
    )
    list_filter = ("status",)
    search_fields = ("user__username", "prompt")
    readonly_fields = ("id", "created_at", "finished_at", "pricing_snapshot", "quality")
