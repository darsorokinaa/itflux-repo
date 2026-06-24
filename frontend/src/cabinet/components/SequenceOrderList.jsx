import { useCallback, useMemo, useState } from "react";

export default function SequenceOrderList({
  items,
  order,
  onReorder,
  showNumbers = true,
  bare = false,
  checked = false,
  correctOrder = [],
}) {
  const [draggingId, setDraggingId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);

  const itemById = useMemo(() => {
    const map = new Map();
    items.forEach((item) => map.set(item.id, item));
    return map;
  }, [items]);

  const reorder = useCallback((fromId, toId) => {
    if (!fromId || !toId || fromId === toId) return;
    const fromIndex = order.indexOf(fromId);
    const toIndex = order.indexOf(toId);
    if (fromIndex < 0 || toIndex < 0) return;
    const next = [...order];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    onReorder(next);
  }, [onReorder, order]);

  const handleDragStart = useCallback((e, id) => {
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
    setDraggingId(id);
  }, []);

  const handleDragOver = useCallback((e, id) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (id !== draggingId) setDragOverId(id);
  }, [draggingId]);

  const handleDragLeave = useCallback((e) => {
    if (e.currentTarget.contains(e.relatedTarget)) return;
    setDragOverId(null);
  }, []);

  const handleDrop = useCallback((e, id) => {
    e.preventDefault();
    const fromId = e.dataTransfer.getData("text/plain") || draggingId;
    reorder(fromId, id);
    setDraggingId(null);
    setDragOverId(null);
  }, [draggingId, reorder]);

  const handleDragEnd = useCallback(() => {
    setDraggingId(null);
    setDragOverId(null);
  }, []);

  return (
    <ul className="cb-sequence-list">
      {order.map((id, index) => {
        const step = itemById.get(id);
        const isItemCorrect = checked && step?.text === correctOrder[index];
        const isItemWrong = checked && step?.text !== correctOrder[index];
        return (
          <li
            key={id}
            className={[
              "cb-sequence-item",
              "cb-sequence-item--draggable",
              draggingId === id ? "cb-sequence-item--dragging" : "",
              dragOverId === id && draggingId !== id ? "cb-sequence-item--over" : "",
              isItemCorrect ? "cb-sequence-item--ok" : "",
              isItemWrong ? "cb-sequence-item--bad" : "",
            ].filter(Boolean).join(" ")}
            draggable
            onDragStart={(e) => handleDragStart(e, id)}
            onDragOver={(e) => handleDragOver(e, id)}
            onDragLeave={handleDragLeave}
            onDrop={(e) => handleDrop(e, id)}
            onDragEnd={handleDragEnd}
          >
            {showNumbers ? <span className="cb-sequence-item__num">{index + 1}</span> : null}
            <span className="cb-sequence-item__text">{step?.text}</span>
          </li>
        );
      })}
    </ul>
  );
}
