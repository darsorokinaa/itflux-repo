(function () {
  function rows(group) {
    return Array.from(group.querySelectorAll("tbody tr")).filter((row) => !row.classList.contains("empty-form"));
  }

  function renumber(group) {
    rows(group).forEach((row, index) => {
      const input = row.querySelector('input[name$="-position"]');
      if (input) input.value = String(index);
    });
  }

  function bind(group) {
    if (!group || group.dataset.dragBound === "1") return;
    group.dataset.dragBound = "1";
    rows(group).forEach((row) => {
      row.draggable = true;
      row.addEventListener("dragstart", () => row.classList.add("lcol-dragging"));
      row.addEventListener("dragend", () => {
        row.classList.remove("lcol-dragging");
        renumber(group);
      });
      row.addEventListener("dragover", (event) => {
        event.preventDefault();
        const dragging = group.querySelector(".lcol-dragging");
        if (!dragging || dragging === row) return;
        const body = row.parentElement;
        const rect = row.getBoundingClientRect();
        const after = event.clientY > rect.top + rect.height / 2;
        body.insertBefore(dragging, after ? row.nextSibling : row);
      });
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    ["sections-group", "items-group"].forEach((id) => bind(document.getElementById(id)));
  });
})();
