import { createTLSchemaFromUtils } from "@tldraw/editor";
import { defaultShapeUtils } from "tldraw";

import { LessonGeoShapeUtil } from "../src/cabinet/boards/lessonGeoShape.js";
import { lessonShapeUtils } from "../src/cabinet/boards/lessonShapes.jsx";

const shapeUtils = [
  LessonGeoShapeUtil,
  ...defaultShapeUtils.filter((Util) => Util.type !== "geo"),
  ...lessonShapeUtils,
];
const schema = createTLSchemaFromUtils({ shapeUtils });
process.stdout.write(JSON.stringify(schema.serialize()));
