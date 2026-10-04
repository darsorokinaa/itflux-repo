/** Load MathJax on the page that actually typesets a formula.

The scripts are inserted from JavaScript after the first render. They are not
in the document head, so DOMContentLoaded does not wait for them.
*/

let loading = null;

export function loadMathJax() {
  if (typeof window === "undefined") return Promise.resolve(null);
  if (window.MathJax?.startup?.promise || window.MathJax?.typesetPromise) {
    return Promise.resolve(window.MathJax);
  }
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const config = document.createElement("script");
    config.src = "/vendor/mathjax/itflux-config.js";
    config.async = true;
    config.onload = () => {
      const script = document.createElement("script");
      script.src = "/vendor/mathjax/tex-mml-chtml.js";
      script.async = true;
      script.onload = () => resolve(window.MathJax || null);
      script.onerror = () => reject(new Error("mathjax"));
      document.head.appendChild(script);
    };
    config.onerror = () => reject(new Error("mathjax-config"));
    document.head.appendChild(config);
  }).catch((error) => {
    loading = null;
    throw error;
  });
  return loading;
}

export function typesetElement(node, isCancelled = () => false) {
  if (!node) return Promise.resolve();
  return loadMathJax()
    .then((mj) => {
      if (isCancelled() || !mj?.typesetPromise) return undefined;
      const run = () => {
        if (isCancelled()) return undefined;
        return mj.typesetPromise([node]).catch(() => {});
      };
      const startup = mj.startup?.promise;
      if (startup?.then) return startup.then(run, run);
      return run();
    })
    .catch(() => {});
}
