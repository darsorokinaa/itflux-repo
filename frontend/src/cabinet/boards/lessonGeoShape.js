import { geoShapeMigrations } from "@tldraw/tlschema";
import { GeoShapeUtil } from "tldraw";

import { withLessonGeoMigrations } from "./lessonGeoUrl";

export class LessonGeoShapeUtil extends GeoShapeUtil {
  static migrations = withLessonGeoMigrations(geoShapeMigrations);
}
