import { Link } from "react-router-dom";

function NotFoundPage() {
  return (
    <div
      className="hero"
      style={{
        textAlign: "center",
        padding: "3rem 2rem",
        maxWidth: 540,
        margin: "2rem auto",
      }}
    >
      <div
        style={{
          fontSize: "5rem",
          fontWeight: 800,
          lineHeight: 1,
          color: "var(--accent)",
          marginBottom: "0.5rem",
        }}
      >
        404
      </div>
      <h1 style={{ marginBottom: "1rem" }}>Страница не найдена</h1>
      <p style={{ marginBottom: "0.75rem" }}>
        Кажется, здесь ничего нет. Но мы уже работаем над этим — скоро всё
        починим!
      </p>
      <p style={{ marginBottom: "2rem", opacity: 0.7, fontSize: "0.95rem" }}>
        Если вы уверены, что страница должна существовать, попробуйте вернуться
        позже.
      </p>
      <Link
        to="/"
        className="welcome-banner-cta"
        style={{ display: "inline-block" }}
      >
        на главную
      </Link>
    </div>
  );
}

export default NotFoundPage;
