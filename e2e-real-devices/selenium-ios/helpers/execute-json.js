function isExecuteSerializeError(err) {
  const message = String((err && err.message) || err || "");
  return /Recursive object cannot be transferred|circular structure|cannot be transferred when running/i.test(message)
    || /Expected ',' or '}' after property value in JSON/i.test(message)
    || /JSON\.parse/i.test(message);
}

function parseExecuteJson(raw, label) {
  const where = label || "execute";
  if (raw == null || raw === "") {
    throw new Error(`${where}: empty execute result`);
  }
  if (typeof raw === "string") {
    return JSON.parse(raw);
  }
  if (typeof raw === "object" && typeof raw.value === "string") {
    return JSON.parse(raw.value);
  }
  if (typeof raw === "object") {
    return raw;
  }
  throw new Error(`${where}: execute returned ${typeof raw}, expected JSON string`);
}

async function executeJson(browser, fn, label) {
  const raw = await browser.execute(fn);
  return parseExecuteJson(raw, label);
}

module.exports = {
  isExecuteSerializeError,
  parseExecuteJson,
  executeJson,
};
