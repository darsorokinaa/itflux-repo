/* Локальный MathJax: без jsDelivr/Google. Подключать до tex-mml-chtml.js / tex-chtml.js. */
window.MathJax = {
  loader: {
    paths: {
      mathjax: "/vendor/mathjax",
      sre: "/vendor/mathjax/sre/mathmaps",
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
    sre: { json: "/vendor/mathjax/sre/mathmaps" },
  },
  chtml: {
    fontURL: "/vendor/mathjax/output/chtml/fonts/woff-v2",
    scale: 1.525,
    mtextInheritFont: false,
    matchFontHeight: false,
  },
  startup: { typeset: false },
};
