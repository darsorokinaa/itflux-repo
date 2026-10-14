/* Осевая линия постоянной толщины, не залитый svgInk: тот на острых поворотах оставляет петли.
   Контур считается штатным getStrokePoints. last всегда true: отпускание пера не
   переключает сглаживание и не меняет форму. Давление в толщину не входит — скачки z
   на касании и отрыве дают наплывы, а ширина остаётся шириной пера. */
/* eslint-disable react-refresh/only-export-components */
import { SVGContainer } from "@tldraw/editor";
import { b64Vecs } from "@tldraw/tlschema";
import { DrawShapeUtil, getStrokePoints, getSvgPathFromStrokePoints } from "tldraw";

/** Умереннее штатных 0.62 у пера: углы, петли и короткие штрихи не срезаются. */
const LESSON_FREEHAND_STREAMLINE = 0.5;
const LESSON_FREEHAND_WIDTH = 4.5;

function coord(value) {
  const rounded = Math.round(Number(value) * 100) / 100;
  return Object.is(rounded, -0) ? 0 : rounded;
}

export function lessonDrawPoints(segments, scaleX = 1, scaleY = 1) {
  const sx = Number.isFinite(scaleX) && scaleX !== 0 ? scaleX : 1;
  const sy = Number.isFinite(scaleY) && scaleY !== 0 ? scaleY : 1;
  const points = [];
  for (const segment of segments || []) {
    if (!segment?.path) continue;
    let decoded = [];
    try {
      decoded = b64Vecs.decodePoints(segment.path, segment.dim);
    } catch {
      decoded = [];
    }
    for (const point of decoded) {
      const next = { x: point.x * sx, y: point.y * sy };
      const prev = points[points.length - 1];
      if (prev && prev.x === next.x && prev.y === next.y) continue;
      points.push(next);
    }
  }
  return points;
}

function pointText(point) {
  return `${coord(point.x)} ${coord(point.y)}`;
}

function penWidth(strokeWidth) {
  const width = Number(strokeWidth);
  return Number.isFinite(width) && width > 0 ? width : LESSON_FREEHAND_WIDTH;
}

/**
 * Короткий обратный скачок в начале или в конце — след отрыва или касания.
 * Длинный ход в обратную сторону (крючок буквы, галочка) остаётся.
 */
function dropShortReversal(points, fromStart, strokeWidth) {
  if (!points || points.length < 3) return points || [];
  const width = penWidth(strokeWidth);
  const a = fromStart ? points[0] : points[points.length - 3];
  const b = fromStart ? points[1] : points[points.length - 2];
  const c = fromStart ? points[2] : points[points.length - 1];
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const bcx = c.x - b.x;
  const bcy = c.y - b.y;
  const ab = Math.hypot(abx, aby);
  const bc = Math.hypot(bcx, bcy);
  const spur = fromStart ? ab : bc;
  const previous = fromStart ? bc : ab;
  if (spur <= 0 || previous <= 0) return points;
  const cos = (abx * bcx + aby * bcy) / (ab * bc);
  const shortNub = spur < width * 0.85 && cos < 0;
  const liftJump = cos < -0.45 && spur > previous * 1.8 && spur < width * 8;
  if (!shortNub && !liftJump) return points;
  return fromStart ? points.slice(1) : points.slice(0, -1);
}

/** Повтор первой точки в конце замкнутого штриха даёт второй заход в вершину. */
function withoutClosingDuplicate(points) {
  if (!points || points.length < 3) return points || [];
  const first = points[0];
  const last = points[points.length - 1];
  if (first.x === last.x && first.y === last.y) return points.slice(0, -1);
  return points;
}

function freehandStroke(points, strokeWidth) {
  const width = penWidth(strokeWidth);
  let next = dropShortReversal(points, true, width);
  next = dropShortReversal(next, false, width);
  if (next.length < 2) return next.map((point) => ({ point }));
  return getStrokePoints(next, {
    size: width,
    thinning: 0,
    streamline: LESSON_FREEHAND_STREAMLINE,
    simulatePressure: false,
    last: true,
  });
}

/** Ломаная только у сегмента «прямая» (Shift). */
function linePath(points, closed = false) {
  if (!points?.length) return "";
  const first = points[0];
  if (points.length === 1) {
    const x = coord(first.x);
    const y = coord(first.y);
    return `M ${x} ${y} L ${x} ${y}`;
  }
  let d = `M ${pointText(first)}`;
  for (let index = 1; index < points.length; index += 1) {
    d += ` L ${pointText(points[index])}`;
  }
  if (closed && points.length > 2) d += " Z";
  return d;
}

function dotPath(point) {
  const x = coord(point.x);
  const y = coord(point.y);
  return `M ${x} ${y} L ${x} ${y}`;
}

/** Точки контура после сглаживания. Хранимая выборка не меняется. */
export function lessonFreehandPoints(points, strokeWidth) {
  const stroke = freehandStroke(points || [], strokeWidth);
  return stroke.map((item) => ({ x: item.point.x, y: item.point.y }));
}

export function lessonDrawPath(points, closed = false, strokeWidth) {
  if (!points?.length) return "";
  const source = closed ? withoutClosingDuplicate(points) : points;
  if (source.length === 1) return dotPath(source[0]);
  const stroke = freehandStroke(source, strokeWidth);
  if (stroke.length < 2) return dotPath(stroke[0]?.point || source[0]);
  return getSvgPathFromStrokePoints(stroke, closed && stroke.length > 2);
}

/**
 * Свободный штрих сглаживается одинаково для пера, мыши и пальца: флаг isPen
 * остаётся в записи, но не меняет контур, иначе штрих расходится у участников.
 * Прямая по Shift остаётся ломаной.
 */
export function lessonDrawShapePath(segments, scaleX, scaleY, closed, _isPen, strokeWidth) {
  const list = Array.isArray(segments) ? segments : [];
  const points = lessonDrawPoints(list, scaleX, scaleY);
  const hasStraight = list.some((segment) => segment?.type === "straight");
  if (hasStraight) return linePath(points, closed && points.length > 2);
  return lessonDrawPath(points, closed, strokeWidth);
}

/**
 * Чернила идут только по выборке. isClosed у tldraw — это заливка,
 * когда конец штриха рядом с началом; черта туда не проводится.
 */
export function lessonDrawMarkGeometry(shape) {
  const isPen = Boolean(shape?.isPen);
  const segments = shape?.segments;
  const scaleX = shape?.scaleX;
  const scaleY = shape?.scaleY;
  const strokeWidth = shape?.strokeWidth;
  const stroke = lessonDrawShapePath(segments, scaleX, scaleY, false, isPen, strokeWidth);
  const wantsFill = Boolean(shape?.isClosed) && shape?.fill && shape.fill !== "none";
  const fill = wantsFill
    ? lessonDrawShapePath(segments, scaleX, scaleY, true, isPen, strokeWidth)
    : "";
  return { stroke, fill };
}

export function lessonDrawStrokeWidth(baseStrokeWidth, scale) {
  const width = Number(baseStrokeWidth);
  const nextScale = Number(scale);
  const safeWidth = Number.isFinite(width) ? width : 0;
  const safeScale = Number.isFinite(nextScale) && nextScale > 0 ? nextScale : 1;
  return (safeWidth + 1) * safeScale;
}

export function lessonDrawDashArray(dash, strokeWidth) {
  if (dash === "dashed") return `${strokeWidth * 2} ${strokeWidth * 2}`;
  if (dash === "dotted") return `0.1 ${strokeWidth * 2}`;
  return undefined;
}

function displayValues(util, shape, colorMode) {
  const theme = util.editor.getCurrentTheme();
  const mode = colorMode || util.editor.getColorMode();
  return {
    ...util.options.getDefaultDisplayValues(util.editor, shape, theme, mode),
    ...util.options.getCustomDisplayValues(util.editor, shape, theme, mode),
  };
}

function LessonDrawMark({ shape, dv }) {
  const strokeWidth = lessonDrawStrokeWidth(dv.strokeWidth, shape.props.scale);
  const { stroke, fill } = lessonDrawMarkGeometry({
    segments: shape.props.segments,
    scaleX: shape.props.scaleX,
    scaleY: shape.props.scaleY,
    isClosed: shape.props.isClosed,
    isPen: shape.props.isPen,
    fill: shape.props.fill,
    strokeWidth,
  });
  if (!stroke && !fill) return null;
  const showStroke = shape.props.dash !== "none" && Boolean(stroke);
  return (
    <>
      {fill ? <path d={fill} fill={dv.fillColor} stroke="none" /> : null}
      {showStroke ? (
        <path
          d={stroke}
          fill="none"
          stroke={dv.strokeColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray={lessonDrawDashArray(shape.props.dash, strokeWidth)}
        />
      ) : null}
    </>
  );
}

export class LessonDrawShapeUtil extends DrawShapeUtil {
  getIndicatorPath(shape) {
    const dv = displayValues(this, shape);
    const strokeWidth = lessonDrawStrokeWidth(dv.strokeWidth, shape.props.scale);
    const d = lessonDrawShapePath(
      shape.props.segments,
      shape.props.scaleX,
      shape.props.scaleY,
      false,
      shape.props.isPen,
      strokeWidth,
    );
    return new Path2D(d || "");
  }

  component(shape) {
    return (
      <SVGContainer>
        <LessonDrawMark shape={shape} dv={displayValues(this, shape)} />
      </SVGContainer>
    );
  }

  toSvg(shape, ctx) {
    const scale = Number(shape.props.scale) > 0 ? shape.props.scale : 1;
    return (
      <g transform={`scale(${1 / scale})`}>
        <LessonDrawMark shape={shape} dv={displayValues(this, shape, ctx?.colorMode)} />
      </g>
    );
  }
}
