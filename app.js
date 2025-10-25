
// G.sales app.js - IndexedDB, sync, activity log, CSV export, last sync
const DB_NAME = 'g_sales_db_v2';
const SALES_STORE = 'sales';
const LOG_STORE = 'activityLogs';
let db;
const SERVER_URL = "https://script.google.com/macros/s/AKfycbx.../exec";

// Open DB and create stores
function openDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = e => {
      db = e.target.result;
      if (!db.objectStoreNames.contains(SALES_STORE)) db.createObjectStore(SALES_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(LOG_STORE)) db.createObjectStore(LOG_STORE, { autoIncrement: true });
    };
    req.onsuccess = e => { db = e.target.result; res(db); };
    req.onerror = e => rej(e);
  });
}

// Helpers for stores
function addToStore(storeName, obj) {
  return new Promise((res, rej) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.add(obj);
    tx.oncomplete = () => res();
    tx.onerror = e => rej(e);
  });
}

function putInStore(storeName, obj) {
  return new Promise((res, rej) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    store.put(obj);
    tx.oncomplete = () => res();
    tx.onerror = e => rej(e);
  });
}

function getAllFromStore(storeName) {
  return new Promise((res, rej) => {
    const tx = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const req = store.getAll();
    req.onsuccess = () => res(req.result);
    req.onerror = e => rej(e);
  });
}

// Activity logging
async function logEvent(type, message) {
  const entry = { type, message, timestamp: new Date().toISOString() };
  try { await addToStore(LOG_STORE, entry); } catch(e){ console.error('Log error', e); }
}

// UI elements
const form = document.getElementById('saleForm');
const salesContainer = document.getElementById('salesContainer');
const networkStatus = document.getElementById('networkStatus');
const syncBtn = document.getElementById('syncBtn');
const lastSyncEl = document.getElementById('lastSync');

function formatLocal(ts) { return new Date(ts).toLocaleString(); }

// Render sales table
async function renderSales() {
  const all = await getAllFromStore(SALES_STORE);
  if(!all || all.length===0) { salesContainer.innerHTML = '<div class="small">No sales yet.</div>'; return; }
  // build table
  let html = '<table class="sales-table"><thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th><th>Timestamp</th><th>Status</th></tr></thead><tbody>';
  all.sort((a,b)=>b.createdAt-a.createdAt).forEach(s=>{
    const status = s.synced ? '<span class="status-badge ok">✅ Synced</span>' : '<span class="status-badge pending">🕓 Pending</span>';
    html += `<tr><td>${s.item}</td><td>${s.qty}</td><td>₦${s.price.toFixed(2)}</td><td>₦${(s.qty*s.price).toFixed(2)}</td><td>${formatLocal(s.createdAt)}</td><td>${status}</td></tr>`;
  });
  html += '</tbody></table>';
  salesContainer.innerHTML = html;
}

// Form submit
form.addEventListener('submit', async e=>{
  e.preventDefault();
  const sale = {
    id: 's_'+Date.now(),
    item: document.getElementById('item').value.trim(),
    qty: Number(document.getElementById('qty').value),
    price: Number(document.getElementById('price').value),
    createdAt: Date.now(),
    synced: false
  };
  await putInStore(SALES_STORE, sale);
  await logEvent('sale_add', `New sale: ${sale.item} x${sale.qty} (₦${sale.price})`);
  form.reset();
  document.getElementById('qty').value = 1;
  renderSales();
});

// Sync single sale with FormData
async function syncSingleSale(sale) {
  try {
    await logEvent('sync_attempt', `Attempting sync for ${sale.id}`);
    const fd = new FormData();
    fd.append('id', sale.id);
    fd.append('item', sale.item);
    fd.append('qty', sale.qty);
    fd.append('price', sale.price);
    fd.append('createdAt', sale.createdAt);

    const resp = await fetch(SERVER_URL, { method: 'POST', body: fd });
    if(!resp.ok) { await logEvent('sync_fail', `Server returned status ${resp.status} for ${sale.id}`); return false; }

    const data = await resp.json();
    if(data && data.status === 'ready') { 
      sale.synced = true;
      await putInStore(SALES_STORE, sale);
      const ts = new Date().toISOString();
      localStorage.setItem('g_last_sync', ts);
      updateLastSyncUI();
      await logEvent('sync_success', `Sale ${sale.id} synced`);
      return true;
    } else { await logEvent('sync_fail', `Unexpected response for ${sale.id}: ${JSON.stringify(data)}`); return false; }
  } catch(err){ await logEvent('sync_fail', `Error syncing ${sale.id}: ${err.message}`); console.error(err); return false; }
}

// Sync all unsynced
async function syncAll(showAlert=true) {
  const all = await getAllFromStore(SALES_STORE);
  const unsynced = all.filter(s=>!s.synced);
  if(!unsynced.length){ if(showAlert) alert('No unsynced sales.'); return; }
  syncBtn.textContent = 'Syncing…';
  let success = 0;
  for(const s of unsynced){ 
    const ok = await syncSingleSale(s);
    if(ok) success++;
    await new Promise(r=>setTimeout(r, 200));
  }
  syncBtn.textContent = 'Sync Now';
  renderSales();
  await logEvent('sync_attempt_summary', `${success} of ${unsynced.length} synced`);
  if(showAlert) alert(`Sync complete: ${success} / ${unsynced.length} records synced.`);
}

syncBtn.addEventListener('click', ()=>syncAll(true));

// Auto-sync when online
async function handleOnline() {
  updateNetworkUI();
  await logEvent('reconnect', 'Network reconnected — attempting background sync');
  // background sync without alert
  syncAll(false);
}

// Update network UI and last sync UI
function updateNetworkUI() { networkStatus.textContent = navigator.onLine ? 'Online' : 'Offline'; }
function updateLastSyncUI() { const v = localStorage.getItem('g_last_sync'); document.getElementById('lastSync').textContent = v ? 'Last sync: ' + new Date(v).toLocaleString() : 'Last sync: —'; }

// CSV export for logs
async function exportLogsCSV() {
  const logs = await getAllFromStore(LOG_STORE);
  if(!logs || logs.length===0) return alert('No logs to export.');
  const rows = [['event','message','timestamp']];
  logs.forEach(l=> rows.push([l.type, l.message.replace(/\n/g,' '), l.timestamp]));
  const csv = rows.map(r=> r.map(v=> '"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\n');
  const date = new Date().toISOString().slice(0,10);
  const filename = `Gsales_ActivityLog_${date}.csv`;
  const blob = new Blob([csv], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  await logEvent('export_csv', `Exported CSV: ${filename}`);
}

// Render log table (for activity.html)
async function renderLogs() {
  const rows = await getAllFromStore(LOG_STORE);
  const tbody = document.getElementById('logBody');
  if(!rows || rows.length===0) { tbody.innerHTML = '<tr><td colspan="3">No logs yet.</td></tr>'; return; }
  tbody.innerHTML = '';
  rows.sort((a,b)=> new Date(b.timestamp) - new Date(a.timestamp)).forEach(r=>{
    const emoji = r.type.includes('sale')? '📝' : r.type.includes('sync_success')? '✅' : r.type.includes('sync_fail')? '⚠️' : r.type.includes('reconnect')? '🔁' : '🌐';
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${emoji} ${r.type}</td><td>${r.message}</td><td>${new Date(r.timestamp).toLocaleString()}</td>`;
    tbody.appendChild(tr);
  });
}

// Clear logs (delete all entries)
async function clearLogs() {
  return new Promise((res, rej)=>{
    const tx = db.transaction(LOG_STORE, 'readwrite');
    const store = tx.objectStore(LOG_STORE);
    const req = store.clear();
    req.onsuccess = () => res();
    req.onerror = e => rej(e);
  });
}

// wire up UI elements on either page
document.addEventListener('DOMContentLoaded', async ()=>{
  await openDB();
  updateNetworkUI();
  updateLastSyncUI();
  // attach handlers if elements present
  const exportBtn = document.getElementById('exportCsv');
  if(exportBtn) exportBtn.addEventListener('click', exportLogsCSV);
  const clearBtn = document.getElementById('clearLogs');
  if(clearBtn) clearBtn.addEventListener('click', async ()=>{ if(confirm('Clear all logs?')){ await clearLogs(); await logEvent('clear_logs','User cleared logs'); renderLogs(); } });
  // if on activity page, render logs
  if(document.getElementById('logBody')) await renderLogs();
  // if on main page render sales list
  if(document.getElementById('salesContainer')) await renderSales();
  // attach network listeners
  window.addEventListener('online', handleOnline);
  window.addEventListener('offline', updateNetworkUI);
  // register service worker
  if('serviceWorker' in navigator) navigator.serviceWorker.register('/service-worker.js').catch(console.error);
});
