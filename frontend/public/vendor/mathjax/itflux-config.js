/* Локальный MathJax: без jsDelivr. Подключать до tex-mml-chtml.js / tex-chtml.js.
   Корень берём из src этого файла — в dev это /vendor/mathjax, в сборке Vite
   иначе превращает путь в /static/vendor/mathjax и скрипт 404. */
(function () {
  var src = (document.currentScript && document.currentScript.src) || "";
  var root = "/vendor/mathjax";
  if (src) {
    root = src.replace(/\/[^/]*$/, "");
  }
  window.MathJax = {
    loader: {
      paths: {
        mathjax: root,
        sre: root + "/sre/mathmaps",
      },
      failed: function (err) {
        console.error("MathJax load failed", err);
      },
    },
    tex: {
      inlineMath: [
        ["$", "$"],
        ["\\(", "\\)"],
      ],
      displayMath: [
        ["$$", "$$"],
        ["\\[", "\\]"],
      ],
    },
    options: {
      enableAssistiveMml: false,
      enableEnrichment: false,
      enableComplexity: false,
      enableExplorer: false,
      menuOptions: {
        settings: { enrich: false, collapsible: false, explorer: false },
      },
      sre: { json: root + "/sre/mathmaps" },
    },
    chtml: {
      fontURL: root + "/output/chtml/fonts/woff-v2",
      scale: 1.525,
      mtextInheritFont: false,
      matchFontHeight: false,
    },
    startup: { typeset: false },
  };
})();
