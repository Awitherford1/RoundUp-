// ============================================
// ROUNDUP — MAIN APPLICATION
// ============================================

import { db } from "./firebase.js";
import {
  collection, doc, setDoc, getDoc, updateDoc,
  onSnapshot, arrayUnion, serverTimestamp
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
  { bg: "#FDE8F8", fg: "#8B2A82" },
  { bg: "#E8F0FE", fg: "#1A56C4" },
  { bg: "#FFF0E6", fg: "#B5440A" },
  { bg: "#E6FAF8", fg: "#0B6E65" },
];

// ============================================
// LOCAL STATE
// ============================================

let state = {
  roundId: null,       // Firestore document ID
  roundCode: null,     // 4-char code
  myName: null,        // This user's name
  isHost: false,       // Did this user create the round?
  unsubscribe: null,   // Firestore real-time listener
  roundData: null,     // Latest snapshot from Firestore
  pendingDrink: null,  // Selected drink in modal
  memberList: [],      // Members added on start screen
};

// ============================================
// UTILITIES
// ============================================

function initials(name) {
  return (name || "?")
    .split(" ")
    .map(w => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function getColor(index) {
  return AVATAR_COLORS[index % AVATAR_COLORS.length];
}

function randomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function getShareUrl(code) {
  const base = window.location.origin + window.location.pathname;
  return `${base}?join=${code}`;
}

// ============================================
// APP NAVIGATION
// ============================================

window.App = {
  goTo(screenId) {
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    const screen = document.getElementById(screenId);
    if (screen) {
      screen.classList.add("active");
      window.scrollTo(0, 0);
    }
  }
};

// ============================================
// TOAST NOTIFICATIONS
// ============================================

let toastTimer;
function showToast(msg, duration = 3000) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), duration);
}

// ============================================
// UI HELPERS
// ============================================

window.UI = {
  nextCode(el, nextId) {
    el.value = el.value.toUpperCase();
    if (el.value && nextId) document.getElementById(nextId).focus();
  },
  prevCode(e, prevId, curId) {
    if (e.key === "Backspace" && !document.getElementById(curId).value && prevId) {
      document.getElementById(prevId).focus();
    }
  },
  openAddDrinkModal() {
    state.pendingDrink = null;
    document.querySelectorAll(".preset").forEach(p => p.classList.remove("selected"));
    document.getElementById("custom-drink").value = "";
    document.getElementById("add-drink-modal").classList.add("open");
  },
  closeModal(e) {
    if (e.target === document.getElementById("add-drink-modal")) {
      document.getElementById("add-drink-modal").classList.remove("open");
    }
  },
  selectPreset(el, drink) {
    document.querySelectorAll(".preset").forEach(p => p.classList.remove("selected"));
    el.classList.add("selected");
    state.pendingDrink = drink;
    document.getElementById("custom-drink").value = "";
  },
  clearPresetSelection() {
    document.querySelectorAll(".preset").forEach(p => p.classList.remove("selected"));
    state.pendingDrink = null;
  }
};

// ============================================
// ROUND RENDERING
// ============================================

function renderRound(data) {
  if (!data) return;
  state.roundData = data;

  const members = data.members || [];
  const drinks = data.drinks || [];
  const requests = data.requests || [];
  const roundsDone = data.roundsDone || 0;

  // Header
  document.getElementById("round-code-display").textContent = data.code;
  document.getElementById("round-name-display").textContent = data.pub || "The Pub";
  document.getElementById("round-meta-display").textContent =
    `Tonight · ${members.length} people · ${roundsDone} round${roundsDone !== 1 ? "s" : ""} done`;

  // Share box
  document.getElementById("share-code-big").textContent = data.code;
  document.getElementById("share-url-display").textContent = getShareUrl(data.code);

  // Who's next
  renderWhosNext(members);

  // Drinks list
  renderDrinks(drinks, members);

  // Requests
  renderRequests(requests, members);

  // Leaderboard
  renderLeaderboard(members);
}

function renderWhosNext(members) {
  if (!members.length) return;
  const sorted = [...members].sort((a, b) => (a.roundsBought || 0) - (b.roundsBought || 0));
  const next = sorted[0];
  document.getElementById("whos-next-name").textContent = next.name;
  const rb = next.roundsBought || 0;
  document.getElementById("whos-next-sub").textContent =
    rb === 0 ? "Hasn't bought a round yet! 👀" : `${rb} round${rb !== 1 ? "s" : ""} bought`;
}

function renderDrinks(drinks, members) {
  const list = document.getElementById("drinks-list");
  document.getElementById("drinks-count-lbl").textContent = `In the round (${drinks.length})`;

  if (!drinks.length) {
    list.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">🍻</span>
        No drinks yet — tap + Add drink to get started!
      </div>`;
    return;
  }

  list.innerHTML = drinks.map((d, i) => {
    const memberIdx = members.findIndex(m => m.name === d.member);
    const color = getColor(memberIdx >= 0 ? memberIdx : i);
    const member = members[memberIdx] || {};
    const rb = member.roundsBought || 0;
    const isMe = d.member === state.myName;

    return `
      <div class="drink-row">
        <div class="d-avatar" style="background:${color.bg};color:${color.fg}">${initials(d.member)}</div>
        <div class="d-info">
          <div class="d-name">${escHtml(d.drink)}</div>
          <div class="d-person">${escHtml(d.member)}${isMe ? " (you)" : ""}</div>
        </div>
        <div class="d-rounds">${rb}r</div>
        <div class="d-check">
          <svg width="10" height="10" viewBox="0 0 10 10">
            <polyline points="1.5,5 4,7.5 8.5,2" stroke="#fff" stroke-width="1.8"
              fill="none" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
      </div>`;
  }).join("");
}

function renderRequests(requests, members) {
  const sec = document.getElementById("requests-section");
  const list = document.getElementById("requests-list");

  if (!requests.length) { sec.style.display = "none"; return; }
  sec.style.display = "block";
  document.getElementById("requests-count-lbl").textContent = `Requests (${requests.length})`;

  list.innerHTML = requests.map((r, i) => {
    const colorIdx = members.length + i;
    const color = getColor(colorIdx);
    return `
      <div class="request-row">
        <div class="d-avatar" style="background:${color.bg};color:${color.fg};width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;">
          ${initials(r.name)}
        </div>
        <div class="d-info">
          <div class="d-name" style="font-size:13px;font-weight:600;">${escHtml(r.drink)}</div>
          <div class="d-person" style="color:#854F0B;">${escHtml(r.name)} wants in 📲</div>
        </div>
        <div class="req-actions">
          ${state.isHost
            ? `<button class="req-btn accept" onclick="Round.acceptRequest(${i})">✓ Yes</button>
               <button class="req-btn reject" onclick="Round.rejectRequest(${i})">✕</button>`
            : `<span style="font-size:11px;color:var(--text-muted);">Waiting…</span>`
          }
        </div>
      </div>`;
  }).join("");
}

function renderLeaderboard(members) {
  const sorted = [...members].sort((a, b) => (b.roundsBought || 0) - (a.roundsBought || 0));
  const max = Math.max(...sorted.map(m => m.roundsBought || 0), 1);
  const minBought = Math.min(...sorted.map(m => m.roundsBought || 0));

  document.getElementById("leaderboard-rows").innerHTML = sorted.map((m, i) => {
    const rb = m.roundsBought || 0;
    const pct = Math.round((rb / max) * 100);
    const color = getColor(members.findIndex(x => x.name === m.name));
    const isMe = m.name === state.myName;

    let badge = "";
    if (i === 0 && rb > 0) badge = `<span class="lb-badge" style="background:#E1F5EE;color:#0F6E56;">legend 🏆</span>`;
    else if (rb === minBought) badge = `<span class="lb-badge" style="background:#FFF8EC;color:#854F0B;">up next 👑</span>`;

    return `
      <div class="lb-row">
        <div class="lb-pos">${i + 1}</div>
        <div class="lb-av" style="background:${color.bg};color:${color.fg}">${initials(m.name)}</div>
        <div class="lb-name">${escHtml(m.name)}${isMe ? `<span class="lb-you">(you)</span>` : ""}</div>
        <div class="lb-bar-bg"><div class="lb-bar-fill" style="width:${pct}%"></div></div>
        <div class="lb-count-txt">${rb}r</div>
        ${badge}
      </div>`;
  }).join("");
}

function renderOrderList() {
  const data = state.roundData;
  if (!data) return;
  const drinks = data.drinks || [];
  const members = data.members || [];
  document.getElementById("order-sub").textContent = `${drinks.length} drink${drinks.length !== 1 ? "s" : ""} — tap each as you grab it`;

  document.getElementById("order-list").innerHTML = drinks.map((d, i) => `
    <div class="order-item" id="oi-${i}">
      <div class="order-num">${i + 1}</div>
      <div style="flex:1;">
        <div class="order-drink">${escHtml(d.drink)}</div>
        <div class="order-person">${escHtml(d.member)}</div>
      </div>
      <div class="order-check" id="oc-${i}" onclick="Round.toggleOrderItem(${i})"></div>
    </div>`).join("");
}

// ============================================
// ROUND ACTIONS
// ============================================

window.Round = {

  // ---- START ROUND SCREEN ----

  addMemberToList() {
    const inp = document.getElementById("member-input");
    const name = inp.value.trim();
    if (!name) return;
    if (state.memberList.includes(name)) { showToast("Already added!"); return; }
    state.memberList.push(name);
    inp.value = "";
    this._renderMemberChips();
  },

  removeMemberFromList(idx) {
    state.memberList.splice(idx, 1);
    this._renderMemberChips();
  },

  _renderMemberChips() {
    const container = document.getElementById("member-chips");
    container.innerHTML = state.memberList.map((name, i) => {
      const color = getColor(i + 1); // +1 because host is index 0
      return `
        <div class="chip">
          <div class="chip-avatar" style="background:${color.bg};color:${color.fg}">${initials(name)}</div>
          ${escHtml(name)}
          <span class="chip-remove" onclick="Round.removeMemberFromList(${i})">×</span>
        </div>`;
    }).join("");
  },

  // ---- CREATE ROUND ----

  async createRound() {
    const pub = document.getElementById("pub-name").value.trim() || "The Pub";
    const hostName = document.getElementById("host-name").value.trim();
    if (!hostName) { showToast("Enter your name first! 👆"); return; }

    const btn = document.getElementById("create-round-btn");
    btn.innerHTML = `<span class="spinner"></span> Creating…`;
    btn.disabled = true;

    try {
      const code = randomCode();
      const roundId = `${slugify(pub)}-${code}`;

      // Build members array — host first
      const hostColor = getColor(0);
      const members = [
        { name: hostName, roundsBought: 0, colorIndex: 0 },
        ...state.memberList.map((name, i) => ({
          name, roundsBought: 0, colorIndex: i + 1
        }))
      ];

      const roundData = {
        code,
        pub,
        host: hostName,
        members,
        drinks: [],
        requests: [],
        roundsDone: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      await setDoc(doc(db, "rounds", roundId), roundData);

      state.roundId = roundId;
      state.roundCode = code;
      state.myName = hostName;
      state.isHost = true;
      state.memberList = [];

      this._subscribeToRound(roundId);
      App.goTo("s-round");
      showToast(`Round created! Code: ${code} 🍺`);

    } catch (err) {
      console.error(err);
      showToast("Couldn't create round. Check your Firebase config!");
      btn.textContent = "Create Round →";
      btn.disabled = false;
    }
  },

  // ---- JOIN ROUND ----

  async joinRound() {
    const code = ["c1","c2","c3","c4"]
      .map(id => document.getElementById(id).value.toUpperCase().trim())
      .join("");
    const name = document.getElementById("join-name").value.trim();

    if (code.length < 4) { showToast("Enter the full 4-letter code 🔡"); return; }
    if (!name) { showToast("Enter your name! 👆"); return; }

    showToast("Joining round…");

    try {
      // Find round by code — search across rounds
      const { collection: col, query, where, getDocs } =
        await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");

      const q = query(collection(db, "rounds"), where("code", "==", code));
      const snap = await getDocs(q);

      if (snap.empty) { showToast("Round not found! Check the code 🤔"); return; }

      const roundDoc = snap.docs[0];
      const roundId = roundDoc.id;
      const data = roundDoc.data();
      const members = data.members || [];

      // Check if already in the round
      const alreadyIn = members.find(m => m.name === name);
      if (alreadyIn) {
        // Just reconnect
        state.roundId = roundId;
        state.roundCode = code;
        state.myName = name;
        state.isHost = data.host === name;
        this._subscribeToRound(roundId);
        App.goTo("s-round");
        showToast(`Welcome back, ${name}! 🍺`);
        return;
      }

      // Add as new member
      const colorIndex = members.length;
      const newMember = { name, roundsBought: 0, colorIndex };
      await updateDoc(doc(db, "rounds", roundId), {
        members: arrayUnion(newMember),
        updatedAt: serverTimestamp(),
      });

      state.roundId = roundId;
      state.roundCode = code;
      state.myName = name;
      state.isHost = false;
      this._subscribeToRound(roundId);
      App.goTo("s-round");
      showToast(`You're in! Welcome, ${name} 🍻`);

    } catch (err) {
      console.error(err);
      showToast("Something went wrong. Try again!");
    }
  },

  // ---- REAL-TIME LISTENER ----

  _subscribeToRound(roundId) {
    if (state.unsubscribe) state.unsubscribe();
    state.unsubscribe = onSnapshot(doc(db, "rounds", roundId), (snap) => {
      if (!snap.exists()) { showToast("Round no longer exists"); return; }
      renderRound(snap.data());
    });
  },

  // ---- ADD DRINK ----

  async addDrink() {
    const custom = document.getElementById("custom-drink").value.trim();
    const drink = custom || state.pendingDrink;
    if (!drink) { showToast("Pick a drink! 🍺"); return; }

    const data = state.roundData;
    if (!data) return;

    const drinks = [...(data.drinks || [])];
    const existingIdx = drinks.findIndex(d => d.member === state.myName);
    if (existingIdx >= 0) drinks[existingIdx] = { member: state.myName, drink };
    else drinks.push({ member: state.myName, drink });

    document.getElementById("add-drink-modal").classList.remove("open");

    try {
      await updateDoc(doc(db, "rounds", state.roundId), {
        drinks,
        updatedAt: serverTimestamp(),
      });
      showToast(`${drink} added! 🍻`);
    } catch (err) {
      console.error(err);
      showToast("Couldn't add drink. Try again!");
    }
  },

  // ---- REQUESTS ----

  async acceptRequest(idx) {
    const data = state.roundData;
    if (!data) return;
    const requests = [...(data.requests || [])];
    const r = requests[idx];
    if (!r) return;

    requests.splice(idx, 1);
    const members = [...data.members];
    const colorIndex = members.length;
    members.push({ name: r.name, roundsBought: 0, colorIndex });
    const drinks = [...(data.drinks || []), { member: r.name, drink: r.drink }];

    try {
      await updateDoc(doc(db, "rounds", state.roundId), {
        requests, members, drinks, updatedAt: serverTimestamp()
      });
      showToast(`${r.name} added to the round! 🍺`);
    } catch (err) {
      console.error(err);
    }
  },

  async rejectRequest(idx) {
    const data = state.roundData;
    if (!data) return;
    const requests = [...(data.requests || [])];
    const r = requests[idx];
    requests.splice(idx, 1);
    try {
      await updateDoc(doc(db, "rounds", state.roundId), {
        requests, updatedAt: serverTimestamp()
      });
      showToast(`${r.name} rejected. Harsh! 😅`);
    } catch (err) {
      console.error(err);
    }
  },

  // ---- ORDER ----

  goToOrder() {
    if (!state.roundData?.drinks?.length) {
      showToast("No drinks in the round yet!");
      return;
    }
    renderOrderList();
    App.goTo("s-order");
  },

  toggleOrderItem(i) {
    const el = document.getElementById(`oc-${i}`);
    const row = document.getElementById(`oi-${i}`);
    el.classList.toggle("done");
    row.classList.toggle("ticked");
  },

  async completeRound() {
    const data = state.roundData;
    if (!data) return;

    // Increment host's round count
    const members = data.members.map(m => {
      if (m.name === state.myName) {
        return { ...m, roundsBought: (m.roundsBought || 0) + 1 };
      }
      return m;
    });

    try {
      await updateDoc(doc(db, "rounds", state.roundId), {
        members,
        drinks: [],
        requests: [],
        roundsDone: (data.roundsDone || 0) + 1,
        updatedAt: serverTimestamp(),
      });
      App.goTo("s-round");
      showToast(`Round ${(data.roundsDone || 0) + 1} done! 🎉 Legend, ${state.myName}!`);
    } catch (err) {
      console.error(err);
      showToast("Couldn't complete round. Try again!");
    }
  },

  // ---- SHARE ----

  copyShareLink() {
    const url = getShareUrl(state.roundCode);
    const text = `Join my round on RoundUp! Code: ${state.roundCode}\n${url}`;
    if (navigator.share) {
      navigator.share({ title: "Join my RoundUp!", text, url });
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => showToast("Invite link copied! 📋"));
    } else {
      showToast(`Share code: ${state.roundCode}`);
    }
  },

  // ---- LEAVE ----

  leaveRound() {
    if (state.unsubscribe) state.unsubscribe();
    state.roundId = null;
    state.roundCode = null;
    state.myName = null;
    state.isHost = false;
    state.roundData = null;
    App.goTo("s-home");
    showToast("Left the round 👋");
  }
};

// ============================================
// BOOTSTRAP
// ============================================

function bootstrap() {
  // Check for ?join=CODE in URL (deep link)
  const params = new URLSearchParams(window.location.search);
  const joinCode = params.get("join");

  // Small delay for loading screen feel
  setTimeout(() => {
    if (joinCode) {
      // Pre-fill the code inputs
      joinCode.toUpperCase().split("").forEach((ch, i) => {
        const el = document.getElementById(`c${i + 1}`);
        if (el) el.value = ch;
      });
      App.goTo("s-join");
    } else {
      App.goTo("s-home");
    }
  }, 1200);
}

// ---- XSS safety ----
function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---- Start ----
bootstrap();
