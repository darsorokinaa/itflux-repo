/* Осевая линия, не залитый контур tldraw: svgInk на острых поворотах оставляет петли и крючки. */
/* Сглаживание — квадратичные Безье с опорой на самих точках, без выноса контролов за штрих. */
/* eslint-disable react-refresh/only-export-components */
import { SVGContainer } from "@tldraw/editor";
import { b64Vecs } from "@tldraw/tlschema";
import { DrawShapeUtil } from "tldraw";

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

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Открытый штрих: концы на первой и последней точке, повороты скруглены.
 * Контрол квадратичной команды — сама точка выборки, конец сегмента — середина
 * ребра. Кривая лежит в выпуклой оболочке выборки и не вылетает за вершину,
 * в отличие от кубических команд залитого контура.
 */
function openSmoothPath(points) {
  let d = `M ${pointText(points[0])} L ${pointText(midpoint(points[0], points[1]))}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    d += ` Q ${pointText(points[index])} ${pointText(midpoint(points[index], points[index + 1]))}`;
  }
  d += ` L ${pointText(points[points.length - 1])}`;
  return d;
}

/** Замкнутый штрих без хорды через первую и последнюю точку. */
function closedSmoothPath(points) {
  const count = points.length;
  let d = `M ${pointText(midpoint(points[count - 1], points[0]))}`;
  for (let index = 0; index < count; index += 1) {
    const next = points[(index + 1) % count];
    d += ` Q ${pointText(points[index])} ${pointText(midpoint(points[index], next))}`;
  }
  return `${d} Z`;
}

/** Повтор первой точки в конце замкнутого штриха даёт второй заход в вершину. */
function withoutClosingDuplicate(points) {
  if (!points || points.length < 3) return points || [];
  const first = points[0];
  const last = points[points.length - 1];
  if (first.x === last.x && first.y === last.y) return points.slice(0, -1);
  return points;
}

/** Прежняя ломаная: мышь, палец и сегмент «прямая» (Shift). */
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

export function lessonDrawPath(points, closed = false) {
  if (!points?.length) return "";
  const first = points[0];
  if (points.length === 1) {
    const x = coord(first.x);
    const y = coord(first.y);
    return `M ${x} ${y} L ${x} ${y}`;
  }
  if (points.length === 2) {
    return `M ${pointText(first)} L ${pointText(points[1])}`;
  }
  if (!closed) return openSmoothPath(points);
  const loop = withoutClosingDuplicate(points);
  if (loop.length < 3) return linePath(loop, false);
  return closedSmoothPath(loop);
}

/**
 * Перо с свободными сегментами сглаживается. Мышь, палец и прямая по Shift
 * остаются ломаной: один и тот же разбор segments даёт один и тот же путь
 * на экране, в экспорте и у второго участника.
 */
export function lessonDrawShapePath(segments, scaleX, scaleY, closed, isPen) {
  const list = Array.isArray(segments) ? segments : [];
  const points = lessonDrawPoints(list, scaleX, scaleY);
  const hasStraight = list.some((segment) => segment?.type === "straight");
  if (!isPen || hasStraight) return linePath(points, closed && points.length > 2);
  return lessonDrawPath(points, closed);
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
  const stroke = lessonDrawShapePath(segments, scaleX, scaleY, false, isPen);
  const wantsFill = Boolean(shape?.isClosed) && shape?.fill && shape.fill !== "none";
  const fill = wantsFill ? lessonDrawShapePath(segments, scaleX, scaleY, true, isPen) : "";
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
  const { stroke, fill } = lessonDrawMarkGeometry({
    segments: shape.props.segments,
    scaleX: shape.props.scaleX,
    scaleY: shape.props.scaleY,
    isClosed: shape.props.isClosed,
    isPen: shape.props.isPen,
    fill: shape.props.fill,
  });
  if (!stroke && !fill) return null;
  const strokeWidth = lessonDrawStrokeWidth(dv.strokeWidth, shape.props.scale);
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
