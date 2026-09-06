window.addEventListener('message', (event) => {
  if (event.source !== window) return;

  if (event.data?.type === 'CAPTURED_API_CONFIG') {
    chrome.storage.local.set({ apiConfig: event.data.payload }, () => {
      chrome.runtime.sendMessage({ action: 'AUTO_START_SCAN' });
    });
  }

  if (event.data?.type === 'REALTIME_ORDER_EVENT') {
    chrome.runtime.sendMessage({
      action: 'PROCESS_REALTIME_ORDER',
      payload: event.data.payload
    });
  }
});