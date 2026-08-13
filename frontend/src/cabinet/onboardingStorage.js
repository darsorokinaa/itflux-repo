const SKIP_MATERIALS_KEY = "cabinet-onboarding-skip-materials";

export function hasSkippedOnboardingMaterials() {
  try {
    return window.localStorage.getItem(SKIP_MATERIALS_KEY) === "1";
  } catch {
    return false;
  }
}

export function skipOnboardingMaterials() {
  try {
    window.localStorage.setItem(SKIP_MATERIALS_KEY, "1");
  } catch {
    /* ignore storage errors */
  }
}
