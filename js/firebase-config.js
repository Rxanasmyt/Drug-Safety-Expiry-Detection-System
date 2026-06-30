/*
 * PharmaCare — Firebase Configuration
 * ─────────────────────────────────────────────────────────────
 * ขั้นตอนการตั้งค่า:
 * 1. ไปที่ https://console.firebase.google.com
 * 2. สร้าง Project ใหม่ → ตั้งชื่อ "PharmaCare"
 * 3. เพิ่ม Web App → คัดลอก firebaseConfig มาวางด้านล่าง
 * 4. เปิด Firestore Database → Start in test mode
 * 5. เปิด Firebase Hosting → รัน: firebase deploy
 * ─────────────────────────────────────────────────────────────
 */

const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT_ID.firebaseapp.com",
  projectId:         "YOUR_PROJECT_ID",
  storageBucket:     "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_MESSAGING_SENDER_ID",
  appId:             "YOUR_APP_ID",
};

firebase.initializeApp(firebaseConfig);

/* ── Firestore instance (exported globally) ── */
const db       = firebase.firestore();
const drugsRef = db.collection('drugs');

/* ── Enable offline persistence (ข้อมูลใช้ได้แม้ไม่มีอินเตอร์เน็ต) ── */
db.enablePersistence({ synchronizeTabs: true }).catch(err => {
  if (err.code === 'failed-precondition') {
    console.warn('Persistence: multiple tabs open');
  } else if (err.code === 'unimplemented') {
    console.warn('Persistence: browser not supported');
  }
});
