/**
 * Человекочитаемые ошибки getUserMedia / Permissions.
 * Пользователь не должен видеть NotAllowedError и подобные имена.
 */

function browserFamily(userAgent = "") {
  const ua = String(userAgent || (typeof navigator !== "undefined" ? navigator.userAgent : "") || "");
  if (/Edg\//.test(ua)) return "edge";
  if (/Firefox\//.test(ua)) return "firefox";
  if (/CriOS|FxiOS/.test(ua) && /iPhone|iPad|iPod/.test(ua)) return "ios-chrome";
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua) && /iPhone|iPad|iPod/.test(ua)) return "safari-ios";
  if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) return "safari";
  if (/Android/.test(ua) && /Chrome\//.test(ua)) return "chrome-android";
  if (/Chrome\//.test(ua)) return "chrome";
  return "generic";
}

function permissionHint(kind, userAgent) {
  const family = browserFamily(userAgent);
  const device = kind === "microphone" ? "микрофона" : "камеры";
  if (family === "safari-ios" || family === "ios-chrome") {
    return `На iPhone или iPad откройте Настройки → Safari (или Chrome) → ${kind === "microphone" ? "Микрофон" : "Камера"} и разрешите доступ для этого сайта.`;
  }
  if (family === "safari") {
    return `В Safari нажмите «Safari» → «Настройки этого сайта» и разрешите ${device}.`;
  }
  if (family === "firefox") {
    return `В Firefox нажмите на значок замка слева от адреса и разрешите ${device} для этого сайта.`;
  }
  return `Нажмите на значок замка или камеры в адресной строке, разрешите ${device} и повторите проверку.`;
}

export function isSecureMediaContext() {
  if (typeof window === "undefined") return true;
  if (window.isSecureContext) return true;
  const host = window.location?.hostname || "";
  return host === "localhost" || host === "127.0.0.1";
}

export function mediaApiSupported() {
  return Boolean(
    typeof navigator !== "undefined"
    && navigator.mediaDevices
    && typeof navigator.mediaDevices.getUserMedia === "function",
  );
}

export function mapMediaError(error, kind = "camera") {
  const deviceWord = kind === "microphone" ? "микрофону" : "камере";
  const name = error?.name || "";
  const message = String(error?.message || "");

  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    const dismissed = /dismiss|prompt was dismissed|permission dismissed/i.test(message);
    return {
      code: dismissed ? "dismissed" : "denied",
      title: `Браузер не разрешает доступ к ${deviceWord}`,
      message: dismissed
        ? `Запрос доступа был закрыт. Нажмите «Проверить ещё раз» и разрешите ${kind === "microphone" ? "микрофон" : "камеру"}, когда браузер спросит.`
        : permissionHint(kind),
    };
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return {
      code: "not-found",
      title: kind === "microphone" ? "Микрофон не найден" : "Камера не найдена",
      message: kind === "microphone"
        ? "Подключите микрофон или гарнитуру и повторите проверку. Если устройство уже подключено, проверьте, что оно не отключено в системе."
        : "Подключите камеру и повторите проверку. Если камера уже подключена, убедитесь, что она не отключена в системе.",
    };
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return {
      code: "busy",
      title: kind === "microphone" ? "Микрофон занят" : "Камера занята",
      message: "Устройство уже использует другое приложение или вкладка. Закройте другие видеозвонки и повторите проверку.",
    };
  }
  if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
    return {
      code: "overconstrained",
      title: "Не удалось включить выбранное устройство",
      message: "Попробуйте другое устройство в списке или повторите проверку без выбора конкретной камеры или микрофона.",
    };
  }
  if (name === "AbortError") {
    return {
      code: "abort",
      title: "Проверка была прервана",
      message: "Повторите проверку. Если ошибка повторяется, перезагрузите страницу.",
    };
  }
  if (name === "InvalidStateError") {
    return {
      code: "disconnected",
      title: "Устройство отключилось",
      message: "Камера или микрофон были отключены во время проверки. Подключите устройство и нажмите «Проверить ещё раз».",
    };
  }
  if (!isSecureMediaContext()) {
    return {
      code: "insecure",
      title: "Сайт должен открываться по защищённому адресу",
      message: "Камера и микрофон доступны только по HTTPS. Откройте кабинет по защищённой ссылке и повторите проверку.",
    };
  }
  if (!mediaApiSupported() || name === "NotSupportedError" || name === "SecurityError" || name === "TypeError") {
    return {
      code: name === "SecurityError" ? "security" : "unsupported",
      title: name === "SecurityError" ? "Браузер блокирует доступ к устройствам" : "Браузер не поддерживает проверку устройств",
      message: name === "SecurityError"
        ? "Проверка возможна только в обычном окне браузера по HTTPS. Отключите строгие ограничения сайта и повторите попытку."
        : "Откройте кабинет в актуальной версии Chrome, Safari, Firefox или Яндекс Браузера.",
    };
  }
  return {
    code: "unknown",
    title: `Не удалось получить доступ к ${deviceWord}`,
    message: "Проверьте, что устройство подключено, не занято другим приложением, и разрешите доступ в настройках сайта.",
  };
}
