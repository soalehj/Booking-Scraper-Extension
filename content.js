function isValidCapturedConfig(payload) {
  if (!payload || typeof payload !== 'object' || typeof payload.url !== 'string') return false;
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(payload.method)) return false;

  try {
    const url = new URL(payload.url);
    return url.origin === window.location.origin;
  } catch (err) {
    return false;
  }
}

window.addEventListener('message', (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;

  if (event.data?.type === 'CAPTURED_API_CONFIG') {
    if (!isValidCapturedConfig(event.data.payload)) return;
    chrome.runtime.sendMessage({
      action: 'CAPTURED_API_CONFIG',
      payload: event.data.payload
    });
  }

  if (event.data?.type === 'REALTIME_ORDER_EVENT') {
    chrome.runtime.sendMessage({
      action: 'PROCESS_REALTIME_ORDER',
      payload: event.data.payload
    });
  }
});