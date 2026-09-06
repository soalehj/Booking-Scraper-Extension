document.addEventListener('DOMContentLoaded', async () => {
  const statTotal = document.getElementById('statTotal');
  const statNew = document.getElementById('statNew');
  const syncTime = document.getElementById('syncTime');
  const checkNewBtn = document.getElementById('checkNewBtn');
  const fullScanBtn = document.getElementById('fullScanBtn');
  const extractBtn = document.getElementById('extractBtn');

  function renderData(scannedDataset = [], lastNewOrderCount = 0, lastSyncTimestamp = null) {
    statTotal.textContent = scannedDataset.length;
    statNew.textContent = `+${lastNewOrderCount}`;

    if (lastSyncTimestamp) {
      const timeStr = new Date(lastSyncTimestamp).toLocaleTimeString('id-ID');
      syncTime.textContent = `Terakhir Sinkron: ${timeStr}`;
    }

    extractBtn.disabled = scannedDataset.length === 0;
  }

  const initialState = await chrome.storage.local.get(['scannedDataset', 'lastNewOrderCount', 'lastSyncTimestamp']);
  renderData(initialState.scannedDataset, initialState.lastNewOrderCount, initialState.lastSyncTimestamp);

  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local') {
      chrome.storage.local.get(['scannedDataset', 'lastNewOrderCount', 'lastSyncTimestamp']).then(res => {
        renderData(res.scannedDataset, res.lastNewOrderCount, res.lastSyncTimestamp);
      });
    }
  });

  checkNewBtn.addEventListener('click', () => {
    checkNewBtn.disabled = true;
    checkNewBtn.textContent = 'Memeriksa...';

    chrome.runtime.sendMessage({ action: 'MANUAL_CHECK_NEW' }, () => {
      checkNewBtn.disabled = false;
      checkNewBtn.textContent = 'Cek Order Baru';
    });
  });

  fullScanBtn.addEventListener('click', async () => {
    fullScanBtn.disabled = true;
    fullScanBtn.textContent = 'Scanning Semua Halaman...';
    await chrome.storage.local.set({ scannedDataset: [] });

    chrome.runtime.sendMessage({ action: 'MANUAL_FULL_SCAN' }, () => {
      fullScanBtn.disabled = false;
      fullScanBtn.textContent = 'Reset & Full Scan';
    });
  });

  extractBtn.addEventListener('click', async () => {
    const { scannedDataset } = await chrome.storage.local.get('scannedDataset');
    if (!scannedDataset || scannedDataset.length === 0) return;

    const blob = new Blob([JSON.stringify(scannedDataset, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `orders-full-export-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });
});