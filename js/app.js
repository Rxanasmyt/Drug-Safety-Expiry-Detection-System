/* PharmaCare — Drug Safety & Expiry Detection System */

// ── State ─────────────────────────────────────────────
const S = {
  drugs: [],
  filter: 'all',
  warn: 30,   // warning threshold (days)
  notice: 90, // notice threshold (days)
  deleteId: null,
};

// ── Sample data (dates relative to 2026-06-30) ────────
const SEED = [
  // Expired
  { id:1,  name:'Doxycycline 100mg',      generic:'Doxycycline Hyclate',       batch:'BT-2023-033', mfr:'PharmaCorp Ltd.',    mfgDate:'2021-12-01', expiry:'2026-01-01', stock:60,   unit:'capsules', cat:'Antibiotic',      storage:'Room Temperature (15–25°C)',  notes:'Avoid prolonged sun exposure.' },
  { id:2,  name:'Azithromycin 250mg',     generic:'Azithromycin Dihydrate',    batch:'BT-2023-055', mfr:'MedTech Corp.',      mfgDate:'2022-04-08', expiry:'2026-03-15', stock:48,   unit:'tablets',  cat:'Antibiotic',      storage:'Room Temperature (15–25°C)',  notes:'' },
  { id:3,  name:'Ciprofloxacin 250mg',    generic:'Ciprofloxacin HCl',         batch:'BT-2023-089', mfr:'GenMed Pharma',      mfgDate:'2021-06-20', expiry:'2026-04-01', stock:150,  unit:'tablets',  cat:'Antibiotic',      storage:'Room Temperature (15–25°C)',  notes:'Avoid sunlight exposure.' },
  { id:4,  name:'COVID-19 mRNA Vaccine',  generic:'BNT162b2',                  batch:'VAC-2025-001',mfr:'BioTech Labs',        mfgDate:'2024-06-01', expiry:'2025-12-01', stock:200,  unit:'vials',    cat:'Vaccine',         storage:'Frozen (−20°C)',              notes:'Ultra-cold storage required.' },

  // Expiring ≤30 days (from 2026-06-30: up to 2026-07-30)
  { id:5,  name:'Aspirin 75mg',           generic:'Acetylsalicylic Acid',      batch:'BT-2023-098', mfr:'MediCare Inc.',      mfgDate:'2022-08-30', expiry:'2026-07-10', stock:2000, unit:'tablets',  cat:'Analgesic',       storage:'Room Temperature (15–25°C)',  notes:'Keep in dry place.' },
  { id:6,  name:'Fluconazole 150mg',      generic:'Fluconazole',               batch:'BT-2023-077', mfr:'MycoCare Pharma',    mfgDate:'2022-07-05', expiry:'2026-07-25', stock:96,   unit:'capsules', cat:'Antifungal',      storage:'Room Temperature (15–25°C)',  notes:'' },

  // Notice ≤90 days (from 2026-06-30: up to 2026-09-28)
  { id:7,  name:'Amoxicillin 500mg',      generic:'Amoxicillin Trihydrate',    batch:'BT-2024-001', mfr:'PharmaCorp Ltd.',    mfgDate:'2022-01-15', expiry:'2026-08-15', stock:500,  unit:'capsules', cat:'Antibiotic',      storage:'Room Temperature (15–25°C)',  notes:'Keep away from moisture.' },
  { id:8,  name:'Atorvastatin 20mg',      generic:'Atorvastatin Calcium',      batch:'BT-2023-112', mfr:'CardioMed Ltd.',     mfgDate:'2022-11-12', expiry:'2026-09-01', stock:360,  unit:'tablets',  cat:'Cardiovascular',  storage:'Room Temperature (15–25°C)',  notes:'' },

  // Safe (>90 days)
  { id:9,  name:'Paracetamol 500mg',      generic:'Acetaminophen',             batch:'BT-2024-002', mfr:'MediCare Inc.',      mfgDate:'2023-03-10', expiry:'2027-03-10', stock:1200, unit:'tablets',  cat:'Analgesic',       storage:'Room Temperature (15–25°C)',  notes:'' },
  { id:10, name:'Insulin Glargine',        generic:'Insulin Glargine',          batch:'BT-2024-045', mfr:'BioPharm Solutions', mfgDate:'2024-01-05', expiry:'2027-01-15', stock:80,   unit:'vials',    cat:'Diabetes',        storage:'Refrigerated (2–8°C)',        notes:'Store at 2–8°C. Do not freeze.' },
  { id:11, name:'Metformin 850mg',         generic:'Metformin HCl',             batch:'BT-2024-067', mfr:'DiabeCare Pharma',   mfgDate:'2023-09-15', expiry:'2027-09-15', stock:720,  unit:'tablets',  cat:'Diabetes',        storage:'Room Temperature (15–25°C)',  notes:'Take with meals.' },
  { id:12, name:'Omeprazole 20mg',         generic:'Omeprazole',                batch:'BT-2024-031', mfr:'GastroCare Ltd.',    mfgDate:'2023-07-20', expiry:'2027-07-20', stock:840,  unit:'capsules', cat:'Gastrointestinal',storage:'Room Temperature (15–25°C)',  notes:'Store below 25°C.' },
  { id:13, name:'Loratadine 10mg',         generic:'Loratadine',                batch:'BT-2024-078', mfr:'AllerCare Pharma',   mfgDate:'2024-02-14', expiry:'2028-02-14', stock:300,  unit:'tablets',  cat:'Respiratory',     storage:'Room Temperature (15–25°C)',  notes:'' },
  { id:14, name:'Lisinopril 10mg',         generic:'Lisinopril',                batch:'BT-2024-089', mfr:'CardioMed Ltd.',     mfgDate:'2023-10-20', expiry:'2027-10-20', stock:480,  unit:'tablets',  cat:'Cardiovascular',  storage:'Room Temperature (15–25°C)',  notes:'' },
  { id:15, name:'Vitamin D3 1000IU',       generic:'Cholecalciferol',           batch:'BT-2024-012', mfr:'NutraCare Inc.',     mfgDate:'2024-01-10', expiry:'2027-01-10', stock:1500, unit:'tablets',  cat:'Vitamin/Supplement',storage:'Room Temperature (15–25°C)', notes:'' },
];

// ── Helpers ───────────────────────────────────────────
function daysLeft(expiry) {
  const now = new Date(); now.setHours(0,0,0,0);
  return Math.floor((new Date(expiry) - now) / 86_400_000);
}

function status(days) {
  if (days < 0)       return 'expired';
  if (days <= S.warn) return 'expiring';
  return 'safe';
}

function badge(days) {
  const st = status(days);
  const labels = { safe:'✓ Safe', expiring:'⚠ Expiring Soon', expired:'✕ Expired' };
  return `<span class="badge badge-${st}">${labels[st]}</span>`;
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
}

function fmtDays(days) {
  if (days < 0) return `<span class="days-expired">${Math.abs(days)}d overdue</span>`;
  if (days === 0) return `<span class="days-expired">Expires today!</span>`;
  if (days <= S.warn)   return `<span class="days-expiring">${days}d</span>`;
  if (days <= S.notice) return `<span class="days-notice">${days}d</span>`;
  return `<span class="days-safe">${days}d</span>`;
}

function nextId() {
  return Math.max(0, ...S.drugs.map(d => d.id)) + 1;
}

function getStats() {
  let safe=0, expiring=0, expired=0;
  S.drugs.forEach(d => {
    const s = status(daysLeft(d.expiry));
    if (s === 'safe')     safe++;
    else if (s === 'expiring') expiring++;
    else expired++;
  });
  return { total: S.drugs.length, safe, expiring, expired };
}

function empty(msg='No drugs in this category') {
  return `<div class="empty"><div class="empty-ico">💊</div><p>${msg}</p></div>`;
}

// ── Render: Dashboard ─────────────────────────────────
function renderDashboard() {
  const st = getStats();
  setText('kpiTotal',    st.total);
  setText('kpiSafe',     st.safe);
  setText('kpiExpiring', st.expiring);
  setText('kpiExpired',  st.expired);

  const total = st.total || 1;

  // Alerts list
  const alertDrugs = S.drugs
    .map(d => ({ ...d, dl: daysLeft(d.expiry) }))
    .filter(d => d.dl <= S.notice)
    .sort((a,b) => a.dl - b.dl)
    .slice(0, 7);

  const alertsEl = document.getElementById('dashAlerts');
  if (!alertDrugs.length) {
    alertsEl.innerHTML = empty('No alerts — all drugs are safe!');
  } else {
    alertsEl.innerHTML = alertDrugs.map(d => {
      const st2 = status(d.dl);
      const dotCls = st2 === 'expired' ? 'expired' : st2 === 'expiring' ? 'expiring' : 'notice';
      const detail = d.dl < 0 ? `Expired ${Math.abs(d.dl)} days ago`
                   : d.dl === 0 ? 'Expires today!'
                   : `Expires in ${d.dl} days`;
      return `<div class="dash-alert-item">
        <div class="dot ${dotCls}"></div>
        <div style="flex:1;min-width:0">
          <div class="da-name">${d.name}</div>
          <div class="da-detail">${detail} · ${d.batch}</div>
        </div>
        <div class="da-date">${fmtDate(d.expiry)}</div>
      </div>`;
    }).join('');
  }

  // Expiry breakdown bar chart
  document.getElementById('expiryBreakdown').innerHTML = [
    { label:'Safe (>90d)',    count: st.safe,     cls:'safe'     },
    { label:'Expiring (≤30d)',count: st.expiring, cls:'expiring' },
    { label:'Expired',        count: st.expired,  cls:'expired'  },
  ].map(({ label, count, cls }) => `
    <div class="bk-row">
      <div class="bk-label">${label}</div>
      <div class="bk-track">
        <div class="bk-fill ${cls}" style="width:${count ? Math.max(4,(count/total)*100) : 0}%"></div>
      </div>
      <div class="bk-count">${count}</div>
    </div>
  `).join('');

  // Recent 5
  const recent = [...S.drugs].reverse().slice(0, 5);
  document.getElementById('dashTableBody').innerHTML = recent.length
    ? recent.map(d => {
        const dl = daysLeft(d.expiry);
        return `<tr>
          <td><strong>${d.name}</strong></td>
          <td><code class="batch">${d.batch}</code></td>
          <td>${fmtDate(d.expiry)}</td>
          <td>${d.stock} ${d.unit}</td>
          <td>${badge(dl)}</td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="5">${empty('No drugs yet — click Add Drug to start.')}</td></tr>`;
}

// ── Render: Inventory ─────────────────────────────────
function renderInventory() {
  const q = (document.getElementById('invSearch').value || '').toLowerCase();
  const drugs = S.drugs
    .map(d => ({ ...d, dl: daysLeft(d.expiry) }))
    .filter(d => {
      if (S.filter !== 'all' && status(d.dl) !== S.filter) return false;
      if (q) {
        const hay = `${d.name} ${d.generic} ${d.batch} ${d.mfr} ${d.cat}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .sort((a,b) => a.dl - b.dl);

  document.getElementById('invTableBody').innerHTML = drugs.length
    ? drugs.map(d => `
        <tr>
          <td><strong>${d.name}</strong></td>
          <td style="color:var(--txt2)">${d.generic || '—'}</td>
          <td><code class="batch">${d.batch}</code></td>
          <td>${d.mfr}</td>
          <td>${fmtDate(d.expiry)}</td>
          <td>${fmtDays(d.dl)}</td>
          <td>${d.stock} ${d.unit}</td>
          <td><span class="badge badge-cat">${d.cat}</span></td>
          <td style="font-size:12px;color:var(--txt2)">${d.storage}</td>
          <td>${badge(d.dl)}</td>
          <td>
            <div style="display:flex;gap:2px">
              <button class="btn-icon" title="Edit" onclick="openEdit(${d.id})">✎</button>
              <button class="btn-icon" title="Delete" onclick="openDelete(${d.id})">🗑</button>
            </div>
          </td>
        </tr>`).join('')
    : `<tr><td colspan="11">${empty('No matching drugs found.')}</td></tr>`;
}

// ── Render: Alerts ────────────────────────────────────
function renderAlerts() {
  const all = S.drugs.map(d => ({ ...d, dl: daysLeft(d.expiry) }));
  const critical = all.filter(d => d.dl < 0).sort((a,b) => a.dl - b.dl);
  const warning  = all.filter(d => d.dl >= 0 && d.dl <= S.warn).sort((a,b) => a.dl - b.dl);
  const notice   = all.filter(d => d.dl > S.warn && d.dl <= S.notice).sort((a,b) => a.dl - b.dl);

  function card(d, type) {
    const ico = type === 'critical' ? '🔴' : type === 'warning' ? '🟡' : '🔵';
    const detail = d.dl < 0
      ? `Expired ${Math.abs(d.dl)} days ago`
      : d.dl === 0 ? 'Expires today!'
      : `Expires in ${d.dl} days`;
    return `<div class="alert-card">
      <div class="alert-card-ico">${ico}</div>
      <div class="alert-card-info">
        <div class="alert-card-name">${d.name}</div>
        <div class="alert-card-meta">${d.batch} · ${d.mfr} · Stock: ${d.stock} ${d.unit} · ${detail}</div>
      </div>
      <div class="alert-card-badge">${badge(d.dl)}</div>
    </div>`;
  }

  const render = (el, arr, type) => {
    document.getElementById(el).innerHTML = arr.length
      ? arr.map(d => card(d, type)).join('')
      : empty('None in this category');
  };
  render('alertCritical', critical, 'critical');
  render('alertWarning',  warning,  'warning');
  render('alertNotice',   notice,   'notice');
}

// ── Render: Reports ───────────────────────────────────
function renderReports() {
  const st = getStats();
  const total = st.total || 1;

  document.getElementById('reportSummary').innerHTML = [
    { label:'Total Drugs Tracked', val: st.total,    cls:'' },
    { label:'Safe',                val:`${st.safe} (${pct(st.safe,total)}%)`,     cls:'safe' },
    { label:'Expiring Soon',       val:`${st.expiring} (${pct(st.expiring,total)}%)`, cls:'warning' },
    { label:'Expired',             val:`${st.expired} (${pct(st.expired,total)}%)`,   cls:'danger' },
    { label:'Total Stock Units',   val: S.drugs.reduce((s,d) => s+d.stock, 0).toLocaleString(), cls:'' },
    { label:'Report Generated',    val: new Date().toLocaleString('en-GB'), cls:'' },
  ].map(({label,val,cls}) => `
    <div class="report-row">
      <span class="report-row-label">${label}</span>
      <span class="report-row-val ${cls}">${val}</span>
    </div>`).join('');

  const bands = [
    { label:'Expired',     count: st.expired,                                                   cls:'expired' },
    { label:'Critical ≤7d',count: S.drugs.filter(d => { const dl=daysLeft(d.expiry); return dl>=0&&dl<=7; }).length, cls:'expired'},
    { label:'Warning ≤30d',count: S.drugs.filter(d => { const dl=daysLeft(d.expiry); return dl>7&&dl<=30; }).length, cls:'warning'},
    { label:'Notice ≤90d', count: S.drugs.filter(d => { const dl=daysLeft(d.expiry); return dl>30&&dl<=90;}).length, cls:''},
    { label:'Safe >90d',   count: S.drugs.filter(d => daysLeft(d.expiry)>90).length,            cls:'safe'    },
  ];
  barChart('reportDist', bands, total);

  const cats = {};
  S.drugs.forEach(d => { cats[d.cat] = (cats[d.cat]||0) + 1; });
  barChart('reportCat', Object.entries(cats).sort((a,b)=>b[1]-a[1]).map(([l,c])=>({label:l,count:c})), total);

  const stor = {};
  S.drugs.forEach(d => { const k=d.storage.split('(')[0].trim(); stor[k]=(stor[k]||0)+1; });
  barChart('reportStorage', Object.entries(stor).sort((a,b)=>b[1]-a[1]).map(([l,c])=>({label:l,count:c})), total);
}

function barChart(id, rows, total) {
  document.getElementById(id).innerHTML = rows.map(({label,count,cls}) => `
    <div class="chart-row">
      <div class="chart-lbl" title="${label}">${label}</div>
      <div class="chart-track">
        <div class="chart-fill ${cls||''}" style="width:${count?Math.max(3,(count/total)*100):0}%"></div>
      </div>
      <div class="chart-cnt">${count}</div>
    </div>`).join('');
}

function pct(n, total) { return Math.round((n/total)*100); }

// ── Badge counts ──────────────────────────────────────
function updateBadges() {
  const st = getStats();
  document.getElementById('navBadgeInventory').textContent = st.total;
  const alertN = st.expired + st.expiring;
  const ab = document.getElementById('navBadgeAlerts');
  ab.textContent = alertN;
  ab.style.display = alertN > 0 ? '' : 'none';
}

// ── Navigation ────────────────────────────────────────
const VIEW_TITLES = {
  dashboard: 'Dashboard',
  inventory: 'Drug Inventory',
  alerts:    'Alerts',
  reports:   'Safety Reports',
  settings:  'Settings',
};

let currentView = 'dashboard';

function switchView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const el = document.getElementById(`view-${name}`);
  if (el) el.classList.remove('hidden');
  const nav = document.querySelector(`[data-view="${name}"]`);
  if (nav) nav.classList.add('active');
  document.getElementById('pageTitle').textContent = VIEW_TITLES[name] || name;
  currentView = name;
  if (name === 'dashboard') renderDashboard();
  else if (name === 'inventory') renderInventory();
  else if (name === 'alerts') renderAlerts();
  else if (name === 'reports') renderReports();
  updateBadges();
}

// ── Drug CRUD ─────────────────────────────────────────
function openAdd() {
  document.getElementById('modalTitle').textContent = 'Add New Drug';
  document.getElementById('drugForm').reset();
  document.getElementById('fId').value = '';
  showModal('drugModal');
}

function openEdit(id) {
  const d = S.drugs.find(x => x.id === id);
  if (!d) return;
  document.getElementById('modalTitle').textContent = 'Edit Drug';
  document.getElementById('fId').value     = d.id;
  document.getElementById('fName').value   = d.name;
  document.getElementById('fGeneric').value= d.generic || '';
  document.getElementById('fBatch').value  = d.batch;
  document.getElementById('fMfr').value    = d.mfr;
  document.getElementById('fMfgDate').value= d.mfgDate || '';
  document.getElementById('fExpiry').value = d.expiry;
  document.getElementById('fStock').value  = d.stock;
  document.getElementById('fUnit').value   = d.unit;
  document.getElementById('fCat').value    = d.cat;
  document.getElementById('fStorage').value= d.storage;
  document.getElementById('fNotes').value  = d.notes || '';
  showModal('drugModal');
}

function saveDrug() {
  const id   = document.getElementById('fId').value;
  const name = val('fName'); if (!name) { toast('Drug name is required.'); return; }
  const batch= val('fBatch'); if (!batch) { toast('Batch number is required.'); return; }
  const mfr  = val('fMfr');  if (!mfr)   { toast('Manufacturer is required.'); return; }
  const exp  = val('fExpiry'); if (!exp)  { toast('Expiry date is required.'); return; }
  const stock= parseInt(document.getElementById('fStock').value);
  if (isNaN(stock) || stock < 0) { toast('Stock must be a non-negative number.'); return; }

  const drug = {
    id:      id ? parseInt(id) : nextId(),
    name,
    generic: val('fGeneric'),
    batch,
    mfr,
    mfgDate: val('fMfgDate'),
    expiry:  exp,
    stock,
    unit:    val('fUnit'),
    cat:     val('fCat'),
    storage: val('fStorage'),
    notes:   val('fNotes'),
  };

  if (id) {
    const i = S.drugs.findIndex(x => x.id === parseInt(id));
    if (i !== -1) S.drugs[i] = drug;
    toast('Drug updated successfully.');
  } else {
    S.drugs.push(drug);
    toast('Drug added successfully.');
  }

  hideModal('drugModal');
  refresh();
}

function openDelete(id) {
  S.deleteId = id;
  const d = S.drugs.find(x => x.id === id);
  document.getElementById('deleteName').textContent = d ? d.name : 'this drug';
  showModal('deleteModal');
}

function confirmDelete() {
  S.drugs = S.drugs.filter(x => x.id !== S.deleteId);
  S.deleteId = null;
  hideModal('deleteModal');
  toast('Drug deleted.');
  refresh();
}

function refresh() {
  updateBadges();
  if (currentView === 'dashboard') renderDashboard();
  else if (currentView === 'inventory') renderInventory();
  else if (currentView === 'alerts') renderAlerts();
  else if (currentView === 'reports') renderReports();
}

// ── Settings ──────────────────────────────────────────
function saveSettings() {
  S.warn   = parseInt(document.getElementById('setWarning').value) || 30;
  S.notice = parseInt(document.getElementById('setNotice').value) || 90;
  toast('Settings saved.');
  refresh();
}

// ── Modal helpers ─────────────────────────────────────
function showModal(id) { document.getElementById(id).classList.remove('hidden'); }
function hideModal(id) { document.getElementById(id).classList.add('hidden'); }

// ── Toast ─────────────────────────────────────────────
let _toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  document.getElementById('toastMsg').textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.add('hidden'), 3000);
}

// ── Tiny DOM utils ────────────────────────────────────
function val(id) { return document.getElementById(id).value.trim(); }
function setText(id, v) { document.getElementById(id).textContent = v; }

// ── Bootstrap ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  S.drugs = SEED.map(d => ({ ...d }));

  // Nav
  document.querySelectorAll('[data-view]').forEach(el => {
    el.addEventListener('click', e => {
      e.preventDefault();
      switchView(el.dataset.view);
    });
  });

  // Add drug button
  document.getElementById('btnAddDrug').addEventListener('click', openAdd);

  // Drug modal
  document.getElementById('modalClose').addEventListener('click', () => hideModal('drugModal'));
  document.getElementById('btnCancel').addEventListener('click', () => hideModal('drugModal'));
  document.getElementById('btnSave').addEventListener('click', saveDrug);
  document.getElementById('drugModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) hideModal('drugModal');
  });

  // Delete modal
  document.getElementById('deleteClose').addEventListener('click', () => hideModal('deleteModal'));
  document.getElementById('btnDeleteCancel').addEventListener('click', () => hideModal('deleteModal'));
  document.getElementById('btnDeleteConfirm').addEventListener('click', confirmDelete);
  document.getElementById('deleteModal').addEventListener('click', e => {
    if (e.target === e.currentTarget) hideModal('deleteModal');
  });

  // Filter tabs
  document.getElementById('filterTabs').addEventListener('click', e => {
    const tab = e.target.closest('.filter-tab');
    if (!tab) return;
    document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    S.filter = tab.dataset.filter;
    renderInventory();
  });

  // Inventory search
  document.getElementById('invSearch').addEventListener('input', renderInventory);

  // Global search → jump to inventory
  document.getElementById('globalSearch').addEventListener('input', e => {
    const q = e.target.value.trim();
    if (q) {
      switchView('inventory');
      document.getElementById('invSearch').value = q;
      renderInventory();
    }
  });

  // Keyboard: Escape closes modals
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      hideModal('drugModal');
      hideModal('deleteModal');
    }
  });

  // Initial render
  switchView('dashboard');
});
