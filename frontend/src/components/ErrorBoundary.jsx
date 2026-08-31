import { Component } from "react";
import { reportClientEvent } from "../utils/clientTelemetry";
import { cabinetHomePath } from "../utils/appBoot";
import { isStandaloneDisplay } from "../cabinet/pwa/pwaHelpers";

function safeMessage(error) {
  return String(error?.message || error || "render").slice(0, 240);
}

function safeStack(error, info) {
  return String(error?.stack || info?.componentStack || "").slice(0, 800);
}

/**
 * Top-level and route crash catcher. Never leave a blank #root.
 */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null, repeats: 0 };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    const repeats = (this.state.repeats || 0) + 1;
    this.setState({ repeats });
    // eslint-disable-next-line no-console
    console.error("[APP_FATAL]", error, info?.componentStack);
    try {
      reportClientEvent("APP_RENDER_ERROR", {
        message: safeMessage(error),
        stack: safeStack(error, info),
        route: typeof window !== "undefined" ? String(window.location.pathname || "").slice(0, 160) : "",
        meetingId: String(this.props.meetingId || "").slice(0, 64),
        role: String(this.props.role || "").slice(0, 32),
        pwa: isStandaloneDisplay(),
        repeats,
      });
    } catch {
      /* ignore */
    }
    this.props.onError?.(error, info);
  }

  handleRetry = () => {
    this.setState({ error: null });
    this.props.onRetry?.();
  };

  handleReload = () => {
    if (typeof window !== "undefined") window.location.reload();
  };

  handleHome = () => {
    if (typeof window === "undefined") return;
    const href = this.props.homeHref || cabinetHomePath(window.location.pathname);
    window.location.assign(href);
  };

  render() {
    const { error, repeats } = this.state;
    if (!error) return this.props.children;

    const kind = this.props.kind === "room" ? "room" : "app";
    const title = kind === "room"
      ? "Не удалось открыть урок."
      : "Не удалось загрузить приложение.";
    const showHome = kind === "room" || repeats >= 1;

    return (
      <div className="itflux-fatal-fallback" role="alert" data-testid="app-error-fallback">
        <div className="itflux-fatal-fallback__card">
          <h2 className="itflux-fatal-fallback__title">{title}</h2>
          <p className="itflux-fatal-fallback__text">
            {kind === "room"
              ? "Комната не открылась. Можно переподключиться или вернуться в кабинет."
              : "Попробуйте ещё раз. Если ошибка повторится — обновите приложение."}
          </p>
          <div className="itflux-fatal-fallback__actions">
            <button
              type="button"
              className="itflux-fatal-fallback__btn itflux-fatal-fallback__btn--primary"
              data-testid="app-error-retry"
              onClick={this.handleRetry}
            >
              {kind === "room" ? "Переподключиться" : "Повторить"}
            </button>
            <button
              type="button"
              className="itflux-fatal-fallback__btn"
              data-testid="app-error-reload"
              onClick={this.handleReload}
            >
              {kind === "room" ? "Обновить" : "Обновить приложение"}
            </button>
            {showHome ? (
              <button
                type="button"
                className="itflux-fatal-fallback__btn"
                data-testid="app-error-home"
                onClick={this.handleHome}
              >
                Вернуться в кабинет
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
