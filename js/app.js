/* Krong Pinang Drug Safety System — Vanilla JS */

// ── STATE ─────────────────────────────────────────────
const S = {
  screen: 'lock', loginStep: 'profiles', pendingUser: null,
  pin: '', pinErr: false, faceStage: 'scanning', faceCam: false,
  user: null, tab: 'scan',
  items: [],
  firestoreLoaded: false,
  scanState: 'idle',    // idle | detecting | lockon | decoding | detected
  scanResult: null, scanDest: 'SUBSTOCK',
  scanFormat: 'GS1 DataMatrix',
  scanFormats: ['GS1 DataMatrix','GS1-128','QR Code','EAN-13','Code 128'],
  aiConf: 0,
  cameraActive: false,
  cameraStream: null,
  barcodeDetector: null,
  rapidMode: false, scanCount: 0,
  manualOpen: false,
  voiceActive: false,
  autoCapture: false,
  drugCache: JSON.parse(localStorage.getItem('_drugCache') || '{}'),
  stockFilter: 'all', stockSort: 'exp', stockSearch: '',
  theme: localStorage.getItem('theme') || 'dark',
  settings: { threshRed: 30, threshOrange: 60, threshYellow: 90, soundOn: true, geminiKey: '' },
  users: [
    { id: 'u1', name: 'ภก.อนัส มะยีแต', en: 'เภสัชกร', role: 'Admin', color: '#009E9E', pin: '0000' },
  ],
  auditLog: [],
  offlineMode: !navigator.onLine,
  lastActivity: Date.now(),
  autoLockMins: 5,
  scanHistory: [],
  sheet: null, sheetData: null,
  confirmAction: null,
  focusManual: null,
  cmdPaletteOpen: false,
  voiceFeedback: true,
  recalls: [],          // Active lot recalls from Firestore
  lastScanNames: [],    // Track last 2 scanned drug names for LASA detection
  batchSession: null,   // { startTime, items[] } for rapid scan session summary
  dept: localStorage.getItem('dept') || 'OPD',
  stockDept: 'all',
};

// ── SEED DATA ─────────────────────────────────────────
// ข้อมูลจริงมาจาก Firestore เท่านั้น — ไม่มีข้อมูลทดลองหรือข้อมูลที่สร้างขึ้นเอง

// ── GEMINI VISION ─────────────────────────────────────
// Prompt is short because responseSchema enforces JSON structure
const DRUG_LABEL_PROMPT = [
  'อ่านฉลากยาไทย กรอกข้อมูลที่มองเห็นในภาพ null=ไม่มีข้อมูล ห้ามเดา',
  '',
  'วันที่ (อ่านทุกรูปแบบ):',
  '• DD MM YY เว้นวรรค (บ่อยที่สุด): "06 02 25"=2025-02-06 | "12 08 26"=2026-08-12',
  '• DD/MM/YY หรือ DD-MM-YY: "06/02/25"=2025-02-06',
  '• MM/YYYY: "02/2025"=2025-02-01 | MMM YYYY: "FEB 2025"=2025-02-01',
  '• พ.ศ. ลบ 543: 2568=2025, 2569=2026, 2570=2027',
  '• เห็น 2 วันไม่มีป้าย: วันเก่ากว่า=mfd, วันใหม่กว่า=expiry',
  '',
  'Lot: คำ Lot/LOT/L/N/Batch/BN | ตัวอย่าง T680094|ST68-6470|240501A|Osra5.5_sac_LAO_22R01',
  'GTIN: ตัวเลข 13 หลักใต้เส้นบาร์โค้ด',
  'ชื่อยา: trade name ที่พิมพ์ใหญ่ที่สุด หรือ generic name',
].join('\n');

// Gemini responseSchema — enforces JSON without prompt overhead
const GEMINI_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name:    { type: 'STRING', nullable: true },
    generic: { type: 'STRING', nullable: true },
    strength:{ type: 'STRING', nullable: true },
    lot:     { type: 'STRING', nullable: true },
    expiry:  { type: 'STRING', nullable: true },
    mfd:     { type: 'STRING', nullable: true },
    form:    { type: 'STRING', nullable: true },
    gtin:    { type: 'STRING', nullable: true },
  },
};

// Compress image before sending — accepts File/Blob or canvas element
function compressForAI(src, maxPx = 1400, quality = 0.84) {
  // Direct canvas path (from in-app camera — skip Image() loading)
  if (src instanceof HTMLCanvasElement) {
    const scale = Math.min(1, maxPx / Math.max(src.width, src.height));
    if (scale < 1) {
      const c2 = document.createElement('canvas');
      c2.width = Math.round(src.width * scale);
      c2.height = Math.round(src.height * scale);
      c2.getContext('2d').drawImage(src, 0, 0, c2.width, c2.height);
      return Promise.resolve(c2.toDataURL('image/jpeg', quality).split(',')[1]);
    }
    return Promise.resolve(src.toDataURL('image/jpeg', quality).split(',')[1]);
  }
  // File/Blob path
  return new Promise(resolve => {
    const url = URL.createObjectURL(src);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * scale);
      c.height = Math.round(img.height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/jpeg', quality).split(',')[1]);
    };
    img.onerror = () => {
      const r = new FileReader();
      r.onload = () => resolve(r.result.split(',')[1]);
      r.onerror = () => resolve(null);
      r.readAsDataURL(src);
    };
    img.src = url;
  });
}

// Merge AI result with local drug cache (by GTIN) for instant name lookup
function _mergeDrugCache(data) {
  if (!data) return data;
  const gtin = data.gtin;
  if (gtin && S.drugCache[gtin]) {
    const cached = S.drugCache[gtin];
    return {
      name:     data.name    || cached.name    || null,
      generic:  data.generic || cached.generic || null,
      strength: data.strength|| cached.strength|| null,
      lot:      data.lot, expiry: data.expiry, mfd: data.mfd,
      form:     data.form    || cached.form    || null,
      gtin,
    };
  }
  return data;
}

function _saveDrugCache(data) {
  if (!data?.gtin || !data?.name) return;
  const entry = {
    name: data.name || '',
    generic: data.generic || '',
    strength: data.strength || '',
    form: data.form || '',
  };
  S.drugCache[data.gtin] = entry;
  // 1. Update localStorage immediately (instant read on same device)
  try { localStorage.setItem('_drugCache', JSON.stringify(S.drugCache)); } catch(_) {}
  // 2. Persist to Firestore so ALL devices/users share the cache (fire-and-forget)
  if (typeof drugCacheRef !== 'undefined') {
    drugCacheRef.doc(data.gtin).set({
      ...entry,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      updatedBy: S.user?.name || 'system',
    }).catch(e => console.warn('Drug cache Firestore write:', e));
  }
}

// Real-time sync: Firestore drugCache → S.drugCache + localStorage
// Called once on app init. Keeps all devices in sync automatically.
function initDrugCache() {
  if (typeof drugCacheRef === 'undefined') return;
  drugCacheRef.onSnapshot(snapshot => {
    let changed = false;
    snapshot.docChanges().forEach(change => {
      const gtin = change.doc.id;
      if (change.type === 'added' || change.type === 'modified') {
        const d = change.doc.data();
        S.drugCache[gtin] = { name: d.name || '', generic: d.generic || '', strength: d.strength || '', form: d.form || '' };
        changed = true;
      } else if (change.type === 'removed') {
        delete S.drugCache[gtin];
        changed = true;
      }
    });
    if (changed) {
      try { localStorage.setItem('_drugCache', JSON.stringify(S.drugCache)); } catch(_) {}
    }
  }, err => {
    // Silently fall back to localStorage — S.drugCache already loaded from it at startup
    console.warn('Drug cache sync:', err.code || err.message);
  });
}

async function analyzeWithGemini(src) {
  const key = S.settings.geminiKey || localStorage.getItem('geminiKey') || '';
  if (!key) return null;
  // src can be: HTMLCanvasElement, File/Blob, or already-compressed base64 string (from camera path)
  const b64 = (typeof src === 'string') ? src : await compressForAI(src);
  if (!b64) return null;
  return _callGeminiAPI(b64, key, 0);
}

async function _callGeminiAPI(b64, key, attempt) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        signal: ctrl.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [
            { text: DRUG_LABEL_PROMPT },
            { inline_data: { mime_type: 'image/jpeg', data: b64 } },
          ]}],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 256,
            responseMimeType: 'application/json',
            responseSchema: GEMINI_SCHEMA,
          },
        }),
      }
    );
    clearTimeout(timer);
    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const msg = errBody.error?.message || `HTTP ${res.status}`;
      // Retry once on 5xx server errors
      if (res.status >= 500 && attempt < 1) {
        await new Promise(r => setTimeout(r, 900));
        return _callGeminiAPI(b64, key, attempt + 1);
      }
      throw new Error(msg);
    }
    const resp = await res.json();
    const raw = (resp.candidates?.[0]?.content?.parts?.[0]?.text || '{}').trim();
    const data = JSON.parse(raw);
    _saveDrugCache(data);
    return _mergeDrugCache(data);
  } catch(e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') {
      // Retry once on timeout
      if (attempt < 1) {
        await new Promise(r => setTimeout(r, 800));
        return _callGeminiAPI(b64, key, attempt + 1);
      }
      throw new Error('Gemini หมดเวลา — กรุณาลองอีกครั้ง (เครือข่ายช้า)');
    }
    throw e;
  }
}

// ── HELPERS ───────────────────────────────────────────
const _todayDayNum = () => Math.floor(Date.now() / 86400000); // changes at UTC midnight
function daysLeft(exp) {
  if (!exp) return 9999;
  const expMs = (exp instanceof Date) ? exp.getTime() : new Date(exp).getTime();
  return Math.ceil((expMs - Date.now()) / 86400000);
}

// Memoized itemStatus — cache key encodes exp+thresholds+today so results
// stay valid all day and auto-invalidate at midnight or threshold change.
const _statusCache = new Map();
function itemStatus(it) {
  const expMs = it.exp instanceof Date ? it.exp.getTime() : new Date(it.exp || 0).getTime();
  const { threshRed: r, threshOrange: o, threshYellow: y } = S.settings;
  const cacheKey = `${expMs}-${_todayDayNum()}-${r}-${o}-${y}`;
  if (_statusCache.has(cacheKey)) return _statusCache.get(cacheKey);
  const d = Math.ceil((expMs - Date.now()) / 86400000);
  let result;
  if (d <= r) result = { key: 'RED', c: '#ff4d5e', label: d < 0 ? `หมดอายุ ${-d} วัน` : `เหลือ ${d} วัน`, shape: 'oct' };
  else if (d <= o) result = { key: 'ORANGE', c: '#ff9f43', label: `คืนบริษัทได้ · ${d} วัน`, shape: 'tri' };
  else if (d <= y) result = { key: 'YELLOW', c: '#ffd23f', label: `เหลือ ${d} วัน`, shape: 'dia' };
  else result = { key: 'GREEN', c: '#2ee6a6', label: `ปลอดภัย · ${d} วัน`, shape: 'cir' };
  if (_statusCache.size > 2000) _statusCache.clear(); // bound memory
  _statusCache.set(cacheKey, result);
  return result;
}
function medColor(name) {
  const pal = ['#6366f1','#0ea5e9','#14b8a6','#8b5cf6','#0891b2','#4f46e5'];
  let n = 0;
  for (let i = 0; i < (name||'').length; i++) n = (n + name.charCodeAt(i)) % pal.length;
  return pal[n];
}
function shapeIconSVG(shape, color, size) {
  // WCAG: every color indicator is paired with a shape + inner symbol.
  // Colorblind-safe: no info conveyed by color alone.
  const sz = size || 13;
  const ic = (shape === 'dia' || shape === 'cir') ? '#0d2b1e' : '#ffffff';
  const w = `width="${sz}" height="${sz}" viewBox="0 0 19 19" aria-hidden="true"`;
  switch (shape) {
    case 'oct': return `<svg ${w}>
      <path d="M7,2 12,2 17,7 17,12 12,17 7,17 2,12 2,7 Z" fill="${color}"/>
      <line x1="7.2" y1="7.2" x2="11.8" y2="11.8" stroke="${ic}" stroke-width="2.2" stroke-linecap="round"/>
      <line x1="11.8" y1="7.2" x2="7.2" y2="11.8" stroke="${ic}" stroke-width="2.2" stroke-linecap="round"/>
    </svg>`;
    case 'tri': return `<svg ${w}>
      <path d="M9.5,2 17,16.5 2,16.5 Z" fill="${color}"/>
      <text x="9.5" y="15.5" text-anchor="middle" font-size="9.5" font-weight="900" fill="${ic}" font-family="system-ui,sans-serif">!</text>
    </svg>`;
    case 'dia': return `<svg ${w}>
      <path d="M9.5,1 18,9.5 9.5,18 1,9.5 Z" fill="${color}"/>
      <text x="9.5" y="14.5" text-anchor="middle" font-size="9" font-weight="900" fill="${ic}" font-family="system-ui,sans-serif">!</text>
    </svg>`;
    case 'cir': return `<svg ${w}>
      <circle cx="9.5" cy="9.5" r="8" fill="${color}"/>
      <polyline points="5.8,9.5 8.3,12 13.2,7" stroke="${ic}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    </svg>`;
    default: return `<svg ${w}><circle cx="9.5" cy="9.5" r="8" fill="${color}"/></svg>`;
  }
}
function formGlyph(form) {
  const glyphs = {
    tab: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M6 12h12"/></svg>`,
    cap: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="4" y="8" width="16" height="8" rx="4"/><path d="M12 8v8"/></svg>`,
    vial: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"><path d="M9 3h6M10 3v4l-2 3v9a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2v-9l-2-3V3"/><path d="M8 13h8"/></svg>`,
    pen: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"><path d="M14 3l7 7-9 9-4 1 1-4 5-5"/></svg>`,
    liq: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"><path d="M12 3c4 6 6 9 6 12a6 6 0 0 1-12 0c0-3 2-6 6-12z"/></svg>`,
  };
  return glyphs[form] || glyphs.tab;
}
function medAvatarHTML(it, size) {
  const sz = size || 46;
  const c = medColor(it.name);
  const st = itemStatus(it);
  return `<div style="position:relative;width:${sz}px;height:${sz}px;flex-shrink:0">
    <div style="width:100%;height:100%;border-radius:14px;background:linear-gradient(140deg,${c},${c}aa);display:flex;align-items:center;justify-content:center;box-shadow:0 8px 20px -8px ${c}cc">${formGlyph(it.form||'tab')}</div>
    <div class="drug-avatar-badge">${shapeIconSVG(st.shape, st.c, 12)}</div>
  </div>`;
}
function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('th-TH-u-ca-gregory', { day: '2-digit', month: 'short', year: 'numeric' });
}
function fmtTime(d) {
  return [d.getHours(), d.getMinutes()].map(x => ('0'+x).slice(-2)).join(':');
}
function currentTime() {
  const n = new Date();
  return fmtTime(n);
}
function vibrate(p) { try { navigator.vibrate && navigator.vibrate(p); } catch(e) {} }
function _debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ── AUDIO ─────────────────────────────────────────────
let _actx = null;
function getAC() {
  try {
    if (!_actx) _actx = new (window.AudioContext || window.webkitAudioContext)();
    if (_actx.state === 'suspended') _actx.resume();
    return _actx;
  } catch(e) { return null; }
}
function sfx(type) {
  if (!S.settings.soundOn) return;
  const ac = getAC(); if (!ac) return;
  const t0 = ac.currentTime;
  function blip(freq, start, dur, gain, wave) {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = wave || 'sine'; o.frequency.setValueAtTime(freq, t0+start);
    g.gain.setValueAtTime(0, t0+start);
    g.gain.linearRampToValueAtTime(gain||0.18, t0+start+0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0+start+dur);
    o.connect(g); g.connect(ac.destination);
    o.start(t0+start); o.stop(t0+start+dur+0.02);
  }
  if (type==='scan')    { blip(880,0,0.09,0.16); blip(1320,0.07,0.16,0.18); }
  else if (type==='success') { blip(660,0,0.1,0.16); blip(990,0.09,0.12,0.17); blip(1320,0.19,0.22,0.18,'triangle'); }
  else if (type==='error') { blip(220,0,0.18,0.2,'square'); blip(160,0.12,0.22,0.18,'square'); }
  else if (type==='tick') { blip(1500,0,0.03,0.07); }
}
function speak(t) {
  if (!S.settings.soundOn) return;
  try { const u = new SpeechSynthesisUtterance(t); u.lang='th-TH'; u.rate=1.07; u.pitch=1.05; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch(e) {}
}

// ── TOAST ─────────────────────────────────────────────
let _toastTimer = null;
function showToast(msg, color, ms, actionLabel, actionFn) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.style.borderColor = (color||'#2dd4bf') + '66';
  el.style.boxShadow = `0 0 28px -6px ${color||'#2dd4bf'}66`;
  const actionHTML = actionLabel ? `<button id="toast-action-btn" style="margin-left:10px;padding:4px 10px;border-radius:8px;border:1px solid currentColor;background:transparent;color:${color||'#2dd4bf'};font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap">${actionLabel}</button>` : '';
  el.innerHTML = `<span style="flex:1">${msg}</span>${actionHTML}`;
  el.classList.remove('hidden');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.add('hidden'), ms || 2800);
  if (actionLabel && actionFn) {
    document.getElementById('toast-action-btn')?.addEventListener('click', () => {
      clearTimeout(_toastTimer);
      el.classList.add('hidden');
      actionFn();
    });
  }
}

// ── THEME ─────────────────────────────────────────────
function applyTheme(t) {
  S.theme = t;
  localStorage.setItem('theme', t);
  ['pc-root','pc-phone'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.setAttribute('data-theme', t);
  });
  document.documentElement.setAttribute('data-theme', t);
}

// ── STATUS BAR CLOCK ──────────────────────────────────
function updateClock() {
  const el = document.getElementById('sb-time');
  if (el) el.textContent = currentTime();
  const roleEl = document.getElementById('sb-role');
  if (roleEl) roleEl.textContent = S.user ? S.user.role : '';
}

// ── RENDER ENGINE ─────────────────────────────────────
function renderScreen() {
  const screen = document.getElementById('screen');
  if (!screen) return;

  if (S.manualOpen) {
    screen.innerHTML = renderManual();
    bindManual();
    return;
  }
  if (S.screen === 'lock') {
    if (S.loginStep === 'profiles') screen.innerHTML = renderLockProfiles();
    else if (S.loginStep === 'pin') screen.innerHTML = renderPinScreen();
    else if (S.loginStep === 'face') screen.innerHTML = renderFaceScreen();
    bindLock();
  } else {
    screen.innerHTML = renderApp();
    bindApp();
  }
  updateClock();
  renderDesktopPanel();
  updateEdgeGlow();
}

// ── LOCK — PROFILE PICKER ─────────────────────────────
function renderLockProfiles() {
  const logoSrc = 'uploads/pasted-1782610336254-0.png';
  const profiles = S.users.map((u, idx) => `
    <button class="profile-btn" data-uid="${u.id}" style="animation:profilePop .45s ${.9+idx*.12}s both">
      <div class="profile-avatar-wrap">
        <div class="profile-avatar" style="background:linear-gradient(145deg,${u.color},${u.color}99);box-shadow:0 14px 40px -10px ${u.color}cc,0 0 0 3px ${u.color}44,inset 0 2px 0 rgba(255,255,255,.3)">
          <div class="profile-avatar-highlight"></div>
          ${u.role==='Admin' ? `<svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.95)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="position:relative;z-index:1;filter:drop-shadow(0 2px 6px rgba(0,0,0,.3))"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>` : `<svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.95)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="position:relative;z-index:1"><circle cx="12" cy="8" r="4"/><path d="M6 20v-2a6 6 0 0 1 12 0v2"/></svg>`}
        </div>
        <div class="profile-role-badge" style="background:${u.color};box-shadow:0 4px 12px -2px ${u.color}99">${u.role}</div>
      </div>
      <div class="profile-name">
        <div class="profile-name-main">${u.name.split(' ')[0]}</div>
        ${u.name.includes(' ') ? `<div class="profile-name-sub">${u.name.split(' ').slice(1).join(' ')}</div>` : ''}
      </div>
    </button>`).join('');

  return `
    <div id="lock-screen">
      <div class="lock-ambient">
        <div class="orb orb1"></div>
        <div class="orb orb2"></div>
        <div class="orb orb3"></div>
        <div class="lock-grid"></div>
      </div>
      <div class="lock-content">
        <div class="lock-brand">
          <div class="lock-logo-wrap">
            <div class="glow-ring glow-ring-1"></div>
            <div class="glow-ring glow-ring-2"></div>
            <div class="glow-ring glow-ring-3"></div>
            <img src="${logoSrc}" alt="รพ.กรงปินัง" class="lock-logo" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
            <div class="lock-logo-fallback" style="display:none">
              <div style="text-align:center">
                <div style="font-size:36px">🏥</div>
                <div style="font-size:13px;font-weight:800;color:#009E9E;margin-top:4px">รพ.กรงปินัง</div>
              </div>
            </div>
          </div>
          <div class="lock-system-label">
            <div class="lock-system-line" style="background:linear-gradient(90deg,transparent,rgba(0,158,158,.4))"></div>
            <div class="lock-system-text">DRUG SAFETY SYSTEM</div>
            <div class="lock-system-line" style="background:linear-gradient(90deg,rgba(0,158,158,.4),transparent)"></div>
          </div>
          <div class="lock-title-wrap">
            <div class="lock-title">ระบบเฝ้าระวังความปลอดภัย</div>
            <div class="lock-title">และตรวจจับยาหมดอายุ</div>
            <div class="lock-subtitle">Drug Safety &amp; Expiry Detection System</div>
          </div>
        </div>


        <div class="lock-divider">
          <div class="lock-divider-line" style="background:linear-gradient(90deg,transparent,rgba(0,158,158,.35))"></div>
          <div class="lock-divider-text">บัญชีผู้เข้าใช้งาน</div>
          <div class="lock-divider-line" style="background:linear-gradient(90deg,rgba(0,158,158,.35),transparent)"></div>
        </div>

        <div class="profile-grid">${profiles}</div>


        <div class="lock-credit">
          <div class="lock-credit-divider">
            <div class="lock-credit-line"></div>
            <span class="lock-credit-label">DEVELOPED BY</span>
            <div class="lock-credit-line"></div>
          </div>
          <div class="lock-credit-content">
            <div style="display:flex;flex-direction:column;align-items:center;gap:3px">
              <div class="lock-credit-name">ภก.อนัส มะยีแต</div>
              <div class="lock-credit-role">เภสัชกร · ฝ่ายเภสัชกรรมฯ</div>
            </div>
            <div class="lock-credit-sep"></div>
            <div style="display:flex;flex-direction:column;align-items:center;gap:3px">
              <div class="lock-credit-hosp">รพ.กรงปินัง · จ.ยะลา</div>
              <div class="lock-credit-badges">
                <span class="ha-badge">HA</span>
                <span class="jci-badge">JCI</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

// ── LOCK — PIN SCREEN ─────────────────────────────────
function renderPinScreen() {
  const u = S.pendingUser;
  if (!u) return '';
  const keys = ['1','2','3','4','5','6','7','8','9','face','0','del'];
  const dots = [0,1,2,3].map(i => {
    const filled = i < S.pin.length;
    const isErr = S.pinErr;
    const bg = filled ? (isErr ? '#ff4d5e' : u.color) : 'transparent';
    const border = filled ? (isErr ? '#ff4d5e' : u.color) : 'rgba(255,255,255,.3)';
    const glow = filled && !isErr ? `0 0 18px ${u.color}cc,0 0 6px ${u.color}` : 'none';
    const scale = filled ? 'scale(1.15)' : 'scale(1)';
    const anim = filled ? 'pinFill .2s ease' : 'none';
    return `<div style="width:18px;height:18px;border-radius:50%;transition:all .18s;background:${bg};border:2px solid ${border};box-shadow:${glow};transform:${scale};animation:${anim}"></div>`;
  }).join('');

  const keyBtns = keys.map((k, i) => {
    if (k === 'face') return `<div class="pin-key-spacer"></div>`;
    if (k === 'del') return `<button class="pin-key-del" id="pinDel" style="opacity:${S.pin.length>0?1:.3}">⌫</button>`;
    return `<button class="pin-key" data-key="${k}">${k}</button>`;
  }).join('');

  return `
    <div id="pin-screen">
      <div class="pin-bg-grad" style="background:radial-gradient(ellipse 80% 60% at 50% 0%,${u.color}28 0%,transparent 65%)"></div>
      <div class="pin-top-line" style="background:linear-gradient(90deg,transparent,${u.color},transparent)"></div>
      <button class="pin-back-btn" id="pinBack">‹</button>
      <div class="pin-hero">
        <div class="pin-avatar" style="background:linear-gradient(145deg,${u.color},${u.color}99);box-shadow:0 16px 48px -10px ${u.color}bb,0 0 0 4px ${u.color}33,inset 0 2px 0 rgba(255,255,255,.3);width:84px;height:84px">
          <div class="pin-avatar-highlight"></div>
          ${u.role==='Admin' ? `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.95)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="position:relative;z-index:1"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>` : `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.95)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="position:relative;z-index:1"><circle cx="12" cy="8" r="4"/><path d="M6 20v-2a6 6 0 0 1 12 0v2"/></svg>`}
        </div>
        <div style="text-align:center">
          <div class="pin-user-name">${u.name}</div>
          <div class="pin-user-sub">${u.role} · โรงพยาบาลกรงปินัง</div>
        </div>
        <div class="pin-dots${S.pinErr ? ' error' : ''}" id="pinDots">${dots}</div>
        ${S.pinErr ? `<div class="pin-error-msg">PIN ไม่ถูกต้อง — ลองอีกครั้ง</div>` : ''}
      </div>
      <div class="pin-keypad">${keyBtns}</div>
      <div class="pin-hint">
        <div class="pin-hint-text">ใส่ PIN 4 หลัก</div>
      </div>
    </div>`;
}

// ── LOCK — FACE SCAN ──────────────────────────────────
function renderFaceScreen() {
  const matched = S.faceStage === 'matched';
  const ring = matched ? '#2ee6a6' : '#38bdf8';
  const corners = [0,1,2,3].map(i => {
    const pos = [{top:'-2px',left:'-2px'},{top:'-2px',right:'-2px'},{bottom:'-2px',left:'-2px'},{bottom:'-2px',right:'-2px'}][i];
    const posStr = Object.entries(pos).map(([k,v])=>`${k}:${v}`).join(';');
    return `<div class="face-corner" style="position:absolute;width:30px;height:30px;${posStr};${i<2?`border-top:3px solid ${ring}`:`border-bottom:3px solid ${ring}`};${i%2===0?`border-left:3px solid ${ring}`:`border-right:3px solid ${ring}`}"></div>`;
  }).join('');
  const dots = !matched ? [0,1,2,3,4].map(i => `<span class="face-dot" style="background:${ring};animation-delay:${i*0.18}s"></span>`).join('') : '';
  return `
    <div id="face-screen">
      <button class="face-cancel-btn" id="faceCancelBtn">‹ ยกเลิก</button>
      <img src="uploads/pasted-1782610336254-0.png" alt="รพ.กรงปินัง" class="face-logo-small" onerror="this.style.display='none'">
      <div class="face-label" style="color:${ring}">${matched ? 'FACE VERIFIED' : 'FACE ID'}</div>
      <div class="face-title">${matched ? 'ยืนยันตัวตนสำเร็จ' : 'กำลังสแกนใบหน้า'}</div>
      <div class="face-subtitle">${matched ? 'กำลังเข้าสู่ระบบ…' : 'จัดใบหน้าให้อยู่ในกรอบ และมองที่กล้อง'}</div>
      <div class="face-oval-wrap">
        <div class="face-oval" style="box-shadow:0 0 0 3px ${ring},0 0 50px -6px ${ring}99;animation:${matched?'none':'faceRing 2.4s ease-in-out infinite'}">
          <div id="faceCamContainer" style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px">
            <svg width="96" height="96" viewBox="0 0 24 24" fill="none" stroke="${ring}" stroke-width="1" opacity=".55">
              <circle cx="12" cy="9" r="4"/><path d="M5.5 20a6.5 6.5 0 0 1 13 0"/>
            </svg>
            <div style="font-size:11px;color:var(--ink3)">กล้องจำลอง</div>
          </div>
          ${!matched ? `<div class="face-sweep" style="background:linear-gradient(90deg,transparent,${ring},transparent);color:${ring}"></div>` : ''}
          ${matched ? `<div class="face-check">✓</div>` : ''}
        </div>
        ${corners}
      </div>
      ${!matched ? `<div class="face-dots">${dots}</div>` : `<div class="face-success-msg">ยินดีต้อนรับ ${S.users[0].name}</div>`}
      <div class="face-privacy"><span>🔒</span>ข้อมูลใบหน้าประมวลผลบนเครื่อง · ไม่ส่งออกนอกระบบ</div>
    </div>`;
}

// ── APP SHELL ─────────────────────────────────────────
function buildNavTabs() {
  const fm = getFocusMode();
  const alertCount = S.items.filter(i => ['RED','ORANGE'].includes(itemStatus(i).key)).length;
  const allTabs = [
    { k:'scan',  label:'สแกน',   ico:'⊹' },
    { k:'stock', label:'คลังยา', ico:'▤' },
    { k:'dash',  label:'รายงาน', ico:'◳' },
    { k:'cfg',   label:'ตั้งค่า', ico:'⚙' },
  ];
  // Focus mode hides dash and cfg
  const tabs = fm ? allTabs.filter(t => t.k === 'scan' || t.k === 'stock') : allTabs;
  // If current tab is hidden in focus mode, redirect to scan
  if (fm && (S.tab === 'dash' || S.tab === 'cfg')) S.tab = 'scan';
  return tabs.map(t => {
    const active = S.tab === t.k;
    const badge = t.k === 'stock' ? alertCount : 0;
    return `<button class="nav-tab${active?' active':''}" data-tab="${t.k}" aria-label="${t.label}${badge>0?' ('+badge+' แจ้งเตือน)':''}">
      <span class="nav-tab-icon">
        ${t.ico}
        ${badge > 0 && !active ? `<span class="nav-badge">${badge > 99 ? '99+' : badge}</span>` : ''}
      </span>
      <span class="nav-tab-label">${t.label}</span>
      ${active ? '<span class="nav-tab-indicator"></span>' : ''}
    </button>`;
  }).join('');
}

function renderApp() {
  const notifCount = getNotifs().length;
  const tabNames = { scan:'สแกนรับยา', stock:'คลังยา', dash:'รายงาน & KPI', cfg:'ตั้งค่าระบบ' };
  const fm = getFocusMode();
  const navTabs = buildNavTabs();

  let bodyHTML = '';
  if (S.tab === 'scan') bodyHTML = renderScanTab();
  else if (S.tab === 'stock') bodyHTML = renderStockTab();
  else if (S.tab === 'dash') bodyHTML = renderDashTab();
  else if (S.tab === 'cfg') bodyHTML = renderCfgTab();

  const focusChip = `<button class="focus-chip${fm?' active':''}" id="focusChipBtn" title="Focus Mode — ${fm?'เปิด':'ปิด'}">◎ ${fm?'Focus':'Auto'}</button>`;

  const redItems = S.items.filter(it => itemStatus(it).key === 'RED');
  const orangeItems = S.items.filter(it => itemStatus(it).key === 'ORANGE');
  let alertBannerHTML = '';
  if (redItems.length > 0) {
    alertBannerHTML = `<div class="alert-banner alert-banner-red" id="alertBanner">⛔ ยาหมดอายุ/ห้ามใช้ ${redItems.length} รายการ — ดำเนินการทันที</div>`;
  } else if (orangeItems.length > 0) {
    alertBannerHTML = `<div class="alert-banner alert-banner-orange" id="alertBanner">⚠ ยาใกล้หมดอายุ ${orangeItems.length} รายการ — ตรวจสอบคลัง</div>`;
  }

  return `
    <div id="app-screen">
      <div id="app-topbar">
        <img src="uploads/pasted-1782610336254-0.png" alt="รพ.กรงปินัง" class="topbar-logo" onerror="this.style.display='none'">
        <div class="topbar-info">
          <div class="topbar-tab-line">
            <span class="topbar-tab-name">${tabNames[S.tab]||''}</span>
            ${focusChip}
          </div>
          <div class="topbar-user">${S.user ? S.user.name+' · '+S.user.role : 'OPD Pharmacy'}</div>
        </div>
        <div class="sync-badge ${S.offlineMode?'offline':'online'}">
          ${S.offlineMode ? '📴 Offline' : '✓ Synced'}
        </div>
        <button class="topbar-btn" id="cmdBtn" aria-label="Command Palette">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>
        </button>
        <button class="topbar-btn" id="notifBtn" aria-label="การแจ้งเตือน">
          🔔
          ${notifCount > 0 ? `<span class="topbar-btn-badge">${notifCount}</span>` : ''}
        </button>
        <button class="topbar-btn" id="lockBtn" aria-label="ล็อกหน้าจอ">⏻</button>
      </div>
      ${alertBannerHTML}
      <div id="app-body">
        <div class="tab-pane" id="tab-body">${bodyHTML}</div>
      </div>
      <div id="app-nav">${navTabs}</div>
      ${renderSheet()}
      ${renderConfirm()}
    </div>`;
}

// ── NOTIFICATIONS ─────────────────────────────────────
function getNotifs() {
  const out = [];
  S.items.forEach(it => {
    const s = itemStatus(it);
    if (s.key === 'RED') out.push({ id:'n-'+it.id, c:'#ff4d5e', shape:'oct', t:'ยาใกล้/หมดอายุ', d:it.name+' · '+s.label, item:it });
    else if (s.key === 'ORANGE') out.push({ id:'n-'+it.id, c:'#ff9f43', shape:'tri', t:'อยู่ในช่วงคืนบริษัท', d:it.name+' · '+s.label, item:it });
  });
  return out;
}

// ── SCAN TAB ──────────────────────────────────────────
function renderScanTab() {
  const dest = S.scanDest;
  const destC = dest === 'SUBSTOCK' ? '#7c6cff' : '#2dd4bf';
  const state = S.scanState;
  const idle = state === 'idle';
  const detecting = state === 'detecting';
  const lockon = state === 'lockon';
  const decoding = state === 'decoding';
  const detected = state === 'detected';
  const scanning = detecting || lockon || decoding;

  /* corner colour by phase */
  const cornerC = detected ? '#2ee6a6' : lockon ? '#2ee6a6' : decoding ? '#38bdf8' : '#009E9E';
  const cornerW = lockon || decoding || detected ? '28px' : '36px';
  const corners = [
    { t:'0', l:'0', bt:'border-top:3px solid '+cornerC, bl:'border-left:3px solid '+cornerC, r:'borderTopLeftRadius' },
    { t:'0', r:'0', bt:'border-top:3px solid '+cornerC, bl:'border-right:3px solid '+cornerC, r:'borderTopRightRadius' },
    { b:'0', l:'0', bt:'border-bottom:3px solid '+cornerC, bl:'border-left:3px solid '+cornerC, r:'borderBottomLeftRadius' },
    { b:'0', r:'0', bt:'border-bottom:3px solid '+cornerC, bl:'border-right:3px solid '+cornerC, r:'borderBottomRightRadius' },
  ].map(c => {
    const pos = Object.entries(c).filter(([k])=>['t','b','l','r'].includes(k)).map(([k,v])=>({t:'top',b:'bottom',l:'left',r:'right'}[k]+':'+v).replace('r:0','right:0')).join(';');
    const br = c.r+':10px';
    const anim = (lockon||decoding||detected) ? 'animation:cornerLock .35s cubic-bezier(.4,0,.2,1) forwards' : '';
    return `<div class="scan-corner-v2" style="${pos.replace(/([trblr]):(\d)/g,'$1:$2px').replace('t:','top:').replace('b:','bottom:').replace('l:','left:').replace('r:0','right:0')};width:${cornerW};height:${cornerW};${br};${c.bt};${c.bl};${anim}"></div>`;
  }).join('');

  /* AI confidence ring SVG */
  const confPct = decoding ? S.aiConf : lockon ? 60 : detecting ? 20 : detected ? 99 : 0;
  const circumference = 201; // 2π×32
  const dashOffset = circumference - (circumference * confPct / 100);
  const ringC = detected ? '#2ee6a6' : decoding ? '#38bdf8' : lockon ? '#2ee6a6' : '#009E9E';
  const confRing = `
    <div class="ai-conf-wrap">
      <svg class="ai-conf-svg" width="52" height="52" viewBox="0 0 52 52">
        <circle class="ai-conf-track" cx="26" cy="26" r="22"/>
        <circle class="ai-conf-bar" cx="26" cy="26" r="22"
          stroke="${ringC}" style="--cd:${dashOffset};stroke-dasharray:${circumference};stroke-dashoffset:${dashOffset}"/>
      </svg>
      <span class="ai-conf-text" style="color:${ringC}">${confPct}%</span>
    </div>`;

  /* phase status badge */
  const phaseInfo = {
    idle:      { label:'เล็งกล้องที่บาร์โค้ด', bg:'rgba(0,0,0,.5)', border:'rgba(255,255,255,.15)', c:'rgba(255,255,255,.8)' },
    detecting: { label:'🔍 AI กำลังค้นหา…',    bg:'rgba(0,158,158,.25)', border:'rgba(0,158,158,.5)', c:'#009E9E' },
    lockon:    { label:'🎯 ล็อคเป้าหมาย…',       bg:'rgba(46,230,166,.2)', border:'rgba(46,230,166,.5)', c:'#2ee6a6' },
    decoding:  { label:'⚡ GS1 ถอดรหัส…',        bg:'rgba(56,189,248,.2)', border:'rgba(56,189,248,.5)', c:'#38bdf8' },
    detected:  { label:'✓ พบข้อมูล!',            bg:'rgba(46,230,166,.2)', border:'#2ee6a6', c:'#2ee6a6' },
  }[state] || phaseInfo?.idle;

  /* barcode bg bars */
  const barcodeH = [100,40,120,60,80,110,45,90,130,55,70,100,40,80,60].map((h,i) =>
    `<div class="scan-barcode-bar" style="height:${h}%;animation-delay:${i*.1}s"></div>`).join('');

  /* scan stats */
  const redCount = S.items.filter(i => itemStatus(i).key === 'RED').length;
  const lowStockCount = S.items.filter(i => i.minStock > 0 && i.qty <= i.minStock).length;
  const sk = getStreakData();
  const statsHTML = `
    <div class="scan-stats-bar">
      <div class="scan-stat" style="animation-delay:.05s">
        <div class="scan-stat-val" style="color:#009E9E">${S.items.length}</div>
        <div class="scan-stat-label">รายการทั้งหมด</div>
      </div>
      <div class="scan-stat" style="animation-delay:.1s">
        <div class="scan-stat-val" style="color:${S.scanCount>0?'#2ee6a6':'var(--ink3)'}">${sk.total||S.scanCount}</div>
        <div class="scan-stat-label">สแกนสะสม</div>
      </div>
      <div class="scan-stat" style="animation-delay:.15s">
        <div class="scan-stat-val" style="color:${redCount>0?'#ff4d5e':'#2ee6a6'}">${redCount}</div>
        <div class="scan-stat-label">ยาเสี่ยง</div>
      </div>
      ${lowStockCount > 0 ? `<div class="scan-stat" style="animation-delay:.2s">
        <div class="scan-stat-val" style="color:#ff9f43">${lowStockCount}</div>
        <div class="scan-stat-label">สต๊อกต่ำ</div>
      </div>` : sk.streak > 0 ? `<div class="scan-stat" style="animation-delay:.2s">
        <div class="scan-stat-val" style="color:#ff9f43">🔥${sk.streak}</div>
        <div class="scan-stat-label">วันติดต่อกัน</div>
      </div>` : ''}
    </div>`;

  /* format chips */
  const formatChips = S.scanFormats.map(f =>
    `<button class="scan-format-chip${S.scanFormat===f?' active':''}" data-fmt="${f}">${f}</button>`).join('');

  /* scan history */
  const historyHTML = S.scanHistory.length > 0 ? `
    <div style="margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:var(--ink3);letter-spacing:.8px;margin-bottom:8px">ประวัติสแกนล่าสุด</div>
      <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:4px">
        ${S.scanHistory.slice(0,6).map((it,idx) => {
          const dc = it.dest === 'SUBSTOCK' ? '#7c6cff' : '#009E9E';
          const st = itemStatus({exp:it.exp});
          return `<div class="history-chip" style="border:1px solid ${dc}33;background:${dc}0e;animation-delay:${idx*.05}s">
            <div style="font-size:11.5px;font-weight:700;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${it.name.split(' ').slice(0,2).join(' ')}</div>
            <div style="display:flex;gap:5px;margin-top:4px;align-items:center">
              ${shapeIconSVG(st.shape,st.c,9)}
              <span style="font-size:9px;font-weight:700;color:${dc}">${it.dest==='SUBSTOCK'?'คลัง':'เคาน์เตอร์'}</span>
              <span style="font-size:9px;color:var(--ink3);font-family:'JetBrains Mono',monospace">${fmtDate(it.exp)}</span>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>` : '';

  const resultHTML = S.scanResult ? renderScanResult(S.scanResult)
    : idle ? `<div class="scan-empty"><div class="scan-empty-icon">📷</div>กดถ่ายภาพฉลากยา<br><span style="font-size:11px;color:var(--ink3)">AI อ่านชื่อยา · EXP · LOT · วันผลิต ได้ครบในภาพเดียว</span></div>` : '';

  /* voice waveform bars */
  const waveHTML = [18,26,22,28,20,24,16].map((_,i) =>
    `<div class="waveform-bar" style="height:${[18,26,22,28,20,24,16][i]}px;animation-delay:${i*.08}s"></div>`).join('');

  return `
    <div class="dest-toggle">
      <div class="dest-slider" id="destSlider" style="left:${dest==='SUBSTOCK'?'4px':'50%'};background:linear-gradient(135deg,${destC},${destC}bb);box-shadow:0 6px 20px -6px ${destC}88"></div>
      <button class="dest-btn" data-dest="SUBSTOCK" style="color:${dest==='SUBSTOCK'?'#fff':'var(--ink3)'}">📦 SUBSTOCK · คลัง</button>
      <button class="dest-btn" data-dest="FRONT_SHELF" style="color:${dest==='FRONT_SHELF'?'#fff':'var(--ink3)'}">🛎 FRONT SHELF · เคาน์เตอร์</button>
    </div>

    <!-- ═══ HERO: AI Photo Scan — PRIMARY ACTION ═══ -->
    <button id="photoScanBtn" class="hero-photo-btn" ${scanning?'disabled style="opacity:.55"':''}>
      <div class="hero-photo-icon-wrap">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
          <circle cx="12" cy="13" r="4"/>
        </svg>
      </div>
      <div class="hero-photo-text">
        <div class="hero-photo-title">ถ่ายภาพฉลากยา</div>
        <div class="hero-photo-sub">AI อ่าน ชื่อยา · EXP · LOT · วันผลิต ครบในภาพเดียว</div>
      </div>
      <svg class="hero-photo-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.7)" stroke-width="2.5" stroke-linecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
    </button>
    <input type="file" id="photoScanInput" accept="image/*" capture="environment" style="display:none">
    <div class="photo-guide-tip">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--ink3)" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
      <span>ถ่ายด้านที่มีชื่อยาให้ชัด — ไม่ใช่แค่ด้านบาร์โค้ด · AI อ่านชื่อยา + EXP + LOT ในภาพเดียว</span>
    </div>

    <!-- SECONDARY: barcode scanner + manual -->
    <div class="scan-secondary-row">
      <button class="scan-btn-secondary" id="camToggleBtn">
        <span>${S.cameraActive?'🔴':'📡'}</span>${S.cameraActive?'ปิดกล้อง':'สแกนบาร์โค้ด GS1'}
      </button>
      <button class="scan-btn-secondary" id="barcodeInputBtn">
        <span>⌨</span>กรอกรหัส
      </button>
      <button class="scan-btn-secondary" id="manualEntryBtn">
        <span>✎</span>กรอกเอง
      </button>
    </div>

    <!-- Camera viewport — shown only when active or scanning -->
    ${(S.cameraActive || scanning) ? `
    <div class="scan-viewport sv-${state}${S.cameraActive?' cam-active':''}" id="scanViewport" style="height:${S.cameraActive?'360px':'280px'}">
      <div class="scan-vp-bg"></div>
      <div class="scan-ai-grid"></div>
      ${!S.cameraActive ? `<div class="scan-barcode-bg">${barcodeH}</div>` : ''}
      <div class="scan-laser-beam"></div>
      ${confRing}
      ${S.cameraActive ? `<div class="live-cam-indicator"><div class="live-cam-dot"></div>LIVE · ZXing AI</div>` : ''}
      <div id="camContainer" style="position:absolute;inset:0;display:${S.cameraActive?'block':'flex'};flex-direction:column;align-items:center;justify-content:center;gap:8px">
        ${!S.cameraActive ? `
          <svg width="60" height="60" viewBox="0 0 24 24" fill="none" stroke="rgba(0,158,158,.4)" stroke-width="1" style="margin-top:8px">
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
            <circle cx="12" cy="13" r="4"/>
          </svg>` : ''}
      </div>
      <div class="scan-reticle" style="width:${S.cameraActive?'200px':'170px'};height:${S.cameraActive?'174px':'148px'}">
        ${corners}
        ${detected ? `<div class="scan-success-ring"></div><div class="scan-check">✓</div>` : ''}
        ${scanning ? '<div class="scan-laser-beam" style="position:relative;animation-duration:1.4s;inset:unset;box-shadow:none;width:100%;height:1px"></div>' : ''}
      </div>
      <div class="scan-phase-badge" style="background:${phaseInfo.bg};border-color:${phaseInfo.border};color:${phaseInfo.c}">
        ${phaseInfo.label}
      </div>
    </div>
    <div class="scan-format-row">${formatChips}</div>
    ` : ''}

    <!-- Rapid scan toggle -->
    <div class="rapid-row${S.rapidMode?' active':''}" id="rapidRow">
      <span style="font-size:16px">⚡</span>
      <div style="flex:1">
        <div class="rapid-label" style="color:${S.rapidMode?'#2ee6a6':'var(--ink)'}">Rapid Scan Mode</div>
        <div class="rapid-sub">สแกนต่อเนื่อง · บันทึกอัตโนมัติ · ไม่ต้องกดยืนยัน</div>
      </div>
      ${S.rapidMode && S.scanCount > 0 ? `<button id="resetRapidBtn" style="padding:5px 11px;border-radius:9px;border:none;background:rgba(124,108,255,.2);color:#9d8cff;font-size:11.5px;font-weight:700;cursor:pointer;font-family:'Sarabun',sans-serif">เริ่มใหม่</button>` : ''}
      <button class="toggle-btn" id="rapidToggle" style="background:${S.rapidMode?'#2ee6a6':'rgba(150,150,160,.35)'}">
        <span class="toggle-thumb" style="left:${S.rapidMode?'21px':'3px'}"></span>
      </button>
    </div>

    ${statsHTML}
    ${historyHTML}


    ${resultHTML}`;
}

function renderScanResult(r) {
  const needsExpiry = !!r.needsExpiry;
  const exp = needsExpiry ? null : (r.exp || null);
  const sC = exp ? itemStatus({ exp }) : { c:'#009E9E', label:'รอระบุ', key:'GREEN' };
  const dl  = exp ? daysLeft(exp) : 999;
  const isExpired = dl < 0;

  const flags = [];
  if (r.highAlert) flags.push(`<span class="drug-tag ha-flag">⬢ HIGH-ALERT</span>`);
  if (r.lasa)      flags.push(`<span class="drug-tag lasa-flag">◆ LASA</span>`);
  if (r.cold)      flags.push(`<span class="drug-tag cold-flag">❄ COLD CHAIN</span>`);
  const destC = (r.dest==='SUBSTOCK') ? '#7c6cff' : '#2dd4bf';
  const destLabel = (r.dest==='SUBSTOCK') ? '📦 SUBSTOCK · คลังยา' : '🛎 FRONT SHELF · จุดบริการ';
  const interactionWarn = r.highAlert && r.lasa;

  // Header label based on scan type
  let hIcon, hLabel;
  if (needsExpiry && r.isNew)  { hIcon='⚠';  hLabel='ยาใหม่ในระบบ — กรอกข้อมูลเพิ่มเติม'; }
  else if (needsExpiry)        { hIcon='📦'; hLabel=`${r.name} — กรอกวันหมดอายุล็อตนี้`; }
  else if (r.isNew)            { hIcon='⚠';  hLabel='ยาใหม่ — กรุณาระบุชื่อยา'; }
  else                         { hIcon='✨'; hLabel='GS1 ดึงข้อมูลครบ · ไม่ต้องกรอกเอง'; }

  // Input style helper
  const inp = `background:var(--glass);border:1px solid var(--glassb);border-radius:10px;padding:9px 12px;font-size:13px;font-family:'Sarabun',sans-serif;color:var(--ink);width:100%;box-sizing:border-box`;
  const inpDate = `background:var(--glass);border:1px solid var(--glassb);border-radius:10px;padding:8px 6px;font-size:12px;font-family:'JetBrains Mono',monospace;color:var(--ink);width:100%;box-sizing:border-box`;

  return `
    <div class="scan-result-card" style="border-color:${needsExpiry?'#ff9f4355':'#009e9e55'}">
      <!-- Barcode row -->
      <div class="ai-meta-row">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#009E9E" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 9h20M7 4v5M12 4v5M17 4v5"/></svg>
        <span class="ai-meta-label">รูปแบบ</span>
        <span class="ai-meta-val">${S.scanFormat}</span>
        ${r.barcode || r.gtin ? `<span class="gs1-gtin" style="margin-left:auto;font-size:10px">${(r.gtin||r.barcode).slice(0,16)}</span>` : ''}
      </div>

      <div class="scan-result-header">
        <span class="scan-result-ok-label"><span>${hIcon}</span>${hLabel}</span>
      </div>

      <!-- Drug name: editable if new, read-only if known -->
      ${(r.isNew || needsExpiry) ? `
      <div style="display:flex;flex-direction:column;gap:7px;margin-bottom:2px;animation:typeReveal .3s ease">
        ${r.isNew ? `
        ${r._missingName ? `
        <div class="name-photo-row">
          <div class="name-photo-hint">💡 AI ยังไม่เจอชื่อยา — ลองถ่ายด้านที่มีชื่อยาเพิ่มได้เลย</div>
          <button id="namePhotoBtn" class="name-photo-btn">
            <span style="font-size:20px;line-height:1">📷</span>
            <span>ถ่ายด้านชื่อยา — AI เติมชื่อให้อัตโนมัติ</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" stroke-width="2.5" stroke-linecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </button>
          <input type="file" id="namePhotoInput" accept="image/*" capture="environment" style="display:none">
        </div>
        ` : ''}
        <input id="newDrugName" placeholder="ชื่อยา (จำเป็น)..." value="${r.name||''}"
          style="${inp}">
        <input id="newDrugGen" placeholder="Generic / ชื่อสามัญ (ถ้ามี)..." value="${r.gen||''}"
          style="${inp}">` : `
        <div class="scan-result-name" style="animation:typeReveal .3s ease">${r.name}</div>
        <div class="scan-result-gen">${r.gen||''}</div>`}

        <!-- Expiry + Lot inputs — always required for EAN-13 -->
        ${needsExpiry ? `
        ${S.cameraActive ? `
        <div style="font-size:11px;color:#2ee6a6;text-align:center;padding:6px 8px;background:rgba(46,230,166,.1);border-radius:10px;border:1px solid rgba(46,230,166,.3);font-weight:700">
          🎯 กล้องทำงานอยู่ — เล็งบาร์โค้ด DataMatrix/QR บนกล่องยาเพื่ออ่านข้อมูลอัตโนมัติ
        </div>` : ''}
        <button id="ocrCaptureBtn" class="ocr-primary-btn">
          <span style="font-size:32px;line-height:1;flex-shrink:0">📷</span>
          <span style="flex:1">
            <span style="display:block;font-size:15px;font-weight:800;color:var(--brand)">ถ่ายภาพยา — AI อ่านอัตโนมัติ</span>
            <span style="display:block;font-size:11px;color:var(--ink3);margin-top:3px">EXP · LOT · วันผลิต · ชื่อยา ไม่ต้องกรอกเอง</span>
          </span>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" stroke-width="2.5" stroke-linecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
        </button>
        <input type="file" id="ocrFileInput" accept="image/*" capture="environment" style="display:none">
        <div style="font-size:10px;color:var(--ink3);text-align:center;padding:4px 0 2px;letter-spacing:.3px">— หรือกรอกข้อมูลด้วยตนเอง —</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:7px">
          <div>
            <div style="font-size:10px;color:var(--ink3);margin-bottom:4px;font-weight:700">ยาสิ้นอายุ *</div>
            <input id="ean13Expiry" type="date" style="${inpDate}">
          </div>
          <div>
            <div style="font-size:10px;color:var(--ink3);margin-bottom:4px;font-weight:700">วันผลิต</div>
            <input id="ean13Mfd" type="date" style="${inpDate}">
          </div>
          <div>
            <div style="font-size:10px;color:var(--ink3);margin-bottom:4px;font-weight:700">ครั้งที่ผลิต / Lot</div>
            <input id="ean13Lot" placeholder="เช่น ST68-6470" style="${inp}">
          </div>
          <div>
            <div style="font-size:10px;color:var(--ink3);margin-bottom:4px;font-weight:700">จำนวน (หน่วย)</div>
            <input id="ean13Qty" type="number" min="1" placeholder="1" style="${inp}">
          </div>
        </div>` : ''}
      </div>` : `
      <div class="scan-result-name" style="animation:typeReveal .3s ease">${r.name}</div>
      <div class="scan-result-gen" style="animation:typeReveal .3s .06s both">${r.gen||''}</div>`}

      ${r.dest ? `<div class="scan-result-dest" style="background:${destC}1e;border:1px solid ${destC}55;animation:typeReveal .3s .1s both;margin-top:8px">
        <span>${destC==='#7c6cff'?'📦':'🛎'}</span><span style="font-size:12px;font-weight:700;color:${destC}">${destLabel}</span>
      </div>` : ''}

      ${flags.length ? `<div class="drug-flags" style="animation:typeReveal .3s .14s both">${flags.join('')}</div>` : ''}
      ${interactionWarn ? `<div class="interaction-warn"><div class="interaction-icon">⚠</div><div class="interaction-text">HIGH-ALERT + LASA — ตรวจสอบ 2 ครั้งก่อนรับ</div></div>` : ''}

      ${!needsExpiry && isExpired ? `<div style="padding:8px 12px;border-radius:12px;background:rgba(255,77,94,.12);border:1px solid rgba(255,77,94,.35);margin-top:8px">
        <span style="font-size:12px;font-weight:700;color:#ff4d5e">⛔ ยาหมดอายุแล้ว ${-dl} วัน — ห้ามรับเข้าสต๊อก</span>
      </div>` : ''}

      ${!needsExpiry ? `
      <div class="scan-result-grid" style="margin-top:12px">
        <div class="scan-field-reveal"><div class="scan-field-label">วันหมดอายุ</div><div class="scan-field-val" style="color:${sC.c};font-family:'JetBrains Mono',monospace">${fmtDate(exp)}</div></div>
        <div class="scan-field-reveal"><div class="scan-field-label">เหลือ</div><div class="scan-field-val" style="color:${sC.c}">${sC.label}</div></div>
        <div class="scan-field-reveal"><div class="scan-field-label">Lot / Batch</div><div class="scan-field-val" style="color:#9d8cff;font-family:'JetBrains Mono',monospace">${r.lot||'—'}</div></div>
        <div class="scan-field-reveal"><div class="scan-field-label">จำนวน</div><div class="scan-field-val">${r.qty||'—'} หน่วย</div></div>
      </div>` : ''}

      <div class="scan-result-actions">
        <button class="scan-accept-btn" id="acceptScanBtn"
          ${!needsExpiry && isExpired ? 'style="opacity:.45;pointer-events:none"' : ''}>
          ✓ รับเข้าสต๊อก
        </button>
        <button class="scan-reject-btn" id="rejectScanBtn">ยกเลิก</button>
      </div>
    </div>`;
}

// ── STOCK TAB ─────────────────────────────────────────
function _countByFilter(k) {
  if (k === 'all') return S.items.length;
  if (k === 'FRONT_SHELF' || k === 'SUBSTOCK') return S.items.filter(i => i.loc === k).length;
  return S.items.filter(i => itemStatus(i).key === k).length;
}

function renderStockTab() {
  const filterDefs = [
    { k:'all', label:'ทั้งหมด' },
    { k:'RED', label:'🔴 แดง' },
    { k:'ORANGE', label:'🟠 ส้ม' },
    { k:'YELLOW', label:'🟡 เหลือง' },
    { k:'GREEN', label:'🟢 เขียว' },
    { k:'FRONT_SHELF', label:'🛎 เคาน์เตอร์' },
    { k:'SUBSTOCK', label:'📦 คลัง' },
  ];
  const q = S.stockSearch.toLowerCase();
  let items = S.items.filter(it => {
    if (S.stockFilter === 'all') return true;
    if (['FRONT_SHELF','SUBSTOCK'].includes(S.stockFilter)) return it.loc === S.stockFilter;
    return itemStatus(it).key === S.stockFilter;
  }).filter(it => !q || (it.name+it.gen+it.lot).toLowerCase().includes(q));

  // Sort
  const sort = S.stockSort || 'exp';
  items = items.sort((a,b) => {
    if (sort === 'name') return (a.name||'').localeCompare(b.name||'', 'th');
    if (sort === 'qty') return a.qty - b.qty;
    if (sort === 'status') {
      const order = { RED:0, ORANGE:1, YELLOW:2, GREEN:3 };
      return (order[itemStatus(a).key]||3) - (order[itemStatus(b).key]||3);
    }
    return daysLeft(a.exp) - daysLeft(b.exp); // default: exp
  });

  const front = items.filter(i => i.loc === 'FRONT_SHELF');
  const sub = items.filter(i => i.loc === 'SUBSTOCK');

  function cardList(arr) {
    if (!arr.length) return `<div class="empty-state"><div class="empty-state-icon">📦</div>ไม่มีรายการ</div>`;
    return arr.map(it => {
      const st = itemStatus(it);
      const flags = [];
      if (it.highAlert) flags.push(`<span class="flag-tag ha-flag">HIGH-ALERT</span>`);
      if (it.lasa) flags.push(`<span class="flag-tag lasa-flag">LASA</span>`);
      if (it.cold) flags.push(`<span class="flag-tag cold-flag">❄ COLD</span>`);
      const lowStockWarn = it.minStock > 0 && it.qty <= it.minStock;
      return `<div class="drug-card" data-id="${it.id}">
        <div class="drug-card-status-bar" style="background:${st.c}"></div>
        ${medAvatarHTML(it, 46)}
        <div class="drug-info">
          <div class="drug-name">${it.name}</div>
          <div class="drug-gen">${it.gen}</div>
          <div class="drug-meta">
            <span class="drug-lot">${it.lot}</span>
            <span class="drug-exp">${fmtDate(it.exp)}</span>
            <span class="drug-qty-badge${lowStockWarn?' low-stock-warn':''}">${it.qty} หน่วย${lowStockWarn?' ⚠':''}</span>
            ${flags.join('')}
          </div>
        </div>
        <div>
          <div class="drug-status-badge" style="background:${st.c}22;border:1px solid ${st.c}55;color:${st.c}">
            ${shapeIconSVG(st.shape, st.c, 11)}
            <span style="font-size:10.5px;font-weight:800">${st.key}</span>
          </div>
        </div>
      </div>`;
    }).join('');
  }

  const showSections = !S.stockFilter || S.stockFilter === 'all' || !['FRONT_SHELF','SUBSTOCK'].includes(S.stockFilter);

  const sortOpts = [
    { v:'exp',    l:'วันหมดอายุ' },
    { v:'status', l:'สถานะ' },
    { v:'name',   l:'ชื่อยา' },
    { v:'qty',    l:'จำนวน' },
  ];

  return `
    <div class="stock-header">
      <button class="stock-transfer-btn" id="bulkTransferBtn">
        🚀 โอนทั้งหมดขึ้นเคาน์เตอร์
      </button>
    </div>
    <div class="stock-filter-wrap">
      ${filterDefs.map(f => {
        const cnt = _countByFilter(f.k);
        return `<button class="stock-filter-btn${S.stockFilter===f.k?' active':''}" data-filter="${f.k}">${f.label}<span class="stock-filter-count">${cnt}</span></button>`;
      }).join('')}
    </div>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
      <input class="stock-search" id="stockSearchInput" placeholder="🔍 ค้นหา ชื่อยา, Lot, Generic…" value="${S.stockSearch}" style="flex:1;margin-bottom:0">
      <select id="stockSortSel" style="padding:9px 10px;border-radius:12px;border:1px solid var(--glassb);background:var(--glass);color:var(--ink);font-family:'Sarabun',sans-serif;font-size:12.5px;font-weight:600;cursor:pointer;outline:none;min-width:100px">
        ${sortOpts.map(o => `<option value="${o.v}"${sort===o.v?' selected':''}>${o.l}</option>`).join('')}
      </select>
    </div>
    ${showSections ? `
      <div class="stock-section-label">🛎 FRONT SHELF <span class="stock-section-count">${front.length}</span></div>
      ${cardList(front)}
      <div class="stock-section-label" style="margin-top:18px">📦 SUBSTOCK <span class="stock-section-count">${sub.length}</span></div>
      ${cardList(sub)}` : cardList(items)}`;
}

// ── DASH RING CHART ───────────────────────────────────
function renderStatusRing(counts, total) {
  if (!total) return '';
  const keys   = ['RED','ORANGE','YELLOW','GREEN'];
  const colors = ['#ff4d5e','#ff9f43','#ffd23f','#2ee6a6'];
  const labels = ['หมดอายุ','คืนบริษัท','เฝ้าระวัง','ปลอดภัย'];
  const r = 50, cx = 66, cy = 66;
  const circ = 2 * Math.PI * r; // ≈314.16

  let segs = '', cumLen = 0;
  keys.forEach((k, i) => {
    const cnt = counts[k] || 0;
    if (!cnt) return;
    const arcLen = (cnt / total) * circ;
    segs += `<circle cx="${cx}" cy="${cy}" r="${r}"
      fill="none" stroke="${colors[i]}" stroke-width="12"
      stroke-dasharray="${arcLen.toFixed(1)} ${(circ-arcLen).toFixed(1)}"
      stroke-dashoffset="${(-cumLen).toFixed(1)}"
      transform="rotate(-90 ${cx} ${cy})"
      style="transition:stroke-dasharray .8s cubic-bezier(.4,0,.2,1)"
    />`;
    cumLen += arcLen;
  });

  const legend = keys.map((k, i) => `
    <div class="dash-legend-item">
      <div class="dash-legend-dot" style="background:${colors[i]}"></div>
      <div class="dash-legend-text">
        <span>${labels[i]}</span>
        <span style="color:${colors[i]};font-size:16px;font-weight:800;font-family:'Space Grotesk',sans-serif;margin-left:auto">${counts[k]||0}</span>
      </div>
    </div>`).join('');

  return `
    <div class="dash-ring-wrap">
      <div style="flex-shrink:0">
        <svg width="132" height="132" viewBox="0 0 132 132">
          <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="12"/>
          ${segs}
          <text x="${cx}" y="${cy-6}" text-anchor="middle" fill="var(--ink)" font-size="23" font-weight="800" font-family="Space Grotesk,sans-serif">${total}</text>
          <text x="${cx}" y="${cy+11}" text-anchor="middle" fill="var(--ink3)" font-size="9.5" font-weight="600" font-family="Sarabun,sans-serif">รายการ</text>
        </svg>
      </div>
      <div class="dash-ring-legend">${legend}</div>
    </div>`;
}

// ── DASH TAB ──────────────────────────────────────────
function renderExpiryChart(items) {
  const now = new Date();
  const months = [];
  for (let i = 0; i < 6; i++) {
    const mStart = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const mEnd   = new Date(now.getFullYear(), now.getMonth() + i + 1, 0, 23, 59, 59);
    const label  = mStart.toLocaleDateString('th-TH', { month: 'short' });
    const inRange = items.filter(it => {
      if (!it.exp) return false;
      const d = it.exp instanceof Date ? it.exp : new Date(it.exp);
      return d >= mStart && d <= mEnd;
    });
    const cRed    = inRange.filter(it => itemStatus(it).key === 'RED').length;
    const cOrange = inRange.filter(it => itemStatus(it).key === 'ORANGE').length;
    const cOther  = inRange.filter(it => !['RED','ORANGE'].includes(itemStatus(it).key)).length;
    months.push({ label, cRed, cOrange, cOther, total: inRange.length });
  }
  const maxVal = Math.max(...months.map(m => m.total), 1);
  const bW = 40; const gap = 11; const chartH = 78;
  const vW = (bW + gap) * 6 - gap;
  const bars = months.map((m, i) => {
    const x = i * (bW + gap);
    const hRed    = (m.cRed    / maxVal) * chartH;
    const hOrange = (m.cOrange / maxVal) * chartH;
    const hOther  = (m.cOther  / maxVal) * chartH;
    let y = chartH; const parts = [];
    if (hOther  > 0) { y -= hOther;  parts.push(`<rect x="${x}" y="${y.toFixed(1)}" width="${bW}" height="${hOther.toFixed(1)}" rx="3" fill="#2ee6a650"/>`); }
    if (hOrange > 0) { y -= hOrange; parts.push(`<rect x="${x}" y="${y.toFixed(1)}" width="${bW}" height="${hOrange.toFixed(1)}" rx="3" fill="#ff9f43"/>`); }
    if (hRed    > 0) { y -= hRed;    parts.push(`<rect x="${x}" y="${y.toFixed(1)}" width="${bW}" height="${hRed.toFixed(1)}" rx="3" fill="#ff4d5e"/>`); }
    if (m.total === 0) parts.push(`<rect x="${x}" y="${chartH - 3}" width="${bW}" height="3" rx="2" fill="rgba(255,255,255,.06)"/>`);
    return `<g>${parts.join('')}
      <text x="${x + bW/2}" y="${chartH + 13}" text-anchor="middle" fill="var(--ink3)" font-size="9.5">${m.label}</text>
      ${m.total > 0 ? `<text x="${x + bW/2}" y="${Math.max(y - 4, 9)}" text-anchor="middle" fill="var(--ink2)" font-size="9" font-weight="700">${m.total}</text>` : ''}
    </g>`;
  }).join('');
  return `
    <div class="dash-chart-wrap">
      <svg width="100%" viewBox="0 0 ${vW} ${chartH + 18}" preserveAspectRatio="xMidYMid meet" style="display:block">${bars}</svg>
      <div class="dash-chart-legend">
        <span><span class="dash-legend-dot" style="background:#ff4d5e"></span>หมดอายุ</span>
        <span><span class="dash-legend-dot" style="background:#ff9f43"></span>ใกล้หมด</span>
        <span><span class="dash-legend-dot" style="background:#2ee6a650"></span>ปลอดภัย</span>
      </div>
    </div>`;
}

function renderDashTab() {
  const all = S.items;
  const counts = { RED:0, ORANGE:0, YELLOW:0, GREEN:0 };
  all.forEach(it => counts[itemStatus(it).key]++);
  const alerts = all.filter(it => ['RED','ORANGE'].includes(itemStatus(it).key))
    .sort((a,b) => daysLeft(a.exp) - daysLeft(b.exp));

  const atRiskCost = alerts.reduce((s, it) => s + (it.qty || 1) * 50, 0);
  const todayScans = S.scanHistory.filter(h => {
    const d = new Date(h.ts); const n = new Date();
    return d.getDate() === n.getDate() && d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear();
  }).length;
  const lowStock = S.items.filter(it => it.minStock > 0 && it.qty <= it.minStock);

  const kpiData = [
    { icon:'💊', bg:'rgba(0,158,158,.15)', val:all.length, label:'ยาทั้งหมด', sub:`${S.dept} · รายการทั้งหมด`, trendC:'#009E9E' },
    { icon:'🔴', bg:'rgba(255,77,94,.15)', val:counts.RED, label:'ห้ามใช้/หมดอายุ', sub: counts.RED>0 ? 'ต้องดำเนินการทันที':'ไม่มีรายการ', trendC: counts.RED>0?'#ff4d5e':'#2ee6a6' },
    { icon:'🟠', bg:'rgba(255,159,67,.15)', val:counts.ORANGE, label:'คืนบริษัท', sub:`มูลค่าเสี่ยง ~${atRiskCost.toLocaleString('th-TH')}฿`, trendC:'#ff9f43' },
    { icon:'📊', bg:'rgba(157,140,255,.15)', val:todayScans, label:'สแกนวันนี้', sub:`สต๊อกต่ำ: ${lowStock.length} รายการ`, trendC:'#9d8cff' },
  ];

  const kpiHTML = kpiData.map((k,i) => `
    <div class="kpi-card" style="animation-delay:${i*0.06}s">
      <div class="kpi-card-head">
        <div class="kpi-card-icon" style="background:${k.bg}">${k.icon}</div>
      </div>
      <div class="kpi-card-val" style="color:${k.trendC||'var(--ink)'}">${k.val}</div>
      <div class="kpi-card-label">${k.label}</div>
      <div style="font-size:10px;color:var(--ink3);margin-top:1px;line-height:1.3">${k.sub}</div>
    </div>`).join('');

  const activeRecalls = (S.recalls || []).filter(r => r.active !== false);
  const recallBanner = activeRecalls.length ? `
    <div class="recall-banner">
      <div class="recall-banner-title">🚨 ยาถูกเรียกคืน ${activeRecalls.length} รายการ</div>
      ${activeRecalls.slice(0,3).map(r => `<div class="recall-banner-item">• ${r.drugName||'—'} · Lot ${r.lotNo||'—'} · ${r.reason||'—'}</div>`).join('')}
    </div>` : '';

  const lowStockHTML = lowStock.length ? `
    <div class="dash-section-title" style="margin-top:16px">
      <span>📉 สต๊อกต่ำกว่ากำหนด</span>
      <span class="dash-section-sub">${lowStock.length} รายการ</span>
    </div>
    ${lowStock.map(it => `<div class="alert-item">
      <div class="alert-shape" style="font-size:18px">📦</div>
      <div class="alert-info"><div class="alert-name">${it.name}</div><div class="alert-detail">เหลือ ${it.qty} / ขั้นต่ำ ${it.minStock} หน่วย</div></div>
      <div class="alert-badge"><div class="alert-days" style="background:rgba(157,140,255,.15);color:#9d8cff">ต่ำ</div></div>
    </div>`).join('')}` : '';

  const alertListHTML = alerts.length ? alerts.slice(0,8).map(it => {
    const st = itemStatus(it);
    const dl = daysLeft(it.exp);
    return `<div class="alert-item">
      <div class="alert-shape">${shapeIconSVG(st.shape, st.c, 16)}</div>
      <div class="alert-info">
        <div class="alert-name">${it.name}</div>
        <div class="alert-detail">Lot ${it.lot} · ${it.loc === 'FRONT_SHELF' ? 'เคาน์เตอร์' : 'คลัง'}</div>
      </div>
      <div class="alert-badge">
        <div class="alert-days" style="background:${st.c}22;color:${st.c}">${dl<0?`หมดอายุ ${-dl}ว`:`${dl}ว`}</div>
      </div>
    </div>`;
  }).join('') : '';

  const isAdmin = S.user?.role === 'Admin';

  return `
    <div class="kpi-grid">${kpiHTML}</div>

    ${recallBanner}

    <div class="dash-section-title" style="margin-top:4px">
      <span>📅 ยาหมดอายุรายเดือน (6 เดือนข้างหน้า)</span>
    </div>
    ${renderExpiryChart(all)}

    ${alerts.length ? `
    <div class="dash-section-title" style="margin-top:16px">
      <span>⚠ รายการต้องระวัง</span>
      <span class="dash-section-sub">${alerts.length} รายการ</span>
    </div>
    ${alertListHTML}` : `<div class="empty-state" style="margin-top:12px"><div class="empty-state-icon">✅</div>ยาทุกรายการปลอดภัย</div>`}

    ${lowStockHTML}

    <div class="dash-section-title" style="margin-top:20px"><span>📊 สัดส่วนสถานะยา</span></div>
    ${renderStatusRing(counts, all.length)}

    <div class="dash-action-row">
      <button class="dash-action-btn" id="exportCSVBtn">📥 Export CSV</button>
      ${isAdmin ? `<button class="dash-action-btn dash-action-btn-red" id="addRecallBtn">🚨 เพิ่ม Recall</button>` : ''}
    </div>

    <div style="font-size:11px;color:var(--ink3);text-align:center;margin-top:14px;padding-bottom:16px;font-family:'JetBrains Mono',monospace">
      อัปเดต ${currentTime()} · ${new Date().toLocaleDateString('th-TH-u-ca-gregory', { day:'2-digit', month:'short', year:'numeric' })}
    </div>`;
}

// ── CFG TAB ───────────────────────────────────────────
function renderCfgTab() {
  const s = S.settings;
  const u = S.user;
  const isAdmin = u && u.role === 'Admin';

  const threshRow = (key, color, label) => `
    <div class="thresh-row">
      <div class="thresh-header">
        <span class="thresh-label" style="color:${color}">● ${label}</span>
        <span class="thresh-val">${s[key]||30} วัน</span>
      </div>
      <input class="thresh-slider" type="range" min="7" max="180" value="${s[key]||30}" data-thresh="${key}" style="accent-color:${color}">
    </div>`;

  const auditHTML = S.auditLog.length === 0
    ? `<div class="audit-empty">ยังไม่มีบันทึก — บันทึกเริ่มต้นเมื่อสแกน/ตัดยอด/โอน</div>`
    : S.auditLog.slice(0,20).map(l => {
        const c = {'รับเข้าสต๊อก':'#009E9E','โอนขึ้นจุดบริการ':'#2ee6a6','ลบยา':'#ff4d5e'}[l.action]||'#9d8cff';
        return `<div class="audit-entry">
          <div class="audit-dot" style="background:${c}"></div>
          <div style="flex:1;min-width:0">
            <div class="audit-action" style="color:${c}">${l.action}</div>
            <div class="audit-detail">${l.detail}</div>
          </div>
          <div style="text-align:right;flex-shrink:0">
            <div class="audit-time">${fmtTime(l.ts)}</div>
            <div class="audit-user">${l.user}</div>
          </div>
        </div>`;
      }).join('');

  const userListHTML = isAdmin ? `
    <div style="display:flex;flex-direction:column;gap:8px">
      ${S.users.map(uu => `
        <div class="user-row">
          <div class="user-row-avatar" style="background:linear-gradient(140deg,${uu.color},${uu.color}88)">${uu.name.slice(-1)||'?'}</div>
          <div class="user-row-info">
            <div class="user-row-name">${uu.name}</div>
            <div class="user-row-sub">${uu.role} · PIN: ${'●'.repeat(uu.pin.length)}</div>
          </div>
          <button class="user-edit-btn" data-edituid="${uu.id}">แก้ไข</button>
        </div>`).join('')}
      <button class="add-user-btn" id="addUserBtn"><span style="font-size:16px">➕</span>เพิ่มบัญชีผู้ใช้งาน</button>
    </div>` : '';

  return `
    <div style="padding-bottom:20px">
      <div class="settings-section-label"><span>🎨</span>การแสดงผลและเสียง</div>
      <div class="settings-row">
        <div class="settings-row-left">
          <div class="settings-row-label">โหมดสีหน้าจอ</div>
        </div>
        <div style="display:flex;gap:6px">
          <button class="theme-btn ${S.theme==='light'?'active':'inactive'}" data-theme="light">☀ สว่าง</button>
          <button class="theme-btn ${S.theme==='dark'?'active':'inactive'}" data-theme="dark">🌙 มืด</button>
        </div>
      </div>
      <div class="settings-row">
        <div class="settings-row-left">
          <div class="settings-row-label">เสียงสังเคราะห์ + TTS</div>
          <div class="settings-row-sub">ปิดเมื่ออยู่ในพื้นที่เงียบ</div>
        </div>
        <button class="settings-toggle" id="soundToggle" style="background:${s.soundOn?'#009E9E':'rgba(150,150,160,.35)'}">
          <span class="settings-toggle-thumb" style="left:${s.soundOn?'23px':'3px'}"></span>
        </button>
      </div>
      <div class="settings-row">
        <div class="settings-row-left">
          <div class="settings-row-label">Auto-lock</div>
          <div class="settings-row-sub">${S.autoLockMins} นาที · มาตรฐาน HA</div>
        </div>
        <div style="display:flex;gap:5px;align-items:center">
          ${[2,5,10,30].map(m => `<button class="autolock-btn ${S.autoLockMins===m?'active':'inactive'}" data-lock="${m}">${m}น.</button>`).join('')}
        </div>
      </div>

      ${isAdmin ? `
        <div class="settings-section-label"><span>📊</span>เกณฑ์วันหมดอายุ (Admin)</div>
        <div class="thresh-wrap">
          ${threshRow('threshRed','#ff4d5e','สีแดง — ห้ามใช้')}
          ${threshRow('threshOrange','#ff9f43','สีส้ม — คืนบริษัท')}
          ${threshRow('threshYellow','#ffd23f','สีเหลือง — เฝ้าระวัง')}
        </div>
        <div class="settings-section-label"><span>👤</span>บัญชีผู้ใช้งาน</div>
        ${userListHTML}
      ` : ''}

      <div class="settings-section-label"><span>🤖</span>AI Vision · อ่านฉลากยาอัตโนมัติ</div>
      <div class="settings-row" style="align-items:flex-start;flex-direction:column;gap:6px">
        <div style="display:flex;align-items:center;justify-content:space-between;width:100%">
          <div class="settings-row-left">
            <div class="settings-row-label">Gemini API Key</div>
            <div class="settings-row-sub">ขอฟรีที่ aistudio.google.com/apikey · gemini-2.0-flash-lite</div>
          </div>
          <div style="font-size:11px;font-weight:700;color:${s.geminiKey?'#2ee6a6':'#ff9f43'}">${s.geminiKey?'✓ พร้อมใช้':'ยังไม่ได้ตั้งค่า'}</div>
        </div>
        <input id="geminiKeyInput" type="password" placeholder="AIza..." value="${s.geminiKey||''}"
          style="width:100%;box-sizing:border-box;padding:10px 14px;border-radius:12px;background:var(--card);border:1.5px solid var(--line);color:var(--ink);font-size:12px;font-family:'JetBrains Mono',monospace"
          autocomplete="off" spellcheck="false">
        <div style="font-size:10.5px;color:var(--ink3);line-height:1.5">📷 ใช้ถ่ายรูปยาแล้วได้ชื่อยา/EXP/LOT ครบโดยอัตโนมัติ — ไม่ต้องกรอกเอง</div>
      </div>

      <div class="settings-section-label"><span>📋</span>Audit Log (${S.auditLog.length} รายการ)</div>
      ${auditHTML}

      <div class="settings-section-label"><span>🔔</span>การแจ้งเตือน & แผนก</div>
      <div class="settings-row">
        <div class="settings-row-left">
          <div class="settings-row-label">การแจ้งเตือนระบบ</div>
          <div class="settings-row-sub">แจ้งเตือนยาหมดอายุแม้ปิดแอป</div>
        </div>
        <button class="cfg-action-btn" id="notifPermBtn"
          style="background:${'Notification' in window && Notification.permission==='granted' ? 'rgba(46,230,166,.15)' : 'rgba(157,140,255,.15)'};color:${'Notification' in window && Notification.permission==='granted' ? '#2ee6a6' : '#9d8cff'}">
          ${'Notification' in window && Notification.permission==='granted' ? '✅ เปิดอยู่' : '🔔 เปิดใช้งาน'}
        </button>
      </div>
      <div class="settings-row">
        <div class="settings-row-left">
          <div class="settings-row-label">แผนก (Department)</div>
          <div class="settings-row-sub">สำหรับกรองและบันทึกข้อมูล</div>
        </div>
        <select class="form-select" id="deptSelect" style="width:auto;padding:8px 12px;font-size:12px">
          ${['OPD','IPD','Emergency','OR','Pharmacy'].map(d => `<option value="${d}"${S.dept===d?' selected':''}>${d}</option>`).join('')}
        </select>
      </div>

      <div class="settings-section-label"><span>ℹ</span>เกี่ยวกับระบบ</div>
      <div class="settings-row">
        <div class="settings-row-left">
          <div class="settings-row-label">Drug Safety System</div>
          <div class="settings-row-sub">รพ.กรงปินัง · จ.ยะลา · v2.1</div>
        </div>
        <div style="display:flex;gap:5px">
          <span class="ha-badge">HA</span>
          <span class="jci-badge">JCI</span>
        </div>
      </div>
    </div>`;
}

// ── SHEET ─────────────────────────────────────────────
function renderSheet() {
  if (!S.sheet) return '';
  if (S.sheet === 'notif') return renderNotifSheet();
  return '';
}
function renderNotifSheet() {
  const notifs = getNotifs();
  const items = notifs.length ? notifs.map(n => `
    <div class="notif-item">
      <div class="notif-icon-wrap" style="background:${n.c}22">
        ${shapeIconSVG(n.shape, n.c, 18)}
      </div>
      <div>
        <div class="notif-title">${n.t}</div>
        <div class="notif-detail">${n.d}</div>
      </div>
    </div>`).join('') : `<div class="audit-empty">ไม่มีการแจ้งเตือน</div>`;
  return `
    <div class="overlay sheet-overlay" id="sheetOverlay">
      <div id="sheet-box">
        <div id="sheet-handle"></div>
        <div class="sheet-title" style="margin-bottom:4px">🔔 การแจ้งเตือน</div>
        <div style="font-size:11px;color:var(--ink3);margin-bottom:12px">${notifs.length} รายการ</div>
        ${items}
        <button class="form-submit" style="background:var(--glass);color:var(--ink);border:1px solid var(--glassb);margin-top:10px" id="closeSheetBtn">ปิด</button>
      </div>
    </div>`;
}

// ── CONFIRM ───────────────────────────────────────────
function renderConfirm() {
  if (!S.confirmAction) return '';
  const a = S.confirmAction;
  return `
    <div class="overlay" id="confirmOverlay">
      <div id="confirm-box" style="border:1px solid ${a.danger?'#ff4d5e':'#7c6cff'}55">
        <div style="font-size:34px;text-align:center">${a.icon||'⚠'}</div>
        <div style="font-size:17px;font-weight:700;text-align:center;margin-top:8px;color:var(--ink)">${a.title}</div>
        <div style="font-size:13px;color:var(--ink2);text-align:center;margin-top:6px;line-height:1.5">${a.msg}</div>
        <div style="display:flex;gap:10px;margin-top:20px">
          <button id="confirmCancel" style="flex:1;padding:14px;border-radius:14px;border:1px solid var(--glassb);background:transparent;color:var(--ink);font-size:14px;font-weight:600;cursor:pointer;font-family:'Sarabun',sans-serif">ยกเลิก</button>
          <button id="confirmOk" style="flex:1.3;padding:14px;border-radius:14px;border:none;cursor:pointer;font-size:14px;font-weight:700;font-family:'Sarabun',sans-serif;color:${a.danger?'#fff':'#04140d'};background:${a.danger?'linear-gradient(135deg,#ff4d5e,#c81e2e)':'linear-gradient(135deg,#2ee6a6,#13a37f)'}">${a.ok||'ยืนยัน'}</button>
        </div>
      </div>
    </div>`;
}

// ── MANUAL ENTRY ──────────────────────────────────────
function renderManual() {
  return `
    <div class="manual-screen" id="manualScreen">
      <button class="manual-back" id="manualBackBtn">‹ ยกเลิก</button>
      <div class="manual-title">กรอกข้อมูลยา</div>
      <div class="manual-sub">กรอกข้อมูลด้วยตนเอง เมื่อไม่สามารถสแกนได้</div>
      <div class="form-field">
        <label class="form-label">ชื่อยา <span style="color:#ff4d5e">*</span></label>
        <input class="form-input" id="mName" placeholder="เช่น Paracetamol 500mg">
      </div>
      <div class="form-field">
        <label class="form-label">Generic</label>
        <input class="form-input" id="mGen" placeholder="เช่น Acetaminophen">
      </div>
      <div class="form-grid-2">
        <div class="form-field">
          <label class="form-label">Lot No. <span style="color:#ff4d5e">*</span></label>
          <input class="form-input" id="mLot" placeholder="เช่น PC0021">
        </div>
        <div class="form-field">
          <label class="form-label">จำนวน</label>
          <input class="form-input" id="mQty" type="number" placeholder="60">
        </div>
      </div>
      <div class="form-field">
        <label class="form-label">วันหมดอายุ <span style="color:#ff4d5e">*</span></label>
        <input class="form-input" id="mExp" type="date">
      </div>
      <div class="form-field">
        <label class="form-label">ตำแหน่ง</label>
        <select class="form-select" id="mLoc">
          <option value="SUBSTOCK">📦 SUBSTOCK — คลัง</option>
          <option value="FRONT_SHELF">🛎 FRONT SHELF — หน้าเคาน์เตอร์</option>
        </select>
      </div>
      <div style="display:flex;gap:8px">
        <div class="form-field" style="flex:1">
          <label style="display:flex;align-items:center;gap:6px">
            <input type="checkbox" id="mHighAlert" style="accent-color:#ff4d5e">
            <span class="form-label" style="margin:0">HIGH-ALERT</span>
          </label>
        </div>
        <div class="form-field" style="flex:1">
          <label style="display:flex;align-items:center;gap:6px">
            <input type="checkbox" id="mCold" style="accent-color:#38bdf8">
            <span class="form-label" style="margin:0">❄ Cold Chain</span>
          </label>
        </div>
      </div>
      <button class="form-submit" id="manualSubmitBtn">✓ บันทึกยา</button>
    </div>`;
}

// ── BIND EVENTS ───────────────────────────────────────
function bindLock() {
  // Profile picker
  document.querySelectorAll('.profile-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const u = S.users.find(x => x.id === btn.dataset.uid);
      if (!u) return;
      vibrate(8);
      S.pendingUser = u;
      S.loginStep = 'pin';
      S.pin = ''; S.pinErr = false;
      renderScreen();
    });
  });

  // Face ID
  const faceMain = document.getElementById('faceBtnMain');
  if (faceMain) faceMain.addEventListener('click', startFace);

  // PIN
  const pinBack = document.getElementById('pinBack');
  if (pinBack) pinBack.addEventListener('click', () => {
    S.loginStep = 'profiles'; S.pin = ''; S.pinErr = false;
    renderScreen();
  });
  document.querySelectorAll('.pin-key[data-key]').forEach(k => {
    k.addEventListener('click', () => pinPress(k.dataset.key));
  });
  const pinDel = document.getElementById('pinDel');
  if (pinDel) pinDel.addEventListener('click', () => pinPress('del'));
  const pinFaceBtn = document.getElementById('pinFaceBtn');
  if (pinFaceBtn) pinFaceBtn.addEventListener('click', startFace);

  // Face cancel
  const faceCancelBtn = document.getElementById('faceCancelBtn');
  if (faceCancelBtn) faceCancelBtn.addEventListener('click', cancelFace);

  // Secondary
  const lockScanBadge = document.getElementById('lockScanBadge');
  if (lockScanBadge) lockScanBadge.addEventListener('click', () => showToast('📷 เปิดกล้องสแกนป้ายชื่อ… (จำลอง)', '#7c6cff'));
  const lockPasskey = document.getElementById('lockPasskey');
  if (lockPasskey) lockPasskey.addEventListener('click', () => {
    vibrate([6,40,6]);
    showToast('🔐 ยืนยันด้วย Passkey (จำลอง)', '#2dd4bf');
    setTimeout(() => doLogin(S.users[0]), 900);
  });
}

function bindApp() {
  // Nav tabs
  document.querySelectorAll('.nav-tab[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      vibrate(6); sfx('tick');
      if (btn.dataset.tab !== 'scan') {
        if (S.cameraActive) stopCamera();
        closePhotoCap(true); // stop photo camera stream when leaving scan tab
      }
      S.tab = btn.dataset.tab;
      renderAppBody(); updateNavTabs();
    });
  });

  // Topbar
  document.getElementById('notifBtn')?.addEventListener('click', () => {
    vibrate(6); S.sheet = 'notif'; renderAppBody(); updateNavTabs();
  });
  document.getElementById('lockBtn')?.addEventListener('click', () => {
    if (S.cameraActive) stopCamera();
    closePhotoCap(true);
    try { localStorage.removeItem('session'); } catch(e) {}
    S.screen = 'lock'; S.user = null; S.loginStep = 'profiles'; renderScreen();
  });
  document.getElementById('cmdBtn')?.addEventListener('click', () => openCmdPalette());
  document.getElementById('focusChipBtn')?.addEventListener('click', () => toggleFocusMode());

  // Swipe-down from top to open command palette
  let _swipeY0 = 0;
  const appScr = document.getElementById('app-screen');
  if (appScr) {
    appScr.addEventListener('touchstart', e => { _swipeY0 = e.touches[0]?.clientY || 0; }, { passive: true });
    appScr.addEventListener('touchend', e => {
      const dy = (e.changedTouches[0]?.clientY || 0) - _swipeY0;
      if (dy > 70 && _swipeY0 < 130 && !S.cmdPaletteOpen) openCmdPalette();
    }, { passive: true });
  }

  // Keyboard shortcut: Ctrl+K / Cmd+K
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); openCmdPalette(); }
    if (e.key === 'Escape' && S.cmdPaletteOpen) closeCmdPalette();
  });

  // Stress-aware tap logging
  document.addEventListener('pointerdown', detectStress, { passive: true });

  bindTabEvents();
  bindSheetEvents();
  bindConfirmEvents();
}

function bindTabEvents() {
  if (S.tab === 'scan') bindScanTab();
  else if (S.tab === 'stock') bindStockTab();
  else if (S.tab === 'dash') bindDashTab();
  else if (S.tab === 'cfg') bindCfgTab();
  initLongPress();
}

function bindDashTab() {
  document.getElementById('exportCSVBtn')?.addEventListener('click', () => exportCSV());
  document.getElementById('addRecallBtn')?.addEventListener('click', () => showAddRecallModal());
}

function bindScanTab() {
  document.querySelectorAll('.dest-btn[data-dest]').forEach(btn => {
    btn.addEventListener('click', () => {
      vibrate(7); sfx('tick');
      S.scanDest = btn.dataset.dest;
      S.scanResult = null; S.scanState = 'idle';
      updateTabBody();
    });
  });

  document.querySelectorAll('.scan-format-chip[data-fmt]').forEach(chip => {
    chip.addEventListener('click', () => {
      vibrate(5); S.scanFormat = chip.dataset.fmt;
      document.querySelectorAll('.scan-format-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      showToast(`📡 ${S.scanFormat}`, '#009E9E');
    });
  });

  const barcodeInputBtn = document.getElementById('barcodeInputBtn');
  if (barcodeInputBtn) barcodeInputBtn.addEventListener('click', openBarcodeInputSheet);

  const camToggle = document.getElementById('camToggleBtn');
  if (camToggle) camToggle.addEventListener('click', toggleCamera);

  const manualEntry = document.getElementById('manualEntryBtn');
  if (manualEntry) manualEntry.addEventListener('click', () => {
    S.manualOpen = true; renderScreen();
  });
  const rapidToggle = document.getElementById('rapidToggle');
  if (rapidToggle) rapidToggle.addEventListener('click', () => {
    vibrate(8);
    if (S.rapidMode && S.batchSession && S.batchSession.items.length > 0) {
      // Ending rapid mode — show batch summary
      setTimeout(() => showBatchSummary(), 300);
    }
    S.rapidMode = !S.rapidMode; S.scanCount = 0;
    if (!S.rapidMode) S.batchSession = null;
    updateTabBody();
  });
  const resetRapid = document.getElementById('resetRapidBtn');
  if (resetRapid) resetRapid.addEventListener('click', () => {
    vibrate(8); S.scanCount = 0; S.scanResult = null;
    showToast('↻ เริ่มนับใหม่', '#7c6cff');
    updateTabBody();
  });
  const accept = document.getElementById('acceptScanBtn');
  if (accept) accept.addEventListener('click', acceptScan);
  const reject = document.getElementById('rejectScanBtn');
  if (reject) reject.addEventListener('click', () => {
    S.scanState = 'idle'; S.scanResult = null; updateTabBody();
  });
  const voiceBtn = document.getElementById('voiceBtn');
  if (voiceBtn) voiceBtn.addEventListener('click', toggleVoice);

  const ocrBtn = document.getElementById('ocrCaptureBtn');
  const ocrFile = document.getElementById('ocrFileInput');
  if (ocrBtn && ocrFile) {
    ocrBtn.addEventListener('click', () => ocrFile.click());
    ocrFile.addEventListener('change', () => {
      if (ocrFile.files && ocrFile.files[0]) handleOCRFile(ocrFile.files[0]);
      ocrFile.value = '';
    });
  }

  const photoBtn = document.getElementById('photoScanBtn');
  const photoInput = document.getElementById('photoScanInput');
  if (photoBtn && photoInput) {
    // Primary: open in-app camera; fallback: file input (if no getUserMedia)
    photoBtn.addEventListener('click', () => {
      if (navigator.mediaDevices?.getUserMedia) { openPhotoCap(); }
      else { photoInput.click(); }
    });
    photoInput.addEventListener('change', () => {
      if (photoInput.files && photoInput.files[0]) handlePhotoScan(photoInput.files[0]);
      photoInput.value = '';
    });
  }

  const namePhotoBtn = document.getElementById('namePhotoBtn');
  const namePhotoInput = document.getElementById('namePhotoInput');
  if (namePhotoBtn && namePhotoInput) {
    namePhotoBtn.addEventListener('click', () => namePhotoInput.click());
    namePhotoInput.addEventListener('change', () => {
      if (namePhotoInput.files && namePhotoInput.files[0]) handleNamePhoto(namePhotoInput.files[0]);
      namePhotoInput.value = '';
    });
  }
}

function toggleVoice() {
  vibrate(8);
  S.voiceActive = !S.voiceActive;
  updateTabBody();
  if (S.voiceActive) {
    showToast('🎤 Voice Command ยังไม่รองรับในรุ่นนี้ — ใช้ปุ่มกรอกบาร์โค้ดแทน', '#7c6cff');
    setTimeout(() => {
      if (S.voiceActive) { S.voiceActive = false; updateTabBody(); }
    }, 3000);
  }
}

function toggleCamera() {
  if (S.cameraActive) { stopCamera(); return; }
  vibrate(8);
  if (!navigator.mediaDevices?.getUserMedia) {
    showToast('📵 เบราว์เซอร์นี้ไม่รองรับกล้อง', '#ff9f43'); return;
  }
  S.cameraActive = true;
  updateTabBody();
  setTimeout(() => {
    const container = document.getElementById('camContainer');
    if (!container) { S.cameraActive = false; updateTabBody(); return; }
    container.innerHTML = '';
    container.style.zIndex = '2'; // lift above scan-ai-grid (z:1) so video is visible
    const v = document.createElement('video');
    v.id = 'pc-scanvid'; v.autoplay = true; v.muted = true; v.playsInline = true;
    v.setAttribute('playsinline', ''); // belt-and-suspenders for iOS Safari
    v.style.cssText = 'width:100%;height:100%;object-fit:cover;position:absolute;inset:0;border-radius:inherit;z-index:0';
    container.appendChild(v);
    startZXingScanner(v);
  }, 150);
}

function stopCamera() {
  if (_zxingReader) {
    try { _zxingReader.reset(); } catch(e) {}
    _zxingReader = null;
  }
  if (_barcodeLoop) { clearInterval(_barcodeLoop); _barcodeLoop = null; }
  if (S.cameraStream) {
    try { S.cameraStream.getTracks().forEach(t => t.stop()); } catch(e) {}
    S.cameraStream = null;
  }
  _lastScanMs = 0;
  S.cameraActive = false;
  S.scanState = 'idle';
  updateTabBody();
  showToast('📷 ปิดกล้องแล้ว', '#ff9f43');
}

// ── OCR AUTO-FILL ─────────────────────────────────────
let _autoSaveTimer = null;
function _startAutoSave(delay = 2) {
  clearTimeout(_autoSaveTimer);
  if (!S.scanResult) return;
  let cnt = delay;
  const btn = document.getElementById('acceptScanBtn');
  if (btn) btn.classList.add('ai-ready');
  function tick() {
    if (!S.scanResult) { if (btn) btn.classList.remove('ai-ready'); return; }
    if (cnt <= 0) { if (btn) btn.classList.remove('ai-ready'); acceptScan(); return; }
    showToast(`✅ AI อ่านครบ — บันทึกใน ${cnt} วิ · แตะเพื่อยกเลิก`, '#2ee6a6', 950);
    cnt--;
    _autoSaveTimer = setTimeout(tick, 1000);
  }
  tick();
  const card = document.querySelector('.scan-result-card');
  if (card) card.addEventListener('pointerdown', () => {
    clearTimeout(_autoSaveTimer); _autoSaveTimer = null;
    if (btn) btn.classList.remove('ai-ready');
  }, { once: true });
}

let _tesseract = null;
async function _loadTesseract() {
  if (_tesseract) return _tesseract;
  if (window.Tesseract) { _tesseract = window.Tesseract; return _tesseract; }
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
    s.onload = () => { _tesseract = window.Tesseract; resolve(_tesseract); };
    s.onerror = () => reject(new Error('Tesseract load failed'));
    document.head.appendChild(s);
  });
}

async function preprocessImage(file) {
  return new Promise(resolve => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const MAX = 2400;
      const scale = Math.min(1, MAX / Math.max(img.width, img.height));
      const W = Math.round(img.width * scale);
      const H = Math.round(img.height * scale);
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, W, H);
      const id = ctx.getImageData(0, 0, W, H);
      const d = id.data;
      for (let i = 0; i < d.length; i += 4) {
        const g = Math.round(0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2]);
        const c = Math.min(255, Math.max(0, (g - 128) * 1.8 + 128));
        d[i] = d[i+1] = d[i+2] = c; d[i+3] = 255;
      }
      ctx.putImageData(id, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob(b => resolve(b || file), 'image/png');
    };
    img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
    img.src = url;
  });
}

async function handleOCRFile(file) {
  if (!file) return;
  const hasGemini = !!(S.settings.geminiKey || localStorage.getItem('geminiKey'));
  const btn = document.getElementById('ocrCaptureBtn');
  showToast(hasGemini ? '🤖 AI กำลังอ่านฉลากยา...' : '🔍 กำลังอ่านข้อมูลยา...', '#7c6cff');
  if (btn) { btn.innerHTML = '<span style="font-size:14px">⏳</span> กำลังอ่าน...'; btn.disabled = true; }
  try {
    let parsed = {};

    if (hasGemini) {
      const g = await analyzeWithGemini(file);
      if (g) parsed = g;
    }

    // Fallback to Tesseract if Gemini not configured or returned nothing useful
    if (!parsed.expiry && !parsed.lot) {
      const processed = await preprocessImage(file);
      const T = await _loadTesseract();
      const worker = await T.createWorker(['eng', 'tha']);
      await worker.setParameters({ tessedit_pageseg_mode: '11' });
      const { data: { text } } = await worker.recognize(processed);
      await worker.terminate();
      const ocrParsed = parseOCRText(text);
      if (!parsed.name    && ocrParsed.name) parsed.name    = ocrParsed.name;
      if (!parsed.expiry  && ocrParsed.exp)  parsed.expiry  = ocrParsed.exp;
      if (!parsed.mfd     && ocrParsed.mfd)  parsed.mfd     = ocrParsed.mfd;
      if (!parsed.lot     && ocrParsed.lot)  parsed.lot     = ocrParsed.lot;
    }

    let filled = 0;
    const set = (id, val) => {
      const el = document.getElementById(id);
      if (el && val) { el.value = val; el.classList.add('ai-filled'); filled++; }
    };
    const setIfEmpty = (id, val) => {
      const el = document.getElementById(id);
      if (el && val && !el.value) { el.value = val; el.classList.add('ai-filled'); filled++; }
    };

    setIfEmpty('newDrugName', parsed.name);
    setIfEmpty('newDrugGen',  parsed.generic);
    set('ean13Expiry', parsed.expiry);
    set('ean13Mfd',    parsed.mfd);
    setIfEmpty('ean13Lot', parsed.lot);

    if (filled > 0) {
      vibrate([8, 30, 8]); sfx('success');
      const expVal = document.getElementById('ean13Expiry')?.value;
      const nameOk = !!(S.scanResult?.name || document.getElementById('newDrugName')?.value?.trim());
      if (expVal && nameOk && S.scanResult) {
        _startAutoSave();
      } else {
        showToast(`✓ AI อ่านได้ ${filled} ช่อง — ตรวจสอบก่อนยืนยัน`, '#2ee6a6');
      }
    } else {
      showToast('⚠ อ่านไม่พบข้อมูล — ถ่ายให้ชัดขึ้นหรือกรอกเอง', '#ff9f43');
    }
  } catch(e) {
    console.warn('OCR error:', e);
    const isKey = /API_KEY|400|403|invalid/i.test(e.message || '');
    showToast(isKey ? '⚠ Gemini API Key ไม่ถูกต้อง — ตั้งค่าที่แท็บ ⚙' : '⚠ อ่านไม่สำเร็จ — กรุณากรอกเอง', '#ff4d5e');
  } finally {
    if (btn) { btn.innerHTML = '🤖 ถ่ายรูปกล่องยา — AI อ่านอัตโนมัติ'; btn.disabled = false; }
  }
}

// ── IN-APP CAMERA CAPTURE ─────────────────────────────
// Stays open between shots in rapid mode — no camera init latency
let _pcStream = null;       // MediaStream
let _pcAnimFrame = null;    // rAF for stability detection
let _pcAutoLock = false;    // prevent double-trigger of auto-capture

function openPhotoCap() {
  if (document.getElementById('photoCap')) return; // already open
  if (!navigator.mediaDevices?.getUserMedia) {
    document.getElementById('photoScanInput')?.click();
    return;
  }
  if (!S.settings.geminiKey && !localStorage.getItem('geminiKey')) {
    showToast('ตั้งค่า Gemini API Key ก่อนใช้กล้อง AI (แท็บ ⚙ ตั้งค่า)', '#ff9f43', 3500);
    return;
  }
  const overlay = document.createElement('div');
  overlay.id = 'photoCap';
  overlay.className = 'pcap-overlay';
  overlay.innerHTML = `
    <div class="pcap-header">
      <button class="pcap-close-btn" id="pcapClose" aria-label="ปิด">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
      </button>
      <div class="pcap-header-text">
        <div class="pcap-title">📷 ถ่ายฉลากยา</div>
        <div class="pcap-sub">เล็งด้านที่มีชื่อยาให้ชัด · แตะปุ่มกล้องหรือหน้าจอเพื่อถ่าย</div>
      </div>
      <button class="pcap-torch-btn" id="pcapTorch" style="display:none" aria-label="ไฟฉาย">🔦</button>
    </div>

    <div class="pcap-viewfinder" id="pcapVF">
      <video id="pcapVideo" autoplay muted playsinline style="width:100%;height:100%;object-fit:cover"></video>
      <canvas id="pcapStabCanvas" width="64" height="36" style="display:none"></canvas>

      <!-- Corner brackets -->
      <div class="pcap-corner pcap-tl"></div>
      <div class="pcap-corner pcap-tr"></div>
      <div class="pcap-corner pcap-bl"></div>
      <div class="pcap-corner pcap-br"></div>

      <!-- Stability pill -->
      <div class="pcap-stab-pill" id="pcapStabPill">
        <div class="pcap-stab-dot" id="pcapStabDot"></div>
        <span id="pcapStabTxt">กำลังเปิดกล้อง...</span>
      </div>

      <!-- Flash overlay -->
      <div id="pcapFlash" style="position:absolute;inset:0;background:#fff;opacity:0;pointer-events:none;transition:opacity .12s"></div>
    </div>

    <div class="pcap-footer">
      <button class="pcap-gallery-btn" id="pcapGallery" title="เลือกจากอัลบั้ม">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="6" width="20" height="14" rx="2"/><path d="M16 2h4l-4 4H4l4-4h8z"/></svg>
      </button>
      <button class="pcap-shutter" id="pcapShutter" aria-label="ถ่ายภาพ">
        <div class="pcap-shutter-ring"></div>
        <div class="pcap-shutter-dot"></div>
      </button>
      <button class="pcap-auto-btn${S.autoCapture ? ' active' : ''}" id="pcapAutoBtn" title="Auto-Capture">
        AUTO
      </button>
    </div>
    <input type="file" id="pcapGalleryInput" accept="image/*" style="display:none">
  `;
  document.body.appendChild(overlay);

  // Event bindings
  document.getElementById('pcapClose').addEventListener('click', () => closePhotoCap(true));
  document.getElementById('pcapShutter').addEventListener('click', captureFromCam);
  document.getElementById('pcapVF').addEventListener('click', e => {
    if (e.target.closest('button')) return;
    captureFromCam();
  });
  document.getElementById('pcapAutoBtn').addEventListener('click', e => {
    e.stopPropagation();
    S.autoCapture = !S.autoCapture;
    e.currentTarget.classList.toggle('active', S.autoCapture);
    showToast(S.autoCapture ? '🤖 Auto-Capture เปิด — นิ่งกล้องแล้วถ่ายอัตโนมัติ' : 'Auto-Capture ปิด', '#7c6cff', 1800);
  });
  const galleryBtn = document.getElementById('pcapGallery');
  const galleryInput = document.getElementById('pcapGalleryInput');
  galleryBtn.addEventListener('click', e => { e.stopPropagation(); galleryInput.click(); });
  galleryInput.addEventListener('change', () => {
    if (galleryInput.files?.[0]) {
      closePhotoCap(true);
      handlePhotoScan(galleryInput.files[0]);
      galleryInput.value = '';
    }
  });

  _startPhotoCam();
}

async function _startPhotoCam() {
  try {
    _pcStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
    });
    const video = document.getElementById('pcapVideo');
    if (!video) { closePhotoCap(true); return; }
    video.srcObject = _pcStream;
    await video.play();

    // Enable continuous autofocus if supported
    const track = _pcStream.getVideoTracks()[0];
    const caps = track.getCapabilities?.() || {};
    if (caps.focusMode?.includes?.('continuous')) {
      track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }).catch(() => {});
    }

    // Torch button
    if (caps.torch) {
      const tBtn = document.getElementById('pcapTorch');
      if (tBtn) {
        tBtn.style.display = 'flex';
        let torchOn = false;
        tBtn.addEventListener('click', e => {
          e.stopPropagation();
          torchOn = !torchOn;
          track.applyConstraints({ advanced: [{ torch: torchOn }] }).catch(() => {});
          tBtn.textContent = torchOn ? '🔆' : '🔦';
          tBtn.classList.toggle('active', torchOn);
        });
      }
    }

    _startStabilityLoop(video);
  } catch(e) {
    console.warn('Camera error:', e);
    closePhotoCap(true);
    showToast('⚠ ไม่สามารถเปิดกล้องได้ — ใช้ไฟล์แทน', '#ff9f43', 2500);
    document.getElementById('photoScanInput')?.click();
  }
}

function _startStabilityLoop(video) {
  const canvas = document.getElementById('pcapStabCanvas');
  const dot = document.getElementById('pcapStabDot');
  const txt = document.getElementById('pcapStabTxt');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let prev = null;
  let stableN = 0;

  function frame() {
    if (!_pcStream || !video.videoWidth) { _pcAnimFrame = requestAnimationFrame(frame); return; }
    ctx.drawImage(video, 0, 0, 64, 36);
    const curr = ctx.getImageData(0, 0, 64, 36).data;
    if (prev) {
      let diff = 0;
      for (let i = 0; i < curr.length; i += 4)
        diff += Math.abs(curr[i] - prev[i]) + Math.abs(curr[i+1] - prev[i+1]) + Math.abs(curr[i+2] - prev[i+2]);
      const motion = diff / (64 * 36 * 3); // 0-255 per pixel
      stableN = motion < 6 ? Math.min(stableN + 1, 12) : Math.max(stableN - 2, 0);
      const stable = stableN >= 8; // ~0.8s at 10fps sampling
      const almostStable = stableN >= 4;
      if (dot) dot.style.background = stable ? '#2ee6a6' : almostStable ? '#ffd23f' : '#ff4d5e';
      if (txt) txt.textContent = stable ? 'นิ่งแล้ว ✓' : almostStable ? 'กำลังนิ่ง...' : 'ถือนิ่งๆ';
      if (stable && S.autoCapture && !_pcAutoLock) {
        _pcAutoLock = true;
        setTimeout(() => { captureFromCam(); setTimeout(() => { _pcAutoLock = false; }, 2500); }, 200);
      }
    }
    prev = new Uint8ClampedArray(curr);
    _pcAnimFrame = requestAnimationFrame(frame);
  }
  _pcAnimFrame = requestAnimationFrame(frame);
}

async function captureFromCam() {
  const video = document.getElementById('pcapVideo');
  if (!video || !video.videoWidth) return;

  // Flash
  const flash = document.getElementById('pcapFlash');
  if (flash) { flash.style.opacity = '1'; setTimeout(() => flash.style.opacity = '0', 140); }
  vibrate([10]);

  // Capture frame → compress directly from canvas (no File/Blob overhead)
  const canvas = document.createElement('canvas');
  canvas.width  = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);

  // Show processing state on viewfinder
  const vf = document.getElementById('pcapVF');
  if (vf) vf.setAttribute('data-processing', '1');
  const shutter = document.getElementById('pcapShutter');
  if (shutter) { shutter.disabled = true; shutter.style.opacity = '.4'; }

  if (!S.rapidMode) {
    closePhotoCap(false); // keep stream alive in case rapid mode is toggled
  }

  const b64 = await compressForAI(canvas);
  await _processDrugPhoto(b64, /* fromCam */ true);

  // Restore camera UI (rapid mode: stays open)
  if (vf) vf.removeAttribute('data-processing');
  if (shutter) { shutter.disabled = false; shutter.style.opacity = ''; }
}

function closePhotoCap(stopStream) {
  cancelAnimationFrame(_pcAnimFrame); _pcAnimFrame = null;
  if (stopStream && _pcStream) {
    _pcStream.getTracks().forEach(t => t.stop());
    _pcStream = null;
  }
  document.getElementById('photoCap')?.remove();
}

// ── CORE DRUG PHOTO PROCESSING (shared by camera + file input) ────
async function _processDrugPhoto(input, fromCam = false) {
  const t0 = Date.now();
  try {
    const data = await analyzeWithGemini(input);
    if (!data || (!data.name && !data.expiry && !data.lot)) {
      showToast('⚠ AI อ่านไม่พบข้อมูล — ถ่ายด้านที่มีชื่อยา ไม่มีแสงสะท้อน', '#ff9f43');
      return;
    }
    const exp = data.expiry ? new Date(data.expiry) : null;
    const mfd = data.mfd    ? new Date(data.mfd)    : null;
    const byGtin = data.gtin ? S.items.find(i => i.gtin === data.gtin || i.barcode === data.gtin) : null;
    const byName = !byGtin && data.name ? S.items.find(i => i.name?.toLowerCase() === data.name?.toLowerCase()) : null;
    const existing = byGtin || byName;
    const result = {
      name:      data.name     || existing?.name || '',
      gen:       data.generic  || existing?.gen  || '',
      strength:  data.strength || existing?.strength || '',
      gtin:      data.gtin     || existing?.gtin || '',
      barcode:   data.gtin     || existing?.gtin || '',
      lot:       data.lot || '',
      exp, mfd,
      qty:       1,
      dest:      S.scanDest,
      highAlert: existing?.highAlert || false,
      lasa:      existing?.lasa      || false,
      cold:      existing?.cold      || false,
      _fromScan: true, _fromAI: true,
      isNew:        !existing && !data.name,
      needsExpiry:  !exp || !data.lot,
      _missingName: !data.name && !!(data.lot || data.expiry),
    };
    S.scanResult = result;
    S.scanState = 'detected';
    S.aiConf = 99;
    handoffWrite(result, itemStatus(result.needsExpiry ? { ...result, exp: new Date(Date.now() + 365*86400000) } : result));
    bumpStreak(); detectStress();
    vibrate([8, 40, 12]);

    const gotFields = [data.name, data.lot, data.expiry, data.mfd].filter(Boolean);
    const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
    if (gotFields.length >= 3) {
      showToast(`✅ AI อ่านได้ ${gotFields.length} ช่อง · ${elapsed}s`, '#2ee6a6', 2200);
    } else {
      showToast(`🤖 AI อ่านได้ ${gotFields.length} ช่อง — กรอกส่วนที่เหลือ`, '#ff9f43');
    }

    // If in-app camera is open and rapid mode, close cam now (we have result)
    if (fromCam && !S.rapidMode) closePhotoCap(true);

    updateTabBody();
    requestAnimationFrame(() => {
      document.querySelector('.scan-result-card')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      setTimeout(() => {
        if (result.needsExpiry) { document.getElementById('ocrCaptureBtn')?.focus(); return; }
        (document.getElementById('newDrugName') || document.getElementById('ean13Expiry'))?.focus();
      }, 80);
      if (!result.needsExpiry && result.name) setTimeout(() => _startAutoSave(2), 400);
    });
  } catch(e) {
    console.warn('Photo scan error:', e);
    const isKey = /API_KEY|400|403|invalid/i.test(e.message || '');
    showToast(isKey ? '⚠ Gemini API Key ไม่ถูกต้อง — ตั้งค่าที่แท็บ ⚙' : '⚠ AI อ่านไม่สำเร็จ — ลองอีกครั้ง', '#ff4d5e');
  }
}

async function handleNamePhoto(file) {
  if (!file) return;
  const btn = document.getElementById('namePhotoBtn');
  if (btn) { btn.disabled = true; btn.style.opacity = '.6'; }
  showToast('🤖 AI กำลังอ่านชื่อยา...', '#7c6cff');
  try {
    const data = await analyzeWithGemini(file);
    if (!data || !data.name) {
      showToast('⚠ ยังไม่เจอชื่อยา — ลองถ่ายให้เห็นชื่อยาชัดขึ้น แสงพอ ไม่สะท้อน', '#ff9f43');
      return;
    }
    if (S.scanResult) {
      S.scanResult.name = data.name;
      S.scanResult.gen = data.generic || S.scanResult.gen || '';
      S.scanResult._missingName = false;
    }
    const nameEl = document.getElementById('newDrugName');
    const genEl  = document.getElementById('newDrugGen');
    if (nameEl) { nameEl.value = data.name; nameEl.classList.add('ai-filled'); }
    if (genEl && data.generic) { genEl.value = data.generic; genEl.classList.add('ai-filled'); }
    showToast(`✅ AI อ่านชื่อยา: ${data.name}`, '#2ee6a6');
    const row = document.querySelector('.name-photo-row');
    if (row) row.style.display = 'none';
    if (!S.scanResult?.needsExpiry) _startAutoSave();
  } catch(e) {
    console.warn('Name photo error:', e);
    showToast('⚠ AI อ่านไม่สำเร็จ — ลองอีกครั้ง', '#ff4d5e');
  } finally {
    if (btn) { btn.disabled = false; btn.style.opacity = ''; }
  }
}

const HERO_BTN_DEFAULT_HTML = `<div class="hero-photo-icon-wrap"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></div><div class="hero-photo-text"><div class="hero-photo-title">ถ่ายภาพฉลากยา</div><div class="hero-photo-sub">AI อ่าน ชื่อยา · EXP · LOT · วันผลิต ครบในภาพเดียว</div></div><svg class="hero-photo-arrow" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.7)" stroke-width="2.5" stroke-linecap="round"><path d="M5 12h14M12 5l7 7-7 7"/></svg>`;

// handlePhotoScan — called when photo comes from file input (gallery/system camera fallback)
async function handlePhotoScan(file) {
  if (!file) return;
  const hasGemini = !!(S.settings.geminiKey || localStorage.getItem('geminiKey'));
  if (!hasGemini) { showToast('ตั้งค่า Gemini API Key ก่อน (แท็บ ⚙ ตั้งค่า)', '#ff9f43'); return; }
  const btn = document.getElementById('photoScanBtn');
  const previewUrl = URL.createObjectURL(file);
  if (btn) {
    btn.innerHTML = `<div class="hero-photo-icon-wrap" style="padding:0;overflow:hidden;border-radius:10px;width:52px;height:52px"><img src="${previewUrl}" style="width:100%;height:100%;object-fit:cover"></div><div class="hero-photo-text"><div class="hero-photo-title" style="display:flex;align-items:center;gap:7px"><span class="ai-spinner"></span>AI กำลังอ่าน...</div><div class="hero-photo-sub">กำลังบีบอัดและวิเคราะห์</div></div>`;
    btn.disabled = true; btn.style.animation = 'none'; btn.style.opacity = '.88';
  }
  try {
    await _processDrugPhoto(file, false);
  } finally {
    URL.revokeObjectURL(previewUrl);
    if (btn) { btn.innerHTML = HERO_BTN_DEFAULT_HTML; btn.disabled = false; btn.style.animation = ''; btn.style.opacity = ''; }
  }
}

function parseOCRText(raw) {
  // Normalize: Thai digits → Arabic, OCR confusion, Buddhist Era → CE
  const text = raw
    .replace(/[๐-๙]/g, d => String.fromCharCode(d.charCodeAt(0) - 0x0E50 + 48))
    .replace(/(?<![A-Za-z])O(?![A-Za-z])/g, '0')
    .replace(/(?<![A-Za-z])l(?![A-Za-z])/g, '1')
    .replace(/\b(25[6-9]\d)\b/g, m => String(parseInt(m) - 543)); // พ.ศ. → ค.ศ.

  const ENG_MONTHS = {JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12'};
  const THAI_MONTHS = {
    'ม.ค':'01','ก.พ':'02','มี.ค':'03','เม.ย':'04','พ.ค':'05','มิ.ย':'06',
    'ก.ค':'07','ส.ค':'08','ก.ย':'09','ต.ค':'10','พ.ย':'11','ธ.ค':'12',
    'มกราคม':'01','กุมภาพันธ์':'02','มีนาคม':'03','เมษายน':'04',
    'พฤษภาคม':'05','มิถุนายน':'06','กรกฎาคม':'07','สิงหาคม':'08',
    'กันยายน':'09','ตุลาคม':'10','พฤศจิกายน':'11','ธันวาคม':'12',
  };

  function toIso(str) {
    let m;
    // DD/MM/YYYY or DD-MM-YYYY
    m = str.match(/\b(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](20\d{2})\b/);
    if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
    // MM/YYYY or MM-YYYY (month ≤ 12)
    m = str.match(/\b(0?[1-9]|1[0-2])[\/\-](20\d{2})\b/);
    if (m) return `${m[2]}-${m[1].padStart(2,'0')}-01`;
    // YYYY/MM or YYYY-MM
    m = str.match(/\b(20\d{2})[\/\-](0?[1-9]|1[0-2])\b/);
    if (m) return `${m[1]}-${m[2].padStart(2,'0')}-01`;
    // MMM YYYY — English (APR 2025, APR. 2025, APR2025)
    m = str.match(/\b([A-Z]{3})\.?\s*(20\d{2})\b/i);
    if (m) { const mo = ENG_MONTHS[m[1].toUpperCase()]; if (mo) return `${m[2]}-${mo}-01`; }
    // Thai month names (ก.พ. 2568 already converted to 2025)
    for (const [th, mo] of Object.entries(THAI_MONTHS)) {
      const tm = str.match(new RegExp(th + '[ุ\\.]?[\\s]*(20\\d{2})'));
      if (tm) return `${tm[1]}-${mo}-01`;
    }
    // Bare 4-digit year only (last resort)
    m = str.match(/\b(20\d{2})\b/);
    if (m) return `${m[1]}-01-01`;
    return null;
  }

  const result = {};
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const u = line.toUpperCase();
    if (!result.exp && /\bEXP\.?(?:\s*DATE)?\b|USE\s+BEFORE|หมดอายุ|ใช้ก่อน/.test(u)) {
      const d = toIso(line); if (d) result.exp = d;
    }
    if (!result.mfd && /\bMF[GD]\.?\b|MANUFACTURED|วันผลิต|ผลิตวันที่/.test(u)) {
      const d = toIso(line); if (d) result.mfd = d;
    }
    if (!result.lot && /\bLOT\.?(?:\s*NO\.?)?\b|\bBATCH\.?(?:\s*NO\.?)?\b|\bL\/N\b|\bB\.?N\b/.test(u)) {
      const m = line.match(/(?:LOT\.?(?:\s*NO\.?)?|BATCH\.?(?:\s*NO\.?)?|L\/N|B\.?N)[:\s]*([A-Z0-9\-]{3,25})/i);
      if (m) result.lot = m[1].trim();
    }
  }
  // Second pass: scan for inline patterns in case keyword and date are on same line
  if (!result.exp) { const m = text.match(/EXP\.?[:\s]*([^\n]{4,25})/i); if (m) { const d = toIso(m[1]); if (d) result.exp = d; } }
  if (!result.mfd) { const m = text.match(/MF[GD]\.?[:\s]*([^\n]{4,25})/i); if (m) { const d = toIso(m[1]); if (d) result.mfd = d; } }

  // Drug name heuristic: first line that looks like a proper name (not a date/lot/noise line)
  const skipPattern = /EXP|MFG|MFD|LOT|BATCH|L\/N|[\d]{4}|mg|ml|mcg|IU|^\s*$/i;
  for (const line of lines) {
    const t = line.trim();
    if (t.length < 4 || skipPattern.test(t)) continue;
    // Prefer English drug name (title-case or ALL-CAPS word sequence)
    if (/[A-Za-z]{3}/.test(t)) { result.name = t; break; }
  }
  // Fallback: first Thai line
  if (!result.name) {
    for (const line of lines) {
      const t = line.trim();
      if (t.length >= 4 && /[฀-๿]{3}/.test(t) && !skipPattern.test(t)) { result.name = t; break; }
    }
  }

  return result;
}

let _barcodeLoop = null;
let _zxingReader = null;
let _lastScanMs = 0;

function _zxingHints() {
  if (!window.ZXing) return null;
  try {
    const fmt = ZXing.BarcodeFormat;
    return new Map([
      [ZXing.DecodeHintType.POSSIBLE_FORMATS, [
        fmt.EAN_13, fmt.EAN_8,
        fmt.CODE_128, fmt.CODE_39,
        fmt.QR_CODE, fmt.DATA_MATRIX,
        fmt.PDF_417, fmt.AZTEC,
        fmt.ITF, fmt.UPC_A, fmt.UPC_E,
      ]],
      [ZXing.DecodeHintType.TRY_HARDER, true],
    ]);
  } catch(e) { return null; }
}

// Fill expiry-form fields directly from GS1 AIs — used when 2D barcode is scanned while form is open
function _fillFormFromGS1(gs1) {
  let filled = 0;
  if (gs1['17']) {
    const d = parseGS1Expiry(gs1['17']);
    if (d) { const el = document.getElementById('ean13Expiry'); if (el) { el.value = d.toISOString().slice(0,10); filled++; } }
  } else if (gs1['15']) {
    const d = parseGS1Expiry(gs1['15']);
    if (d) { const el = document.getElementById('ean13Expiry'); if (el) { el.value = d.toISOString().slice(0,10); filled++; } }
  }
  if (gs1['11']) {
    const d = parseGS1Expiry(gs1['11']);
    if (d) { const el = document.getElementById('ean13Mfd'); if (el) { el.value = d.toISOString().slice(0,10); filled++; } }
  }
  if (gs1['10']) {
    const el = document.getElementById('ean13Lot');
    if (el && !el.value) { el.value = gs1['10']; filled++; }
  }
  if (filled > 0) {
    vibrate([8, 30, 8]); sfx('success');
    showToast(`✓ อ่าน ${filled} ข้อมูลจากบาร์โค้ด 2D — ตรวจสอบแล้วกด รับเข้าสต๊อก`, '#2ee6a6');
  }
}

// Shared debounced barcode handler — called by both BarcodeDetector and ZXing
function _onBarcode(raw, fmt) {
  const now = Date.now();
  if (now - _lastScanMs < 1500) return;

  // Special path: expiry form is open — let a GS1 2D barcode fill the fields directly
  if (S.scanState === 'detected' && S.scanResult?.needsExpiry) {
    const gs1 = parseGS1(raw);
    if (gs1['17'] || gs1['15'] || gs1['11'] || gs1['10']) {
      _lastScanMs = now;
      _fillFormFromGS1(gs1);
    }
    return; // never replace the open result while form is visible
  }

  if (['lockon','decoding','detected'].includes(S.scanState)) return;
  if (!S.cameraActive) return;
  _lastScanMs = now;
  try { processBarcode(raw, fmt); } catch(e) { console.warn('processBarcode:', e); }
}

// Open camera via getUserMedia, then run both BarcodeDetector + ZXing in parallel
function startZXingScanner(videoEl) {
  const constraints = {
    audio: false,
    video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
  };
  navigator.mediaDevices.getUserMedia(constraints)
    .then(stream => {
      S.cameraStream = stream;
      videoEl.srcObject = stream;
      return videoEl.play().catch(() => {});
    })
    .then(() => {
      S.scanState = 'detecting'; updateScanViewport();
      showToast('📷 กล้องพร้อม — เล็งบาร์โค้ดให้อยู่ในกรอบ', '#2ee6a6');
      _startAllDetectors(videoEl);
    })
    .catch(err => {
      console.warn('Camera open:', err);
      S.cameraActive = false; updateTabBody();
      showToast('📵 ไม่สามารถเปิดกล้องได้ — กรุณาอนุญาตสิทธิ์กล้อง', '#ff4d5e');
    });
}

function _startAllDetectors(videoEl) {
  // Method 1: BarcodeDetector API — native, fast, reliable for EAN-13 (Chrome/Android)
  if ('BarcodeDetector' in window) {
    try {
      const det = new BarcodeDetector({
        formats: ['ean_13','ean_8','qr_code','data_matrix','code_128','code_39','aztec','pdf_417','itf'],
      });
      if (_barcodeLoop) clearInterval(_barcodeLoop);
      _barcodeLoop = setInterval(async () => {
        if (!S.cameraActive) { clearInterval(_barcodeLoop); _barcodeLoop = null; return; }
        try {
          const codes = await det.detect(videoEl);
          if (codes.length > 0) _onBarcode(codes[0].rawValue, codes[0].format);
        } catch(e) {}
      }, 200);
    } catch(e) { console.warn('BarcodeDetector init:', e); }
  }

  // Method 2: ZXing decodeFromStream — cross-browser fallback (iOS Safari, Firefox)
  if (window.ZXing && videoEl.srcObject) {
    try {
      if (_zxingReader) { try { _zxingReader.reset(); } catch(e) {} _zxingReader = null; }
      _zxingReader = new ZXing.BrowserMultiFormatReader(_zxingHints(), { delayBetweenScanAttempts: 250 });
      _zxingReader.decodeFromStream(videoEl.srcObject, videoEl, (result, err) => {
        if (result && S.cameraActive) _onBarcode(result.getText(), result.getBarcodeFormat().toString());
      });
    } catch(e) { console.warn('ZXing decodeFromStream:', e); }
  }

  if (!('BarcodeDetector' in window) && !window.ZXing) {
    showToast('⚠ บราวเซอร์นี้สแกนอัตโนมัติไม่ได้ — ลองกรอกบาร์โค้ดเอง', '#ff9f43');
  }
}

const _stockSearchDebounced = _debounce(val => {
  S.stockSearch = val;
  updateTabBody();
}, 50);

function bindStockTab() {
  document.querySelectorAll('.stock-filter-btn[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      vibrate(6); S.stockFilter = btn.dataset.filter;
      updateTabBody();
    });
  });
  const search = document.getElementById('stockSearchInput');
  if (search) {
    search.addEventListener('input', e => _stockSearchDebounced(e.target.value));
    // Keep focus after tab re-render (search was active)
    if (S.stockSearch) setTimeout(() => { search.focus(); search.setSelectionRange(search.value.length, search.value.length); }, 0);
  }
  const sortSel = document.getElementById('stockSortSel');
  if (sortSel) sortSel.addEventListener('change', e => {
    S.stockSort = e.target.value;
    updateTabBody();
  });
  document.querySelectorAll('.drug-card[data-id]').forEach(card => {
    card.addEventListener('click', () => {
      const it = S.items.find(x => x.id === card.dataset.id);
      if (it) showDrugSheet(it);
    });
  });
  const bulkBtn = document.getElementById('bulkTransferBtn');
  if (bulkBtn) bulkBtn.addEventListener('click', bulkTransfer);
}

function saveSettings() {
  try {
    localStorage.setItem('settings', JSON.stringify(S.settings));
    localStorage.setItem('autoLockMins', String(S.autoLockMins));
  } catch(e) {}
}

function bindCfgTab() {
  document.querySelectorAll('.theme-btn[data-theme]').forEach(btn => {
    btn.addEventListener('click', () => {
      vibrate(6); applyTheme(btn.dataset.theme);
      updateTabBody();
    });
  });
  const soundToggle = document.getElementById('soundToggle');
  if (soundToggle) soundToggle.addEventListener('click', () => {
    vibrate(6);
    S.settings.soundOn = !S.settings.soundOn;
    saveSettings();
    updateTabBody();
  });
  document.querySelectorAll('.autolock-btn[data-lock]').forEach(btn => {
    btn.addEventListener('click', () => {
      vibrate(6); S.autoLockMins = parseInt(btn.dataset.lock);
      saveSettings();
      updateTabBody();
    });
  });
  document.querySelectorAll('.thresh-slider[data-thresh]').forEach(slider => {
    slider.addEventListener('input', e => {
      S.settings[e.target.dataset.thresh] = parseInt(e.target.value);
      const label = e.target.closest('.thresh-row')?.querySelector('.thresh-val');
      if (label) label.textContent = e.target.value + ' วัน';
      _statusCache.clear(); // thresholds changed — invalidate cached statuses
      saveSettings();
    });
  });
  const geminiInput = document.getElementById('geminiKeyInput');
  if (geminiInput) {
    geminiInput.addEventListener('change', () => {
      S.settings.geminiKey = geminiInput.value.trim();
      try { localStorage.setItem('geminiKey', S.settings.geminiKey); } catch(e) {}
      saveSettings();
      updateTabBody();
    });
  }
  document.getElementById('notifPermBtn')?.addEventListener('click', () => requestNotifPermission());
  const deptSel = document.getElementById('deptSelect');
  if (deptSel) deptSel.addEventListener('change', () => {
    S.dept = deptSel.value;
    try { localStorage.setItem('dept', S.dept); } catch(e) {}
    showToast(`✓ เปลี่ยนแผนกเป็น ${S.dept}`, '#009E9E');
  });
}

function bindSheetEvents() {
  const closeSheet = document.getElementById('closeSheetBtn');
  if (closeSheet) closeSheet.addEventListener('click', closeSheetFn);
  const overlay = document.getElementById('sheetOverlay');
  if (overlay) overlay.addEventListener('click', e => {
    if (e.target === overlay) closeSheetFn();
  });
}
function closeSheetFn() {
  S.sheet = null; S.sheetData = null;
  renderAppBody(); updateNavTabs();
}

function bindConfirmEvents() {
  const cancel = document.getElementById('confirmCancel');
  if (cancel) cancel.addEventListener('click', () => {
    S.confirmAction = null; renderAppBody(); updateNavTabs();
  });
  const ok = document.getElementById('confirmOk');
  if (ok) ok.addEventListener('click', () => {
    const fn = S.confirmAction?.fn;
    S.confirmAction = null;
    if (fn) fn();
    renderAppBody(); updateNavTabs();
  });
  const overlay = document.getElementById('confirmOverlay');
  if (overlay) overlay.addEventListener('click', e => {
    if (e.target === overlay) { S.confirmAction = null; renderAppBody(); updateNavTabs(); }
  });
}

function bindManual() {
  const back = document.getElementById('manualBackBtn');
  if (back) back.addEventListener('click', () => {
    S.manualOpen = false; renderScreen();
  });
  const submit = document.getElementById('manualSubmitBtn');
  if (submit) submit.addEventListener('click', () => {
    const name = document.getElementById('mName')?.value?.trim();
    const lot = document.getElementById('mLot')?.value?.trim();
    const exp = document.getElementById('mExp')?.value;
    if (!name || !lot || !exp) { showToast('กรุณากรอกชื่อยา, Lot และวันหมดอายุ', '#ff4d5e'); return; }
    const qty = parseInt(document.getElementById('mQty')?.value) || 0;
    const loc = document.getElementById('mLoc')?.value || 'SUBSTOCK';
    const highAlert = document.getElementById('mHighAlert')?.checked;
    const cold = document.getElementById('mCold')?.checked;
    const gen = document.getElementById('mGen')?.value?.trim();
    const newItem = {
      id: 'local-' + Date.now(),
      name, gen: gen||'', lot, exp: new Date(exp), qty, loc,
      highAlert: !!highAlert, lasa: false, cold: !!cold, age: 0, form: 'tab',
    };
    S.items.unshift(newItem);
    addLog('รับเข้าสต๊อก', name + ' Lot ' + lot);
    S.manualOpen = false;
    S.tab = 'stock';
    showToast('✓ บันทึก ' + name + ' แล้ว', '#2ee6a6');
    sfx('success');
    renderScreen();
    saveToFirestore(newItem);
  });
}

// ── RE-RENDER HELPERS ─────────────────────────────────
function renderAppBody() {
  const appBody = document.getElementById('tab-body');
  if (!appBody) return;
  let html = '';
  if (S.tab === 'scan') html = renderScanTab();
  else if (S.tab === 'stock') html = renderStockTab();
  else if (S.tab === 'dash') html = renderDashTab();
  else if (S.tab === 'cfg') html = renderCfgTab();
  appBody.innerHTML = html;
  appBody.style.animation = 'none';
  appBody.offsetHeight; // reflow
  appBody.style.animation = 'tabIn .22s ease both';

  // Re-inject sheet and confirm
  const appScreen = document.getElementById('app-screen');
  if (appScreen) {
    let extra = document.getElementById('sheetOverlay');
    if (extra) extra.remove();
    extra = document.getElementById('confirmOverlay');
    if (extra) extra.remove();
    if (S.sheet) appScreen.insertAdjacentHTML('beforeend', renderSheet());
    if (S.confirmAction) appScreen.insertAdjacentHTML('beforeend', renderConfirm());
  }

  bindTabEvents();
  bindSheetEvents();
  bindConfirmEvents();

  // Sync topbar title with current tab (topbar is outside #tab-body so not rebuilt above)
  const _tabNames = { scan:'สแกนรับยา', stock:'คลังยา', dash:'รายงาน & KPI', cfg:'ตั้งค่าระบบ' };
  const _tabNameEl = document.querySelector('.topbar-tab-name');
  if (_tabNameEl) _tabNameEl.textContent = _tabNames[S.tab] || '';
}

function updateTabBody() {
  if (S.cameraActive) {
    // Save the live video element before the DOM rebuild wipes #camContainer
    const savedVideo = document.getElementById('pc-scanvid');
    renderAppBody();
    const container = document.getElementById('camContainer');
    if (container) {
      container.style.zIndex = '2';
      if (savedVideo && savedVideo.srcObject) {
        container.innerHTML = '';
        container.appendChild(savedVideo);
      }
    }
  } else {
    renderAppBody();
  }
}

function updateNavTabs() {
  const nav = document.getElementById('app-nav');
  if (!nav) return;
  nav.innerHTML = buildNavTabs();
  nav.querySelectorAll('.nav-tab[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      vibrate(6); sfx('tick');
      if (btn.dataset.tab !== 'scan') {
        if (S.cameraActive) stopCamera();
        closePhotoCap(true); // stop photo camera stream when leaving scan tab
      }
      S.tab = btn.dataset.tab; S.sheet = null;
      renderAppBody(); updateNavTabs();
    });
  });
  // Refresh focus chip in topbar too
  const chip = document.getElementById('focusChipBtn');
  const fm = getFocusMode();
  if (chip) { chip.textContent = `◎ ${fm?'Focus':'Auto'}`; chip.className = `focus-chip${fm?' active':''}`; }
}

// ── LOGIN LOGIC ────────────────────────────────────────
function pinPress(k) {
  // Ripple on key
  const rippleEl = k === 'del' ? document.getElementById('pinDel')
    : k === 'face' ? document.getElementById('pinFaceBtn')
    : document.querySelector(`.pin-key[data-key="${k}"]`);
  if (rippleEl) {
    rippleEl.classList.remove('ripple');
    void rippleEl.offsetWidth;
    rippleEl.classList.add('ripple');
    setTimeout(() => rippleEl.classList.remove('ripple'), 500);
  }
  if (k === 'del') {
    S.pin = S.pin.slice(0, -1); S.pinErr = false;
    vibrate(5);
    document.getElementById('pinDots') && updatePinDots();
    const del = document.getElementById('pinDel');
    if (del) del.style.opacity = S.pin.length > 0 ? '1' : '0.3';
    return;
  }
  if (S.pin.length >= 4) return;
  S.pin += k; vibrate(6);
  updatePinDots();
  if (S.pin.length === 4) {
    setTimeout(() => {
      const u = S.users.find(x => x.id === S.pendingUser?.id) || S.pendingUser;
      if (S.pin === u?.pin) { doLogin(u); }
      else { vibrate([10,60,10,60,10]); sfx('error'); S.pinErr = true; S.pin = ''; updatePinDots(); }
    }, 120);
  }
}

function updatePinDots() {
  const dots = document.getElementById('pinDots');
  if (!dots) return;
  const u = S.pendingUser;
  const errCls = S.pinErr ? ' error' : '';
  dots.className = 'pin-dots' + errCls;
  dots.innerHTML = [0,1,2,3].map(i => {
    const filled = i < S.pin.length;
    const isErr = S.pinErr;
    const bg = filled ? (isErr ? '#ff4d5e' : u.color) : 'transparent';
    const border = filled ? (isErr ? '#ff4d5e' : u.color) : 'rgba(255,255,255,.3)';
    const glow = filled && !isErr ? `0 0 18px ${u.color}cc,0 0 6px ${u.color}` : 'none';
    const anim = filled ? 'pinFill .2s ease' : 'none';
    return `<div style="width:18px;height:18px;border-radius:50%;background:${bg};border:2px solid ${border};box-shadow:${glow};animation:${anim};transform:${filled?'scale(1.15)':'scale(1)'};transition:all .18s"></div>`;
  }).join('');

  // error message
  let errMsg = dots.parentElement?.querySelector('.pin-error-msg');
  if (S.pinErr && !errMsg) {
    const msg = document.createElement('div');
    msg.className = 'pin-error-msg';
    msg.textContent = 'PIN ไม่ถูกต้อง — ลองอีกครั้ง';
    dots.insertAdjacentElement('afterend', msg);
  } else if (!S.pinErr && errMsg) {
    errMsg.remove();
  }
}

function doLogin(u) {
  stopFace();
  vibrate([8,40,12]); sfx('success');
  speak('เข้าสู่ระบบสำเร็จ');
  S.user = u; S.screen = 'app'; S.tab = 'scan';
  S.loginStep = 'profiles'; S.pin = ''; S.faceStage = 'scanning';
  S.lastActivity = Date.now();
  try { localStorage.setItem('session', JSON.stringify({ uid: u.id, exp: Date.now() + 8*3600*1000 })); } catch(e) {}
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
  renderScreen();
  handoffListen();
  showToast(`ยินดีต้อนรับ ${u.name}`, u.color);
}

let _faceStream = null, _faceT1 = null, _faceT2 = null;
function startFace() {
  vibrate(8);
  S.loginStep = 'face'; S.faceStage = 'scanning';
  renderScreen();
  if (navigator.mediaDevices?.getUserMedia) {
    navigator.mediaDevices.getUserMedia({ video: { facingMode:'user' }, audio:false })
      .then(stream => {
        if (S.loginStep !== 'face') { stream.getTracks().forEach(t => t.stop()); return; }
        _faceStream = stream;
        const v = document.createElement('video');
        v.id = 'pc-facevid'; v.autoplay = true; v.muted = true; v.playsInline = true;
        v.style.cssText = 'width:100%;height:100%;object-fit:cover;transform:scaleX(-1)';
        v.srcObject = stream;
        const container = document.getElementById('faceCamContainer');
        if (container) { container.innerHTML = ''; container.appendChild(v); }
        v.play?.().catch(() => {});
      }).catch(() => {});
  }
  clearTimeout(_faceT1); clearTimeout(_faceT2);
  _faceT1 = setTimeout(() => {
    if (S.loginStep !== 'face') return;
    vibrate([10,40,10]); speak('ยืนยันใบหน้าสำเร็จ');
    S.faceStage = 'matched';
    const screen = document.getElementById('face-screen');
    if (screen) {
      screen.querySelector('.face-label').textContent = 'FACE VERIFIED';
      screen.querySelector('.face-label').style.color = '#2ee6a6';
      screen.querySelector('.face-title').textContent = 'ยืนยันตัวตนสำเร็จ';
      screen.querySelector('.face-subtitle').textContent = 'กำลังเข้าสู่ระบบ…';
      const oval = screen.querySelector('.face-oval');
      if (oval) { oval.style.boxShadow = '0 0 0 3px #2ee6a6,0 0 50px -6px #2ee6a699'; oval.style.animation = 'none'; }
      const sweep = screen.querySelector('.face-sweep');
      if (sweep) sweep.remove();
      const check = document.createElement('div');
      check.className = 'face-check'; check.textContent = '✓';
      oval?.appendChild(check);
      const dotsWrap = screen.querySelector('.face-dots');
      if (dotsWrap) {
        dotsWrap.outerHTML = `<div class="face-success-msg">ยินดีต้อนรับ ${S.users[0].name}</div>`;
      }
    }
    _faceT2 = setTimeout(() => {
      if (S.loginStep === 'face') doLogin(S.users[0]);
    }, 1100);
  }, 2600);
}
function stopFace() {
  clearTimeout(_faceT1); clearTimeout(_faceT2);
  if (_faceStream) { try { _faceStream.getTracks().forEach(t => t.stop()); } catch(e) {} _faceStream = null; }
}
function cancelFace() {
  stopFace(); vibrate(6);
  S.loginStep = 'profiles'; S.faceStage = 'scanning';
  renderScreen();
}

// ── SCAN LOGIC ────────────────────────────────────────

function openBarcodeInputSheet() {
  if (['detecting','lockon','decoding'].includes(S.scanState)) return;
  vibrate(8);
  const appScreen = document.getElementById('app-screen');
  if (!appScreen) return;
  let overlay = document.getElementById('barcodeInputOverlay');
  if (overlay) overlay.remove();
  appScreen.insertAdjacentHTML('beforeend', `
    <div class="overlay sheet-overlay" id="barcodeInputOverlay" style="z-index:300">
      <div id="sheet-box" style="padding:20px">
        <div id="sheet-handle"></div>
        <div style="font-size:15px;font-weight:700;color:var(--ink);margin-bottom:14px">⌨ กรอกบาร์โค้ด / รหัสยา</div>
        <input id="barcodeManualInput" type="text" inputmode="text"
          placeholder="สแกนหรือพิมพ์บาร์โค้ด เช่น (01)06901234567890(17)260630(10)LOT01"
          style="background:var(--glass);border:1.5px solid var(--glassb);border-radius:12px;padding:11px 14px;font-size:13px;font-family:'Sarabun',sans-serif;color:var(--ink);width:100%;margin-bottom:12px">
        <div style="font-size:11px;color:var(--ink3);margin-bottom:14px">รองรับ GS1 DataMatrix, GS1-128, EAN-13, หรือรหัส Lot</div>
        <div style="display:flex;gap:10px">
          <button id="barcodeSubmitBtn" style="flex:1;padding:12px;border-radius:14px;background:var(--brand);color:#fff;font-size:14px;font-weight:700;border:none;font-family:'Sarabun',sans-serif">
            ✓ ยืนยัน
          </button>
          <button id="barcodeCloseBtn" style="padding:12px 18px;border-radius:14px;background:var(--glass);color:var(--ink2);font-size:14px;border:1px solid var(--glassb);font-family:'Sarabun',sans-serif">
            ยกเลิก
          </button>
        </div>
      </div>
    </div>`);
  const inp = document.getElementById('barcodeManualInput');
  if (inp) inp.focus();
  document.getElementById('barcodeSubmitBtn').addEventListener('click', () => {
    const val = (document.getElementById('barcodeManualInput')?.value || '').trim();
    if (!val) { showToast('⚠ กรุณากรอกบาร์โค้ด', '#ff9f43'); return; }
    document.getElementById('barcodeInputOverlay')?.remove();
    processBarcode(val, 'MANUAL');
  });
  document.getElementById('barcodeCloseBtn').addEventListener('click', () => {
    document.getElementById('barcodeInputOverlay')?.remove();
  });
  document.getElementById('barcodeManualInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('barcodeSubmitBtn')?.click();
  });
}

// ── GS1 BARCODE ENGINE ────────────────────────────────
// Fixed-length AI data-field lengths (after 2-digit AI code)
const GS1_FIXED = {
  '00':18,'01':14,'02':14,'03':14,'04':16,
  '11':6,'12':6,'13':6,'14':6,'15':6,'16':6,'17':6,
  '18':6,'19':6,'20':2,'31':6,'32':6,'33':6,'34':6,'35':6,'36':6,'41':13,
};

function parseGS1(raw) {
  const ais = {};
  if (!raw) return ais;
  let s = raw.replace(/[\x00-\x08\x0B\x0E-\x1C\x1E-\x1F]/g, '').trim();

  // Parenthesis notation: (01)06901234567890(17)260630(10)LOT123
  if (/\(\d{2,4}\)/.test(s)) {
    for (const [,ai,val] of s.matchAll(/\((\d{2,4})\)([^(]*)/g)) {
      ais[ai] = val.replace(/\x1D/g,'').trim();
    }
    return ais;
  }

  // Raw GS-separated or compact format
  let pos = 0;
  while (pos < s.length) {
    if (s[pos] === '\x1D') { pos++; continue; }
    const ai = s.slice(pos, pos + 2);
    if (!/^\d{2}/.test(ai)) break;
    pos += 2;
    const fl = GS1_FIXED[ai];
    if (fl !== undefined) {
      ais[ai] = s.slice(pos, pos + fl);
      pos += fl;
    } else {
      const gs = s.indexOf('\x1D', pos);
      if (gs === -1) { ais[ai] = s.slice(pos); break; }
      ais[ai] = s.slice(pos, gs);
      pos = gs + 1;
    }
  }
  return ais;
}

function parseGS1Expiry(yymmdd) {
  if (!yymmdd || yymmdd.length < 6) return null;
  const yy = parseInt(yymmdd.slice(0,2));
  const mm = parseInt(yymmdd.slice(2,4)) - 1;
  let dd = parseInt(yymmdd.slice(4,6));
  const year = yy <= 49 ? 2000 + yy : 1900 + yy;
  if (dd === 0) { // 00 = last day of month
    const d = new Date(year, mm + 1, 0);
    return d;
  }
  return new Date(year, mm, dd);
}

function buildResultFromGS1(gs1, rawText) {
  const lot     = gs1['10'] || '';
  const qty     = gs1['37'] ? Math.max(1, parseInt(gs1['37'])) : 1;
  const gtin    = gs1['01'] || '';
  // AI(17) = expiry, AI(15) = best-before (fallback), AI(11) = production date
  const expDate = gs1['17'] ? parseGS1Expiry(gs1['17'])
                : gs1['15'] ? parseGS1Expiry(gs1['15']) : null;
  const mfdDate = gs1['11'] ? parseGS1Expiry(gs1['11']) : null;
  const needsExpiry = !expDate;

  // Match lot number against inventory
  if (lot) {
    const byLot = S.items.find(i => i.lot === lot);
    if (byLot) return {
      ...byLot, qty: byLot.qty + qty, dest: S.scanDest,
      ...(expDate ? { exp: expDate } : { needsExpiry: true }),
      ...(mfdDate ? { mfd: mfdDate } : {}),
      barcode: rawText, gs1,
    };
  }

  // Match GTIN against inventory
  if (gtin) {
    const byGtin = S.items.find(i => i.gtin === gtin);
    if (byGtin) return {
      ...byGtin, lot, qty, dest: S.scanDest,
      ...(expDate ? { exp: expDate } : { needsExpiry: true }),
      ...(mfdDate ? { mfd: mfdDate } : {}),
      barcode: rawText, gs1,
    };
  }

  // New drug — require name + expiry from user
  return {
    name: '', gen: '', lot, qty,
    exp: expDate || null, mfd: mfdDate || null,
    dest: S.scanDest, highAlert: false, lasa: false, cold: false,
    barcode: rawText, gs1, gtin, _fromScan: true, isNew: true,
    needsExpiry,
  };
}

function processBarcode(rawText, formatName) {
  if (['lockon','decoding','detected'].includes(S.scanState)) return;
  vibrate([8,30,8]); sfx('scan');
  S.scanState = 'detecting'; S.aiConf = 0; S.scanResult = null;
  updateScanViewport();

  // Parse GS1 data now so it's ready at result phase
  const gs1 = parseGS1(rawText);
  const hasGS1 = !!(gs1['01'] || gs1['17'] || gs1['10']);

  // Update detected format label
  if (formatName) {
    const fn = formatName.toUpperCase();
    if (fn.includes('DATA_MATRIX') || fn.includes('DATAMATRIX')) S.scanFormat = 'GS1 DataMatrix';
    else if (fn.includes('QR')) S.scanFormat = 'QR Code';
    else if (fn.includes('EAN_13') || fn.includes('EAN13')) S.scanFormat = 'EAN-13';
    else if (fn.includes('CODE_128') || fn.includes('CODE128')) S.scanFormat = 'Code 128';
    else if (fn.includes('GS1_128') || fn.includes('GS1128')) S.scanFormat = 'GS1-128';
  }

  setTimeout(() => {
    if (hasGS1) return; // GS1 already has full data — skip decorative animation
    if (S.scanState !== 'detecting') return;
    sfx('tick'); vibrate(6);
    S.scanState = 'lockon'; S.aiConf = 60;
    updateScanViewport();
  }, 120);

  setTimeout(() => {
    if (hasGS1) return; // GS1 already has full data — skip decorative animation
    if (S.scanState !== 'lockon') return;
    sfx('tick'); vibrate(4);
    S.scanState = 'decoding'; S.aiConf = 75;
    updateScanViewport();
    let c = 75;
    const tick = setInterval(() => {
      c = Math.min(98, c + Math.floor(Math.random() * 8 + 3));
      S.aiConf = c;
      const txt = document.querySelector('.ai-conf-text');
      const bar = document.querySelector('.ai-conf-bar');
      if (txt) txt.textContent = c + '%';
      if (bar) bar.style.strokeDashoffset = 201 - (201 * c / 100);
      if (c >= 98) clearInterval(tick);
    }, 80);
  }, 350);

  setTimeout(() => {
    if (S.scanState === 'detected') return; // already handled (fast path)
    if (!hasGS1 && !['lockon','decoding'].includes(S.scanState)) return;
    let result;
    if (hasGS1) {
      result = buildResultFromGS1(gs1, rawText);
    } else {
      const raw = rawText.trim();
      const isEAN = /^\d{8}$/.test(raw) || /^\d{13}$/.test(raw);
      if (isEAN) {
        // EAN-13 / EAN-8 — รหัสสินค้าไทย (885...) ไม่มีวันหมดอายุ/Lot ในบาร์โค้ด
        // ต้องกรอกเพิ่มเติมเสมอ ไม่ว่าจะเคยบันทึกแล้วหรือไม่
        const knownDrug = S.items.find(i => i.gtin === raw || i.barcode === raw);
        S.scanFormat = /^\d{13}$/.test(raw) ? 'EAN-13' : 'EAN-8';
        result = {
          name: knownDrug?.name || '',
          gen:  knownDrug?.gen  || '',
          gtin: raw, barcode: raw,
          lot: '', exp: null, qty: 1,
          dest: S.scanDest,
          highAlert: knownDrug?.highAlert || false,
          lasa:      knownDrug?.lasa      || false,
          cold:      knownDrug?.cold      || false,
          _fromScan: true,
          isNew: !knownDrug,        // ชื่อยาต้องกรอกถ้ายังไม่มีในระบบ
          needsExpiry: true,        // วันหมดอายุต้องกรอกเสมอสำหรับ EAN-13
        };
      } else {
        // บาร์โค้ดรูปแบบอื่น — ค้นหาใน inventory
        const found = S.items.find(i => i.barcode === raw || i.lot === raw);
        if (found) {
          result = { ...found, dest: S.scanDest, barcode: raw, _fromScan: true };
        } else {
          S.scanState = 'idle';
          updateScanViewport();
          showToast('❌ ไม่พบบาร์โค้ดนี้ในระบบ — ใช้ GS1 หรือกรอกข้อมูลเอง', '#ff4d5e');
          return;
        }
      }
    }

    S.scanResult = result;
    S.scanState = 'detected'; S.aiConf = 99;

    // For EAN-13 (needsExpiry), exp is null — use neutral status until user fills in
    const _stResult = result.needsExpiry ? { ...result, exp: new Date(Date.now() + 365*86400000) } : result;
    const _st = itemStatus(_stResult);
    if (!result.needsExpiry) playScanChord(_st.key, result.highAlert);
    handoffWrite(result, _st);
    bumpStreak();
    detectStress();

    // Hands-free TTS: full spoken summary so staff need not look at screen
    if (result.needsExpiry) {
      speak(result.name ? `${result.name} — กรุณากรอกวันหมดอายุ` : 'พบบาร์โค้ดยา — กรุณากรอกชื่อยาและวันหมดอายุ');
    } else if (S.voiceFeedback && S.settings.soundOn && result.name) {
      const _dl = daysLeft(result.exp);
      const _dlTxt = _dl < 0 ? `หมดอายุแล้ว ${-_dl} วัน` : `เหลือ ${_dl} วัน`;
      const _stTh = { GREEN:'ปลอดภัย', YELLOW:'เฝ้าระวัง', ORANGE:'ใกล้หมดอายุ', RED:'วิกฤต' }[_st.key] || '';
      speak(`${result.name}. ${_dlTxt}. ${_stTh}`);
    }

    if (S.rapidMode) {
      if (result.needsExpiry || result.isNew) {
        showToast('กรอกข้อมูลให้ครบก่อนบันทึก (ขาดชื่อยา/วันหมดอายุ)', '#ff9f43');
        vibrate([10,40,15]);
      } else {
        S.scanCount++;
        S.scanHistory.unshift({ ...result, ts: new Date() });
        if (S.scanHistory.length > 20) S.scanHistory.pop();
        addToItems(result);
        addLog('รับยา (Rapid)', `${result.name} · Lot ${result.lot}`);
        saveToFirestore(result);
        vibrate([8,40,12]);
        showToast(`✓ #${S.scanCount}: ${result.name}`, _st.c);
      }
    } else {
      vibrate([10,40,15]);
    }
    updateTabBody();
    // Scroll result card into view; focus OCR button for EAN-13 so user just taps it
    requestAnimationFrame(() => {
      const card = document.querySelector('.scan-result-card');
      if (card) card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      setTimeout(() => {
        if (result.needsExpiry) {
          const ocrBtn = document.getElementById('ocrCaptureBtn');
          if (ocrBtn) { ocrBtn.focus(); return; }
        }
        const firstInput = document.getElementById('newDrugName') || document.getElementById('ean13Expiry');
        if (firstInput) firstInput.focus();
      }, 80);
    });
  }, hasGS1 ? 80 : 600);
}

function updateScanViewport() {
  const vp = document.getElementById('scanViewport');
  if (!vp) return;
  const state = S.scanState;
  ['sv-idle','sv-detecting','sv-lockon','sv-decoding','sv-detected'].forEach(c => vp.classList.remove(c));
  vp.classList.add('sv-' + state);

  if (S.cameraActive) {
    vp.style.height = '390px';
    vp.classList.add('cam-active');
  } else {
    vp.style.height = ['detecting','lockon','decoding'].includes(state) ? '310px' : '280px';
    vp.classList.remove('cam-active');
  }

  const badge = vp.querySelector('.scan-phase-badge');
  const labels = {
    idle: S.cameraActive ? '📷 เล็งบาร์โค้ดที่กล้อง…' : 'เล็งกล้องที่บาร์โค้ด',
    detecting: '🔍 AI กำลังค้นหา…',
    lockon: '🎯 ล็อคเป้าหมาย…',
    decoding: '⚡ GS1 ถอดรหัส…',
    detected: '✓ พบข้อมูล!',
  };
  const colors = {
    idle:{bg:'rgba(0,0,0,.5)',b:'rgba(255,255,255,.15)',c:'rgba(255,255,255,.8)'},
    detecting:{bg:'rgba(0,158,158,.25)',b:'rgba(0,158,158,.5)',c:'#009E9E'},
    lockon:{bg:'rgba(46,230,166,.2)',b:'rgba(46,230,166,.5)',c:'#2ee6a6'},
    decoding:{bg:'rgba(56,189,248,.2)',b:'rgba(56,189,248,.5)',c:'#38bdf8'},
    detected:{bg:'rgba(46,230,166,.2)',b:'#2ee6a6',c:'#2ee6a6'},
  };
  if (badge) {
    const cl = colors[state] || colors.idle;
    badge.textContent = labels[state] || '';
    badge.style.background = cl.bg;
    badge.style.borderColor = cl.b;
    badge.style.color = cl.c;
  }
}

function acceptScan() {
  if (!S.scanResult) return;

  // Step 1: Validate + read name if new drug
  if (S.scanResult.isNew) {
    const nameEl = document.getElementById('newDrugName');
    const genEl  = document.getElementById('newDrugGen');
    const name = nameEl ? nameEl.value.trim() : '';
    if (!name) {
      pokaShake(nameEl || document.querySelector('.scan-result-card'));
      showToast('⚠ กรุณาระบุชื่อยาก่อน', '#ff9f43');
      return;
    }
    S.scanResult.name = name;
    S.scanResult.gen  = genEl ? genEl.value.trim() : '';
    delete S.scanResult.isNew;
  }

  // Step 2: Validate + read expiry/lot/qty for EAN-13
  if (S.scanResult.needsExpiry) {
    const expEl = document.getElementById('ean13Expiry');
    const lotEl = document.getElementById('ean13Lot');
    const qtyEl = document.getElementById('ean13Qty');
    const expVal = expEl ? expEl.value.trim() : '';
    if (!expVal) {
      pokaShake(expEl || document.querySelector('.scan-result-card'));
      showToast('⚠ กรุณาระบุวันยาสิ้นอายุ', '#ff9f43');
      return;
    }
    S.scanResult.exp = new Date(expVal);
    if (isNaN(S.scanResult.exp.getTime())) {
      showToast('⚠ วันที่ไม่ถูกต้อง', '#ff4d5e');
      return;
    }
    const mfdEl = document.getElementById('ean13Mfd');
    if (mfdEl && mfdEl.value.trim()) S.scanResult.mfd = new Date(mfdEl.value.trim());
    if (lotEl && lotEl.value.trim()) S.scanResult.lot = lotEl.value.trim();
    if (qtyEl && qtyEl.value.trim()) S.scanResult.qty = Math.max(1, parseInt(qtyEl.value) || 1);
    delete S.scanResult.needsExpiry;
  }

  vibrate([8,40,12]); sfx('success');
  speak(S.scanResult.name);
  const savedName = S.scanResult.name;
  const savedDest = S.scanResult.dest;
  const savedLot  = S.scanResult.lot;
  const wasFromAI = !!S.scanResult._fromAI;

  // LASA consecutive scan detection
  if (savedName) {
    checkLASA(savedName);
    S.lastScanNames.unshift(savedName);
    if (S.lastScanNames.length > 2) S.lastScanNames.pop();
  }

  // Recall check on accepted scan
  const activeRecall = checkRecall(S.scanResult);
  if (activeRecall) showRecallAlert(activeRecall, S.scanResult);

  const scannedItem = { ...S.scanResult, ts: new Date(), dept: S.dept };
  S.scanHistory.unshift(scannedItem);
  if (S.scanHistory.length > 50) S.scanHistory.pop();

  // Batch session tracking
  if (S.rapidMode) {
    if (!S.batchSession) S.batchSession = { startTime: Date.now(), items: [] };
    S.batchSession.items.push(scannedItem);
  }

  const undoFn = addToItems(S.scanResult);
  addLog('รับเข้าสต๊อก', savedName + ' Lot ' + savedLot + ' → ' + savedDest);
  const toastMsg = `✓ รับ ${savedName} · ${S.rapidMode ? 'พร้อมถ่ายยาชิ้นถัดไป 📷' : 'เข้า' + (savedDest==='SUBSTOCK'?'คลัง':'เคาน์เตอร์')}`;
  if (!S.rapidMode) {
    showToast(toastMsg, '#2ee6a6', 10000, '↩ เลิกทำ', () => {
      undoFn();
      S.scanHistory.shift(); // remove from history
      addLog('เลิกทำ', `ยกเลิกรับ ${savedName}`);
      updateTabBody();
      showToast(`↩ ยกเลิกรับ ${savedName} แล้ว`, '#ff9f43', 2200);
    });
  } else {
    showToast(toastMsg, '#2ee6a6', 2200);
  }
  S.scanResult = null; S.scanState = 'idle';
  updateTabBody();
  saveToFirestore(S.scanHistory[0]);
  // Rapid mode: re-open in-app camera immediately for next drug
  if (S.rapidMode && wasFromAI) {
    setTimeout(() => {
      if (_pcStream) {
        // Camera stream still warm — just re-open overlay
        openPhotoCap();
      } else if (navigator.mediaDevices?.getUserMedia) {
        openPhotoCap();
      } else {
        document.getElementById('photoScanInput')?.click();
      }
    }, 500);
  }
}

function addToItems(r) {
  const exp = r.exp || new Date(Date.now() + (r.expDays||90)*86400000);
  const loc = r.dest || 'SUBSTOCK';
  const existing = S.items.find(i =>
    (r.lot && i.lot === r.lot && i.name === r.name) ||
    (r.gtin && i.gtin === r.gtin && r.lot && i.lot === r.lot)
  );
  const added = r.qty || 1;
  const prevExp = existing?.exp;
  if (existing) {
    existing.qty += added;
    if (r.exp) existing.exp = r.exp;
    // Return undo: decrement qty, restore exp
    return () => {
      existing.qty = Math.max(0, existing.qty - added);
      if (prevExp !== undefined) existing.exp = prevExp;
    };
  } else {
    const newItem = {
      id: 'scan-' + Date.now(),
      name: r.name, gen: r.gen||'', lot: r.lot||'', exp, qty: added,
      loc, highAlert: !!r.highAlert, lasa: !!r.lasa, cold: !!r.cold, age: 0,
      form: r.cold ? 'pen' : r.highAlert ? 'vial' : 'tab',
      gtin: r.gtin || '', mfd: r.mfd || null,
    };
    S.items.unshift(newItem);
    // Return undo: remove the new item
    return () => {
      const idx = S.items.indexOf(newItem);
      if (idx !== -1) S.items.splice(idx, 1);
    };
  }
}

// ── STOCK LOGIC ───────────────────────────────────────
function bulkTransfer() {
  const sub = S.items.filter(i => i.loc === 'SUBSTOCK');
  if (!sub.length) { showToast('ไม่มียาใน SUBSTOCK', '#ff9f43'); return; }
  S.confirmAction = {
    icon: '🚀',
    title: 'โอนยาทั้งหมด?',
    msg: `SUBSTOCK → FRONT SHELF ×${sub.length} รายการ พร้อม FIFO`,
    ok: 'โอนทั้งหมด',
    fn: () => {
      S.items.forEach(i => { if (i.loc === 'SUBSTOCK') i.loc = 'FRONT_SHELF'; });
      vibrate([8,30,8]); sfx('success'); speak('โอนยาทั้งหมดขึ้นหน้าเคาน์เตอร์');
      addLog('โอนขึ้นจุดบริการ', `SUBSTOCK → FRONT SHELF ×${sub.length} รายการ`);
      showToast(`✓ โอน ${sub.length} รายการขึ้นหน้าเคาน์เตอร์`, '#2ee6a6');
      renderAppBody(); updateNavTabs();
    },
  };
  renderAppBody(); updateNavTabs();
}

function showDrugSheet(it) {
  const st = itemStatus(it);
  const flags = [];
  if (it.highAlert) flags.push(`<span class="drug-tag ha-flag">⬢ HIGH-ALERT</span>`);
  if (it.lasa) flags.push(`<span class="drug-tag lasa-flag">◆ LASA</span>`);
  if (it.cold) flags.push(`<span class="drug-tag cold-flag">❄ COLD CHAIN</span>`);
  const dl = daysLeft(it.exp);

  S.sheetData = it;
  const appScreen = document.getElementById('app-screen');
  let overlay = document.getElementById('sheetOverlay');
  if (overlay) overlay.remove();
  const html = `
    <div class="overlay sheet-overlay" id="sheetOverlay">
      <div id="sheet-box">
        <div id="sheet-handle"></div>
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
          ${medAvatarHTML(it, 48)}
          <div>
            <div class="sheet-title">${it.name}</div>
            <div style="font-size:12px;color:var(--ink2)">${it.gen}</div>
            ${flags.length ? `<div class="drug-flags" style="margin-top:5px">${flags.join('')}</div>` : ''}
          </div>
        </div>
        <div style="padding:12px;border-radius:13px;background:${st.c}22;border:1px solid ${st.c}55;margin-bottom:12px">
          <div style="font-size:13px;font-weight:700;color:${st.c}">${shapeIconSVG(st.shape,st.c,14)} ${st.label}</div>
          <div style="font-size:11px;color:var(--ink3);margin-top:3px">วันหมดอายุ: ${fmtDate(it.exp)}</div>
        </div>
        <div class="detail-field">
          <div class="detail-item"><div class="detail-item-label">LOT NO.</div><div class="detail-item-val" style="font-family:'JetBrains Mono',monospace;color:#9d8cff">${it.lot}</div></div>
          ${it.mfd ? `<div class="detail-item"><div class="detail-item-label">วันผลิต</div><div class="detail-item-val" style="font-family:'JetBrains Mono',monospace">${fmtDate(it.mfd)}</div></div>` : ''}
          <div class="detail-item"><div class="detail-item-label">จำนวน</div><div class="detail-item-val">${it.qty} หน่วย${it.minStock > 0 ? ` <span style="color:${it.qty<=it.minStock?'#ff4d5e':'#2ee6a6'};font-size:10px">(ขั้นต่ำ ${it.minStock})</span>` : ''}</div></div>
          <div class="detail-item"><div class="detail-item-label">ตำแหน่ง</div><div class="detail-item-val">${it.loc==='FRONT_SHELF'?'🛎 หน้าเคาน์เตอร์':'📦 คลัง'}</div></div>
          <div class="detail-item"><div class="detail-item-label">อายุสต๊อก</div><div class="detail-item-val">${it.age} วัน</div></div>
          ${it.gtin ? `<div class="detail-item"><div class="detail-item-label">GTIN</div><div class="detail-item-val" style="font-family:'JetBrains Mono',monospace;font-size:11px">${it.gtin}</div></div>` : ''}
          ${it.gen ? `<div class="detail-item"><div class="detail-item-label">Generic</div><div class="detail-item-val">${it.gen}</div></div>` : ''}
          ${(() => { const cache = it.gtin ? S.drugCache[it.gtin] : null; return cache?.strength ? `<div class="detail-item"><div class="detail-item-label">Strength</div><div class="detail-item-val">${cache.strength}</div></div>` : ''; })()}
          ${(() => { const cache = it.gtin ? S.drugCache[it.gtin] : null; return cache?.form ? `<div class="detail-item"><div class="detail-item-label">รูปแบบ</div><div class="detail-item-val">${cache.form}</div></div>` : ''; })()}
        </div>
        <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">
          ${it.loc==='SUBSTOCK' ? `<button class="sheet-action-btn sheet-action-transfer" id="transferOneBtn">🚀 โอนขึ้นเคาน์เตอร์</button>` : ''}
          <button class="sheet-action-btn sheet-action-dispense" id="dispenseItemBtn">💊 จ่ายยา</button>
          ${st.key === 'ORANGE' ? `<button class="sheet-action-btn sheet-action-return" id="returnItemBtn">↩ คืนบริษัท</button>` : ''}
          ${(st.key === 'RED' || S.user?.role === 'Admin') ? `<button class="sheet-action-btn sheet-action-disposal" id="disposalItemBtn">🗑 ทำลายยา</button>` : ''}
        </div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="sheet-action-btn" style="flex:1;background:rgba(0,158,158,.12);color:#009E9E;border-color:rgba(0,158,158,.25)" id="fdaLookupBtn">🔍 ค้นหาใน อย.</button>
          <button class="sheet-action-btn" style="flex:1;background:rgba(255,77,94,.12);color:#ff4d5e;border-color:rgba(255,77,94,.25)" id="deleteItemBtn">🗑 ลบออก</button>
        </div>
        <button class="form-submit" style="background:var(--glass);color:var(--ink);border:1px solid var(--glassb);margin-top:8px" id="closeSheetBtn">ปิด</button>
      </div>
    </div>`;
  appScreen?.insertAdjacentHTML('beforeend', html);

  document.getElementById('closeSheetBtn')?.addEventListener('click', closeSheetFn);
  document.getElementById('sheetOverlay')?.addEventListener('click', e => {
    if (e.target.id === 'sheetOverlay') closeSheetFn();
  });
  const transferOne = document.getElementById('transferOneBtn');
  if (transferOne) transferOne.addEventListener('click', () => {
    it.loc = 'FRONT_SHELF';
    addLog('โอนขึ้นจุดบริการ', it.name + ' Lot ' + it.lot);
    sfx('success'); vibrate([8,30]);
    showToast(`✓ โอน ${it.name} ขึ้นหน้าเคาน์เตอร์`, '#2ee6a6');
    closeSheetFn();
  });
  document.getElementById('dispenseItemBtn')?.addEventListener('click', () => showDispenseModal(it));
  document.getElementById('returnItemBtn')?.addEventListener('click', () => showReturnWorkflowModal(it));
  document.getElementById('disposalItemBtn')?.addEventListener('click', () => showDisposalModal(it));
  document.getElementById('fdaLookupBtn')?.addEventListener('click', () => lookupThaiFDA(it.name, it.gtin));
  const deleteItem = document.getElementById('deleteItemBtn');
  if (deleteItem) deleteItem.addEventListener('click', () => {
    S.items = S.items.filter(x => x.id !== it.id);
    if (typeof drugsRef !== 'undefined' && it.id && it._fromFirestore) {
      drugsRef.doc(it.id).delete().catch(() => {});
    }
    addLog('ลบยา', it.name + ' Lot ' + it.lot);
    sfx('success');
    showToast(`✓ ลบ ${it.name} แล้ว`, '#ff9f43');
    closeSheetFn();
  });
}

// ── AUDIT LOG ─────────────────────────────────────────
function addLog(action, detail) {
  S.auditLog.unshift({
    id: 'l' + Date.now(),
    ts: new Date(),
    user: S.user?.name || '—',
    role: S.user?.role || '—',
    action, detail,
  });
  if (S.auditLog.length > 200) S.auditLog.splice(200);
}

// ── FIREBASE INTEGRATION ──────────────────────────────
function initFirestore() {
  if (typeof drugsRef === 'undefined') return;
  drugsRef
    .orderBy('createdAt', 'asc')
    .onSnapshot(snapshot => {
      S.firestoreLoaded = true;
      const fsItems = snapshot.docs.map(doc => {
        const d = doc.data();
        return {
          id: doc.id,
          name: d.name || '—',
          gen: d.generic || d.gen || '',
          lot: d.batch || d.lot || '',
          exp: d.expiry ? new Date(d.expiry) : new Date(Date.now() + 90*86400000),
          qty: d.stock || d.qty || 0,
          loc: d.loc || (d.isEmergency ? 'FRONT_SHELF' : 'SUBSTOCK'),
          highAlert: !!d.isEmergency,
          lasa: !!d.lasa,
          cold: (d.storage||'').includes('2–8'),
          age: 0,
          form: (d.unit||'').includes('vial') ? 'vial' : (d.unit||'').includes('capsule') ? 'cap' : 'tab',
          gtin: d.gtin || '',
          mfd: d.mfd ? new Date(d.mfd) : null,
          minStock: d.minStock || 0,
          dept: d.dept || 'OPD',
          _fromFirestore: true,
        };
      });
      if (fsItems.length > 0) S.items = fsItems;
      S.offlineMode = false;
      if (S.screen === 'app') { renderAppBody(); updateNavTabs(); updateEdgeGlow(); }
      checkAndNotify();
    }, err => {
      console.warn('Firestore error:', err.message);
      S.offlineMode = true;
    });
}

let _lastNotifKey = '';
function checkAndNotify() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const red = S.items.filter(it => itemStatus(it).key === 'RED');
  const orange = S.items.filter(it => itemStatus(it).key === 'ORANGE');
  const lowStock = S.items.filter(it => it.minStock > 0 && it.qty <= it.minStock);
  const recalls = (S.recalls || []).filter(r => r.active !== false);
  const key = `${red.length}-${orange.length}-${lowStock.length}-${recalls.length}`;
  if (key === _lastNotifKey) return;
  _lastNotifKey = key;
  // Priority: recalls > expired > near-expiry > low stock
  if (recalls.length > 0) {
    try { new Notification(`🚨 ยาถูกเรียกคืน ${recalls.length} รายการ`, {
      body: recalls.slice(0,2).map(r => `• ${r.drugName} Lot ${r.lotNo}`).join('\n'),
      icon: '/icons/icon.svg', tag: 'pharmacare-recall', requireInteraction: true }); } catch(e) {}
  }
  if (red.length > 0) {
    try { new Notification(`⛔ ยาหมดอายุ ${red.length} รายการ`, {
      body: red.slice(0,3).map(it => `• ${it.name} (${daysLeft(it.exp)<0?`หมดอายุแล้ว`:`เหลือ ${daysLeft(it.exp)} วัน`})`).join('\n'),
      icon: '/icons/icon.svg', tag: 'pharmacare-alert', requireInteraction: true }); } catch(e) {}
  } else if (orange.length > 0) {
    try { new Notification(`⚠ ยาใกล้หมดอายุ ${orange.length} รายการ`, {
      body: orange.slice(0,3).map(it => `• ${it.name} · ${daysLeft(it.exp)} วัน`).join('\n'),
      icon: '/icons/icon.svg', tag: 'pharmacare-alert' }); } catch(e) {}
  }
  if (lowStock.length > 0) {
    try { new Notification(`📦 สต๊อกต่ำ ${lowStock.length} รายการ`, {
      body: lowStock.slice(0,3).map(it => `• ${it.name} เหลือ ${it.qty}/${it.minStock}`).join('\n'),
      icon: '/icons/icon.svg', tag: 'pharmacare-stock' }); } catch(e) {}
  }
}

async function saveToFirestore(item) {
  if (typeof drugsRef === 'undefined') return;
  try {
    const data = {
      name: item.name, generic: item.gen||'', batch: item.lot||'',
      expiry: item.exp instanceof Date ? item.exp.toISOString().slice(0,10) : item.exp,
      stock: item.qty||0, unit: 'units', loc: item.loc||'SUBSTOCK',
      isEmergency: !!item.highAlert, minStock: item.minStock||0, cat: 'Other',
      storage: item.cold ? 'Refrigerated (2–8°C)' : 'Room Temperature (15–25°C)',
      gtin: item.gtin || '', lasa: !!item.lasa,
      mfd: item.mfd instanceof Date ? item.mfd.toISOString().slice(0,10) : (item.mfd || ''),
      dept: item.dept || S.dept || 'OPD',
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    };
    await drugsRef.add(data);
  } catch(e) { console.warn('Firestore save error:', e); }
}

// ── OFFLINE MONITOR ───────────────────────────────────
function initOfflineMonitor() {
  window.addEventListener('online', () => {
    S.offlineMode = false;
    if (S.screen === 'app') updateNavTabs();
    showToast('📶 กลับมาออนไลน์แล้ว', '#2ee6a6');
  });
  window.addEventListener('offline', () => {
    S.offlineMode = true;
    if (S.screen === 'app') updateNavTabs();
    showToast('📴 ออฟไลน์ — ข้อมูลอาจไม่อัปเดต', '#ff9f43');
  });
}

// ── AUTO-LOCK ─────────────────────────────────────────
function initAutoLock() {
  ['pointerdown','keydown','touchstart'].forEach(e =>
    document.addEventListener(e, () => {
      S.lastActivity = Date.now();
    }, { passive: true })
  );
  setInterval(() => {
    if (S.screen !== 'app') return;
    const idle = (Date.now() - S.lastActivity) / 60000;
    if (idle >= S.autoLockMins) {
      speak('ล็อกหน้าจออัตโนมัติ');
      addLog('Auto-lock', `ไม่มีการใช้งาน ${S.autoLockMins} นาที`);
      try { localStorage.removeItem('session'); } catch(e) {}
      S.screen = 'lock'; S.user = null;
      renderScreen();
    }
  }, 30000);
}

// ── EDGE GLOW (Calm Ambient Alert) ────────────────────
// Conveys overall stock health silently via phone-frame glow — no popup
function updateEdgeGlow() {
  const phone = document.getElementById('pc-phone');
  if (!phone) return;
  phone.classList.remove('eglow-red', 'eglow-orange', 'eglow-yellow');
  if (S.screen !== 'app') return;
  const keys = S.items.map(it => itemStatus(it).key);
  if (keys.includes('RED'))    phone.classList.add('eglow-red');
  else if (keys.includes('ORANGE')) phone.classList.add('eglow-orange');
  else if (keys.includes('YELLOW')) phone.classList.add('eglow-yellow');
}

// ── PROGRESSIVE DISCLOSURE (Long Press Popover) ────────
let _lpTimer = null;
let _lpCurrentItem = null;

function initLongPress() {
  document.querySelectorAll('.drug-card[data-id]').forEach(card => {
    card.addEventListener('touchstart', () => {
      clearTimeout(_lpTimer);
      _lpTimer = setTimeout(() => lpShow(card), 620);
    }, { passive: true });
    ['touchend','touchmove','touchcancel'].forEach(ev =>
      card.addEventListener(ev, () => clearTimeout(_lpTimer), { passive: true }));
    card.addEventListener('contextmenu', e => { e.preventDefault(); lpShow(card); });
  });
}

function lpShow(card) {
  const it = S.items.find(x => x.id === card.dataset.id || x.lot === card.dataset.id);
  if (!it) return;
  _lpCurrentItem = it;
  vibrate([8, 40, 8]);
  const st = itemStatus(it);
  const dl = daysLeft(it.exp);
  const total = Math.max((it.age || 0) + Math.max(dl, 0), 1);
  const agePct  = Math.min(((it.age || 0) / total) * 100, 100).toFixed(1);
  const remPct  = Math.min((Math.max(dl, 0) / total) * 100, 100).toFixed(1);

  document.getElementById('lp-pop')?.remove();
  document.getElementById('lp-bd')?.remove();

  const pop = document.createElement('div');
  pop.id = 'lp-pop';
  pop.className = 'lp-pop';
  pop.innerHTML = `
    <div class="lp-hdr">
      <div class="lp-nm">${it.name}</div>
      <button class="lp-x" onclick="lpClose()">✕</button>
    </div>
    <div class="lp-tl">
      <div class="lp-tl-label">อายุการใช้งาน</div>
      <div class="lp-tl-track">
        <div class="lp-tl-used" style="width:${agePct}%"></div>
        <div class="lp-tl-rem"  style="width:${remPct}%;background:${st.c}88"></div>
      </div>
      <div class="lp-tl-row">
        <span>ใช้แล้ว ${it.age||0} วัน</span>
        <span style="color:${st.c}">${dl<0?'หมดอายุแล้ว':'เหลือ '+dl+' วัน'}</span>
      </div>
    </div>
    <div class="lp-rows">
      <div class="lp-row"><span class="lp-lbl">Lot No.</span><span class="lp-val mono">${it.lot}</span></div>
      <div class="lp-row"><span class="lp-lbl">จำนวน</span><span class="lp-val">${it.qty} หน่วย</span></div>
      <div class="lp-row"><span class="lp-lbl">ตำแหน่ง</span><span class="lp-val">${it.loc==='FRONT_SHELF'?'🛎 หน้าเคาน์เตอร์':'📦 คลัง'}</span></div>
    </div>
    <div class="lp-footer">
      <button class="lp-detail-btn" onclick="lpOpenFull()">ดูข้อมูลเต็ม →</button>
    </div>`;

  const bd = document.createElement('div');
  bd.id = 'lp-bd';
  bd.className = 'lp-bd';
  bd.addEventListener('click', lpClose);

  const scr = document.getElementById('app-screen') || document.getElementById('screen');
  if (scr) { scr.appendChild(bd); scr.appendChild(pop); }
  setTimeout(() => pop.classList.add('visible'), 10);
  setTimeout(lpClose, 7000);
}

function lpClose() {
  document.getElementById('lp-pop')?.remove();
  document.getElementById('lp-bd')?.remove();
}

function lpOpenFull() {
  lpClose();
  if (_lpCurrentItem) showDrugSheet(_lpCurrentItem);
}

// ── GAMIFICATION (Scan Streak) ─────────────────────────
function getStreakData() {
  try {
    const d = JSON.parse(localStorage.getItem('scanStreak') || '{}');
    const today  = new Date().toDateString();
    const yest   = new Date(Date.now() - 86400000).toDateString();
    if (d.lastDay === today)  return d;
    if (d.lastDay === yest)   return { streak: d.streak, lastDay: d.lastDay, total: d.total || 0 };
    return { streak: 0, lastDay: today, total: d.total || 0 };
  } catch(e) { return { streak: 0, lastDay: '', total: 0 }; }
}

function bumpStreak() {
  try {
    const today = new Date().toDateString();
    const d = getStreakData();
    const yest = new Date(Date.now() - 86400000).toDateString();
    const streak = (d.lastDay === yest || d.lastDay === today) ? d.streak + (d.lastDay === today ? 0 : 1) : 1;
    const total  = (d.total || 0) + 1;
    localStorage.setItem('scanStreak', JSON.stringify({ streak, lastDay: today, total }));
    if (total % 25 === 0) showToast(`🏆 สแกนยาแล้ว ${total} ครั้ง! ยอดเยี่ยม`, '#ffd23f');
    else if (streak > 1 && streak % 7 === 0) showToast(`🔥 ${streak} วันติดต่อกัน! ต่อเนื่องมาก`, '#ff9f43');
    return { streak, total };
  } catch(e) { return { streak: 0, total: 0 }; }
}

function streakBadgeHTML() {
  const d = getStreakData();
  if (!d.total) return '';
  return `<div class="streak-badge">
    <span class="streak-fire">🔥</span>
    <span class="streak-num">${d.streak}</span>
    <span class="streak-lbl">วัน · ${d.total} ครั้ง</span>
  </div>`;
}

// ── STRESS-AWARE UI ────────────────────────────────────
const _tapLog = [];
let _stressMode = false;
function detectStress() {
  const now = Date.now();
  _tapLog.push(now);
  while (_tapLog.length > 0 && now - _tapLog[0] > 1200) _tapLog.shift();
  _stressMode = _tapLog.length >= 4;
  if (_stressMode) document.getElementById('pc-root')?.classList.add('stress-mode');
  else document.getElementById('pc-root')?.classList.remove('stress-mode');
}

function stressToast(msg, color) {
  const dur = _stressMode ? 5500 : 2800;
  const el = document.getElementById('toast');
  el.style.borderColor = (color||'#2dd4bf') + '66';
  el.style.boxShadow = `0 0 28px -6px ${color||'#2dd4bf'}66`;
  el.innerHTML = `<span style="flex:1">${msg}</span>`;
  el.classList.remove('hidden');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => el.classList.add('hidden'), dur);
}

// ── AI COPILOT (Natural Language) ─────────────────────
const NL_MAP = [
  { re: /หมดอายุ|expired|วิกฤต|ด่วน|recall|ถูกเรียกคืน/i,  id:'emerg' },
  { re: /ใกล้หมด|คืนบริษัท|ส้ม|orange/i,                  id:'recall' },
  { re: /รายงาน|สรุป|กราฟ|สถิติ|kpi|dashboard/i,           id:'dash' },
  { re: /ตั้งค่า|setting|config|เกณฑ์|ธีม/i,               id:'cfg' },
  { re: /focus|โฟกัส|ซ่อน/i,                               id:'focus' },
  { re: /ล็อก|ออก|logout|lock/i,                           id:'lock' },
  { re: /สแกน|กล้อง|scan/i,                                id:'scan' },
  { re: /คลัง|stock|รายการยา/i,                            id:'stock' },
];
function nlResolve(q) {
  for (const p of NL_MAP) if (p.re.test(q)) return CMD_ACTIONS.find(c => c.id === p.id);
  return null;
}

// ── POKA-YOKE (Error Prevention) ──────────────────────
function pokaShake(el) {
  if (!el) return;
  el.classList.remove('poka-shake');
  void el.offsetWidth;
  el.classList.add('poka-shake');
  setTimeout(() => el.classList.remove('poka-shake'), 600);
  vibrate([8, 60, 8, 60, 8]);
  sfx('error');
}

// ── CONTEXT-AWARE FOCUS MODE ─────────────────────────
function getFocusMode() {
  if (S.focusManual === true) return true;
  if (S.focusManual === false) return false;
  const h = new Date().getHours();
  return h >= 8 && h < 12;
}

function toggleFocusMode() {
  // Cycle: auto → force-on → force-off → auto
  if (S.focusManual === null) S.focusManual = true;
  else if (S.focusManual === true) S.focusManual = false;
  else S.focusManual = null;
  const fm = getFocusMode();
  renderScreen();
  showToast(fm ? '◎ Focus Mode เปิดแล้ว — ซ่อนเมนูที่ไม่จำเป็น' : '◎ Focus Mode ปิด — แสดงเมนูทั้งหมด', '#ff9f43');
}

// ── COMMAND PALETTE ────────────────────────────────────
let _cmdQuery = '';
const CMD_ACTIONS = [
  { id:'scan',   label:'สแกนยา',              sub:'เปิดหน้ากล้องสแกนบาร์โค้ด',      icon:'⊹', color:'#009E9E', act:() => { S.tab='scan';   renderAppBody(); updateNavTabs(); } },
  { id:'stock',  label:'คลังยา',              sub:'ดูรายการยาและสต็อกทั้งหมด',       icon:'▤', color:'#6366f1', act:() => { S.tab='stock';  renderAppBody(); updateNavTabs(); } },
  { id:'dash',   label:'รายงาน & KPI',         sub:'กราฟสรุปและสถิติยา',             icon:'◳', color:'#0ea5e9', act:() => { S.tab='dash';   renderAppBody(); updateNavTabs(); } },
  { id:'cfg',    label:'ตั้งค่าระบบ',           sub:'เกณฑ์แจ้งเตือน เสียง ธีม',       icon:'⚙', color:'#8b5cf6', act:() => { S.tab='cfg';    renderAppBody(); updateNavTabs(); } },
  { id:'focus',  label:'สลับ Focus Mode',       sub:'ซ่อน/แสดงเมนูตามช่วงเวลา',       icon:'◎', color:'#ff9f43', act:toggleFocusMode },
  { id:'recall', label:'ยาถูกเรียกคืน (Recall)', sub:'กรองยาที่ต้องคืนบริษัท',          icon:'⚠', color:'#ff4d5e', act:() => { S.tab='stock'; S.stockFilter='orange'; renderAppBody(); updateNavTabs(); } },
  { id:'emerg',  label:'ยาวิกฤต / ยาหมดอายุ',   sub:'แสดงยาสถานะ RED ทั้งหมด',         icon:'⬢', color:'#ff4d5e', act:() => { S.tab='stock'; S.stockFilter='red'; renderAppBody(); updateNavTabs(); } },
  { id:'lock',   label:'ล็อกหน้าจอ',            sub:'กลับสู่หน้าเลือกผู้ใช้',          icon:'⏻', color:'#888',    act:() => { S.screen='lock'; S.user=null; S.loginStep='profiles'; renderScreen(); } },
];

function openCmdPalette() {
  if (S.screen !== 'app') return;
  S.cmdPaletteOpen = true; _cmdQuery = '';
  let el = document.getElementById('cmd-palette');
  if (!el) {
    el = document.createElement('div');
    el.id = 'cmd-palette';
    el.className = 'cmd-overlay';
    const appScr = document.getElementById('app-screen');
    if (appScr) appScr.appendChild(el);
  }
  el.innerHTML = `
    <div class="cmd-backdrop" id="cmd-bd"></div>
    <div class="cmd-box">
      <div class="cmd-search-row">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--ink3)" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="21" y2="21"/></svg>
        <input id="cmd-input" class="cmd-input" placeholder="พิมพ์ชื่อยา หรือคำสั่ง..." autocomplete="off" spellcheck="false">
        <span class="cmd-esc" onclick="closeCmdPalette()">ESC</span>
      </div>
      <div class="cmd-results" id="cmd-results"></div>
    </div>`;
  document.getElementById('cmd-bd').addEventListener('click', closeCmdPalette);
  const inp = document.getElementById('cmd-input');
  inp.addEventListener('input', e => { _cmdQuery = e.target.value; renderCmdResults(); });
  inp.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeCmdPalette();
    if (e.key === 'Enter') { const f = document.querySelector('.cmd-item'); if (f) f.click(); }
  });
  setTimeout(() => inp.focus(), 60);
  renderCmdResults();
  vibrate(8); sfx('tick');
}

function closeCmdPalette() {
  S.cmdPaletteOpen = false;
  const el = document.getElementById('cmd-palette');
  if (el) el.remove();
}

function renderCmdResults() {
  const el = document.getElementById('cmd-results'); if (!el) return;
  const q = _cmdQuery.toLowerCase().trim();

  // AI Copilot: NL pattern matching
  const nlMatch = q.length > 2 ? nlResolve(q) : null;

  const drugs = q.length > 0 ? S.items.filter(it =>
    it.name.toLowerCase().includes(q) ||
    (it.gen||'').toLowerCase().includes(q) ||
    (it.lot||'').toUpperCase().includes(q.toUpperCase())
  ).slice(0, 6) : [];

  const cmds = CMD_ACTIONS.filter(c =>
    q.length === 0 ||
    c.label.toLowerCase().includes(q) ||
    c.sub.toLowerCase().includes(q) ||
    c.id.includes(q)
  );

  let html = '';

  // NL Copilot suggestion at top
  if (nlMatch && !cmds.find(c => c.id === nlMatch.id)) {
    html += `<div class="cmd-section">✨ AI Copilot</div>
      <div class="cmd-item cmd-nl" onclick="cmdExec('${nlMatch.id}')">
        <div class="cmd-item-icon" style="background:${nlMatch.color}22;color:${nlMatch.color};font-size:15px;font-weight:700">${nlMatch.icon}</div>
        <div class="cmd-item-body">
          <div class="cmd-item-name">${nlMatch.label}</div>
          <div class="cmd-item-sub">AI เดาจากคำว่า "${_cmdQuery}"</div>
        </div>
        <span style="font-size:10px;color:var(--brand);font-weight:700">→ ไปได้เลย</span>
      </div>`;
  }

  if (drugs.length > 0) {
    html += `<div class="cmd-section">ยาในคลัง</div>`;
    html += drugs.map(it => {
      const st = itemStatus(it); const dl = daysLeft(it.exp);
      const idKey = it.id || it.lot;
      return `<div class="cmd-item" onclick="cmdOpenDrug('${idKey}')">
        <div class="cmd-item-icon" style="background:${st.c}22">${shapeIconSVG(st.shape,st.c,15)}</div>
        <div class="cmd-item-body">
          <div class="cmd-item-name">${it.name}</div>
          <div class="cmd-item-sub">Lot ${it.lot} · ${dl < 0 ? 'หมดอายุแล้ว' : 'เหลือ '+dl+' วัน'}</div>
        </div>
        <span class="cmd-item-badge" style="background:${st.c}33;color:${st.c}">${st.key}</span>
      </div>`;
    }).join('');
  }

  if (cmds.length > 0) {
    html += `<div class="cmd-section">${q ? 'คำสั่ง' : 'คำสั่งด่วน'}</div>`;
    html += cmds.map(c => `<div class="cmd-item" onclick="cmdExec('${c.id}')">
      <div class="cmd-item-icon" style="background:${c.color}22;color:${c.color};font-size:15px;font-weight:700">${c.icon}</div>
      <div class="cmd-item-body">
        <div class="cmd-item-name">${c.label}</div>
        <div class="cmd-item-sub">${c.sub}</div>
      </div>
    </div>`).join('');
  }

  if (!html) {
    html = `<div class="cmd-empty">ไม่พบ "<strong>${_cmdQuery}</strong>" — ลองพิมพ์ชื่อยา, Lot No. หรือคำสั่งภาษาไทย</div>`;
  }
  el.innerHTML = html;
}

function cmdExec(id) {
  const c = CMD_ACTIONS.find(x => x.id === id);
  if (c) { closeCmdPalette(); c.act(); }
}

function cmdOpenDrug(idOrLot) {
  const it = S.items.find(x => x.id === idOrLot || x.lot === idOrLot);
  closeCmdPalette();
  if (it) showDrugSheet(it);
}

// ── DATA SONIFICATION (Chord UX) ─────────────────────
// Each drug status maps to a musical chord so staff can "hear" safety at a glance.
// GREEN=C major (bright/resolved), YELLOW=A minor (cautious),
// ORANGE=F diminished (tense), RED=half-diminished + bass rumble (urgent).
function playScanChord(statusKey, highAlert) {
  if (!S.settings.soundOn) return;
  const ac = getAC(); if (!ac) return;
  const t0 = ac.currentTime;
  const chords = {
    GREEN:  [[523.25,0],[659.25,0.02],[783.99,0.04]],
    YELLOW: [[440,0],[523.25,0.02],[659.25,0.04]],
    ORANGE: [[349.23,0],[415.30,0.02],[493.88,0.04]],
    RED:    [[261.63,0],[311.13,0.02],[369.99,0.04],[440,0.06]],
  };
  const durs  = { GREEN:0.55, YELLOW:0.65, ORANGE:0.72, RED:0.85 };
  const gains = { GREEN:0.15, YELLOW:0.14, ORANGE:0.14, RED:0.12 };
  const notes = chords[statusKey] || chords.GREEN;
  const dur = durs[statusKey] || 0.55;
  const g0  = gains[statusKey] || 0.15;
  notes.forEach(([freq, delay]) => {
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = statusKey === 'RED' ? 'triangle' : 'sine';
    o.frequency.setValueAtTime(freq, t0 + delay);
    g.gain.setValueAtTime(0, t0 + delay);
    g.gain.linearRampToValueAtTime(g0, t0 + delay + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + dur);
    o.connect(g); g.connect(ac.destination);
    o.start(t0 + delay); o.stop(t0 + delay + dur + 0.02);
  });
  if (statusKey === 'RED') {
    const o2 = ac.createOscillator(), g2 = ac.createGain();
    o2.type = 'sawtooth'; o2.frequency.setValueAtTime(62, t0);
    g2.gain.setValueAtTime(0.07, t0);
    g2.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.7);
    o2.connect(g2); g2.connect(ac.destination);
    o2.start(t0); o2.stop(t0 + 0.75);
  }
  if (highAlert) {
    setTimeout(() => {
      const ac2 = getAC(); if (!ac2) return;
      const t = ac2.currentTime + 0.05;
      const o3 = ac2.createOscillator(), g3 = ac2.createGain();
      o3.type = 'sawtooth';
      o3.frequency.setValueAtTime(700, t);
      o3.frequency.linearRampToValueAtTime(1100, t + 0.14);
      o3.frequency.linearRampToValueAtTime(700, t + 0.28);
      g3.gain.setValueAtTime(0.17, t);
      g3.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
      o3.connect(g3); g3.connect(ac2.destination);
      o3.start(t); o3.stop(t + 0.35);
    }, 640);
  }
}

// ── CROSS-DEVICE HANDOFF (Firestore) ─────────────────
const _handoffSid = Math.random().toString(36).slice(2, 10);
let _handoffUnsub = null;

function handoffWrite(item, status) {
  if (typeof db === 'undefined' || !S.user) return;
  try {
    db.collection('handoff').doc(S.user.id).set({
      userId: S.user.id, userName: S.user.name,
      drugName: item.name, lot: item.lot || '',
      statusKey: status.key, statusColor: status.c, statusLabel: status.label,
      ts: firebase.firestore.FieldValue.serverTimestamp(),
      sid: _handoffSid,
    });
  } catch(e) {}
}

function handoffListen() {
  if (typeof db === 'undefined' || !S.user) return;
  if (_handoffUnsub) { _handoffUnsub(); _handoffUnsub = null; }
  try {
    _handoffUnsub = db.collection('handoff').doc(S.user.id)
      .onSnapshot(snap => {
        const d = snap.data();
        if (!d || d.sid === _handoffSid) return;
        const tsMs = d.ts?.toDate ? d.ts.toDate().getTime() : 0;
        if (Date.now() - tsMs > 25000) return;
        showHandoffBar(d);
      });
  } catch(e) {}
}

function showHandoffBar(d) {
  const phone = document.getElementById('pc-phone');
  if (!phone) return;
  let bar = document.getElementById('handoff-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'handoff-bar';
    phone.appendChild(bar);
  }
  bar._hData = d;
  bar.innerHTML = `
    <div class="hb-pulse" style="background:${d.statusColor}"></div>
    <div class="hb-text">
      <span class="hb-main">กำลังสแกน <strong>${d.drugName}</strong> บนอุปกรณ์อื่น</span>
      <span class="hb-sub">${d.statusLabel} · แตะเพื่อดูรายละเอียด</span>
    </div>
    <button class="hb-btn" onclick="handoffOpen()">เปิดดู</button>
    <button class="hb-close" onclick="document.getElementById('handoff-bar').remove()">✕</button>`;
  requestAnimationFrame(() => bar.classList.add('visible'));
  clearTimeout(bar._t);
  bar._t = setTimeout(() => {
    bar.classList.remove('visible');
    setTimeout(() => { const b = document.getElementById('handoff-bar'); if(b) b.remove(); }, 450);
  }, 18000);
}

function handoffOpen() {
  const bar = document.getElementById('handoff-bar');
  if (!bar?._hData) return;
  const d = bar._hData;
  bar.remove();
  const item = S.items.find(it => it.lot === d.lot) ||
    { name: d.drugName, lot: d.lot, exp: new Date(Date.now() + 90*86400000), qty: 0, gen: '', loc: 'SUBSTOCK', highAlert: false, lasa: false, cold: false };
  showDrugSheet(item);
}

// ── PREDICTIVE PREFETCH ────────────────────────────────
const Prefetch = { camera: false, stock: false, dash: false };
const _rIC = window.requestIdleCallback || (fn => setTimeout(fn, 100));

function initPredictivePrefetch() {
  document.addEventListener('pointermove', e => {
    if (S.screen !== 'app') return;
    const nav = document.getElementById('app-nav');
    if (nav) {
      nav.querySelectorAll('.nav-tab').forEach(tab => {
        const r = tab.getBoundingClientRect();
        const d = Math.hypot(e.clientX - (r.left + r.width/2), e.clientY - (r.top + r.height/2));
        if (d < 90) prefetchTab(tab.dataset.tab, tab);
      });
    }
    if (!Prefetch.camera) {
      const camBtn = document.getElementById('camToggleBtn');
      if (camBtn) {
        const r = camBtn.getBoundingClientRect();
        if (Math.hypot(e.clientX - (r.left + r.width/2), e.clientY - (r.top + r.height/2)) < 110)
          prefetchCamera();
      }
    }
  }, { passive: true });

  document.addEventListener('touchmove', e => {
    if (S.screen !== 'app' || !e.touches[0]) return;
    const el = document.elementFromPoint(e.touches[0].clientX, e.touches[0].clientY);
    const tab = el?.closest?.('.nav-tab');
    if (tab) prefetchTab(tab.dataset.tab, tab);
  }, { passive: true });
}

function prefetchTab(tabName, tabEl) {
  if (tabName === 'scan' && !Prefetch.camera) { prefetchCamera(); return; }
  if (tabName === 'stock' && !Prefetch.stock) {
    Prefetch.stock = true;
    _rIC(() => {
      S._stockSorted = [...S.items].sort((a,b) => daysLeft(a.exp) - daysLeft(b.exp));
      if (tabEl) markTabPrefetched(tabEl);
    });
  }
  if (tabName === 'dash' && !Prefetch.dash) {
    Prefetch.dash = true;
    _rIC(() => {
      const c = { RED:0, ORANGE:0, YELLOW:0, GREEN:0 };
      S.items.forEach(it => c[itemStatus(it).key]++);
      S._dashCounts = c;
      if (tabEl) markTabPrefetched(tabEl);
    });
  }
}

function prefetchCamera() {
  Prefetch.camera = true;
  if (window.ZXing && !_zxingReader) {
    try { _zxingReader = new ZXing.BrowserMultiFormatReader(_zxingHints(), { delayBetweenScanAttempts: 250 }); } catch(e) {}
  }
  const t = document.querySelector('.nav-tab[data-tab="scan"]');
  if (t) markTabPrefetched(t);
}

function markTabPrefetched(tabEl) {
  if (tabEl.dataset.prefetch === 'ready') return;
  tabEl.dataset.prefetch = 'ready';
  setTimeout(() => delete tabEl.dataset.prefetch, 3000);
}

// ── AMBIENT LIGHT SENSOR ──────────────────────────────
function initAmbientLight() {
  const root = document.getElementById('pc-root');
  if (!root) return;
  if ('AmbientLightSensor' in window) {
    try {
      navigator.permissions.query({ name: 'ambient-light-sensor' })
        .then(perm => {
          if (perm.state === 'denied') { ambientFallback(root); return; }
          const sensor = new AmbientLightSensor({ frequency: 2 });
          sensor.addEventListener('reading', () => applyAmbientClass(root, sensor.illuminance));
          sensor.addEventListener('error', () => ambientFallback(root));
          sensor.start();
        }).catch(() => ambientFallback(root));
    } catch(e) { ambientFallback(root); }
  } else {
    ambientFallback(root);
  }
}

function applyAmbientClass(root, lux) {
  root.classList.remove('ambient-dim', 'ambient-bright', 'ambient-glare');
  if (lux < 20)        root.classList.add('ambient-dim');
  else if (lux > 8000) root.classList.add('ambient-glare');
  else if (lux > 1500) root.classList.add('ambient-bright');
}

function ambientFallback(root) {
  const h = new Date().getHours();
  root.classList.remove('ambient-dim', 'ambient-bright', 'ambient-glare');
  if (h < 6 || h >= 21) root.classList.add('ambient-dim');
  setTimeout(() => ambientFallback(root), 20 * 60 * 1000);
}

// ── PHONE SCALE (Desktop) ─────────────────────────────
function fitPhoneToViewport() {
  const phone = document.getElementById('pc-phone');
  if (!phone) return;
  if (window.innerWidth < 768) {
    phone.style.transform = '';
    phone.style.marginTop = '';
    phone.style.marginBottom = '';
    return;
  }
  const panelW = window.innerWidth >= 1440 ? 368 : 0; // 320 panel + 48 gap
  const availW = window.innerWidth - 48 - panelW;
  const availH = window.innerHeight - 48;
  const scale = Math.min(availH / 880, availW / 412, 1);
  if (scale < 0.99) {
    phone.style.transform = `scale(${scale.toFixed(3)})`;
    phone.style.transformOrigin = 'center center';
    const margin = -Math.round((880 - 880 * scale) / 2);
    phone.style.marginTop = margin + 'px';
    phone.style.marginBottom = margin + 'px';
  } else {
    phone.style.transform = '';
    phone.style.marginTop = '';
    phone.style.marginBottom = '';
  }
}

// ── DESKTOP INFO PANEL ────────────────────────────────
function renderDesktopPanel() {
  const root = document.getElementById('pc-root');
  if (!root) return;
  const existing = document.getElementById('desktop-panel');
  if (window.innerWidth < 1440 || S.screen !== 'app') {
    if (existing) existing.remove();
    return;
  }
  const counts = { RED: 0, ORANGE: 0, YELLOW: 0, GREEN: 0 };
  S.items.forEach(it => { const k = itemStatus(it).key; counts[k]++; });
  const alerts = S.items
    .filter(it => daysLeft(it.exp) <= 60)
    .sort((a, b) => daysLeft(a.exp) - daysLeft(b.exp))
    .slice(0, 5);
  const alertRows = alerts.map(it => {
    const st = itemStatus(it);
    return `<div class="dp-alert-item">
      <div style="width:8px;height:8px;border-radius:50%;background:${st.c};flex-shrink:0"></div>
      <div>
        <div class="dp-alert-name">${it.name}</div>
        <div class="dp-alert-sub">${st.label} · Lot ${it.lot}</div>
      </div>
    </div>`;
  }).join('');
  const html = `
    <div class="dp-card">
      <div class="dp-title">ภาพรวมระบบ</div>
      <div class="dp-kpi-row">
        <div class="dp-kpi">
          <div class="dp-kpi-val" style="color:#ff4d5e">${counts.RED}</div>
          <div class="dp-kpi-lbl">วิกฤต</div>
        </div>
        <div class="dp-kpi">
          <div class="dp-kpi-val" style="color:#ff9f43">${counts.ORANGE}</div>
          <div class="dp-kpi-lbl">ใกล้หมด</div>
        </div>
        <div class="dp-kpi">
          <div class="dp-kpi-val" style="color:#ffd23f">${counts.YELLOW}</div>
          <div class="dp-kpi-lbl">เฝ้าระวัง</div>
        </div>
        <div class="dp-kpi">
          <div class="dp-kpi-val" style="color:#2ee6a6">${counts.GREEN}</div>
          <div class="dp-kpi-lbl">ปลอดภัย</div>
        </div>
      </div>
    </div>
    ${alertRows ? `<div class="dp-card">
      <div class="dp-title">แจ้งเตือนด่วน</div>
      ${alertRows}
    </div>` : ''}
    <div class="dp-card dp-brand">
      <div class="dp-brand-name">PharmaCare AI</div>
      <div class="dp-brand-sub">รพ.กรงปินัง · Drug Safety System</div>
    </div>`;
  let panel = existing;
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'desktop-panel';
    root.appendChild(panel);
  }
  panel.innerHTML = html;
}

// ── FEATURE: PUSH NOTIFICATION PERMISSION ────────────
function requestNotifPermission() {
  if (!('Notification' in window)) {
    showToast('🔕 บราวเซอร์นี้ไม่รองรับการแจ้งเตือน', '#ff9f43'); return;
  }
  if (Notification.permission === 'granted') {
    new Notification('PharmaCare ✅', { body: 'การแจ้งเตือนเปิดอยู่แล้ว', icon: '/icons/icon.svg' });
    showToast('✅ การแจ้งเตือนเปิดอยู่แล้ว', '#2ee6a6'); return;
  }
  Notification.requestPermission().then(p => {
    if (p === 'granted') {
      showToast('✅ เปิดรับการแจ้งเตือนแล้ว', '#2ee6a6');
      new Notification('PharmaCare', { body: 'ระบบแจ้งเตือนยาพร้อมแล้ว 🔔', icon: '/icons/icon.svg' });
      updateTabBody();
    } else {
      showToast('❌ กรุณาอนุญาตในการตั้งค่าบราวเซอร์', '#ff4d5e');
    }
  });
}

// ── FEATURE: LOT RECALL TRACKING ─────────────────────
function initRecalls() {
  if (typeof recallsRef === 'undefined') return;
  recallsRef.where('active', '==', true).onSnapshot(snap => {
    S.recalls = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (S.screen === 'app' && S.tab === 'dash') renderAppBody();
    checkAndNotify();
  }, err => console.warn('Recalls sync:', err.code || err.message));
}

function checkRecall(result) {
  if (!result || !S.recalls?.length) return null;
  return S.recalls.find(r =>
    (r.lotNo && result.lot && r.lotNo === result.lot) ||
    (r.gtin  && result.gtin && r.gtin === result.gtin)
  ) || null;
}

function showRecallAlert(recall, item) {
  const appScreen = document.getElementById('app-screen');
  if (!appScreen) return;
  document.getElementById('recallOverlay')?.remove();
  const html = `
    <div class="overlay" id="recallOverlay">
      <div id="confirm-box" style="border:2px solid #ff4d5e">
        <div style="font-size:44px;text-align:center">🚨</div>
        <div style="font-size:17px;font-weight:700;text-align:center;color:#ff4d5e;margin-top:8px">ยาถูกเรียกคืน!</div>
        <div style="font-size:13px;color:var(--ink2);margin-top:10px;line-height:1.7;background:rgba(255,77,94,.08);border-radius:12px;padding:12px">
          <b>ยา:</b> ${recall.drugName || item?.name || '—'}<br>
          <b>Lot:</b> ${recall.lotNo || item?.lot || '—'}<br>
          <b>เหตุผล:</b> ${recall.reason || '—'}<br>
          <b>ออกโดย:</b> ${recall.issuedBy || '—'}
        </div>
        <div style="font-size:12px;color:#ff9f43;margin-top:8px">⚠ แยกยาออกจากชั้นทันที ห้ามจ่ายให้ผู้ป่วย</div>
        <div style="display:flex;gap:10px;margin-top:16px">
          <button id="recallCloseBtn" style="flex:1;padding:13px;border-radius:14px;border:1px solid var(--glassb);background:transparent;color:var(--ink);font-size:14px;font-weight:600;cursor:pointer;font-family:'Sarabun',sans-serif">รับทราบ</button>
          <button id="recallDisposalBtn" style="flex:1.3;padding:13px;border-radius:14px;border:none;cursor:pointer;font-size:14px;font-weight:700;font-family:'Sarabun',sans-serif;color:#fff;background:linear-gradient(135deg,#ff4d5e,#c81e2e)">🗑 ทำลายยา</button>
        </div>
      </div>
    </div>`;
  appScreen.insertAdjacentHTML('beforeend', html);
  sfx('error'); vibrate([50,100,50,100,50]);
  speak(`แจ้งเตือน ยา${recall.drugName||''}ถูกเรียกคืน กรุณาแยกยาออกทันที`);
  document.getElementById('recallCloseBtn')?.addEventListener('click', () => document.getElementById('recallOverlay')?.remove());
  document.getElementById('recallDisposalBtn')?.addEventListener('click', () => {
    document.getElementById('recallOverlay')?.remove();
    if (item) showDisposalModal(item);
  });
}

function showAddRecallModal() {
  const appScreen = document.getElementById('app-screen');
  if (!appScreen) return;
  document.getElementById('addRecallOverlay')?.remove();
  const html = `
    <div class="overlay sheet-overlay" id="addRecallOverlay">
      <div id="sheet-box">
        <div id="sheet-handle"></div>
        <div class="sheet-title">🚨 เพิ่มรายการ Recall</div>
        <div class="form-field"><label class="form-label">ชื่อยา *</label><input class="form-input" id="rcDrugName" placeholder="เช่น Paracetamol 500mg"></div>
        <div class="form-field"><label class="form-label">Lot No. *</label><input class="form-input" id="rcLotNo" placeholder="เช่น PC0021" style="font-family:'JetBrains Mono',monospace"></div>
        <div class="form-field"><label class="form-label">GTIN (ถ้ามี)</label><input class="form-input" id="rcGtin" placeholder="เลข 13 หลัก" type="tel" style="font-family:'JetBrains Mono',monospace"></div>
        <div class="form-field"><label class="form-label">เหตุผล *</label><input class="form-input" id="rcReason" placeholder="เช่น พบการปนเปื้อน ผิดมาตรฐาน"></div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="form-submit" style="flex:1;background:var(--glass);color:var(--ink);border:1px solid var(--glassb)" id="rcCancelBtn">ยกเลิก</button>
          <button class="form-submit" style="flex:1.3;background:linear-gradient(135deg,#ff4d5e,#c81e2e)" id="rcConfirmBtn">🚨 เพิ่ม Recall</button>
        </div>
      </div>
    </div>`;
  appScreen.insertAdjacentHTML('beforeend', html);
  document.getElementById('rcCancelBtn')?.addEventListener('click', () => document.getElementById('addRecallOverlay')?.remove());
  document.getElementById('addRecallOverlay')?.addEventListener('click', e => { if (e.target.id==='addRecallOverlay') document.getElementById('addRecallOverlay')?.remove(); });
  document.getElementById('rcConfirmBtn')?.addEventListener('click', async () => {
    const drugName = document.getElementById('rcDrugName')?.value.trim();
    const lotNo = document.getElementById('rcLotNo')?.value.trim();
    const gtin  = document.getElementById('rcGtin')?.value.trim();
    const reason = document.getElementById('rcReason')?.value.trim();
    if (!drugName || !lotNo || !reason) { showToast('⚠ กรุณากรอกข้อมูลให้ครบ', '#ff9f43'); return; }
    const record = { drugName, lotNo, gtin: gtin||'', reason, active: true,
      issuedBy: S.user?.name||'Admin', issuedAt: firebase.firestore.FieldValue.serverTimestamp() };
    if (typeof recallsRef !== 'undefined') {
      await recallsRef.add(record).catch(e => console.warn('Recall add:', e));
    } else {
      S.recalls.push({ ...record, id: 'local-' + Date.now(), issuedAt: new Date() });
    }
    addLog('เพิ่ม Recall', `${drugName} · Lot ${lotNo} · ${reason}`);
    sfx('success'); showToast(`✅ เพิ่ม Recall: ${drugName}`, '#ff4d5e');
    document.getElementById('addRecallOverlay')?.remove();
    renderAppBody();
  });
}

// ── FEATURE: DISPOSAL LOG ─────────────────────────────
function showDisposalModal(item) {
  const appScreen = document.getElementById('app-screen');
  if (!appScreen) return;
  document.getElementById('disposalOverlay')?.remove();
  const html = `
    <div class="overlay sheet-overlay" id="disposalOverlay">
      <div id="sheet-box">
        <div id="sheet-handle"></div>
        <div class="sheet-title">🗑 บันทึกการทำลายยา</div>
        <div style="font-size:12px;color:var(--ink3);margin-bottom:14px">HA/JCI — ต้องมีผู้ยืนยัน 2 คน · บันทึกเข้าระบบถาวร</div>
        <div style="padding:12px;border-radius:13px;background:rgba(255,77,94,.1);border:1px solid rgba(255,77,94,.3);margin-bottom:16px">
          <div style="font-weight:700;color:#ff4d5e">${item.name}</div>
          <div style="font-size:12px;color:var(--ink2);margin-top:2px">Lot ${item.lot} · คงเหลือ ${item.qty} หน่วย</div>
        </div>
        <div class="form-field">
          <label class="form-label">เหตุผลการทำลาย *</label>
          <select class="form-select" id="dispReason">
            <option value="expired">หมดอายุ</option>
            <option value="recall">ยาถูกเรียกคืน (Recall)</option>
            <option value="damaged">เสียหาย / แตกหัก</option>
            <option value="contaminated">ปนเปื้อน</option>
            <option value="other">อื่นๆ</option>
          </select>
        </div>
        <div class="form-field">
          <label class="form-label">จำนวนที่ทำลาย (หน่วย) *</label>
          <input class="form-input" id="dispQty" type="number" value="${item.qty}" min="1" max="${item.qty}">
        </div>
        <div class="form-field">
          <label class="form-label">ผู้ทำลายที่ 1 * (ต้องเป็นเภสัชกร)</label>
          <input class="form-input" id="dispPerson1" value="${S.user?.name||''}" placeholder="ชื่อ-นามสกุล">
        </div>
        <div class="form-field">
          <label class="form-label">ผู้ยืนยันที่ 2 * (ต้องเป็นบุคคลอื่น)</label>
          <input class="form-input" id="dispPerson2" placeholder="ชื่อเภสัชกร / ผู้ช่วย">
        </div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="form-submit" style="flex:1;background:var(--glass);color:var(--ink);border:1px solid var(--glassb)" id="dispCancelBtn">ยกเลิก</button>
          <button class="form-submit" style="flex:1.3;background:linear-gradient(135deg,#ff4d5e,#c81e2e)" id="dispConfirmBtn">✓ ยืนยันทำลาย</button>
        </div>
      </div>
    </div>`;
  appScreen.insertAdjacentHTML('beforeend', html);
  document.getElementById('dispCancelBtn')?.addEventListener('click', () => document.getElementById('disposalOverlay')?.remove());
  document.getElementById('disposalOverlay')?.addEventListener('click', e => { if (e.target.id==='disposalOverlay') document.getElementById('disposalOverlay')?.remove(); });
  document.getElementById('dispConfirmBtn')?.addEventListener('click', async () => {
    const reason = document.getElementById('dispReason')?.value;
    const qty    = parseInt(document.getElementById('dispQty')?.value || '0');
    const p1     = document.getElementById('dispPerson1')?.value.trim();
    const p2     = document.getElementById('dispPerson2')?.value.trim();
    if (!p1 || !p2) { showToast('⚠ กรุณาระบุผู้ทำลายและผู้ยืนยัน', '#ff9f43'); return; }
    if (p1.toLowerCase() === p2.toLowerCase()) { showToast('⚠ ต้องเป็น 2 คนที่แตกต่างกัน', '#ff4d5e'); return; }
    if (!qty || qty <= 0) { showToast('⚠ กรุณาระบุจำนวน', '#ff9f43'); return; }
    const record = { drugId: item.id, drugName: item.name, lot: item.lot, gtin: item.gtin||'',
      qty, reason, approvedBy1: p1, approvedBy2: p2,
      disposedAt: firebase.firestore.FieldValue.serverTimestamp(), dept: S.dept };
    if (typeof disposalsRef !== 'undefined') {
      await disposalsRef.add(record).catch(e => console.warn('Disposal save:', e));
    }
    const idx = S.items.findIndex(x => x.id === item.id);
    if (idx >= 0) {
      if (qty >= S.items[idx].qty) {
        S.items.splice(idx, 1);
        if (typeof drugsRef !== 'undefined' && item._fromFirestore) drugsRef.doc(item.id).delete().catch(()=>{});
      } else {
        S.items[idx].qty -= qty;
        if (typeof drugsRef !== 'undefined' && item._fromFirestore) drugsRef.doc(item.id).update({ stock: S.items[idx].qty }).catch(()=>{});
      }
    }
    addLog('ทำลายยา', `${item.name} · Lot ${item.lot} · ${qty} หน่วย · ${p1} & ${p2}`);
    sfx('success'); vibrate([8,40,12]);
    showToast(`✅ บันทึกการทำลาย ${item.name} × ${qty} หน่วย`, '#2ee6a6');
    document.getElementById('disposalOverlay')?.remove();
    document.getElementById('sheetOverlay')?.remove();
    renderAppBody(); updateNavTabs();
  });
}

// ── FEATURE: NEAR-EXPIRY RETURN WORKFLOW ──────────────
function showReturnWorkflowModal(item) {
  const appScreen = document.getElementById('app-screen');
  if (!appScreen) return;
  document.getElementById('returnOverlay')?.remove();
  const dl = daysLeft(item.exp);
  const html = `
    <div class="overlay sheet-overlay" id="returnOverlay">
      <div id="sheet-box">
        <div id="sheet-handle"></div>
        <div class="sheet-title">↩ คืนยาบริษัท</div>
        <div style="padding:12px;border-radius:13px;background:rgba(255,159,67,.1);border:1px solid rgba(255,159,67,.3);margin-bottom:16px">
          <div style="font-weight:700;color:#ff9f43">${item.name}</div>
          <div style="font-size:12px;color:var(--ink2);margin-top:2px">Lot ${item.lot} · หมดอายุ ${fmtDate(item.exp)} (${dl} วัน) · ${item.qty} หน่วย</div>
        </div>
        <div class="return-steps">
          <div class="return-step"><div class="return-step-num">1</div><div><div class="return-step-title">แยกยาออกจากชั้น</div><div class="return-step-sub">ติด Label "รอคืน" และวางในพื้นที่กักยา</div></div></div>
          <div class="return-step"><div class="return-step-num">2</div><div><div class="return-step-title">ติดต่อบริษัทยา</div><div class="return-step-sub">แจ้ง Lot ${item.lot} · ${item.qty} หน่วย · หมดอายุ ${fmtDate(item.exp)}</div></div></div>
          <div class="return-step"><div class="return-step-num">3</div><div><div class="return-step-title">รับ Credit Note</div><div class="return-step-sub">แนบในแฟ้มเอกสาร HA และบันทึกใบส่งคืน</div></div></div>
        </div>
        <div class="form-field" style="margin-top:16px">
          <label class="form-label">บริษัทผู้จำหน่าย</label>
          <input class="form-input" id="retSupplier" placeholder="ชื่อบริษัทยา">
        </div>
        <div class="form-field">
          <label class="form-label">วันที่แจ้งคืน</label>
          <input class="form-input" type="date" id="retDate" value="${new Date().toISOString().slice(0,10)}">
        </div>
        <div class="form-field">
          <label class="form-label">หมายเหตุ</label>
          <input class="form-input" id="retNote" placeholder="ข้อมูลเพิ่มเติม">
        </div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="form-submit" style="flex:1;background:var(--glass);color:var(--ink);border:1px solid var(--glassb)" id="retCancelBtn">ปิด</button>
          <button class="form-submit" style="flex:1.3;background:linear-gradient(135deg,#ff9f43,#e67e00)" id="retConfirmBtn">✓ บันทึกคืนยา</button>
        </div>
      </div>
    </div>`;
  appScreen.insertAdjacentHTML('beforeend', html);
  document.getElementById('retCancelBtn')?.addEventListener('click', () => document.getElementById('returnOverlay')?.remove());
  document.getElementById('retConfirmBtn')?.addEventListener('click', () => {
    const supplier = document.getElementById('retSupplier')?.value.trim() || '—';
    const date     = document.getElementById('retDate')?.value || new Date().toISOString().slice(0,10);
    const note     = document.getElementById('retNote')?.value.trim() || '';
    addLog('คืนยาบริษัท', `${item.name} · Lot ${item.lot} · ${supplier} · ${date}${note?' · '+note:''}`);
    sfx('success'); vibrate([8,40]);
    showToast(`✅ บันทึกคืนยา ${item.name} แล้ว`, '#ff9f43');
    document.getElementById('returnOverlay')?.remove();
  });
}

// ── FEATURE: DISPENSING RECORD ────────────────────────
function showDispenseModal(item) {
  const appScreen = document.getElementById('app-screen');
  if (!appScreen) return;
  document.getElementById('dispenseOverlay')?.remove();
  const html = `
    <div class="overlay sheet-overlay" id="dispenseOverlay">
      <div id="sheet-box">
        <div id="sheet-handle"></div>
        <div class="sheet-title">💊 จ่ายยา</div>
        <div style="padding:12px;border-radius:13px;background:rgba(0,158,158,.1);border:1px solid rgba(0,158,158,.3);margin-bottom:16px">
          <div style="font-weight:700;color:#009E9E">${item.name}</div>
          <div style="font-size:12px;color:var(--ink2);margin-top:2px">Lot ${item.lot} · คงเหลือ ${item.qty} หน่วย</div>
        </div>
        <div class="form-field">
          <label class="form-label">HN (เลขประจำตัวผู้ป่วย)</label>
          <input class="form-input" id="dspHN" placeholder="เช่น 12345678" type="tel" inputmode="numeric">
        </div>
        <div class="form-field">
          <label class="form-label">Ward / แผนก</label>
          <input class="form-input" id="dspWard" placeholder="เช่น OPD, IPD, ER" value="${S.dept}">
        </div>
        <div class="form-field">
          <label class="form-label">จำนวนที่จ่าย *</label>
          <input class="form-input" id="dspAmt" type="number" placeholder="1" min="1" max="${item.qty}" value="1">
        </div>
        <div class="form-field">
          <label class="form-label">ผู้จ่ายยา</label>
          <input class="form-input" id="dspBy" value="${S.user?.name||''}" placeholder="ชื่อเภสัชกร">
        </div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="form-submit" style="flex:1;background:var(--glass);color:var(--ink);border:1px solid var(--glassb)" id="dspCancelBtn">ยกเลิก</button>
          <button class="form-submit" style="flex:1.3" id="dspConfirmBtn">✓ จ่ายยา</button>
        </div>
      </div>
    </div>`;
  appScreen.insertAdjacentHTML('beforeend', html);
  document.getElementById('dspCancelBtn')?.addEventListener('click', () => document.getElementById('dispenseOverlay')?.remove());
  document.getElementById('dispenseOverlay')?.addEventListener('click', e => { if (e.target.id==='dispenseOverlay') document.getElementById('dispenseOverlay')?.remove(); });
  document.getElementById('dspConfirmBtn')?.addEventListener('click', async () => {
    const hn  = document.getElementById('dspHN')?.value.trim() || '';
    const ward = document.getElementById('dspWard')?.value.trim() || S.dept;
    const amt = parseInt(document.getElementById('dspAmt')?.value || '0');
    const by  = document.getElementById('dspBy')?.value.trim() || S.user?.name || '';
    if (!amt || amt <= 0) { showToast('⚠ กรุณาระบุจำนวน', '#ff9f43'); return; }
    if (amt > item.qty) { showToast(`⚠ สต๊อกไม่พอ (เหลือ ${item.qty} หน่วย)`, '#ff4d5e'); return; }
    const record = { drugId: item.id, drugName: item.name, lot: item.lot, gtin: item.gtin||'',
      qty: amt, hn, ward, dispensedBy: by,
      dispensedAt: firebase.firestore.FieldValue.serverTimestamp(), dept: S.dept };
    if (typeof dispensingRef !== 'undefined') {
      await dispensingRef.add(record).catch(e => console.warn('Dispense save:', e));
    }
    const idx = S.items.findIndex(x => x.id === item.id);
    if (idx >= 0) {
      S.items[idx].qty -= amt;
      if (S.items[idx].qty <= 0) {
        S.items.splice(idx, 1);
        if (typeof drugsRef !== 'undefined' && item._fromFirestore) drugsRef.doc(item.id).delete().catch(()=>{});
      } else {
        if (typeof drugsRef !== 'undefined' && item._fromFirestore) drugsRef.doc(item.id).update({ stock: S.items[idx].qty }).catch(()=>{});
      }
    }
    addLog('จ่ายยา', `${item.name} × ${amt} · HN: ${hn||'—'} · ${ward} · ${by}`);
    sfx('success'); vibrate([8,40]);
    showToast(`✅ จ่าย ${item.name} × ${amt} หน่วย`, '#2ee6a6');
    document.getElementById('dispenseOverlay')?.remove();
    document.getElementById('sheetOverlay')?.remove();
    renderAppBody(); updateNavTabs();
  });
}

// ── FEATURE: BATCH SCAN SUMMARY ───────────────────────
function showBatchSummary() {
  if (!S.batchSession || S.batchSession.items.length === 0) return;
  const items = S.batchSession.items;
  const nearExpiry = items.filter(it => ['RED','ORANGE'].includes(itemStatus(it).key || ''));
  const dupMap = {};
  items.forEach(it => { const k = `${it.name}|${it.lot}`; dupMap[k] = (dupMap[k]||0) + 1; });
  const dupCount = Object.values(dupMap).filter(v => v > 1).length;
  const mins = Math.max(1, Math.round((Date.now() - S.batchSession.startTime) / 60000));
  const appScreen = document.getElementById('app-screen');
  if (!appScreen) return;
  document.getElementById('batchSumOverlay')?.remove();
  const html = `
    <div class="overlay" id="batchSumOverlay">
      <div id="confirm-box" style="border:1px solid #9d8cff55">
        <div style="font-size:34px;text-align:center">📋</div>
        <div style="font-size:17px;font-weight:700;text-align:center;margin-top:8px;color:var(--ink)">สรุปการสแกนชุดนี้</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px">
          <div class="batch-kpi-cell" style="--bc:#009E9E"><div class="batch-kpi-val" style="color:#009E9E">${items.length}</div><div class="batch-kpi-lbl">รับเข้าทั้งหมด</div></div>
          <div class="batch-kpi-cell" style="--bc:#ff4d5e"><div class="batch-kpi-val" style="color:#ff4d5e">${nearExpiry.length}</div><div class="batch-kpi-lbl">ใกล้/หมดอายุ</div></div>
          <div class="batch-kpi-cell" style="--bc:#ff9f43"><div class="batch-kpi-val" style="color:#ff9f43">${dupCount}</div><div class="batch-kpi-lbl">Lot ซ้ำ</div></div>
          <div class="batch-kpi-cell" style="--bc:#9d8cff"><div class="batch-kpi-val" style="color:#9d8cff">${mins}</div><div class="batch-kpi-lbl">นาที</div></div>
        </div>
        ${nearExpiry.length > 0 ? `<div style="margin-top:10px;font-size:12px;color:#ff9f43;background:rgba(255,159,67,.1);border-radius:10px;padding:10px;line-height:1.6">⚠ ใกล้/หมดอายุ: ${[...new Set(nearExpiry.map(it=>it.name))].join(', ')}</div>` : ''}
        <div style="display:flex;gap:10px;margin-top:16px">
          <button id="bsClose" style="flex:1;padding:13px;border-radius:14px;border:1px solid var(--glassb);background:transparent;color:var(--ink);font-size:14px;font-weight:600;cursor:pointer;font-family:'Sarabun',sans-serif">ปิด</button>
          <button id="bsExport" style="flex:1.3;padding:13px;border-radius:14px;border:none;cursor:pointer;font-size:14px;font-weight:700;font-family:'Sarabun',sans-serif;color:#04140d;background:linear-gradient(135deg,#2ee6a6,#13a37f)">📥 Export CSV</button>
        </div>
      </div>
    </div>`;
  appScreen.insertAdjacentHTML('beforeend', html);
  document.getElementById('bsClose')?.addEventListener('click', () => document.getElementById('batchSumOverlay')?.remove());
  document.getElementById('bsExport')?.addEventListener('click', () => { exportCSV(); document.getElementById('batchSumOverlay')?.remove(); });
}

// ── FEATURE: LASA CONSECUTIVE SCAN DETECTION ──────────
function checkLASA(name) {
  if (!name || !S.lastScanNames.length) return;
  const prev = S.lastScanNames[0];
  if (!prev) return;
  const norm = s => s.toLowerCase().replace(/[\s\-\.]+/g, '').slice(0, 10);
  const a = norm(name); const b = norm(prev);
  if (a === b) return; // same drug, not LASA
  // LASA: same first 5 chars, or Levenshtein distance <= 2 for short names
  const prefix5 = a.slice(0,5) === b.slice(0,5) && a.length > 4;
  const closeStr = a.length <= 10 && b.length <= 10 && levenshtein(a, b) <= 2;
  if (!prefix5 && !closeStr) return;
  sfx('error'); vibrate([30,60,30]);
  const appScreen = document.getElementById('app-screen');
  if (!appScreen) return;
  document.getElementById('lasaOverlay')?.remove();
  const html = `
    <div class="overlay" id="lasaOverlay">
      <div id="confirm-box" style="border:2px solid #ff9f43">
        <div style="font-size:40px;text-align:center">◆</div>
        <div style="font-size:17px;font-weight:700;text-align:center;color:#ff9f43;margin-top:8px">LASA Warning</div>
        <div style="font-size:13px;color:var(--ink2);text-align:center;margin-top:10px;line-height:1.7">
          ยา 2 รายการที่สแกนต่อกันมีชื่อคล้ายกัน<br>
          <span style="font-weight:700;color:var(--ink)">"${prev}"</span><br>
          <span style="font-weight:700;color:var(--ink)">"${name}"</span>
        </div>
        <div style="font-size:12px;color:var(--ink3);text-align:center;margin-top:6px">กรุณาตรวจสอบฉลากอีกครั้งก่อนนำขึ้นชั้น</div>
        <button id="lasaCloseBtn" style="width:100%;margin-top:16px;padding:13px;border-radius:14px;border:none;cursor:pointer;font-size:14px;font-weight:700;font-family:'Sarabun',sans-serif;color:#04140d;background:linear-gradient(135deg,#ff9f43,#e67e00)">✓ ตรวจสอบแล้ว รับทราบ</button>
      </div>
    </div>`;
  appScreen.insertAdjacentHTML('beforeend', html);
  speak(`แจ้งเตือน LASA ยา${name}คล้ายกับ${prev} กรุณาตรวจสอบ`);
  document.getElementById('lasaCloseBtn')?.addEventListener('click', () => document.getElementById('lasaOverlay')?.remove());
}

function levenshtein(a, b) {
  const m = a.length; const n = b.length;
  const dp = Array.from({length: m+1}, (_, i) => Array.from({length: n+1}, (_, j) => i===0?j:j===0?i:0));
  for (let i=1;i<=m;i++) for (let j=1;j<=n;j++) {
    dp[i][j] = a[i-1]===b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  }
  return dp[m][n];
}

// ── FEATURE: EXPORT CSV ───────────────────────────────
function exportCSV() {
  const headers = ['ชื่อยา','Generic','Lot No.','วันหมดอายุ','วันผลิต','จำนวน','ตำแหน่ง','สถานะ','GTIN','แผนก'];
  const rows = S.items.map(it => {
    const st = itemStatus(it);
    const statusTh = { RED:'ห้ามใช้', ORANGE:'ใกล้หมด', YELLOW:'เฝ้าระวัง', GREEN:'ปลอดภัย' }[st.key] || st.key;
    return [it.name, it.gen||'', it.lot,
      it.exp instanceof Date ? it.exp.toLocaleDateString('th-TH') : '',
      it.mfd instanceof Date ? it.mfd.toLocaleDateString('th-TH') : '',
      it.qty,
      it.loc === 'FRONT_SHELF' ? 'หน้าเคาน์เตอร์' : 'คลัง',
      statusTh, it.gtin||'', it.dept||S.dept,
    ].map(v => `"${String(v).replace(/"/g,'""')}"`).join(',');
  });
  const csv = '﻿' + headers.join(',') + '\n' + rows.join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `pharmacare-${new Date().toISOString().slice(0,10)}.csv`; a.click();
  URL.revokeObjectURL(url);
  showToast('📥 Export CSV สำเร็จ', '#2ee6a6');
  addLog('Export CSV', `${S.items.length} รายการ`);
}

// ── FEATURE: THAI FDA LOOKUP ──────────────────────────
function lookupThaiFDA(name, gtin) {
  const q = encodeURIComponent(name || gtin || '');
  const url = gtin
    ? `https://pertento.fda.moph.go.th/FDA_SEARCH_DRUG/SEARCH_DRUG/frm-SearchDrug.aspx`
    : `https://pertento.fda.moph.go.th/FDA_SEARCH_DRUG/SEARCH_DRUG/frm-SearchDrug.aspx`;
  const appScreen = document.getElementById('app-screen');
  if (!appScreen) return;
  document.getElementById('fdaOverlay')?.remove();
  const html = `
    <div class="overlay" id="fdaOverlay">
      <div id="confirm-box" style="border:1px solid rgba(0,158,158,.4)">
        <div style="font-size:34px;text-align:center">🔍</div>
        <div style="font-size:17px;font-weight:700;text-align:center;margin-top:8px;color:var(--ink)">ค้นหาในฐานข้อมูล อย.</div>
        <div style="font-size:13px;color:var(--ink2);text-align:center;margin-top:8px;line-height:1.6">
          ยา: <b>${name||gtin||'—'}</b><br>
          <span style="font-size:11px;color:var(--ink3)">FDA Thailand Drug Database<br>สำนักงานคณะกรรมการอาหารและยา</span>
        </div>
        <div style="display:flex;gap:10px;margin-top:16px">
          <button id="fdaClose" style="flex:1;padding:13px;border-radius:14px;border:1px solid var(--glassb);background:transparent;color:var(--ink);font-size:14px;font-weight:600;cursor:pointer;font-family:'Sarabun',sans-serif">ปิด</button>
          <button id="fdaOpen" style="flex:1.3;padding:13px;border-radius:14px;border:none;cursor:pointer;font-size:14px;font-weight:700;font-family:'Sarabun',sans-serif;color:#04140d;background:linear-gradient(135deg,#009E9E,#007070)">🌐 เปิดเว็บ อย.</button>
        </div>
      </div>
    </div>`;
  appScreen.insertAdjacentHTML('beforeend', html);
  document.getElementById('fdaClose')?.addEventListener('click', () => document.getElementById('fdaOverlay')?.remove());
  document.getElementById('fdaOpen')?.addEventListener('click', () => {
    window.open(url, '_blank', 'noopener');
    document.getElementById('fdaOverlay')?.remove();
  });
}

// ── BOOTSTRAP ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  applyTheme(S.theme);

  // Restore persisted settings
  try {
    const savedSettings = JSON.parse(localStorage.getItem('settings') || 'null');
    if (savedSettings) Object.assign(S.settings, savedSettings);
    const savedLock = parseInt(localStorage.getItem('autoLockMins'));
    if (savedLock > 0) S.autoLockMins = savedLock;
    const savedKey = localStorage.getItem('geminiKey');
    if (savedKey) S.settings.geminiKey = savedKey;
  } catch(e) {}

  // Restore session if valid (8h window)
  try {
    const sess = JSON.parse(localStorage.getItem('session') || 'null');
    if (sess && sess.exp > Date.now()) {
      const u = S.users.find(x => x.id === sess.uid);
      if (u) {
        S.user = u; S.screen = 'app'; S.lastActivity = Date.now();
      }
    }
  } catch(e) {}

  // Status bar clock
  setInterval(updateClock, 10000);
  updateClock();

  renderScreen();
  initOfflineMonitor();
  initAutoLock();

  fitPhoneToViewport();
  window.addEventListener('resize', () => {
    fitPhoneToViewport();
    renderDesktopPanel();
  }, { passive: true });

  initPredictivePrefetch();
  initAmbientLight();

  // Try Firestore
  try { initFirestore(); } catch(e) { console.warn('Firestore init:', e); }
  try { initDrugCache(); } catch(e) { console.warn('Drug cache init:', e); }
  try { initRecalls(); } catch(e) { console.warn('Recalls init:', e); }

  // Periodic notify check every 30 minutes
  setInterval(() => { if (S.screen === 'app') checkAndNotify(); }, 30 * 60 * 1000);

  // If session was restored, start Firestore listener now
  if (S.screen === 'app' && S.user) {
    try { handoffListen(); } catch(e) {}
  }
});
