export function canPublishCatalogPlans(user) {
  return Boolean(user?.can_publish_catalog_plans);
}
