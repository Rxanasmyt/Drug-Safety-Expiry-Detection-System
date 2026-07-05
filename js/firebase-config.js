/* PharmaCare — Firebase Configuration */

const firebaseConfig = {
  apiKey:            "AIzaSyDU7fAHU2m4rtj4QK_xmDhsnL9UXnoN52E",
  authDomain:        "detect-expire-opd-drug.firebaseapp.com",
  projectId:         "detect-expire-opd-drug",
  storageBucket:     "detect-expire-opd-drug.firebasestorage.app",
  messagingSenderId: "781834103808",
  appId:             "1:781834103808:web:6971780c76ebbc75d47ce5",
  measurementId:     "G-RHKCEZK6MB",
};

firebase.initializeApp(firebaseConfig);

const db           = firebase.firestore();
const drugsRef     = db.collection('drugs');
const drugCacheRef = db.collection('drugCache');   // GTIN → drug metadata, shared across all devices/users
const recallsRef   = db.collection('recalls');     // Lot recall alerts issued by pharmacy admin
const disposalsRef = db.collection('disposals');   // Drug disposal records (2-person confirmation)
const dispensingRef = db.collection('dispensing'); // Patient dispensing records
const usersRef     = db.collection('users');       // Staff accounts — synced across all devices
const auditRef     = db.collection('auditLog');    // Audit trail — all actions logged here

db.enablePersistence({ synchronizeTabs: true }).catch(err => {
  if (err.code !== 'failed-precondition' && err.code !== 'unimplemented') {
    console.warn('Persistence error:', err);
  }
});
