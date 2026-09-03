import { Link } from "react-router-dom";
import { trackValueGoal } from "../utils/valuePath";

export default function TutorLandingPage() {
  return (
    <div className="digital-flow-page">
      <div className="digital-flow-page__wrap">
        <main className="pain-landing">
          <p className="pain-landing__eyebrow">Для репетиторов</p>
          <h1 className="pain-landing__title">Вести учеников, расписание, ДЗ и оплаты в одном месте</h1>
          <p className="pain-landing__lead">
            Ученик выбирает свободное время — занятие появляется у вас. Домашние задания,
            журнал и материалы к уроку не разъезжаются по вкладкам.
          </p>
          <div className="pain-landing__actions">
            <Link
              to="/cabinet"
              className="pain-landing__cta"
              onClick={() => trackValueGoal("value_path_selected", { path: "students", source: "repetitor" })}
            >
              Настроить работу
            </Link>
            <Link to="/lessons" className="pain-landing__secondary">
              Найти готовый урок
            </Link>
          </div>
        </main>
      </div>
    </div>
  );
}
