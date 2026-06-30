/* PharmaCare — Firebase Firestore + Real-time Sync */

// ── State ─────────────────────────────────────────────
const S = {
  drugs:     [],   // populated by Firestore onSnapshot
  filter:    'all',
  warn:      30,
  notice:    90,
  deleteId:  null,
  loaded:    false,
};

// ── Seed data (only written to Firestore on first run) ─
const SEED = [
  { name:'Doxycycline 100mg',     generic:'Doxycycline Hyclate',      batch:'BT-2023-033', mfr:'PharmaCorp Ltd.',    mfgDate:'2021-12-01', expiry:'2026-01-01', stock:60,   unit:'capsules', cat:'Antibiotic',      storage:'Room Temperature (15–25°C)', notes:'Avoid sun.', isEmergency:false, minStock:0 },
  { name:'Azithromycin 250mg',    generic:'Azithromycin Dihydrate',   batch:'BT-2023-055', mfr:'MedTech Corp.',      mfgDate:'2022-04-08', expiry:'2026-03-15', stock:48,   unit:'tablets',  cat:'Antibiotic',      storage:'Room Temperature (15–25°C)', notes:'',           isEmergency:false, minStock:0 },
  { name:'Aspirin 75mg',          generic:'Acetylsalicylic Acid',     batch:'BT-2023-098', mfr:'MediCare Inc.',      mfgDate:'2022-08-30', expiry:'2026-07-10', stock:12,   unit:'tablets',  cat:'Analgesic',       storage:'Room Temperature (15–25°C)', notes:'Keep dry.',  isEmergency:true,  minStock:50 },
  { name:'Fluconazole 150mg',     generic:'Fluconazole',              batch:'BT-2023-077', mfr:'MycoCare Pharma',    mfgDate:'2022-07-05', expiry:'2026-07-25', stock:96,   unit:'capsules', cat:'Antifungal',      storage:'Room Temperature (15–25°C)', notes:'',           isEmergency:false, minStock:0 },
  { name:'Amoxicillin 500mg',     generic:'Amoxicillin Trihydrate',   batch:'BT-2024-001', mfr:'PharmaCorp Ltd.',    mfgDate:'2022-01-15', expiry:'2026-08-15', stock:500,  unit:'capsules', cat:'Antibiotic',      storage:'Room Temperature (15–25°C)', notes:'No moisture.',isEmergency:true,  minStock:100 },
  { name:'Atorvastatin 20mg',     generic:'Atorvastatin Calcium',     batch:'BT-2023-112', mfr:'CardioMed Ltd.',     mfgDate:'2022-11-12', expiry:'2026-09-01', stock:360,  unit:'tablets',  cat:'Cardiovascular',  storage:'Room Temperature (15–25°C)', notes:'',           isEmergency:false, minStock:0 },
  { name:'Paracetamol 500mg',     generic:'Acetaminophen',            batch:'BT-2024-002', mfr:'MediCare Inc.',      mfgDate:'2023-03-10', expiry:'2027-03-10', stock:80,   unit:'tablets',  cat:'Analgesic',       storage:'Room Temperature (15–25°C)', notes:'',           isEmergency:true,  minStock:200 },
  { name:'Insulin Glargine',      generic:'Insulin Glargine',         batch:'BT-2024-045', mfr:'BioPharm Solutions', mfgDate:'2024-01-05', expiry:'2027-01-15', stock:80,   unit:'vials',    cat:'Diabetes',        storage:'Refrigerated (2–8°C)',       notes:'Do not freeze.',isEmergency:true,minStock:20 },
  { name:'Metformin 850mg',       generic:'Metformin HCl',            batch:'BT-2024-067', mfr:'DiabeCare Pharma',   mfgDate:'2023-09-15', expiry:'2027-09-15', stock:720,  unit:'tablets',  cat:'Diabetes',        storage:'Room Temperature (15–25°C)', notes:'Take with meals.',isEmergency:false,minStock:0 },
  { name:'Omeprazole 20mg',       generic:'Omeprazole',               batch:'BT-2024-031', mfr:'GastroCare Ltd.',    mfgDate:'2023-07-20', expiry:'2027-07-20', stock:840,  unit:'capsules', cat:'Gastrointestinal',storage:'Room Temperature (15–25°C)', notes:'Below 25°C.', isEmergency:false, minStock:0 },
  { name:'Loratadine 10mg',       generic:'Loratadine',               batch:'BT-2024-078', mfr:'AllerCare Pharma',   mfgDate:'2024-02-14', expiry:'2028-02-14', stock:300,  unit:'tablets',  cat:'Respiratory',     storage:'Room Temperature (15–25°C)', notes:'',           isEmergency:false, minStock:0 },
  { name:'Epinephrine 1mg/ml',    generic:'Adrenaline',               batch:'EPI-2024-001',mfr:'EmergPharm Ltd.',    mfgDate:'2024-03-01', expiry:'2027-03-01', stock:8,    unit:'ampoules', cat:'Other',           storage:'Protected from Light',       notes:'Single use.', isEmergency:true,  minStock:10 },
  { name:'Diazepam 10mg/2ml',     generic:'Diazepam',                 batch:'DZP-2024-001',mfr:'NeuroCare Inc.',     mfgDate:'2024-01-15', expiry:'2027-01-15', stock:24,   unit:'ampoules', cat:'Neurological',    storage:'Protected from Light',       notes:'Controlled.',  isEmergency:true,  minStock:12 },
  { name:'Vitamin D3 1000IU',     generic:'Cholecalciferol',          batch:'BT-2024-012', mfr:'NutraCare Inc.',     mfgDate:'2024-01-10', expiry:'2027-01-10', stock:1500, unit:'tablets',  cat:'Vitamin/Supplement',storage:'Room Temperature (15–25°C)',notes:'',           isEmergency:false, minStock:0 },
  { name:'Normal Saline 0.9%',    generic:'Sodium Chloride',          batch:'NS-2024-055', mfr:'IV Solutions Ltd.',  mfgDate:'2024-04-01', expiry:'2026-10-01', stock:3,    unit:'bottles',  cat:'Other',           storage:'Room Temperature (15–25°C)', notes:'For IV use.', isEmergency:true,  minStock:20 },
];

// ── Helpers ───────────────────────────────────────────
function daysLeft(expiry) {
  const now = new Date(); now.setHours(0,0,0,0);
  return Math.floor((new Date(expiry) - now) / 86_400_000);
}
function expiryStatus(days) {
  if (days < 0)        return 'expired';
  if (days <= S.warn)  return 'expiring';
  return 'safe';
}
function isLowStock(d) {
  return d.isEmergency && d.minStock > 0 && d.stock < d.minStock;
}
function badge(days) {
  const st = expiryStatus(days);
  const labels = { safe:'✓ Safe', expiring:'⚠ Expiring', expired:'✕ Expired' };
  return `<span class="badge badge-${st}">${labels[st]}</span>`;
}
function stockBadge(d) {
  if (!d.isEmergency) return '—';
  if (isLowStock(d)) return `<span class="badge badge-lowstock">⚠ Low Stock</span>`;
  return `<span class="badge badge-safe">✓ OK</span>`;
}
function erBadge(d) {
  return d.isEmergency ? '<span class="badge badge-er">🚨 ER</span>' : '';
}
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
}
function fmtDays(days) {
  if (days < 0)          return `<span class="days-expired">${Math.abs(days)}d overdue</span>`;
  if (days === 0)        return `<span class="days-expired">Today!</span>`;
  if (days <= S.warn)    return `<span class="days-expiring">${days}d</span>`;
  if (days <= S.notice)  return `<span class="days-notice">${days}d</span>`;
  return `<span class="days-safe">${days}d</span>`;
}
function getStats() {
  let safe=0, expiring=0, expired=0, emergency=0, erIssue=0;
  S.drugs.forEach(d => {
    const dl = daysLeft(d.expiry);
    const st = expiryStatus(dl);
    if (st === 'safe')     safe++;
    else if (st === 'expiring') expiring++;
    else expired++;
    if (d.isEmergency) {
      emergency++;
      if (st !== 'safe' || isLowStock(d)) erIssue++;
    }
  });
  return { total: S.drugs.length, safe, expiring, expired, emergency, erIssue };
}
function empty(msg='No drugs') {
  return `<div class="empty"><div class="empty-ico">💊</div><p>${msg}</p></div>`;
}
function pct(n, t) { return Math.round((n/(t||1))*100); }

// ── Firebase real-time listener ───────────────────────
function initFirestore() {
  setSyncStatus('connecting');
  drugsRef
    .orderBy('createdAt', 'asc')
    .onSnapshot(snapshot => {
      S.drugs = snapshot.docs.map(doc => ({ _id: doc.id, ...doc.data() }));

      if (!S.loaded && S.drugs.length === 0) seedFirestore();
      S.loaded = true;

      document.getElementById('loadingOverlay').classList.add('hidden');
      setSyncStatus('online');
      refresh();
      updateBadges();
    }, err => {
      console.error('Firestore:', err);
      setSyncStatus('error');
      document.getElementById('loadingOverlay').classList.add('hidden');
      toast('⚠️ Firebase error: ' + err.message);
    });
}

async function seedFirestore() {
  try {
    const batch = db.batch();
    SEED.forEach(drug => {
      const ref = drugsRef.doc();
      batch.set(ref, { ...drug, createdAt: firebase.firestore.FieldValue.serverTimestamp() });
    });
    await batch.commit();
  } catch(e) { console.error('Seed error:', e); }
}

function setSyncStatus(state) {
  const dot   = document.getElementById('syncDot');
  const label = document.getElementById('syncLabel');
  dot.className = 'sync-dot ' + state;
  label.textContent = state === 'online' ? 'Synced ✓' : state === 'error' ? 'Error ✗' : 'Connecting…';
}

// ── Render: Dashboard ─────────────────────────────────
function renderDashboard() {
  const st = getStats();
  setText('kpiTotal',     st.total);
  setText('kpiEmergency', st.emergency);
  setText('kpiExpiring',  st.expiring);
  setText('kpiExpired',   st.expired);

  // Emergency Box summary on dashboard
  const erDrugs = S.drugs.filter(d => d.isEmergency)
    .map(d => ({ ...d, dl: daysLeft(d.expiry) }))
    .sort((a,b) => a.dl - b.dl);

  const erEl = document.getElementById('dashEmergency');
  if (!erDrugs.length) {
    erEl.innerHTML = empty('No emergency drugs added yet.');
  } else {
    erEl.innerHTML = erDrugs.map(d => {
      const st2 = expiryStatus(d.dl);
      const low  = isLowStock(d);
      const dotCls = st2 === 'expired' ? 'expired' : low ? 'expiring' : st2 === 'expiring' ? 'expiring' : 'notice';
      const issue = st2 !== 'safe' ? `Expiry: ${fmtDate(d.expiry)}` : low ? `Stock: ${d.stock}/${d.minStock}` : `OK — ${d.dl}d left`;
      return `<div class="dash-alert-item">
        <div class="dot ${dotCls}"></div>
        <div style="flex:1;min-width:0">
          <div class="da-name">🚨 ${d.name}</div>
          <div class="da-detail">${issue}</div>
        </div>
        <div style="flex-shrink:0">${badge(d.dl)}</div>
      </div>`;
    }).join('');
  }

  // General alerts
  const alertDrugs = S.drugs
    .map(d => ({ ...d, dl: daysLeft(d.expiry) }))
    .filter(d => d.dl <= S.notice)
    .sort((a,b) => a.dl - b.dl).slice(0, 6);

  const alertsEl = document.getElementById('dashAlerts');
  alertsEl.innerHTML = alertDrugs.length
    ? alertDrugs.map(d => {
        const dotCls = d.dl < 0 ? 'expired' : d.dl <= S.warn ? 'expiring' : 'notice';
        const detail = d.dl < 0 ? `Expired ${Math.abs(d.dl)}d ago` : d.dl === 0 ? 'Expires today!' : `${d.dl}d left`;
        return `<div class="dash-alert-item">
          <div class="dot ${dotCls}"></div>
          <div style="flex:1;min-width:0"><div class="da-name">${d.name}</div><div class="da-detail">${detail}</div></div>
          <div class="da-date">${fmtDate(d.expiry)}</div>
        </div>`;
      }).join('')
    : empty('All drugs safe!');

  // Recent 5
  const recent = [...S.drugs].reverse().slice(0,5);
  document.getElementById('dashTableBody').innerHTML = recent.length
    ? recent.map(d => {
        const dl = daysLeft(d.expiry);
        return `<tr${d.isEmergency ? ' class="er-row"' : ''}>
          <td><strong>${d.name}</strong></td>
          <td><code class="batch">${d.batch}</code></td>
          <td>${fmtDate(d.expiry)}</td>
          <td>${d.stock} ${d.unit}</td>
          <td>${erBadge(d)}</td>
          <td>${badge(dl)}</td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="6">${empty('No drugs yet.')}</td></tr>`;
}

// ── Render: Emergency Box ─────────────────────────────
function renderEmergency() {
  const erDrugs = S.drugs
    .filter(d => d.isEmergency)
    .map(d => ({ ...d, dl: daysLeft(d.expiry) }))
    .sort((a,b) => a.dl - b.dl);

  const safe     = erDrugs.filter(d => expiryStatus(d.dl) === 'safe' && !isLowStock(d)).length;
  const expired  = erDrugs.filter(d => expiryStatus(d.dl) === 'expired').length;
  const lowStock = erDrugs.filter(d => isLowStock(d)).length;

  setText('erTotal',    erDrugs.length);
  setText('erSafe',     safe);
  setText('erExpired',  expired);
  setText('erLowStock', lowStock);

  document.getElementById('erTableBody').innerHTML = erDrugs.length
    ? erDrugs.map(d => {
        const low = isLowStock(d);
        const rowCls = expiryStatus(d.dl) === 'expired' ? 'er-row' : low ? 'er-row' : '';
        return `<tr class="${rowCls}">
          <td><strong>🚨 ${d.name}</strong></td>
          <td><code class="batch">${d.batch}</code></td>
          <td>${fmtDate(d.expiry)}</td>
          <td>${fmtDays(d.dl)}</td>
          <td>${d.stock} ${d.unit}</td>
          <td style="font-weight:600">${d.minStock > 0 ? d.minStock + ' ' + d.unit : '—'}</td>
          <td>${stockBadge(d)}</td>
          <td>${badge(d.dl)}</td>
          <td><div style="display:flex;gap:2px">
            <button class="btn-icon" title="Edit" onclick="openEdit('${d._id}')">✎</button>
            <button class="btn-icon" title="Delete" onclick="openDelete('${d._id}')">🗑</button>
          </div></td>
        </tr>`;
      }).join('')
    : `<tr><td colspan="9">${empty('No emergency drugs. Click "+ Add ER Drug" to add.')}</td></tr>`;
}

// ── Render: Inventory ─────────────────────────────────
function renderInventory() {
  const q = (document.getElementById('invSearch').value || '').toLowerCase();
  const drugs = S.drugs
    .map(d => ({ ...d, dl: daysLeft(d.expiry) }))
    .filter(d => {
      if (S.filter !== 'all' && expiryStatus(d.dl) !== S.filter) return false;
      if (q) {
        const hay = `${d.name} ${d.generic||''} ${d.batch} ${d.mfr} ${d.cat}`.toLowerCase();
        return hay.includes(q);
      }
      return true;
    })
    .sort((a,b) => a.dl - b.dl);

  document.getElementById('invTableBody').innerHTML = drugs.length
    ? drugs.map(d => `
        <tr${d.isEmergency ? ' class="er-row"' : ''}>
          <td><strong>${d.name}</strong></td>
          <td style="color:var(--txt2)">${d.generic||'—'}</td>
          <td><code class="batch">${d.batch}</code></td>
          <td>${d.mfr}</td>
          <td>${fmtDate(d.expiry)}</td>
          <td>${fmtDays(d.dl)}</td>
          <td>${d.stock} ${d.unit}</td>
          <td><span class="badge badge-cat">${d.cat}</span></td>
          <td>${erBadge(d)}</td>
          <td>${badge(d.dl)}</td>
          <td><div style="display:flex;gap:2px">
            <button class="btn-icon" onclick="openEdit('${d._id}')">✎</button>
            <button class="btn-icon" onclick="openDelete('${d._id}')">🗑</button>
          </div></td>
        </tr>`).join('')
    : `<tr><td colspan="11">${empty('No matching drugs.')}</td></tr>`;
}

// ── Render: Alerts ────────────────────────────────────
function renderAlerts() {
  const all = S.drugs.map(d => ({ ...d, dl: daysLeft(d.expiry) }));
  const critical = all.filter(d => d.dl < 0).sort((a,b) => a.dl - b.dl);
  const warning  = all.filter(d => d.dl >= 0 && d.dl <= S.warn).sort((a,b) => a.dl - b.dl);
  const notice   = all.filter(d => d.dl > S.warn && d.dl <= S.notice).sort((a,b) => a.dl - b.dl);

  function cards(arr, type) {
    if (!arr.length) return empty('None in this category');
    const ico = { critical:'🔴', warning:'🟡', notice:'🔵' }[type];
    return arr.map(d => {
      const detail = d.dl < 0 ? `Expired ${Math.abs(d.dl)}d ago` : d.dl === 0 ? 'Expires today!' : `Expires in ${d.dl}d`;
      const erTag  = d.isEmergency ? ' 🚨 ER' : '';
      return `<div class="alert-card">
        <div class="alert-card-ico">${ico}</div>
        <div class="alert-card-info">
          <div class="alert-card-name">${d.name}${erTag}</div>
          <div class="alert-card-meta">${d.batch} · ${d.mfr} · ${d.stock} ${d.unit} · ${detail}</div>
        </div>
        <div>${badge(d.dl)}</div>
      </div>`;
    }).join('');
  }
  document.getElementById('alertCritical').innerHTML = cards(critical, 'critical');
  document.getElementById('alertWarning').innerHTML  = cards(warning,  'warning');
  document.getElementById('alertNotice').innerHTML   = cards(notice,   'notice');
}

// ── Render: Reports ───────────────────────────────────
function renderReports() {
  const st    = getStats();
  const total = st.total || 1;

  document.getElementById('reportSummary').innerHTML = [
    { label:'Total Drugs',       val: st.total,                                    cls:'' },
    { label:'Emergency Drugs',   val: st.emergency,                                cls:'' },
    { label:'Safe',              val:`${st.safe} (${pct(st.safe,total)}%)`,        cls:'safe' },
    { label:'Expiring Soon',     val:`${st.expiring} (${pct(st.expiring,total)}%)`,cls:'warning' },
    { label:'Expired',           val:`${st.expired} (${pct(st.expired,total)}%)`,  cls:'danger' },
    { label:'Report Generated',  val: new Date().toLocaleString('th-TH'),          cls:'' },
  ].map(({label,val,cls}) => `<div class="report-row"><span class="report-row-label">${label}</span><span class="report-row-val ${cls}">${val}</span></div>`).join('');

  const bands = [
    { label:'Expired',     count: st.expired,  cls:'expired' },
    { label:'Critical ≤7d',count: S.drugs.filter(d=>{const dl=daysLeft(d.expiry);return dl>=0&&dl<=7;}).length, cls:'expired'},
    { label:'Warning ≤30d',count: S.drugs.filter(d=>{const dl=daysLeft(d.expiry);return dl>7&&dl<=30;}).length,  cls:'warning'},
    { label:'Notice ≤90d', count: S.drugs.filter(d=>{const dl=daysLeft(d.expiry);return dl>30&&dl<=90;}).length, cls:''},
    { label:'Safe >90d',   count: S.drugs.filter(d=>daysLeft(d.expiry)>90).length, cls:'safe'},
  ];
  barChart('reportDist', bands, total);

  const cats = {};
  S.drugs.forEach(d => { cats[d.cat] = (cats[d.cat]||0)+1; });
  barChart('reportCat', Object.entries(cats).sort((a,b)=>b[1]-a[1]).map(([l,c])=>({label:l,count:c})), total);

  const stor = {};
  S.drugs.forEach(d => { const k=d.storage.split('(')[0].trim(); stor[k]=(stor[k]||0)+1; });
  barChart('reportStorage', Object.entries(stor).sort((a,b)=>b[1]-a[1]).map(([l,c])=>({label:l,count:c})), total);
}

function barChart(id, rows, total) {
  document.getElementById(id).innerHTML = rows.map(({label,count,cls}) => `
    <div class="chart-row">
      <div class="chart-lbl" title="${label}">${label}</div>
      <div class="chart-track"><div class="chart-fill ${cls||''}" style="width:${count?Math.max(3,(count/total)*100):0}%"></div></div>
      <div class="chart-cnt">${count}</div>
    </div>`).join('');
}

// ── Badge counts ──────────────────────────────────────
function updateBadges() {
  const st = getStats();
  document.getElementById('navBadgeInventory').textContent = st.total;

  const alertN = st.expired + st.expiring;
  const ab = document.getElementById('navBadgeAlerts');
  ab.textContent = alertN;
  ab.style.display = alertN > 0 ? '' : 'none';

  const erAb = document.getElementById('navBadgeER');
  erAb.textContent = st.erIssue;
  erAb.style.display = st.erIssue > 0 ? '' : 'none';
}

// ── Navigation ────────────────────────────────────────
let currentView = 'dashboard';
const TITLES = { dashboard:'Dashboard', emergency:'Emergency Box', inventory:'Drug Inventory', alerts:'Alerts', reports:'Safety Reports', settings:'Settings' };

function switchView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const el  = document.getElementById(`view-${name}`);
  const nav = document.querySelector(`[data-view="${name}"]`);
  if (el)  el.classList.remove('hidden');
  if (nav) nav.classList.add('active');
  document.getElementById('pageTitle').textContent = TITLES[name] || name;
  currentView = name;
  if (name === 'dashboard') renderDashboard();
  else if (name === 'emergency') renderEmergency();
  else if (name === 'inventory') renderInventory();
  else if (name === 'alerts') renderAlerts();
  else if (name === 'reports') renderReports();
  updateBadges();
}

function refresh() {
  if (currentView === 'dashboard')  renderDashboard();
  else if (currentView === 'emergency') renderEmergency();
  else if (currentView === 'inventory') renderInventory();
  else if (currentView === 'alerts')    renderAlerts();
  else if (currentView === 'reports')   renderReports();
}

// ── Drug CRUD (Firestore) ─────────────────────────────
function openAdd() {
  document.getElementById('modalTitle').textContent = 'Add New Drug';
  document.getElementById('drugForm').reset();
  document.getElementById('fId').value = '';
  document.getElementById('erMinStockWrap').style.display = 'none';
  showModal('drugModal');
}
function openAddEmergency() {
  openAdd();
  document.getElementById('fIsEmergency').checked = true;
  document.getElementById('erMinStockWrap').style.display = 'block';
}

function openEdit(id) {
  const d = S.drugs.find(x => x._id === id);
  if (!d) return;
  document.getElementById('modalTitle').textContent = 'Edit Drug';
  document.getElementById('fId').value        = d._id;
  document.getElementById('fName').value      = d.name;
  document.getElementById('fGeneric').value   = d.generic || '';
  document.getElementById('fBatch').value     = d.batch;
  document.getElementById('fMfr').value       = d.mfr;
  document.getElementById('fMfgDate').value   = d.mfgDate || '';
  document.getElementById('fExpiry').value    = d.expiry;
  document.getElementById('fStock').value     = d.stock;
  document.getElementById('fUnit').value      = d.unit;
  document.getElementById('fCat').value       = d.cat;
  document.getElementById('fStorage').value   = d.storage;
  document.getElementById('fIsEmergency').checked = !!d.isEmergency;
  document.getElementById('fMinStock').value  = d.minStock || 0;
  document.getElementById('erMinStockWrap').style.display = d.isEmergency ? 'block' : 'none';
  document.getElementById('fNotes').value     = d.notes || '';
  showModal('drugModal');
}

async function saveDrug() {
  const id     = document.getElementById('fId').value;
  const name   = val('fName');   if (!name)   { toast('Drug name is required.');   return; }
  const batch  = val('fBatch');  if (!batch)  { toast('Batch number is required.'); return; }
  const mfr    = val('fMfr');    if (!mfr)    { toast('Manufacturer is required.'); return; }
  const expiry = val('fExpiry'); if (!expiry) { toast('Expiry date is required.'); return; }
  const stock  = parseInt(document.getElementById('fStock').value);
  if (isNaN(stock) || stock < 0) { toast('Stock must be a valid number.'); return; }

  const isEmergency = document.getElementById('fIsEmergency').checked;
  const minStock    = isEmergency ? parseInt(document.getElementById('fMinStock').value) || 0 : 0;

  const data = {
    name, generic: val('fGeneric'), batch, mfr,
    mfgDate: val('fMfgDate'), expiry, stock,
    unit: val('fUnit'), cat: val('fCat'), storage: val('fStorage'),
    notes: val('fNotes'), isEmergency, minStock,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  };

  try {
    document.getElementById('btnSave').disabled = true;
    if (id) {
      await drugsRef.doc(id).update(data);
      toast('Drug updated ✓');
    } else {
      data.createdAt = firebase.firestore.FieldValue.serverTimestamp();
      await drugsRef.add(data);
      toast('Drug added ✓');
    }
    hideModal('drugModal');
  } catch(e) {
    toast('Error: ' + e.message);
  } finally {
    document.getElementById('btnSave').disabled = false;
  }
}

function openDelete(id) {
  S.deleteId = id;
  const d = S.drugs.find(x => x._id === id);
  document.getElementById('deleteName').textContent = d ? d.name : 'this drug';
  showModal('deleteModal');
}

async function confirmDelete() {
  if (!S.deleteId) return;
  try {
    await drugsRef.doc(S.deleteId).delete();
    hideModal('deleteModal');
    toast('Drug deleted.');
  } catch(e) { toast('Error: ' + e.message); }
  S.deleteId = null;
}

// ── Settings ──────────────────────────────────────────
function saveSettings() {
  S.warn   = parseInt(document.getElementById('setWarning').value) || 30;
  S.notice = parseInt(document.getElementById('setNotice').value) || 90;
  toast('Settings saved.');
  refresh();
  updateBadges();
}

// ── Modal ─────────────────────────────────────────────
function showModal(id) { document.getElementById(id).classList.remove('hidden'); }
function hideModal(id) { document.getElementById(id).classList.add('hidden'); }

// ── Toast ─────────────────────────────────────────────
let _tt;
function toast(msg) {
  const el = document.getElementById('toast');
  document.getElementById('toastMsg').textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(_tt);
  _tt = setTimeout(() => el.classList.add('hidden'), 3000);
}

// ── Utils ─────────────────────────────────────────────
function val(id) { return document.getElementById(id).value.trim(); }
function setText(id, v) { document.getElementById(id).textContent = v; }

// ── Bootstrap ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  // Check URL params (PWA shortcuts)
  const params = new URLSearchParams(window.location.search);
  const startView = params.get('view') || 'dashboard';

  // Nav clicks
  document.querySelectorAll('[data-view]').forEach(el => {
    el.addEventListener('click', e => { e.preventDefault(); switchView(el.dataset.view); });
  });

  // Add drug
  document.getElementById('btnAddDrug').addEventListener('click', openAdd);

  // Emergency checkbox toggle
  document.getElementById('fIsEmergency').addEventListener('change', e => {
    document.getElementById('erMinStockWrap').style.display = e.target.checked ? 'block' : 'none';
  });

  // Drug modal
  document.getElementById('modalClose').addEventListener('click', () => hideModal('drugModal'));
  document.getElementById('btnCancel').addEventListener('click',  () => hideModal('drugModal'));
  document.getElementById('btnSave').addEventListener('click', saveDrug);
  document.getElementById('drugModal').addEventListener('click', e => { if (e.target === e.currentTarget) hideModal('drugModal'); });

  // Delete modal
  document.getElementById('deleteClose').addEventListener('click',      () => hideModal('deleteModal'));
  document.getElementById('btnDeleteCancel').addEventListener('click',  () => hideModal('deleteModal'));
  document.getElementById('btnDeleteConfirm').addEventListener('click', confirmDelete);
  document.getElementById('deleteModal').addEventListener('click', e => { if (e.target === e.currentTarget) hideModal('deleteModal'); });

  // Filter tabs
  document.getElementById('filterTabs').addEventListener('click', e => {
    const tab = e.target.closest('.filter-tab');
    if (!tab) return;
    document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    S.filter = tab.dataset.filter;
    renderInventory();
  });

  // Search
  document.getElementById('invSearch').addEventListener('input', renderInventory);
  document.getElementById('globalSearch').addEventListener('input', e => {
    const q = e.target.value.trim();
    if (q) { switchView('inventory'); document.getElementById('invSearch').value = q; renderInventory(); }
  });

  // Escape closes modals
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { hideModal('drugModal'); hideModal('deleteModal'); }
  });

  // Start Firestore listener then render initial view
  initFirestore();
  switchView(startView);
});
