const CHANNEL_PREFIX = "tas-edu-presenter-";

export function createPresenterSync({ mode, sessionId, getState, onState, onAnnotations, onPointer, onConnection, onEnd }) {
  if (!("BroadcastChannel" in window)) {
    onConnection?.("unsupported");
    return unsupportedSync();
  }
  const channel = new BroadcastChannel(`${CHANNEL_PREFIX}${sessionId}`);
  let destroyed = false;
  let lastAudienceSeenAt = 0;
  let annotationTimer = null;
  let pointerTimer = null;
  let pendingPointer = null;
  let pendingAnnotations = null;

  const post = (type, payload = {}) => {
    if (!destroyed) channel.postMessage({ type, sessionId, ...payload });
  };
  const sendState = () => {
    if (mode !== "presenter") return;
    const snapshot = getState?.();
    if (snapshot) post("FULL_STATE", { state: snapshot });
  };

  channel.onmessage = (event) => {
    const message = event.data ?? {};
    if (message.sessionId !== sessionId) return;
    if (mode === "presenter") {
      if (["REQUEST_STATE", "AUDIENCE_READY", "PONG"].includes(message.type)) {
        lastAudienceSeenAt = Date.now();
        onConnection?.("connected");
      }
      if (["REQUEST_STATE", "AUDIENCE_READY"].includes(message.type)) sendState();
      if (message.type === "AUDIENCE_CLOSED") onConnection?.("disconnected");
      return;
    }
    if (message.type === "FULL_STATE") onState?.(message.state);
    if (message.type === "ANNOTATIONS") onAnnotations?.(message.pageNumber, message.annotations);
    if (message.type === "POINTER") onPointer?.(message.pointer);
    if (message.type === "PING") post("PONG");
    if (message.type === "PRESENTATION_END") onEnd?.();
  };

  const heartbeat = mode === "presenter"
    ? setInterval(() => {
      post("PING");
      if (lastAudienceSeenAt && Date.now() - lastAudienceSeenAt > 5500) onConnection?.("disconnected");
    }, 2000)
    : setInterval(() => post("PONG"), 2000);

  if (mode === "audience") {
    post("AUDIENCE_READY");
    post("REQUEST_STATE");
  } else {
    onConnection?.("waiting");
  }

  return {
    supported: true,
    sendState,
    sendAnnotations(pageNumber, annotations) {
      if (mode !== "presenter") return;
      pendingAnnotations = { pageNumber, annotations };
      if (annotationTimer) return;
      annotationTimer = setTimeout(() => {
        annotationTimer = null;
        post("ANNOTATIONS", pendingAnnotations);
      }, 33);
    },
    sendPointer(pointer) {
      if (mode !== "presenter") return;
      pendingPointer = pointer;
      if (pointerTimer) return;
      pointerTimer = setTimeout(() => {
        pointerTimer = null;
        post("POINTER", { pointer: pendingPointer });
      }, 25);
    },
    requestState() { post("REQUEST_STATE"); },
    end() { if (mode === "presenter") post("PRESENTATION_END"); },
    close() {
      if (destroyed) return;
      if (mode === "audience") post("AUDIENCE_CLOSED");
      destroyed = true;
      clearInterval(heartbeat);
      clearTimeout(annotationTimer);
      clearTimeout(pointerTimer);
      channel.close();
    },
  };
}

function unsupportedSync() {
  return {
    supported: false,
    sendState() {}, sendAnnotations() {}, sendPointer() {}, requestState() {}, end() {}, close() {},
  };
}
