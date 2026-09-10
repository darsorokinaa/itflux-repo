/**
 * Runs INSIDE the Jitsi Meet page (cross-origin iframe).
 * Activates the existing Jitsi remote-control feature via APP.store / conference.
 * Installed by: sudo bash deploy/jitsi/enable-remote-control.sh
 *
 * Does not inject OS mouse/keyboard. Native input stays in Electron SDK main.
 */
(function itfluxRemoteControlBridge() {
  if (window.__ITFLUX_RC_BRIDGE__) return;
  window.__ITFLUX_RC_BRIDGE__ = true;

  var SOURCE = "itflux";
  var TYPE = "itflux:remote-control";
  var MESSAGE_NAME = "remote-control";

  function parentOrigin() {
    try {
      if (document.referrer) return new URL(document.referrer).origin;
    } catch (err) { /* ignore */ }
    return "";
  }

  function conference() {
    try {
      var store = window.APP && APP.store;
      var state = store && store.getState && store.getState();
      return (state && state["features/base/conference"] && state["features/base/conference"].conference)
        || (window.APP && APP.conference && APP.conference._room)
        || null;
    } catch (err) {
      return null;
    }
  }

  function send(to, payload) {
    var room = conference();
    if (!room || !to || typeof room.sendEndpointMessage !== "function") return false;
    try {
      room.sendEndpointMessage(to, Object.assign({ name: MESSAGE_NAME }, payload));
      return true;
    } catch (err) {
      return false;
    }
  }

  function handle(data) {
    var action = String(data && data.action || "");
    var participantId = String(data && data.participantId || "");
    if (action === "request" && participantId) {
      return send(participantId, { type: "permissions", action: "request" });
    }
    if (action === "stop") {
      if (participantId) return send(participantId, { type: "stop" });
      return send("", { type: "stop" });
    }
    return false;
  }

  window.addEventListener("message", function (event) {
    var data = event && event.data;
    if (!data || data.source !== SOURCE || data.type !== TYPE) return;
    var expected = parentOrigin();
    if (expected && event.origin && event.origin !== expected) return;
    handle(data);
  });
})();
