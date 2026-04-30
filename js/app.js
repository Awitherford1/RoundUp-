// ============================================
// ROUNDUP — MAIN APPLICATION (UPGRADED)
// ============================================

import { db } from "./firebase.js";
import {
  collection, doc, setDoc, getDoc, updateDoc,
  onSnapshot, arrayUnion, serverTimestamp, query, where, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ============================================
// CONSTANTS
// ============================================

const AVATAR_COLORS = [
  { bg: "#E1F5EE", fg: "#0F6E56" },
  { bg: "#EEEDFE", fg: "#534AB7" },
  { bg: "#FAEEDA", fg: "#854F0B" },
  { bg: "#FAECE7", fg: "#993C1D" },
  { bg: "#E6F1FB", fg: "#185FA5" },
  { bg: "#EAF3DE", fg: "#3B6D11" },
];

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
};

// ============================================
// UTILITIES
// ============================================

function initials(name) {
  return (name || "?").split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

function getColor(index) {
  return AVATAR_COLORS[index % AVATAR_COLORS.length];
}

function randomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getShareUrl(code) {
  return `${window.location.origin}?join=${code}`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ============================================
// NAVIGATION
// ============================================

window.App = {
  goTo(id) {
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    document.getElementById(id)?.classList.add("active");
  }
};

// ============================================
// TOAST
// ============================================

let toastTimer;
function showToast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 2500);
}

// ============================================
// ROUND RENDER
// ============================================

function renderRound(data) {
  state.roundData = data;

  const members = data.members || [];
  const drinks = data.drinks || [];
  const requests = data.requests || [];

  document.getElementById("round-code-display").textContent = data.code;

  renderWhosNext(members);
  renderDrinks(drinks, members);
  renderRequests(requests);
}

function renderWhosNext(members) {
  if (!members.length) return;

  const next = [...members].sort((a, b) => (a.roundsBought || 0) - (b.roundsBought || 0))[0];

  let text = next.name;
  if (next.name === state.myName) text += " (you)";

  document.getElementById("whos-next-name").textContent = text;
}

function renderDrinks(drinks, members) {
  const list = document.getElementById("drinks-list");

  if (!drinks.length) {
    list.innerHTML = `
      <div class="empty-state">
        👇 Start the round<br>
        Add your drink to get involved 🍻
      </div>`;
    return;
  }

  list.innerHTML = drinks.map(d => `
    <div class="drink-row">
      <div>${escHtml(d.drink)}</div>
      <div>${escHtml(d.member)}${d.member === state.myName ? " (you)" : ""}</div>
    </div>
  `).join("");
}

function renderRequests(requests) {
  const el = document.getElementById("requests-list");

  if (!requests.length) {
    el.innerHTML = "";
    return;
  }

  el.innerHTML = requests.map((r, i) => `
    <div>
      ${escHtml(r.name)} wants ${escHtml(r.drink)}
      ${state.isHost ? `
        <button onclick="Round.acceptRequest(${i})">✓</button>
        <button onclick="Round.rejectRequest(${i})">✕</button>
      ` : ""}
    </div>
  `).join("");
}

// ============================================
// ACTIONS
// ============================================

window.Round = {

  async createRound() {
    const pub = document.getElementById("pub-name").value || "Pub";
    const name = document.getElementById("host-name").value;

    if (!name) return showToast("Enter your name");

    const code = randomCode();
    const roundId = `${slugify(pub)}-${code}`;

    const data = {
      code,
      pub,
      host: name,
      members: [{ name, roundsBought: 0 }],
      drinks: [],
      requests: [],
      roundsDone: 0,
      createdAt: serverTimestamp(),
    };

    await setDoc(doc(db, "rounds", roundId), data);

    state.roundId = roundId;
    state.roundCode = code;
    state.myName = name;
    state.isHost = true;

    this._subscribe(roundId);
    App.goTo("s-round");

    // ✅ AUTO COPY LINK
    const url = getShareUrl(code);
    navigator.clipboard?.writeText(url);
    showToast("Invite link copied 🍻");
  },

  async joinRound() {
    const code = ["c1","c2","c3","c4"].map(id => document.getElementById(id).value).join("");
    const name = document.getElementById("join-name").value;

    const q = query(collection(db, "rounds"), where("code", "==", code));
    const snap = await getDocs(q);

    if (snap.empty) return showToast("Round not found");

    const docSnap = snap.docs[0];
    const data = docSnap.data();

    const exists = data.members.find(m => m.name.toLowerCase() === name.toLowerCase());
    if (exists) return showToast("Name already taken");

    await updateDoc(doc(db, "rounds", docSnap.id), {
      members: arrayUnion({ name, roundsBought: 0 })
    });

    state.roundId = docSnap.id;
    state.roundCode = code;
    state.myName = name;

    this._subscribe(docSnap.id);
    App.goTo("s-round");

    showToast("You're in 🍻");

    // ✅ AUTO DRINK PROMPT
    setTimeout(() => {
      UI.openAddDrinkModal();
    }, 500);
  },

  _subscribe(id) {
    if (state.unsubscribe) state.unsubscribe();

    state.unsubscribe = onSnapshot(doc(db, "rounds", id), snap => {
      renderRound(snap.data());
    });
  },

  async addDrink() {
    const drink = document.getElementById("custom-drink").value;
    if (!drink) return showToast("Pick a drink");

    const data = state.roundData;
    const drinks = [...data.drinks.filter(d => d.member !== state.myName), { member: state.myName, drink }];

    await updateDoc(doc(db, "rounds", state.roundId), { drinks });
    showToast("Drink added 🍺");
  },

  async sendRequest() {
    const drink = prompt("What do you want?");
    if (!drink) return;

    const data = state.roundData;
    const requests = [...data.requests, { name: state.myName, drink }];

    await updateDoc(doc(db, "rounds", state.roundId), { requests });

    showToast("Request sent 📲");
  },

  async acceptRequest(i) {
    const data = state.roundData;
    const r = data.requests[i];

    await updateDoc(doc(db, "rounds", state.roundId), {
      requests: data.requests.filter((_, idx) => idx !== i),
      drinks: [...data.drinks, { member: r.name, drink: r.drink }],
      members: arrayUnion({ name: r.name, roundsBought: 0 })
    });

    showToast("Added 🍺");
  },

  async rejectRequest(i) {
    const data = state.roundData;

    await updateDoc(doc(db, "rounds", state.roundId), {
      requests: data.requests.filter((_, idx) => idx !== i)
    });

    showToast("Rejected");
  },

  copyShareLink() {
    const url = getShareUrl(state.roundCode);

    if (navigator.share) {
      navigator.share({ title: "Join my round 🍻", url });
    } else {
      navigator.clipboard.writeText(url);
      showToast("Link copied 📋");
    }
  }
};

// ============================================
// BOOTSTRAP
// ============================================

function bootstrap() {
  const params = new URLSearchParams(window.location.search);
  const join = params.get("join");

  setTimeout(() => {
    if (join) {
      join.split("").forEach((c, i) => {
        const el = document.getElementById(`c${i + 1}`);
        if (el) el.value = c;
      });

      App.goTo("s-join");

      setTimeout(() => {
        document.getElementById("join-name")?.focus();
      }, 300);

    } else {
      App.goTo("s-home");
    }
  }, 800);
}

bootstrap();
