// Offline stand-in for the Firebase compat SDK, used only by test/qa-full-flow.js.
// The real app talks to Firestore for persistence; this stub answers every
// collection().doc().get/add/set/update/delete/onSnapshot() call with an
// empty-but-well-formed result so the UI can render and be driven without a
// live project or network access.
(function () {
  function chainable() {
    const handler = {
      get(target, prop) {
        if (prop === 'then') return undefined;
        if (!(prop in target)) {
          target[prop] = (...args) => {
            if (prop === 'onSnapshot' && typeof args[0] === 'function') {
              try { args[0]({ empty: true, docs: [], forEach: () => {}, size: 0 }); } catch (e) {}
              return () => {};
            }
            if (prop === 'get') {
              return Promise.resolve({ empty: true, docs: [], forEach: () => {}, exists: false, data: () => ({}) });
            }
            if (prop === 'add' || prop === 'set' || prop === 'update' || prop === 'delete') {
              return Promise.resolve({ id: 'stub' });
            }
            return new Proxy(function () {}, handler);
          };
        }
        return target[prop];
      },
      apply() {
        return new Proxy(function () {}, handler);
      },
    };
    return new Proxy(function () {}, handler);
  }
  window.firebase = {
    initializeApp: () => {},
    firestore: Object.assign(() => chainable(), {
      FieldValue: { serverTimestamp: () => new Date() },
    }),
  };
})();
