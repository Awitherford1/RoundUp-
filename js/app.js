// ============================================
// ROUNDUP — MAIN APPLICATION (FIXED VERSION)
// ============================================

import { db } from "./firebase.js";
import {
  collection, doc, setDoc, getDoc, updateDoc,
  onSnapshot, arrayUnion, serverTimestamp,
  query, where, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ============================================
// STATE
// ============================================

let state = {
  roundId: null,
  roundCode: null,
  myName: null,
  isHost: false,
  unsubscribe: null,
  roundData: null,
  pendingDrink: null,
  memberList: [],

  // NEW FLAGS (fix timing issues)
  _drinkPromptShown: false,
  _requestHintShown: false
};

// ============================================
// HELPERS
// ============================================

function randomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 4 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join("");
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getShareUrl(code) {
  return `${window.location.origin}${window.location.pathname}?join=${code}`;
}

// ============================================
// TOAST
// ============================================

function showToast(msg) {
  const t = document.getElementById("toast");
  if (!t) return;
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 3000);
}

// ============================================
// NAV
// ============================================

window.App = {
  goTo(id) {
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    document.getElementById(id)?.classList.add("active");
  }
};

// ============================================
// RENDER
// ============================================

function renderRound(data) {
  state.roundData = data;

  // Share code FIX
  const codeEl = document.getElementById("share-code-big");
  if (codeEl) codeEl.textContent = data.code;

  const urlEl = document.getElementById("share-url-display");
  if (urlEl) urlEl.textContent = getShareUrl(data.code);
}

// ============================================
// CORE LOGIC
// ============================================

window.Round = {

  async createRound() {
    const name = document.getElementById("host-name").value.trim();
    const pub = document.getElementById("pub-name").value.trim() || "The Pub";

    if (!name) return showToast("Enter your name");

    const code = randomCode();
    const id = `${slugify(pub)}-${code}`;

    const data = {
      code,
      pub,
      host: name,
      members: [{ name, roundsBought: 0 }],
      drinks: [],
      requests: [],
      roundsDone: 0,
      createdAt: serverTimestamp()
    };

    await setDoc(doc(db, "rounds", id), data);

    state.roundId = id;
    state.roundCode = code;
    state.myName = name;
    state.isHost = true;

    this._subscribe(id);
    App.goTo("s-round");

    showToast(`Round created: ${code}`);
  },

  async joinRound() {
    const code = ["c1","c2","c3","c4"]
      .map(id => document.getElementById(id).value.toUpperCase())
      .join("");

    const name = document.getElementById("join-name").value.trim();

    if (!name || code.length < 4) return showToast("Enter details");

    const q = query(collection(db, "rounds"), where("code", "==", code));
    const snap = await getDocs(q);

    if (snap.empty) return showToast("Not found");

    const docSnap = snap.docs[0];
    const data = docSnap.data();

    const exists = data.members.find(m => m.name === name);

    if (!exists) {
      await updateDoc(doc(db, "rounds", docSnap.id), {
        members: arrayUnion({ name, roundsBought: 0 })
      });
    }

    state.roundId = docSnap.id;
    state.roundCode = code;
    state.myName = name;

    this._subscribe(docSnap.id);
    App.goTo("s-round");
  },

  _subscribe(id) {
    if (state.unsubscribe) state.unsubscribe();

    state.unsubscribe = onSnapshot(doc(db, "rounds", id), (snap) => {
      if (!snap.exists()) return;

      const data = snap.data();

      renderRound(data);

      // 🔥 FIX: run features AFTER data loads
      this._afterLoad(data);
    });
  },

  _afterLoad(data) {
    // ---- DRINK PROMPT ----
    const hasDrink = (data.drinks || []).some(
      d => d.member === state.myName
    );

    if (!hasDrink && !state._drinkPromptShown) {
      state._drinkPromptShown = true;

      setTimeout(() => {
        document.getElementById("add-drink-modal")?.classList.add("open");
        showToast("Add your drink 🍺");
      }, 500);
    }

    // ---- REQUEST HINT ----
    if (!state._requestHintShown && data.members.length > 1) {
      state._requestHintShown = true;

      setTimeout(() => {
        showToast("Tap + for last-minute request 📲");
      }, 1200);
    }
  },

  async addDrink() {
    const val = document.getElementById("custom-drink").value.trim();
    if (!val) return showToast("Enter drink");

    const data = state.roundData;

    const drinks = [...(data.drinks || [])];
    const idx = drinks.findIndex(d => d.member === state.myName);

    if (idx >= 0) drinks[idx].drink = val;
    else drinks.push({ member: state.myName, drink: val });

    await updateDoc(doc(db, "rounds", state.roundId), { drinks });

    document.getElementById("add-drink-modal")?.classList.remove("open");
  },

  async sendRequest() {
    const drink = prompt("What do you want?");
    if (!drink) return;

    const data = state.roundData;

    const requests = [
      ...(data.requests || []),
      {
        name: state.myName,
        drink,
        createdAt: Date.now()
      }
    ];

    await updateDoc(doc(db, "rounds", state.roundId), { requests });

    showToast("Request sent 📲");
  },

  copyShareLink() {
    const url = getShareUrl(state.roundCode);

    if (navigator.share) {
      navigator.share({ url });
    } else {
      navigator.clipboard.writeText(url);
      showToast("Link copied");
    }
  }
};

// ============================================
// START
// ============================================

(function () {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("join");

  if (code) {
    code.split("").forEach((c, i) => {
      const el = document.getElementById(`c${i+1}`);
      if (el) el.value = c;
    });
    App.goTo("s-join");
  } else {
    App.goTo("s-home");
  }
})();
