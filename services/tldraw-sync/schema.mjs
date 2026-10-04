import { DEFAULT_THEME } from "./node_modules/@tldraw/editor/dist-esm/lib/editor/managers/ThemeManager/defaultThemes.mjs";
import { DefaultLabelColorStyle } from "./node_modules/@tldraw/tlschema/dist-esm/styles/TLColorStyle.mjs";
import { T } from "@tldraw/validate";
import {
  createShapePropsMigrationIds,
  createShapePropsMigrationSequence,
  createTLSchema,
  DefaultColorStyle,
  defaultShapeSchemas,
  geoShapeMigrations,
  registerColorsFromThemes,
} from "@tldraw/tlschema";

registerColorsFromThemes({ default: DEFAULT_THEME });

const LESSON_CUSTOM_COLOR = /^c[0-9a-f]{6}$/;

/** Цвет из палитры появляется уже после старта комнаты. Иначе сервер рвёт сокет. */
function acceptLessonCustomColors(style) {
  const builtin = style.type;
  style.type = {
    validate(value) {
      if (typeof value === "string" && LESSON_CUSTOM_COLOR.test(value)) return value;
      return builtin.validate(value);
    },
  };
}

acceptLessonCustomColors(DefaultColorStyle);
acceptLessonCustomColors(DefaultLabelColorStyle);

const LESSON_GEO_URL_MIGRATION_ID = "com.tldraw.shape.geo/13";

function lessonGeoMigrations() {
  const sequence = geoShapeMigrations.sequence;
  const last = sequence.at(-1)?.id;
  if (last !== "com.tldraw.shape.geo/12") {
    throw new Error(`Geo link migration must follow com.tldraw.shape.geo/12, found ${last}`);
  }
  return {
    sequence: [
      ...sequence,
      {
        id: LESSON_GEO_URL_MIGRATION_ID,
        up(props) {
          if (!props || typeof props.url !== "string" || props.url === "") return;
          if (!T.linkUrl.isValid(props.url)) props.url = "";
        },
        down() {},
      },
    ],
  };
}

function lessonMigrations(type) {
  const versions = createShapePropsMigrationIds(type, { Init: 1, Defaults: 2 });
  return createShapePropsMigrationSequence({
    sequence: [
      { id: versions.Init, up: (props) => props },
      { id: versions.Defaults, up: (props) => applyLessonShapeDefaults(type, props) },
    ],
  });
}

function applyLessonShapeDefaults(type, props) {
  if (!props || typeof props !== "object") return props;
  if (typeof props.w !== "number") props.w = type === "graph" ? 360 : type === "task" ? 320 : 280;
  if (typeof props.h !== "number") props.h = type === "graph" ? 240 : type === "task" ? 180 : 96;
  if (type === "formula") {
    if (typeof props.latex !== "string") props.latex = "x";
    if (typeof props.fontSize !== "number") props.fontSize = 22;
  } else if (type === "graph") {
    if (!Array.isArray(props.functions)) props.functions = ["x"];
    if (typeof props.xMin !== "number") props.xMin = -4;
    if (typeof props.xMax !== "number") props.xMax = 4;
    if (typeof props.yMin !== "number") props.yMin = -4;
    if (typeof props.yMax !== "number") props.yMax = 4;
    if (typeof props.showGrid !== "boolean") props.showGrid = true;
    if (typeof props.showAxes !== "boolean") props.showAxes = true;
    if (typeof props.showLabels !== "boolean") props.showLabels = true;
  } else if (type === "task") {
    if (typeof props.taskId !== "string") props.taskId = "";
    if (typeof props.title !== "string") props.title = "Задание";
    if (typeof props.condition !== "string") props.condition = "";
  }
  return props;
}

export function lessonSyncSchema() {
  return createTLSchema({
    shapes: {
      ...defaultShapeSchemas,
      geo: {
        ...defaultShapeSchemas.geo,
        migrations: lessonGeoMigrations(),
      },
      formula: {
        props: {
          w: T.number,
          h: T.number,
          latex: T.string,
          fontSize: T.number,
        },
        migrations: lessonMigrations("formula"),
      },
      graph: {
        props: {
          w: T.number,
          h: T.number,
          functions: T.arrayOf(T.string),
          xMin: T.number,
          xMax: T.number,
          yMin: T.number,
          yMax: T.number,
          showGrid: T.boolean,
          showAxes: T.boolean,
          showLabels: T.boolean,
        },
        migrations: lessonMigrations("graph"),
      },
      task: {
        props: {
          w: T.number,
          h: T.number,
          taskId: T.string,
          title: T.string,
          condition: T.string,
        },
        migrations: lessonMigrations("task"),
      },
    },
  });
}
