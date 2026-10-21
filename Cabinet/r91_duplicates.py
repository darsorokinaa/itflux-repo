"""r91: поиск вероятных дублей — пустой аккаунт, созданный через Яндекс/VK, с тем же
именем и фамилией, что у уже существующего ученика. Только чтение."""
from django.contrib.auth import get_user_model
from django.db.models import Q

from .models import Payment, Profile, ScheduleEvent, SocialAccount, Student
from .r91_oauth import mask_email

User = get_user_model()


def initials(first, last):
    f = (first or "").strip()[:1].upper()
    l = (last or "").strip()[:1].upper()
    return " ".join(x + "." for x in (f, l) if x) or "—"


def usage_counts(user):
    from .billing_models import StudentPayment

    return {
        "students_as_teacher": Student.objects.filter(teacher=user).count(),
        "student_records": Student.objects.filter(user=user).count(),
        "events": ScheduleEvent.objects.filter(owner=user).count(),
        "payments": Payment.objects.filter(teacher=user).count()
        + StudentPayment.objects.filter(Q(created_by=user) | Q(student__user=user)).count(),
    }


def is_empty(user):
    return not any(usage_counts(user).values())


def _norm(s):
    return " ".join((s or "").lower().replace("ё", "е").split())


def find_duplicates():
    oauth_user_ids = set(SocialAccount.objects.values_list("user_id", flat=True))
    # существующие «ученики»: роль student или привязка к карточке ученика
    student_user_ids = set(Profile.objects.filter(role=Profile.Role.STUDENT).values_list("user_id", flat=True))
    student_user_ids |= set(Student.objects.filter(user__isnull=False).values_list("user_id", flat=True))
    by_name = {}
    for p in Profile.objects.filter(user_id__in=student_user_ids).select_related("user"):
        key = (_norm(p.name), _norm(p.surname))
        if key[0] and key[1]:
            by_name.setdefault(key, []).append(p.user)
    for st in Student.objects.filter(user_id__in=student_user_ids).select_related("user"):
        key = (_norm(st.first_name), _norm(st.last_name))
        if key[0] and key[1] and st.user not in by_name.get(key, []):
            by_name.setdefault(key, []).append(st.user)

    rows = []
    for p in Profile.objects.filter(user_id__in=oauth_user_ids).select_related("user"):
        key = (_norm(p.name), _norm(p.surname))
        if not (key[0] and key[1]) or key not in by_name:
            continue
        u = p.user
        originals = [o for o in by_name[key] if o.id != u.id and o.date_joined < u.date_joined]
        if not originals or not is_empty(u):
            continue
        for o in originals:
            rows.append({
                "dup_id": u.id,
                "dup_initials": initials(p.name, p.surname),
                "dup_created": u.date_joined,
                "dup_email": mask_email(u.email),
                "dup_role": p.role,
                "dup_providers": sorted(SocialAccount.objects.filter(user=u).values_list("provider", flat=True)),
                "orig_id": o.id,
                "orig_email": mask_email(o.email),
                "orig_role": getattr(getattr(o, "profile", None), "role", ""),
                "orig_student_ids": list(Student.objects.filter(user=o).values_list("id", flat=True)),
                "dup_last_login": u.last_login,
            })
    rows.sort(key=lambda r: (r["dup_created"], r["dup_id"]))
    return rows
