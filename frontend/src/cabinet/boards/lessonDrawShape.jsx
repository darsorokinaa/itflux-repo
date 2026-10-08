/* Одна линия штриха: залитый контур tldraw на поворотах оставляет петли и крючки. */
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

/** Только отрезки. Квадратичные команды контура дают выбросы мимо точек. */
export function lessonDrawPath(points, closed = false) {
  if (!points?.length) return "";
  const first = points[0];
  if (points.length === 1) {
    const x = coord(first.x);
    const y = coord(first.y);
    return `M ${x} ${y} L ${x} ${y}`;
  }
  let d = `M ${coord(first.x)} ${coord(first.y)}`;
  for (let index = 1; index < points.length; index += 1) {
    d += ` L ${coord(points[index].x)} ${coord(points[index].y)}`;
  }
  if (closed && points.length > 2) d += " Z";
  return d;
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
  const points = lessonDrawPoints(shape.props.segments, shape.props.scaleX, shape.props.scaleY);
  const closed = Boolean(shape.props.isClosed && points.length > 2);
  const d = lessonDrawPath(points, closed);
  if (!d) return null;
  const strokeWidth = lessonDrawStrokeWidth(dv.strokeWidth, shape.props.scale);
  const showStroke = shape.props.dash !== "none";
  const showFill = closed && shape.props.fill !== "none";
  return (
    <path
      d={d}
      fill={showFill ? dv.fillColor : "none"}
      stroke={showStroke ? dv.strokeColor : "none"}
      strokeWidth={showStroke ? strokeWidth : 0}
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeDasharray={showStroke ? lessonDrawDashArray(shape.props.dash, strokeWidth) : undefined}
    />
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
