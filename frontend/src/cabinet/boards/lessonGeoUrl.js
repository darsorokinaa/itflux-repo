import { T } from "@tldraw/validate";

const GEO_URL_READY_VERSION = "com.tldraw.shape.geo/12";

export const LESSON_GEO_URL_MIGRATION_ID = "com.tldraw.shape.geo/13";

export function isLessonLinkUrl(url) {
  return typeof url === "string" && url !== "" && T.linkUrl.isValid(url);
}

export function clearInvalidGeoUrl(props) {
  if (!props || typeof props.url !== "string" || props.url === "") return;
  if (!T.linkUrl.isValid(props.url)) props.url = "";
}

export function withLessonGeoMigrations(base) {
  const sequence = Array.isArray(base?.sequence) ? [...base.sequence] : [];
  const last = sequence.at(-1)?.id;
  if (sequence.length > 0 && last !== GEO_URL_READY_VERSION) {
    throw new Error(`Geo link migration must follow ${GEO_URL_READY_VERSION}, found ${last}`);
  }
  if (sequence.some((step) => step.id === LESSON_GEO_URL_MIGRATION_ID)) return { sequence };
  return {
    sequence: [
      ...sequence,
      {
        id: LESSON_GEO_URL_MIGRATION_ID,
        up(props) {
          clearInvalidGeoUrl(props);
        },
        down() {},
      },
    ],
  };
}
