(function () {
  const TARGET_ENDPOINT = '/api/line_haul/agency/booking/bidding/list';

  function getAbsoluteUrl(url) {
    try {
      return new URL(url, window.location.href).href;
    } catch (e) {
      return url;
    }
  }

  function broadcastApiConfig(rawUrl, method, headers, requestBody, responseData) {
    const absoluteUrl = getAbsoluteUrl(rawUrl);
    let parsedHeaders = {};
    if (headers instanceof Headers) {
      parsedHeaders = Object.fromEntries(headers.entries());
    } else if (headers && typeof headers === 'object') {
      parsedHeaders = headers;
    }

    let parsedBody = null;
    if (requestBody) {
      try {
        parsedBody = typeof requestBody === 'string' ? JSON.parse(requestBody) : requestBody;
      } catch (e) {}
    }

    window.postMessage({
      type: 'CAPTURED_API_CONFIG',
      payload: {
        url: absoluteUrl,
        method: method.toUpperCase(),
        headers: parsedHeaders,
        body: parsedBody,
        timestamp: Date.now()
      }
    }, '*');
  }

  // 1. SPA Navigation Patch
  const patchHistory = (type) => {
    const orig = history[type];
    return function (...args) {
      const result = orig.apply(this, args);
      window.dispatchEvent(new Event('locationchange'));
      return result;
    };
  };
  history.pushState = patchHistory('pushState');
  history.replaceState = patchHistory('replaceState');
  window.addEventListener('popstate', () => window.dispatchEvent(new Event('locationchange')));

  // 2. WebSocket Interceptor
  const OriginalWebSocket = window.WebSocket;
  window.WebSocket = function (...args) {
    const ws = new OriginalWebSocket(...args);
    ws.addEventListener('message', (event) => {
      try {
        const payload = typeof event.data === 'string' ? JSON.parse(event.data) : null;
        if (payload && (payload.booking_id || payload.id || payload.order_id)) {
          window.postMessage({
            type: 'REALTIME_ORDER_EVENT',
            payload: payload.data || payload
          }, '*');
        }
      } catch (e) {}
    });
    return ws;
  };

  // 3. Fetch Interceptor
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
    const response = await originalFetch.apply(this, args);

    if (url.includes(TARGET_ENDPOINT)) {
      try {
        const method = args[1]?.method || 'GET';
        const reqBody = args[1]?.body || null;
        const clone = response.clone();
        const json = await clone.json();
        broadcastApiConfig(url, method, args[1]?.headers || {}, reqBody, json);
      } catch (err) {}
    }
    return response;
  };

  // 4. XHR Interceptor
  const originalXHR = window.XMLHttpRequest.prototype.open;
  const originalSend = window.XMLHttpRequest.prototype.send;

  window.XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._url = url;
    this._method = method;
    return originalXHR.apply(this, [method, url, ...rest]);
  };

  window.XMLHttpRequest.prototype.send = function (body, ...args) {
    this.addEventListener('load', function () {
      if (this._url && this._url.includes(TARGET_ENDPOINT)) {
        try {
          const json = JSON.parse(this.responseText);
          broadcastApiConfig(this._url, this._method, {}, body, json);
        } catch (err) {}
      }
    });
    return originalSend.apply(this, [body, ...args]);
  };
})();