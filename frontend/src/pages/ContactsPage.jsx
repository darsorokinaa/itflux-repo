/** r50: контакты и реквизиты. */
import { Link } from "react-router-dom";
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
      <h2>Реквизиты</h2>
      <div className="legal-card">
        <dl>
          <dt>Исполнитель</dt>
          <dd>Индивидуальный предприниматель Сорокина Дарья Витальевна</dd>
          <dt>ИНН</dt>
          <dd>212404973272</dd>
          <dt>ОГРНИП</dt>
          <dd>325508100173371 (дата регистрации 28.03.2025)</dd>
          <dt>ОКВЭД</dt>
          <dd>85.41</dd>
          <dt>Адрес</dt>
          <dd>Московская обл., г. Балашиха</dd>
          <dt>Расчётный счёт</dt>
          <dd>40802810000008116630</dd>
          <dt>Банк</dt>
          <dd>АО «ТБанк»</dd>
          <dt>ИНН банка</dt>
          <dd>7710140679</dd>
          <dt>БИК</dt>
          <dd>044525974</dd>
          <dt>Корр. счёт</dt>
          <dd>30101810145250000974</dd>
          <dt>Адрес банка</dt>
          <dd>127287, г. Москва, ул. Хуторская 2-я, д. 38А, стр. 26</dd>
        </dl>
      </div>
      <p>
        Заявки от школ и учебных центров — на странице <Link to="/pricing">тарифов</Link> (карточка «Школа»).
        Условия оплаты и возврата — в <Link to="/offer">публичной оферте</Link>.
      </p>
    </div>
  );
}
