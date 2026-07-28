import { Link } from "react-router-dom";
import { greetingByHour, pluralRu } from "../studentDisplay";

export default function StudentDashboardHeader({ name, lessonsToday = 0, assignmentsDue = 0 }) {
  const greeting = greetingByHour();
  const displayName = name || "ученик";
  const lessonWord = pluralRu(lessonsToday, "урок", "урока", "уроков");
  const hwWord = pluralRu(assignmentsDue, "невыполненное задание", "невыполненных задания", "невыполненных заданий");

  let summary = "";
  if (lessonsToday === 0 && assignmentsDue === 0) {
    summary = "Сегодня свободный день — можно повторить материалы или отдохнуть.";
  } else if (lessonsToday > 0 && assignmentsDue > 0) {
    summary = `Сегодня у тебя ${lessonsToday} ${lessonWord} и ${assignmentsDue} ${hwWord}.`;
  } else if (lessonsToday > 0) {
    summary = `Сегодня у тебя ${lessonsToday} ${lessonWord}.`;
  } else {
    summary = `У тебя ${assignmentsDue} ${hwWord}.`;
  }

  return (
    <header className="st-dash-welcome">
      <div>
        <h1 className="st-dash-welcome__title">
          {greeting}, {displayName}
        </h1>
        <p className="st-dash-welcome__sub">{summary}</p>
      </div>
      {assignmentsDue > 0 ? (
        <Link to="/cabinet/student/assignments" className="st-dash-welcome__hint">
          К заданиям →
        </Link>
      ) : null}
    </header>
  );
}
