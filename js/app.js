/* Krong Pinang Drug Safety System — Vanilla JS */

// ── STATE ─────────────────────────────────────────────
const S = {
  screen: 'lock', loginStep: 'profiles', pendingUser: null,
  pin: '', pinErr: false, faceStage: 'scanning', faceCam: false,
  user: null, tab: 'scan',
  items: [],
  firestoreLoaded: false,
  scanState: 'idle', scanResult: null, scanDest: 'SUBSTOCK',
  rapidMode: false, scanCount: 0,
  manualOpen: false,
  stockFilter: 'all', stockSort: 'exp', stockSearch: '',
  theme: localStorage.getItem('theme') || 'dark',
  settings: { threshRed: 30, threshOrange: 60, threshYellow: 90, soundOn: true },
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
};

// ── SEED DATA ─────────────────────────────────────────
const SEED_ITEMS = [
  { id:'i1', name:'Adrenaline 1mg/mL', gen:'Epinephrine inj.', lot:'A2291', expDays:12, qty:8, loc:'FRONT_SHELF', highAlert:true, lasa:false, cold:false, age:14, form:'vial' },
  { id:'i2', name:'Warfarin 5mg', gen:'Warfarin sodium', lot:'WF8830', expDays:64, qty:3, loc:'FRONT_SHELF', highAlert:true, lasa:true, cold:false, age:103, form:'tab' },
  { id:'i3', name:'Insulin Glargine', gen:'Lantus 100IU/mL', lot:'LZ4471', expDays:120, qty:5, loc:'FRONT_SHELF', highAlert:false, lasa:false, cold:true, age:9, form:'pen' },
  { id:'i4', name:'Hydralazine 25mg', gen:'Hydralazine HCl', lot:'HY1190', expDays:45, qty:20, loc:'FRONT_SHELF', highAlert:false, lasa:true, cold:false, age:31, form:'tab' },
  { id:'i5', name:'Paracetamol 500mg', gen:'Acetaminophen', lot:'PC0021', expDays:310, qty:60, loc:'SUBSTOCK', highAlert:false, lasa:false, cold:false, age:6, form:'tab' },
  { id:'i6', name:'Amoxicillin 500mg', gen:'Amoxicillin', lot:'AM5521', expDays:82, qty:40, loc:'SUBSTOCK', highAlert:false, lasa:false, cold:false, age:120, form:'cap' },
  { id:'i7', name:'Vincristine 1mg', gen:'Vincristine sulfate', lot:'VC0093', expDays:28, qty:2, loc:'SUBSTOCK', highAlert:true, lasa:true, cold:true, age:40, form:'vial' },
  { id:'i8', name:'Metformin 850mg', gen:'Metformin HCl', lot:'MF7740', expDays:-3, qty:12, loc:'SUBSTOCK', highAlert:false, lasa:false, cold:false, age:55, form:'tab' },
  { id:'i9', name:'Paracetamol 500mg', gen:'Acetaminophen', lot:'PC0044', expDays:70, qty:25, loc:'SUBSTOCK', highAlert:false, lasa:false, cold:false, age:20, form:'tab' },
  { id:'i10', name:'Paracetamol 500mg', gen:'Acetaminophen', lot:'PC0098', expDays:150, qty:48, loc:'SUBSTOCK', highAlert:false, lasa:false, cold:false, age:12, form:'tab' },
  { id:'i11', name:'Warfarin 5mg', gen:'Warfarin sodium', lot:'WF9001', expDays:200, qty:15, loc:'FRONT_SHELF', highAlert:true, lasa:true, cold:false, age:18, form:'tab' },
];

function makeItems() {
  return SEED_ITEMS.map(i => {
    const exp = new Date();
    exp.setDate(exp.getDate() + i.expDays);
    return { ...i, exp };
  });
}

// ── HELPERS ───────────────────────────────────────────
function daysLeft(exp) {
  return Math.ceil((new Date(exp) - new Date()) / 86400000);
}
function itemStatus(it) {
  const d = daysLeft(it.exp);
  const { threshRed: r, threshOrange: o, threshYellow: y } = S.settings;
  if (d <= r) return { key: 'RED', c: '#ff4d5e', label: d < 0 ? `หมดอายุ ${-d} วัน` : `เหลือ ${d} วัน`, shape: 'oct' };
  if (d <= o) return { key: 'ORANGE', c: '#ff9f43', label: `คืนบริษัทได้ · ${d} วัน`, shape: 'tri' };
  if (d <= y) return { key: 'YELLOW', c: '#ffd23f', label: `เหลือ ${d} วัน`, shape: 'dia' };
  return { key: 'GREEN', c: '#2ee6a6', label: `ปลอดภัย · ${d} วัน`, shape: 'cir' };
}
function medColor(name) {
  const pal = ['#6366f1','#0ea5e9','#14b8a6','#8b5cf6','#0891b2','#4f46e5'];
  let n = 0;
  for (let i = 0; i < (name||'').length; i++) n = (n + name.charCodeAt(i)) % pal.length;
  return pal[n];
}
function shapeIconSVG(shape, color, size) {
  const sz = size || 13;
  const paths = {
    oct: 'M7,2 12,2 17,7 17,12 12,17 7,17 2,12 2,7 Z',
    tri: 'M9.5,2 17,16 2,16 Z',
    dia: 'M9.5,1 18,9.5 9.5,18 1,9.5 Z',
  };
  if (shape === 'cir') return `<svg width="${sz}" height="${sz}" viewBox="0 0 19 19"><circle cx="9.5" cy="9.5" r="8" fill="${color}"/></svg>`;
  return `<svg width="${sz}" height="${sz}" viewBox="0 0 19 19"><path d="${paths[shape]}" fill="${color}"/></svg>`;
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
  return new Date(d).toLocaleDateString('th-TH', { day: '2-digit', month: 'short', year: '2-digit' });
}
function fmtTime(d) {
  return [d.getHours(), d.getMinutes()].map(x => ('0'+x).slice(-2)).join(':');
}
function currentTime() {
  const n = new Date();
  return fmtTime(n);
}
function vibrate(p) { try { navigator.vibrate && navigator.vibrate(p); } catch(e) {} }

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
function showToast(msg, color) {
  const el = document.getElementById('toast');
  el.style.borderColor = (color||'#2dd4bf') + '66';
  el.style.boxShadow = `0 0 28px -6px ${color||'#2dd4bf'}66`;
  el.innerHTML = `<span style="flex:1">${msg}</span>`;
  el.classList.remove('hidden');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.add('hidden'), 2800);
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

        <button class="face-btn" id="faceBtnMain">
          <div class="face-btn-inner">
            <div class="face-icon-wrap">
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/>
                <path d="M9 10h.01M15 10h.01M9.5 15a3.5 3.5 0 0 0 5 0"/>
              </svg>
            </div>
            <div class="face-btn-text">
              <div class="face-btn-title">สแกนใบหน้าเข้าระบบ</div>
              <div class="face-btn-sub">Face ID · เร็วที่สุด · แตะแล้วมองกล้อง</div>
            </div>
            <div class="face-btn-arrow">›</div>
          </div>
        </button>

        <div class="lock-divider">
          <div class="lock-divider-line" style="background:linear-gradient(90deg,transparent,rgba(0,158,158,.35))"></div>
          <div class="lock-divider-text">บัญชีผู้เข้าใช้งาน</div>
          <div class="lock-divider-line" style="background:linear-gradient(90deg,rgba(0,158,158,.35),transparent)"></div>
        </div>

        <div class="profile-grid">${profiles}</div>

        <div class="lock-secondary">
          <button class="lock-sec-btn" id="lockScanBadge">
            <span class="lock-sec-icon">🪪</span>สแกนป้ายชื่อ
          </button>
          <button class="lock-sec-btn" id="lockPasskey">
            <span class="lock-sec-icon">🔑</span>Passkey
          </button>
        </div>

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
    if (k === 'face') return `<button class="pin-key-face" id="pinFaceBtn">
      <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
        <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2M9 10h.01M15 10h.01M9.5 15a3.5 3.5 0 0 0 5 0"/>
      </svg>
    </button>`;
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
        <div class="pin-hint-text">ใส่ PIN 4 หลัก · PIN ทดลอง: ${u.pin}</div>
        <div class="pin-faceid-hint">กดไอคอนใบหน้า เพื่อใช้ Face ID</div>
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
function renderApp() {
  const notifCount = getNotifs().length;
  const tabs = [
    { k:'scan', label:'สแกน', ico:'⊹' },
    { k:'stock', label:'คลังยา', ico:'▤' },
    { k:'dash', label:'รายงาน', ico:'◳' },
    { k:'cfg', label:'ตั้งค่า', ico:'⚙' },
  ];
  const tabNames = { scan:'สแกนรับยา', stock:'คลังยา', dash:'รายงาน & KPI', cfg:'ตั้งค่าระบบ' };
  const alertCount = S.items.filter(i => ['RED','ORANGE'].includes(itemStatus(i).key)).length;

  const navTabs = tabs.map(t => {
    const active = S.tab === t.k;
    const badge = t.k === 'stock' ? alertCount : 0;
    return `<button class="nav-tab${active?' active':''}" data-tab="${t.k}">
      <span class="nav-tab-icon">
        ${t.ico}
        ${badge > 0 && !active ? `<span class="nav-badge">${badge > 99 ? '99+' : badge}</span>` : ''}
      </span>
      <span class="nav-tab-label">${t.label}</span>
      ${active ? '<span class="nav-tab-indicator"></span>' : ''}
    </button>`;
  }).join('');

  let bodyHTML = '';
  if (S.tab === 'scan') bodyHTML = renderScanTab();
  else if (S.tab === 'stock') bodyHTML = renderStockTab();
  else if (S.tab === 'dash') bodyHTML = renderDashTab();
  else if (S.tab === 'cfg') bodyHTML = renderCfgTab();

  return `
    <div id="app-screen">
      <div id="app-topbar">
        <img src="uploads/pasted-1782610336254-0.png" alt="รพ.กรงปินัง" class="topbar-logo" onerror="this.style.display='none'">
        <div class="topbar-info">
          <div class="topbar-tab-line">
            <span class="topbar-tab-name">${tabNames[S.tab]||''}</span>
            <span class="topbar-time">${currentTime()}</span>
          </div>
          <div class="topbar-user">${S.user ? S.user.name+' · '+S.user.role : 'OPD Pharmacy'}</div>
        </div>
        <div class="sync-badge ${S.offlineMode?'offline':'online'}">
          ${S.offlineMode ? '📴 Offline' : '✓ Synced'}
        </div>
        <button class="topbar-btn" id="notifBtn">
          🔔
          ${notifCount > 0 ? `<span class="topbar-btn-badge">${notifCount}</span>` : ''}
        </button>
        <button class="topbar-btn" id="lockBtn">⏻</button>
      </div>
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
  const destLabel = dest === 'SUBSTOCK' ? 'รับเข้าคลัง' : 'เข้าจุดบริการ';
  const det = S.scanState === 'detected';
  const corners = [0,1,2,3].map(i => {
    const b = det ? '#2ee6a6' : '#009E9E';
    const pos = [{top:'0',left:'0'},{top:'0',right:'0'},{bottom:'0',left:'0'},{bottom:'0',right:'0'}][i];
    const posStr = Object.entries(pos).map(([k,v])=>`${k}:${v}`).join(';');
    const r = ['borderTopLeftRadius','borderTopRightRadius','borderBottomLeftRadius','borderBottomRightRadius'][i];
    return `<div style="position:absolute;width:36px;height:36px;${posStr};${r}:10px;${i<2?`border-top:3px solid ${b}`:`border-bottom:3px solid ${b}`};${i%2===0?`border-left:3px solid ${b}`:`border-right:3px solid ${b}`};opacity:${det?1:.85};transition:all .3s"></div>`;
  }).join('');
  const historyHTML = S.scanHistory.length > 0 ? `
    <div style="margin-bottom:12px">
      <div style="font-size:11px;font-weight:700;color:var(--ink3);letter-spacing:.8px;margin-bottom:7px">ประวัติสแกนล่าสุด</div>
      <div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:4px">
        ${S.scanHistory.slice(0,5).map(it => {
          const dc = it.dest === 'SUBSTOCK' ? '#7c6cff' : '#009E9E';
          return `<div style="flex-shrink:0;padding:8px 11px;border-radius:13px;border:1px solid ${dc}33;background:${dc}0e;min-width:130px;max-width:160px">
            <div style="font-size:12px;font-weight:700;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${it.name}</div>
            <div style="display:flex;gap:5px;margin-top:3px;align-items:center">
              <span style="font-size:9.5px;font-weight:700;color:${dc}">${it.dest==='SUBSTOCK'?'📦':'🛎'}</span>
              <span style="font-size:9.5px;color:var(--ink3);font-family:'JetBrains Mono',monospace">${fmtDate(it.exp)}</span>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>` : '';

  const resultHTML = S.scanResult ? renderScanResult(S.scanResult) : `
    <div class="scan-empty">
      <div class="scan-empty-icon">📷</div>
      ยังไม่มีรายการสแกน<br>แตะ "จำลองสแกน" เพื่อทดสอบ
    </div>`;

  return `
    <div class="dest-toggle">
      <div class="dest-slider" id="destSlider" style="left:${dest==='SUBSTOCK'?'4px':'50%'};background:linear-gradient(135deg,${destC},${destC}bb);box-shadow:0 6px 20px -6px ${destC}88"></div>
      <button class="dest-btn" data-dest="SUBSTOCK" style="color:${dest==='SUBSTOCK'?'#fff':'var(--ink3)'}">📦 SUBSTOCK · รับเข้าคลัง</button>
      <button class="dest-btn" data-dest="FRONT_SHELF" style="color:${dest==='FRONT_SHELF'?'#fff':'var(--ink3)'}">🛎 FRONT SHELF · จุดบริการ</button>
    </div>
    <div class="scan-viewport" id="scanViewport">
      <div class="scan-vp-bg"></div>
      <div class="scan-reticle">
        ${corners}
        ${!det ? `<div class="scan-line" style="background:linear-gradient(90deg,transparent,#009E9E,transparent)"></div>` : ''}
        ${det ? `<div class="scan-check">✓</div>` : ''}
      </div>
      <div class="scan-vp-badge">
        <span class="scan-pulse-dot" style="background:${det?'#2ee6a6':'#ff4d5e'}"></span>
        ${det ? 'พบบาร์โค้ด…' : 'GS1 DataMatrix · 2D'}
      </div>
      <div class="scan-vp-hint">${det ? 'กำลังถอดรหัส GS1…' : 'เล็งกล้องไปที่บาร์โค้ด'}</div>
    </div>
    <div class="scan-actions">
      <button class="scan-btn-primary" id="simScanBtn" style="background:linear-gradient(135deg,${destC},${destC}bb);box-shadow:0 10px 28px -8px ${destC}88">
        <span style="font-size:18px">📷</span>จำลองสแกน
      </button>
      <button class="scan-btn-manual" id="manualEntryBtn">
        <span style="font-size:16px">✎</span>กรอกเอง
      </button>
    </div>
    <div class="rapid-row${S.rapidMode?' active':''}" id="rapidRow">
      <span style="font-size:16px">⚡</span>
      <div style="flex:1">
        <div class="rapid-label" style="color:${S.rapidMode?'#2ee6a6':'var(--ink)'}">Rapid Scan</div>
        <div class="rapid-sub">สแกนรัวต่อเนื่อง ไม่ต้องกดยืนยัน</div>
      </div>
      ${S.rapidMode && S.scanCount > 0 ? `<button id="resetRapidBtn" style="padding:5px 11px;border-radius:9px;border:none;background:rgba(124,108,255,.2);color:#9d8cff;font-size:11.5px;font-weight:700;cursor:pointer;font-family:'Sarabun',sans-serif">เริ่มใหม่</button>` : ''}
      <button class="toggle-btn" id="rapidToggle" style="background:${S.rapidMode?'#2ee6a6':'rgba(150,150,160,.35)'}">
        <span class="toggle-thumb" style="left:${S.rapidMode?'21px':'3px'}"></span>
      </button>
    </div>
    ${historyHTML}
    <div class="voice-bar">
      <button class="voice-btn idle" id="voiceBtn">🎤</button>
      <div class="voice-info">
        <div class="voice-title">Voice Command · พูดเพื่อสั่งงาน</div>
        <div class="voice-sub">พูด "รับยา", "โอน", "ยาแดง", "สรุปเวร"…</div>
      </div>
      <span style="font-size:10px;color:var(--ink3);padding:3px 8px;border-radius:8px;background:rgba(255,255,255,.07)">แตะ</span>
    </div>
    ${resultHTML}`;
}

function renderScanResult(r) {
  const sC = itemStatus({ exp: r.exp || new Date(Date.now() + r.expDays*86400000) });
  const flags = [];
  if (r.highAlert) flags.push(`<span class="drug-tag ha-flag">⬢ HIGH-ALERT</span>`);
  if (r.lasa) flags.push(`<span class="drug-tag lasa-flag">◆ LASA</span>`);
  if (r.cold) flags.push(`<span class="drug-tag cold-flag">❄ COLD CHAIN</span>`);
  const destC = (r.dest==='SUBSTOCK') ? '#7c6cff' : '#2dd4bf';
  const destLabel = (r.dest==='SUBSTOCK') ? '📦 เข้าคลัง SUBSTOCK' : '🛎️ เข้าจุดบริการ FRONT_SHELF';
  const exp = r.exp || new Date(Date.now() + (r.expDays||90)*86400000);
  const dl = daysLeft(exp);
  return `
    <div class="scan-result-card">
      <div class="scan-result-header">
        <span class="scan-result-ok-label"><span>✨</span>ดึงข้อมูลครบอัตโนมัติ · ไม่ต้องกรอกเอง</span>
        <span class="scan-result-format">GS1 2D</span>
      </div>
      <div class="scan-result-name">${r.name}</div>
      <div class="scan-result-gen">${r.gen||''}</div>
      ${r.dest ? `<div class="scan-result-dest" style="background:${destC}22;border:1px solid ${destC}55"><span>${destC==='#7c6cff'?'📦':'🛎️'}</span><span style="font-size:12px;font-weight:700;color:${destC}">${destLabel}</span></div>` : ''}
      ${flags.length ? `<div class="drug-flags">${flags.join('')}</div>` : ''}
      <div class="scan-result-grid">
        <div><div class="scan-field-label">วันหมดอายุ</div><div class="scan-field-val" style="color:${sC.c};font-family:'JetBrains Mono',monospace">${fmtDate(exp)}</div></div>
        <div><div class="scan-field-label">เหลือ</div><div class="scan-field-val" style="color:${sC.c}">${sC.label}</div></div>
        <div><div class="scan-field-label">Lot No.</div><div class="scan-field-val" style="color:#9d8cff;font-family:'JetBrains Mono',monospace">${r.lot||'—'}</div></div>
        <div><div class="scan-field-label">จำนวน</div><div class="scan-field-val">${r.qty||'—'} หน่วย</div></div>
      </div>
      <div class="scan-result-actions">
        <button class="scan-accept-btn" id="acceptScanBtn">✓ รับเข้าสต๊อก</button>
        <button class="scan-reject-btn" id="rejectScanBtn">ยกเลิก</button>
      </div>
    </div>`;
}

// ── STOCK TAB ─────────────────────────────────────────
function renderStockTab() {
  const filters = [
    { k:'all', label:'ทั้งหมด' },
    { k:'RED', label:'🔴 แดง' },
    { k:'ORANGE', label:'🟠 ส้ม' },
    { k:'YELLOW', label:'🟡 เหลือง' },
    { k:'GREEN', label:'🟢 เขียว' },
    { k:'FRONT_SHELF', label:'🛎 หน้าเคาน์เตอร์' },
    { k:'SUBSTOCK', label:'📦 คลัง' },
  ];
  const q = S.stockSearch.toLowerCase();
  let items = S.items.filter(it => {
    if (S.stockFilter === 'all') return true;
    if (['FRONT_SHELF','SUBSTOCK'].includes(S.stockFilter)) return it.loc === S.stockFilter;
    return itemStatus(it).key === S.stockFilter;
  }).filter(it => !q || (it.name+it.gen+it.lot).toLowerCase().includes(q));
  items = items.sort((a,b) => daysLeft(a.exp) - daysLeft(b.exp));

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
      return `<div class="drug-card" data-id="${it.id}">
        <div class="drug-card-status-bar" style="background:${st.c}"></div>
        ${medAvatarHTML(it, 46)}
        <div class="drug-info">
          <div class="drug-name">${it.name}</div>
          <div class="drug-gen">${it.gen}</div>
          <div class="drug-meta">
            <span class="drug-lot">${it.lot}</span>
            <span class="drug-exp">${fmtDate(it.exp)}</span>
            <span class="drug-qty-badge">${it.qty} หน่วย</span>
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

  return `
    <div class="stock-header">
      <button class="stock-transfer-btn" id="bulkTransferBtn">
        🚀 โอนทั้งหมดขึ้นเคาน์เตอร์
      </button>
    </div>
    <div class="stock-filter-wrap">
      ${filters.map(f => `<button class="stock-filter-btn${S.stockFilter===f.k?' active':''}" data-filter="${f.k}">${f.label}</button>`).join('')}
    </div>
    <input class="stock-search" id="stockSearchInput" placeholder="🔍 ค้นหา ชื่อยา, Lot, Generic…" value="${S.stockSearch}">
    ${showSections ? `
      <div class="stock-section-label">🛎 FRONT SHELF <span class="stock-section-count">${front.length}</span></div>
      ${cardList(front)}
      <div class="stock-section-label" style="margin-top:18px">📦 SUBSTOCK <span class="stock-section-count">${sub.length}</span></div>
      ${cardList(sub)}` : cardList(items)}`;
}

// ── DASH TAB ──────────────────────────────────────────
function renderDashTab() {
  const all = S.items;
  const counts = { RED:0, ORANGE:0, YELLOW:0, GREEN:0 };
  all.forEach(it => counts[itemStatus(it).key]++);
  const alerts = all.filter(it => ['RED','ORANGE'].includes(itemStatus(it).key))
    .sort((a,b) => daysLeft(a.exp) - daysLeft(b.exp));

  const kpiData = [
    { icon:'💊', bg:'rgba(0,158,158,.15)', val:all.length, label:'ยาทั้งหมด', trend:'+2', trendC:'#2ee6a6' },
    { icon:'🔴', bg:'rgba(255,77,94,.15)', val:counts.RED, label:'ห้ามใช้/หมดอายุ', trend: counts.RED > 0 ? '!' : '✓', trendC: counts.RED > 0 ? '#ff4d5e' : '#2ee6a6' },
    { icon:'🟠', bg:'rgba(255,159,67,.15)', val:counts.ORANGE, label:'คืนบริษัท', trend:'', trendC:'#ff9f43' },
    { icon:'🟢', bg:'rgba(46,230,166,.15)', val:counts.GREEN, label:'ปลอดภัย', trend:'', trendC:'#2ee6a6' },
  ];

  const kpiHTML = kpiData.map((k,i) => `
    <div class="kpi-card" style="animation-delay:${i*0.06}s">
      <div class="kpi-card-head">
        <div class="kpi-card-icon" style="background:${k.bg}">${k.icon}</div>
        ${k.trend ? `<div class="kpi-trend" style="background:${k.trendC}22;color:${k.trendC}">${k.trend}</div>` : ''}
      </div>
      <div class="kpi-card-val" style="color:${k.trendC||'var(--ink)'}">${k.val}</div>
      <div class="kpi-card-label">${k.label}</div>
    </div>`).join('');

  const alertListHTML = alerts.length ? alerts.slice(0,6).map(it => {
    const st = itemStatus(it);
    const dl = daysLeft(it.exp);
    return `<div class="alert-item">
      <div class="alert-shape">${shapeIconSVG(st.shape, st.c, 16)}</div>
      <div class="alert-info">
        <div class="alert-name">${it.name}</div>
        <div class="alert-detail">Lot ${it.lot} · ${it.loc}</div>
      </div>
      <div class="alert-badge">
        <div class="alert-days" style="background:${st.c}22;color:${st.c}">${dl<0?`หมดอายุ ${-dl}ว`:`${dl}ว`}</div>
      </div>
    </div>`;
  }).join('') : `<div class="empty-state" style="margin-top:8px"><div class="empty-state-icon">✅</div>ยาทุกรายการปลอดภัย</div>`;

  const total = all.length || 1;
  const bars = [
    { label:'หมดอายุ', count:counts.RED, color:'#ff4d5e' },
    { label:'ส้ม', count:counts.ORANGE, color:'#ff9f43' },
    { label:'เหลือง', count:counts.YELLOW, color:'#ffd23f' },
    { label:'เขียว', count:counts.GREEN, color:'#2ee6a6' },
  ];
  const barHTML = bars.map(b => `
    <div class="bar-row">
      <div class="bar-label">${b.label}</div>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(3,(b.count/total)*100)}%;background:${b.color}"></div></div>
      <div class="bar-count">${b.count}</div>
    </div>`).join('');

  return `
    <div class="kpi-grid">${kpiHTML}</div>
    <div class="dash-section-title">
      <span>⚠ รายการต้องระวัง</span>
      <span class="dash-section-sub">${alerts.length} รายการ</span>
    </div>
    ${alertListHTML}
    <div class="dash-section-title" style="margin-top:20px"><span>📊 สัดส่วนสถานะ</span></div>
    <div style="padding:14px;border-radius:16px;background:var(--card);border:1px solid var(--line)">${barHTML}</div>
    <div style="font-size:11px;color:var(--ink3);text-align:center;margin-top:12px;font-family:'JetBrains Mono',monospace">
      อัปเดต ${currentTime()} · ${new Date().toLocaleDateString('th-TH')}
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

      <div class="settings-section-label"><span>📋</span>Audit Log (${S.auditLog.length} รายการ)</div>
      ${auditHTML}

      <div class="settings-section-label"><span>ℹ</span>เกี่ยวกับระบบ</div>
      <div class="settings-row">
        <div class="settings-row-left">
          <div class="settings-row-label">Drug Safety System</div>
          <div class="settings-row-sub">รพ.กรงปินัง · จ.ยะลา · v2.0</div>
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
      S.tab = btn.dataset.tab;
      renderAppBody();
      updateNavTabs();
    });
  });

  // Topbar
  const notifBtn = document.getElementById('notifBtn');
  if (notifBtn) notifBtn.addEventListener('click', () => {
    vibrate(6); S.sheet = 'notif'; renderAppBody(); updateNavTabs();
  });
  const lockBtn = document.getElementById('lockBtn');
  if (lockBtn) lockBtn.addEventListener('click', () => {
    S.screen = 'lock'; S.user = null; S.loginStep = 'profiles';
    renderScreen();
  });

  bindTabEvents();
  bindSheetEvents();
  bindConfirmEvents();
}

function bindTabEvents() {
  if (S.tab === 'scan') bindScanTab();
  else if (S.tab === 'stock') bindStockTab();
  else if (S.tab === 'cfg') bindCfgTab();
}

function bindScanTab() {
  document.querySelectorAll('.dest-btn[data-dest]').forEach(btn => {
    btn.addEventListener('click', () => {
      vibrate(7); sfx('tick');
      S.scanDest = btn.dataset.dest;
      S.scanResult = null;
      updateTabBody();
    });
  });
  const simScan = document.getElementById('simScanBtn');
  if (simScan) simScan.addEventListener('click', doSimScan);
  const manualEntry = document.getElementById('manualEntryBtn');
  if (manualEntry) manualEntry.addEventListener('click', () => {
    S.manualOpen = true; renderScreen();
  });
  const rapidToggle = document.getElementById('rapidToggle');
  if (rapidToggle) rapidToggle.addEventListener('click', () => {
    vibrate(8); S.rapidMode = !S.rapidMode; S.scanCount = 0;
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
  if (voiceBtn) voiceBtn.addEventListener('click', () => showToast('🎤 Voice Command (จำลอง)', '#7c6cff'));
}

function bindStockTab() {
  document.querySelectorAll('.stock-filter-btn[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      vibrate(6); S.stockFilter = btn.dataset.filter;
      updateTabBody();
    });
  });
  const search = document.getElementById('stockSearchInput');
  if (search) search.addEventListener('input', e => {
    S.stockSearch = e.target.value;
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
    updateTabBody();
  });
  document.querySelectorAll('.autolock-btn[data-lock]').forEach(btn => {
    btn.addEventListener('click', () => {
      vibrate(6); S.autoLockMins = parseInt(btn.dataset.lock);
      updateTabBody();
    });
  });
  document.querySelectorAll('.thresh-slider[data-thresh]').forEach(slider => {
    slider.addEventListener('input', e => {
      S.settings[e.target.dataset.thresh] = parseInt(e.target.value);
      const label = e.target.closest('.thresh-row')?.querySelector('.thresh-val');
      if (label) label.textContent = e.target.value + ' วัน';
    });
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
}

function updateTabBody() {
  renderAppBody();
}

function updateNavTabs() {
  const nav = document.getElementById('app-nav');
  if (!nav) return;
  const alertCount = S.items.filter(i => ['RED','ORANGE'].includes(itemStatus(i).key)).length;
  const tabs = [
    { k:'scan', label:'สแกน', ico:'⊹' },
    { k:'stock', label:'คลังยา', ico:'▤' },
    { k:'dash', label:'รายงาน', ico:'◳' },
    { k:'cfg', label:'ตั้งค่า', ico:'⚙' },
  ];
  nav.innerHTML = tabs.map(t => {
    const active = S.tab === t.k;
    const badge = t.k === 'stock' ? alertCount : 0;
    return `<button class="nav-tab${active?' active':''}" data-tab="${t.k}">
      <span class="nav-tab-icon">
        ${t.ico}
        ${badge > 0 && !active ? `<span class="nav-badge">${badge}</span>` : ''}
      </span>
      <span class="nav-tab-label">${t.label}</span>
      ${active ? '<span class="nav-tab-indicator"></span>' : ''}
    </button>`;
  }).join('');
  nav.querySelectorAll('.nav-tab[data-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      vibrate(6); sfx('tick');
      S.tab = btn.dataset.tab;
      S.sheet = null;
      renderAppBody();
      updateNavTabs();
    });
  });
}

// ── LOGIN LOGIC ────────────────────────────────────────
function pinPress(k) {
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
  renderScreen();
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
const SCAN_POOL = [
  { name:'Adrenaline 1mg/mL', gen:'Epinephrine inj.', lot:'A'+Date.now().toString().slice(-4), expDays:12, qty:8, highAlert:true, lasa:false, cold:false },
  { name:'Warfarin 5mg', gen:'Warfarin sodium', lot:'WF'+Date.now().toString().slice(-4), expDays:64, qty:3, highAlert:true, lasa:true, cold:false },
  { name:'Paracetamol 500mg', gen:'Acetaminophen', lot:'PC'+Date.now().toString().slice(-4), expDays:310, qty:60, highAlert:false, lasa:false, cold:false },
  { name:'Insulin Glargine', gen:'Lantus 100IU/mL', lot:'LZ'+Date.now().toString().slice(-4), expDays:120, qty:5, highAlert:false, lasa:false, cold:true },
  { name:'Amoxicillin 500mg', gen:'Amoxicillin', lot:'AM'+Date.now().toString().slice(-4), expDays:82, qty:40, highAlert:false, lasa:false, cold:false },
  { name:'Metformin 850mg', gen:'Metformin HCl', lot:'MF'+Date.now().toString().slice(-4), expDays:-3, qty:12, highAlert:false, lasa:false, cold:false },
];

function doSimScan() {
  vibrate([8,30,8]); sfx('scan');
  S.scanState = 'detected';
  updateTabBody();
  setTimeout(() => {
    const pool = SCAN_POOL;
    const r = { ...pool[Math.floor(Math.random() * pool.length)] };
    const exp = new Date();
    exp.setDate(exp.getDate() + r.expDays);
    r.exp = exp;
    r.dest = S.scanDest;
    S.scanResult = r;
    S.scanState = 'detected';
    if (S.rapidMode) {
      S.scanCount++;
      S.scanHistory.unshift({ ...r, ts: new Date() });
      if (S.scanHistory.length > 20) S.scanHistory.pop();
      addToItems(r);
      speak(r.name);
      sfx('success');
      showToast(`✓ สแกน #${S.scanCount}: ${r.name}`, '#2ee6a6');
    }
    updateTabBody();
  }, 600);
}

function acceptScan() {
  if (!S.scanResult) return;
  vibrate([8,40,12]); sfx('success');
  speak(S.scanResult.name);
  S.scanHistory.unshift({ ...S.scanResult, ts: new Date() });
  if (S.scanHistory.length > 20) S.scanHistory.pop();
  addToItems(S.scanResult);
  addLog('รับเข้าสต๊อก', S.scanResult.name + ' Lot ' + S.scanResult.lot + ' → ' + S.scanResult.dest);
  showToast(`✓ รับ ${S.scanResult.name} เข้า${S.scanResult.dest==='SUBSTOCK'?'คลัง':'หน้าเคาน์เตอร์'}`, '#2ee6a6');
  S.scanResult = null; S.scanState = 'idle';
  updateTabBody();
  saveToFirestore(S.scanHistory[0]);
}

function addToItems(r) {
  const exp = r.exp || new Date(Date.now() + (r.expDays||90)*86400000);
  const loc = r.dest || 'SUBSTOCK';
  const existing = S.items.find(i => i.lot === r.lot && i.name === r.name);
  if (existing) {
    existing.qty += (r.qty || 1);
  } else {
    S.items.unshift({
      id: 'scan-' + Date.now(),
      name: r.name, gen: r.gen||'', lot: r.lot, exp, qty: r.qty||1,
      loc, highAlert: !!r.highAlert, lasa: !!r.lasa, cold: !!r.cold, age: 0,
      form: r.cold ? 'pen' : r.highAlert ? 'vial' : 'tab',
    });
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
          <div class="detail-item"><div class="detail-item-label">จำนวน</div><div class="detail-item-val">${it.qty} หน่วย</div></div>
          <div class="detail-item"><div class="detail-item-label">ตำแหน่ง</div><div class="detail-item-val">${it.loc==='FRONT_SHELF'?'🛎 หน้าเคาน์เตอร์':'📦 คลัง'}</div></div>
          <div class="detail-item"><div class="detail-item-label">อายุสต๊อก</div><div class="detail-item-val">${it.age} วัน</div></div>
        </div>
        <div style="display:flex;gap:8px;margin-top:16px">
          ${it.loc==='SUBSTOCK' ? `<button class="form-submit" style="flex:1;padding:13px;font-size:13px" id="transferOneBtn">🚀 โอนขึ้นเคาน์เตอร์</button>` : ''}
          <button class="form-submit" style="flex:1;padding:13px;font-size:13px;background:rgba(255,77,94,.15);color:#ff4d5e;border:1px solid rgba(255,77,94,.3)" id="deleteItemBtn">🗑 ลบ</button>
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
  const deleteItem = document.getElementById('deleteItemBtn');
  if (deleteItem) deleteItem.addEventListener('click', () => {
    S.items = S.items.filter(x => x.id !== it.id);
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
      if (!S.firestoreLoaded && snapshot.docs.length === 0) {
        seedFirestore();
      }
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
          lasa: false,
          cold: (d.storage||'').includes('2–8'),
          age: 0,
          form: (d.unit||'').includes('vial') ? 'vial' : (d.unit||'').includes('capsule') ? 'cap' : 'tab',
          _fromFirestore: true,
        };
      });
      if (fsItems.length > 0) S.items = fsItems;
      S.offlineMode = false;
      if (S.screen === 'app') { renderAppBody(); updateNavTabs(); }
    }, err => {
      console.warn('Firestore error:', err.message);
      S.offlineMode = true;
    });
}

async function seedFirestore() {
  if (typeof drugsRef === 'undefined' || typeof db === 'undefined') return;
  try {
    const batch = db.batch();
    const seeds = [
      { name:'Paracetamol 500mg', generic:'Acetaminophen', batch:'PC0021', expiry:'2027-06-01', stock:60, unit:'tablets', cat:'Analgesic', storage:'Room Temperature (15–25°C)', isEmergency:false, minStock:0, loc:'SUBSTOCK' },
      { name:'Adrenaline 1mg/mL', generic:'Epinephrine', batch:'A2291', expiry:(() => { const d=new Date(); d.setDate(d.getDate()+12); return d.toISOString().slice(0,10); })(), stock:8, unit:'vials', cat:'Emergency', storage:'Protected from Light', isEmergency:true, minStock:5, loc:'FRONT_SHELF' },
      { name:'Warfarin 5mg', generic:'Warfarin sodium', batch:'WF8830', expiry:(() => { const d=new Date(); d.setDate(d.getDate()+64); return d.toISOString().slice(0,10); })(), stock:3, unit:'tablets', cat:'Cardiovascular', storage:'Room Temperature (15–25°C)', isEmergency:true, minStock:10, loc:'FRONT_SHELF' },
    ];
    seeds.forEach(s => batch.set(drugsRef.doc(), { ...s, createdAt: firebase.firestore.FieldValue.serverTimestamp() }));
    await batch.commit();
  } catch(e) { console.warn('Seed error:', e); }
}

async function saveToFirestore(item) {
  if (typeof drugsRef === 'undefined') return;
  try {
    const data = {
      name: item.name, generic: item.gen||'', batch: item.lot||'',
      expiry: item.exp instanceof Date ? item.exp.toISOString().slice(0,10) : item.exp,
      stock: item.qty||0, unit: 'units', loc: item.loc||'SUBSTOCK',
      isEmergency: !!item.highAlert, minStock: 0, cat: 'Other',
      storage: item.cold ? 'Refrigerated (2–8°C)' : 'Room Temperature (15–25°C)',
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
      S.screen = 'lock'; S.user = null;
      renderScreen();
    }
  }, 30000);
}

// ── BOOTSTRAP ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  applyTheme(S.theme);
  S.items = makeItems();

  // Status bar clock
  setInterval(updateClock, 10000);
  updateClock();

  renderScreen();
  initOfflineMonitor();
  initAutoLock();

  // Try Firestore
  try { initFirestore(); } catch(e) { console.warn('Firestore init:', e); }
});
