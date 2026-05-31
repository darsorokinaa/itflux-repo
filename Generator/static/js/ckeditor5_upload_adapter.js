(function () {
  "use strict";

  function getCookie(name) {
    const cookie = document.cookie
      .split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(name + "="));
    return cookie ? decodeURIComponent(cookie.substring(name.length + 1)) : "";
  }

  class SimpleUploadAdapter {
    constructor(loader, uploadUrl) {
      this.loader = loader;
      this.uploadUrl = uploadUrl;
      this.controller = null;
    }

    upload() {
      return this.loader.file.then((file) => {
        if (!file) {
          return Promise.reject("Файл не выбран.");
        }

        const formData = new FormData();
        formData.append("upload", file);

        this.loader.uploadTotal = file.size || 0;
        this.controller = new AbortController();

        return fetch(this.uploadUrl, {
          method: "POST",
          body: formData,
          credentials: "same-origin",
          signal: this.controller.signal,
          headers: {
            "X-CSRFToken": getCookie("csrftoken"),
          },
        })
          .then((resp) =>
            resp.json().catch(() => ({})).then((payload) => ({ ok: resp.ok, payload }))
          )
          .then(({ ok, payload }) => {
            if (!ok) {
              const msg =
                payload?.error?.message ||
                payload?.message ||
                "Не удалось загрузить изображение.";
              throw new Error(msg);
            }
            const url = payload?.url;
            if (!url) {
              throw new Error("Сервер не вернул URL изображения.");
            }
            this.loader.uploaded = file.size || 0;
            return { default: url };
          });
      });
    }

    abort() {
      if (this.controller) this.controller.abort();
    }
  }

  function attachAdapter(editor, uploadUrl) {
    try {
      const repo = editor.plugins.get("FileRepository");
      repo.createUploadAdapter = (loader) => new SimpleUploadAdapter(loader, uploadUrl);
    } catch (_) {
      // Ignore if this is not a standard editor instance.
    }
  }

  function patchClassicEditor(uploadUrl) {
    const CE = window.ClassicEditor;
    if (!CE || CE.__customUploadPatched) return;
    const originalCreate = CE.create.bind(CE);
    CE.create = function (element, config) {
      return originalCreate(element, config).then((editor) => {
        attachAdapter(editor, uploadUrl);
        return editor;
      });
    };
    CE.__customUploadPatched = true;
  }

  function patchExistingEditors(uploadUrl) {
    const buckets = [window.editors, window.ckeditorEditors, window.djangoCkeditor5Editors];
    for (const bucket of buckets) {
      if (!bucket) continue;
      if (Array.isArray(bucket)) {
        bucket.forEach((editor) => attachAdapter(editor, uploadUrl));
      } else if (typeof bucket === "object") {
        Object.values(bucket).forEach((editor) => attachAdapter(editor, uploadUrl));
      }
    }
  }

  function init() {
    const uploadField = document.querySelector("[data-ckeditor-custom-adapter='1']");
    if (!uploadField) return;
    const uploadUrl = uploadField.getAttribute("data-upload-url") || "/ckeditor/upload/";
    patchClassicEditor(uploadUrl);
    patchExistingEditors(uploadUrl);
    setTimeout(() => patchExistingEditors(uploadUrl), 300);
    setTimeout(() => patchExistingEditors(uploadUrl), 1000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
