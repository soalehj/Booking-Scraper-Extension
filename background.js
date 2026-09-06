const delay = (ms) => new Promise(res => setTimeout(res, ms));
const SYNC_ALARM_NAME = 'INCREMENTAL_ORDER_SYNC';

// Set Alarm minimum 1.0 menit (Aturan Ketat MV3 Chromium)
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(SYNC_ALARM_NAME, { periodInMinutes: 1.0 });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM_NAME) {
    checkForNewOrders();
  }
});

function sanitizeHeaders(headersObj) {
  const forbidden = ['host', 'origin', 'referer', 'user-agent', 'content-length', 'sec-fetch-dest', 'sec-fetch-mode', 'sec-fetch-site'];
  const clean = {};
  if (headersObj && typeof headersObj === 'object') {
    Object.entries(headersObj).forEach(([k, v]) => {
      if (!forbidden.includes(k.toLowerCase())) clean[k] = v;
    });
  }
  return clean;
}

function getItemId(item) {
  if (!item || typeof item !== 'object') return '';
  return String(item.id || item.booking_id || item.id_booking || item.booking_no || item.code || '');
}

function extractItemsFromResponse(json) {
  if (!json || typeof json !== 'object') return [];
  if (Array.isArray(json)) return json;
  if (Array.isArray(json.data)) return json.data;
  if (Array.isArray(json.data?.list)) return json.data.list;
  if (Array.isArray(json.data?.items)) return json.data.items;
  if (Array.isArray(json.data?.rows)) return json.data.rows;
  if (Array.isArray(json.data?.records)) return json.data.records;
  if (Array.isArray(json.data?.booking_list)) return json.data.booking_list;
  if (Array.isArray(json.items)) return json.items;
  if (Array.isArray(json.rows)) return json.rows;
  if (Array.isArray(json.result)) return json.result;
  return [];
}

async function acquireLock() {
  const { isSyncLocked } = await chrome.storage.local.get('isSyncLocked');
  if (isSyncLocked) return false;
  await chrome.storage.local.set({ isSyncLocked: true });
  return true;
}

async function releaseLock() {
  await chrome.storage.local.set({ isSyncLocked: false });
}

function updateExtensionBadge(text, color) {
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color });
}

function buildRequestPayload(urlStr, method, originalBody, page, pageSize = 20) {
  const targetUrl = new URL(urlStr);
  let fetchUrl = urlStr;
  let bodyData = null;
  const offset = (page - 1) * pageSize;

  if (method === 'POST') {
    const payload = originalBody ? JSON.parse(JSON.stringify(originalBody)) : {};
    payload.page = page;
    payload.page_no = page;
    payload.pageNo = page;
    payload.page_number = page;
    payload.current = page;
    payload.pageSize = pageSize;
    payload.page_size = pageSize;
    payload.size = pageSize;
    payload.offset = offset;
    bodyData = JSON.stringify(payload);
  } else {
    targetUrl.searchParams.set('page', page.toString());
    targetUrl.searchParams.set('page_no', page.toString());
    targetUrl.searchParams.set('pageNo', page.toString());
    targetUrl.searchParams.set('page_number', page.toString());
    targetUrl.searchParams.set('current', page.toString());
    targetUrl.searchParams.set('pageSize', pageSize.toString());
    targetUrl.searchParams.set('page_size', pageSize.toString());
    targetUrl.searchParams.set('size', pageSize.toString());
    targetUrl.searchParams.set('offset', offset.toString());
    fetchUrl = targetUrl.toString();
  }

  return { fetchUrl, bodyData };
}

async function fetchSingleOverview(item, listApiUrl, headers) {
  const itemId = getItemId(item);
  if (!itemId) return { ...item, overview: null };

  try {
    const originUrl = new URL(listApiUrl);
    const overviewUrl = new URL(`${originUrl.origin}/api/line_haul/agency/booking/bidding/booking_overview`);
    overviewUrl.searchParams.set('id', itemId);

    const res = await fetch(overviewUrl.toString(), {
      method: 'GET',
      headers: { ...headers, 'content-type': 'application/json' },
      credentials: 'include'
    });

    if (!res.ok) return { ...item, overview: null, overview_error: `HTTP ${res.status}` };

    const json = await res.json();
    return { ...item, overview: json.data || json };
  } catch (err) {
    return { ...item, overview: null, overview_error: err.message };
  }
}

async function enrichWithBookingOverview(items, listApiUrl, headers) {
  if (items.length === 0) return [];
  const BATCH_SIZE = 5;
  const BATCH_DELAY = 150;
  const enrichedItems = [];

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const promises = batch.map(item => fetchSingleOverview(item, listApiUrl, headers));
    const batchResults = await Promise.all(promises);
    enrichedItems.push(...batchResults);
    await delay(BATCH_DELAY);
  }

  return enrichedItems;
}

// 1. FULL SCAN PIPELINE (Setiap kali storage kosong / tombol scan ditekan)
async function executeFullScanPipeline(sendResponse) {
  const locked = await acquireLock();
  if (!locked) {
    if (sendResponse) sendResponse({ success: false, reason: 'BUSY' });
    return;
  }

  updateExtensionBadge('FULL', '#2563eb');

  try {
    const { apiConfig } = await chrome.storage.local.get('apiConfig');
    if (!apiConfig || !apiConfig.url) throw new Error('API belum disadap.');

    const { url, method, headers, body } = apiConfig;
    const safeHeaders = sanitizeHeaders(headers);
    const scannedRecords = [];
    const uniqueKeys = new Set();

    let currentPage = 1;
    let hasMore = true;

    while (hasMore && currentPage <= 50) {
      const { fetchUrl, bodyData } = buildRequestPayload(url, method, body, currentPage, 20);
      const options = {
        method: method || 'GET',
        headers: { ...safeHeaders, 'content-type': 'application/json' },
        credentials: 'include'
      };
      if (bodyData) options.body = bodyData;

      const res = await fetch(fetchUrl, options);
      if (!res.ok) break;

      const json = await res.json();
      const items = extractItemsFromResponse(json);
      if (!items || items.length === 0) break;

      let newCount = 0;
      items.forEach(item => {
        const idKey = getItemId(item) || JSON.stringify(item);
        if (idKey && !uniqueKeys.has(idKey)) {
          uniqueKeys.add(idKey);
          scannedRecords.push(item);
          newCount++;
        }
      });

      if (newCount === 0) break;
      currentPage++;
      await delay(200);
    }

    const enrichedDataset = await enrichWithBookingOverview(scannedRecords, url, safeHeaders);

    await chrome.storage.local.set({
      scannedDataset: enrichedDataset,
      lastSyncTimestamp: Date.now()
    });

    updateExtensionBadge(enrichedDataset.length.toString(), '#16a34a');
    if (sendResponse) sendResponse({ success: true, count: enrichedDataset.length });
  } catch (err) {
    updateExtensionBadge('ERR', '#dc2626');
    if (sendResponse) sendResponse({ success: false, error: err.message });
  } finally {
    await releaseLock();
  }
}

// 2. INCREMENTAL SYNC (Siklus Periodik Alarm)
async function checkForNewOrders() {
  const locked = await acquireLock();
  if (!locked) return;

  try {
    const { apiConfig, scannedDataset = [] } = await chrome.storage.local.get(['apiConfig', 'scannedDataset']);
    if (!apiConfig || !apiConfig.url) return;

    const { url, method, headers, body } = apiConfig;
    const safeHeaders = sanitizeHeaders(headers);
    const existingIdSet = new Set(scannedDataset.map(item => getItemId(item)).filter(Boolean));

    let currentPage = 1;
    let newItemsFound = [];
    let hitExistingOrder = false;

    while (!hitExistingOrder && currentPage <= 10) {
      const { fetchUrl, bodyData } = buildRequestPayload(url, method, body, currentPage, 20);
      const options = {
        method: method || 'GET',
        headers: { ...safeHeaders, 'content-type': 'application/json' },
        credentials: 'include'
      };
      if (bodyData) options.body = bodyData;

      const res = await fetch(fetchUrl, options);
      if (!res.ok) break;

      const json = await res.json();
      const items = extractItemsFromResponse(json);
      if (!items || items.length === 0) break;

      let addedInPage = 0;
      for (const item of items) {
        const id = getItemId(item);
        if (!id) continue;

        if (existingIdSet.has(id)) {
          hitExistingOrder = true;
          break;
        } else {
          newItemsFound.push(item);
          addedInPage++;
        }
      }

      if (addedInPage === 0) break;
      currentPage++;
      await delay(200);
    }

    if (newItemsFound.length > 0) {
      const enrichedNewItems = await enrichWithBookingOverview(newItemsFound, url, safeHeaders);
      const updatedDataset = [...enrichedNewItems, ...scannedDataset];

      await chrome.storage.local.set({
        scannedDataset: updatedDataset,
        lastNewOrderCount: newItemsFound.length,
        lastSyncTimestamp: Date.now()
      });

      updateExtensionBadge(updatedDataset.length.toString(), '#16a34a');

      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        title: 'Order Baru Masuk!',
        message: `Ditemukan ${newItemsFound.length} order baru secara background.`
      });
    }
  } catch (err) {
    console.error('[Incremental Sync Error]:', err);
  } finally {
    await releaseLock();
  }
}

// 3. REALTIME WEBSOCKET PUSH HANDLER
async function handleRealtimeOrderPush(rawPayload) {
  const { scannedDataset = [], apiConfig } = await chrome.storage.local.get(['apiConfig', 'scannedDataset']);
  const incomingItems = Array.isArray(rawPayload) ? rawPayload : (rawPayload && typeof rawPayload === 'object' ? [rawPayload] : []);
  if (incomingItems.length === 0) return;

  const existingIdSet = new Set(scannedDataset.map(item => getItemId(item)).filter(Boolean));
  const newItems = incomingItems.filter(item => {
    const id = getItemId(item);
    return id && !existingIdSet.has(id);
  });

  if (newItems.length === 0) return;

  const safeHeaders = sanitizeHeaders(apiConfig?.headers || {});
  const listUrl = apiConfig?.url || location.origin;

  const enrichedNewItems = await Promise.all(newItems.map(item => fetchSingleOverview(item, listUrl, safeHeaders)));
  const updatedDataset = [...enrichedNewItems, ...scannedDataset];

  await chrome.storage.local.set({
    scannedDataset: updatedDataset,
    lastNewOrderCount: newItems.length,
    lastSyncTimestamp: Date.now()
  });

  updateExtensionBadge(updatedDataset.length.toString(), '#16a34a');
}

// Event Router
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'AUTO_START_SCAN') {
    chrome.storage.local.get('scannedDataset', (res) => {
      if (!res.scannedDataset || res.scannedDataset.length === 0) {
        executeFullScanPipeline(sendResponse);
      } else {
        checkForNewOrders().then(() => sendResponse({ success: true }));
      }
    });
    return true;
  } else if (message.action === 'MANUAL_FULL_SCAN') {
    executeFullScanPipeline(sendResponse);
    return true;
  } else if (message.action === 'MANUAL_CHECK_NEW') {
    checkForNewOrders().then(() => sendResponse({ success: true }));
    return true;
  } else if (message.action === 'PROCESS_REALTIME_ORDER') {
    handleRealtimeOrderPush(message.payload);
    return true;
  }
});