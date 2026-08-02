/**
 * useSubscription — хук для работы с тарифной системой.
 *
 * Возвращает:
 *   currentPlan, limits, usage, features, loading
 *   canCreateStudent, canCreateGroup, canCreateLesson, canCreateInteractive, canUseAI
 *   refreshUsage()
 *   handleLimitError(error, openModal) — открывает нужный upgrade modal
 */

import { useCallback, useEffect, useState } from "react";
import { fetchSubscriptionUsage } from "../../utils/cabinetAuth";

const INITIAL_STATE = {
  currentPlan: null,
  limits: { students: 5, groups: 2, lessons: 10, interactives: 5, ai_requests: 10 },
  usage: { students: 0, groups: 0, lessons: 0, interactives: 0, ai_requests: 0 },
  features: {
    homework: true,
    review: true,
    basic_notifications: false,
    advanced_notifications: false,
    extended_library: false,
    multi_teacher: false,
  },
  subscription: null,
  loading: true,
  error: null,
};

export function useSubscription() {
  const [state, setState] = useState(INITIAL_STATE);

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fetchSubscriptionUsage();
      setState({
        currentPlan: data.plan,
        limits: data.limits,
        usage: data.usage,
        features: data.features,
        subscription: data.subscription,
        loading: false,
        error: null,
      });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err.message || "Ошибка загрузки тарифа" }));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const { limits, usage } = state;

  return {
    ...state,
    refreshUsage: load,
    canCreateStudent: usage.students < limits.students,
    canCreateGroup: usage.groups < limits.groups,
    canCreateLesson: usage.lessons < limits.lessons,
    canCreateInteractive: usage.interactives < limits.interactives,
    canUseAI: usage.ai_requests < limits.ai_requests,
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
