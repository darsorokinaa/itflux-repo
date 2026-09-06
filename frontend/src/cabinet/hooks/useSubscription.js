/**
 * useSubscription — хук для работы с тарифной системой.
 *
 * Возвращает:
 *   currentPlan, limits, usage, features, loading, subscription
 *   canCreateStudent, canCreateGroup, canCreateLesson, canCreateInteractive, canUseAI
 *   refreshUsage()
 *
 * После оплаты / смены тарифа вызывайте notifySubscriptionChanged() —
 * все инстансы хука (сайдбар, главная, лимиты) обновятся.
 */

import { useCallback, useEffect, useState } from "react";
import { fetchSubscriptionUsage } from "../../utils/cabinetAuth";

export const SUBSCRIPTION_CHANGED_EVENT = "cabinet:subscription-changed";

/** Сообщить всему кабинету, что тариф/подписка изменились. */
export function notifySubscriptionChanged() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SUBSCRIPTION_CHANGED_EVENT));
}

const INITIAL_STATE = {
  currentPlan: null,
  assignedPlan: null,
  limits: {},
  usage: {},
  usageItems: [],
  features: {},
  subscription: null,
  loading: true,
  error: null,
};

export function useSubscription() {
  const [state, setState] = useState(INITIAL_STATE);

  const load = useCallback(async ({ soft = false } = {}) => {
    if (!soft) {
      setState((s) => ({ ...s, loading: true, error: null }));
    }
    try {
      const data = await fetchSubscriptionUsage();
      setState({
        currentPlan: data.plan,
        assignedPlan: data.assigned_plan || data.plan,
        limits: data.limits || {},
        usage: data.usage || {},
        usageItems: data.usage_items || [],
        features: data.features || {},
        subscription: data.subscription,
        loading: false,
        error: null,
      });
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: err.message || "Ошибка загрузки тарифа",
      }));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const onChanged = () => {
      void load({ soft: true });
    };
    window.addEventListener(SUBSCRIPTION_CHANGED_EVENT, onChanged);
    return () => {
      window.removeEventListener(SUBSCRIPTION_CHANGED_EVENT, onChanged);
    };
  }, [load]);

  const { limits, usage } = state;

  return {
    ...state,
    refreshUsage: load,
    canCreateStudent: limits.students == null || (usage.students || 0) < limits.students,
    canCreateGroup: limits.groups == null || (usage.groups || 0) < limits.groups,
    canCreateLesson: true,
    canCreateInteractive: limits.interactives == null || (usage.interactives || 0) < limits.interactives,
    canUseAI: limits.ai_requests == null || (usage.ai_requests || 0) < limits.ai_requests,
    canCreateTeacherTask: limits.teacher_tasks == null || (usage.teacher_tasks || 0) < limits.teacher_tasks,
    canCopyTeacherTask: limits.teacher_task_copies_monthly == null
      || (usage.teacher_task_copies || 0) < limits.teacher_task_copies_monthly,
  };
}

/**
 * Обрабатывает ошибку API и вызывает openModal с нужными параметрами.
 *
 * @param {object} error — объект ошибки (должен иметь .code или .data.code)
 * @param {function} openModal — callback: openModal({ type, current, limit, recommendedPlan })
 */
export function handleLimitError(error, openModal) {
  const data = error?.data || error || {};
  const code = data.code || error?.code;

  const LIMIT_MAP = {
    STUDENT_LIMIT_REACHED: "students",
    GROUP_LIMIT_REACHED: "groups",
    LESSON_LIMIT_REACHED: "lessons",
    INTERACTIVE_LIMIT_REACHED: "interactives",
    AI_LIMIT_REACHED: "ai",
    TEACHER_TASK_LIMIT_REACHED: "teacher_tasks",
    TEACHER_TASK_COPY_LIMIT_REACHED: "teacher_task_copies",
    TEACHER_TASK_ATTACHMENTS_REQUIRED: "teacher_task_attachments",
  };

  const type = LIMIT_MAP[code];
  if (type && openModal) {
    openModal({
      type,
      current: data.current ?? 0,
      limit: data.limit ?? 0,
      recommendedPlan: data.recommended_plan || "teacher",
    });
    return true;
  }
  return false;
}
