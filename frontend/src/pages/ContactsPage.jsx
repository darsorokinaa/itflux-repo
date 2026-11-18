/** r50: контакты и реквизиты. */
import { Link } from "react-router-dom";
import SiteRequisites from "./SiteRequisites";
import "./LegalPages.css";

export default function ContactsPage() {
  return (
    <div className="legal-page">
      <h1>Контакты</h1>
      <div className="legal-card">
        <dl>
          <dt>E-mail</dt>
          <dd><a href="mailto:itflux.academy@yandex.ru">itflux.academy@yandex.ru</a></dd>
          <dt>Телефон</dt>
          <dd><a href="tel:+79091690931">+7 909 169-09-31</a></dd>
          <dt>Сайт</dt>
          <dd><a href="https://itflux-academy.ru">itflux-academy.ru</a></dd>
        </dl>
      </div>
      <SiteRequisites />
      <p>
        Заявки от школ и учебных центров — на странице <Link to="/pricing">тарифов</Link> (карточка «Школа»).
        Условия оплаты и возврата — в <Link to="/offer">публичной оферте</Link>.
      </p>
    </div>
  );
}
