import { Component } from "react";

import LessonBoardMessage from "./LessonBoardMessage";

/** Ловит падение tldraw, не отдавая его границе всей страницы урока. */
export default class BoardV2ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    console.error("tldraw board render failed", error);
  }

  retry = () => {
    this.setState({ error: null });
    this.props.onRetry?.();
  };

  render() {
    if (!this.state.error) return this.props.children;
    const detail = this.state.error instanceof Error ? this.state.error.message : String(this.state.error);
    return (
      <LessonBoardMessage
        title="Не удалось подключить доску"
        text={`Доска остановилась с ошибкой${detail ? `: ${detail}` : ""}. Видеозвонок, задания и чат при этом продолжают работать.`}
        onRetry={this.retry}
      />
    );
  }
}
