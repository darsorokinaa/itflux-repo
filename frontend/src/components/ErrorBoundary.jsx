import { Component } from "react";

/**
 * Перехватывает ошибки рендера/эффектов в поддереве, чтобы при сбое
 * пользователь видел понятное сообщение, а не полностью пустой экран.
 */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("UI_ERROR_BOUNDARY:", error, info?.componentStack);
  }

  handleReload = () => {
    this.setState({ error: null });
    if (typeof window !== "undefined") window.location.reload();
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div
        role="alert"
        style={{
          maxWidth: 640,
          margin: "32px auto",
          padding: 24,
          borderRadius: 16,
          border: "1.5px solid #fecaca",
          background: "#fef2f2",
          color: "#7f1d1d",
          fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
        }}
      >
        <h2 style={{ margin: "0 0 10px", fontSize: 22, lineHeight: 1.2 }}>
          Что-то пошло не так при отображении страницы
        </h2>
        <p style={{ margin: "0 0 16px", fontSize: 15, lineHeight: 1.5, color: "#b91c1c" }}>
          Произошла ошибка при формировании страницы. Попробуйте обновить — если ошибка
          повторяется, сообщите этот текст разработчику.
        </p>
        <pre
          style={{
            margin: "0 0 16px",
            padding: 12,
            borderRadius: 8,
            background: "#fff",
            border: "1px solid #fecaca",
            color: "#991b1b",
            fontSize: 12,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            maxHeight: 240,
            overflow: "auto",
          }}
        >
          {String(error?.stack || error?.message || error)}
        </pre>
        <button
          type="button"
          onClick={this.handleReload}
          style={{
            appearance: "none",
            border: "none",
            borderRadius: 999,
            padding: "10px 18px",
            background: "#2b52f5",
            color: "#fff",
            fontWeight: 700,
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          Обновить страницу
        </button>
      </div>
    );
  }
}

export default ErrorBoundary;
