import { lessonExamLabel } from "../cabinet/lessonCardUtils";

export function catalogShowsCollections(catalogKind) {
  return catalogKind === "collections";
}

export function catalogFoundCount(catalogKind, lessonCount, collectionCount) {
  return catalogShowsCollections(catalogKind) ? collectionCount : lessonCount;
}

function matchesExam(item, level) {
  if (!level) return true;
  return item.level === level || lessonExamLabel(item) === level;
}

export function filterCollections(collections, { search = "", subject = "", grade = "", level = "" } = {}) {
  const query = String(search || "").trim().toLowerCase();
  return (collections || []).filter((item) => {
    if (subject && item.subject !== subject) return false;
    if (grade && String(item.grade || "") !== grade) return false;
    if (!matchesExam(item, level)) return false;
    if (!query) return true;
    return [item.title, item.short_description, item.subject]
      .filter(Boolean)
      .join(" ")
      .toLowerCase()
      .includes(query);
  });
}

export function collectCatalogFilterOptions(lessons, collections) {
  const subjects = new Set();
  const levels = new Set();
  const grades = new Set();
  for (const lesson of lessons || []) {
    if (lesson.subject) subjects.add(lesson.subject);
    const exam = lessonExamLabel(lesson);
    if (exam) levels.add(exam);
    if (lesson.level) levels.add(lesson.level);
    if (lesson.grade) grades.add(String(lesson.grade));
  }
  for (const item of collections || []) {
    if (item.subject) subjects.add(item.subject);
    const exam = lessonExamLabel(item);
    if (exam) levels.add(exam);
    if (item.level) levels.add(item.level);
    if (item.grade) grades.add(String(item.grade));
  }
  const byRu = (a, b) => a.localeCompare(b, "ru");
  return {
    subjects: Array.from(subjects).sort(byRu),
    levels: Array.from(levels).sort(byRu),
    grades: Array.from(grades).sort((a, b) => Number(a) - Number(b)),
  };
}
