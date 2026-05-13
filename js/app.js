// ============================================
// ROUNDUP — MAIN APPLICATION
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
  myName: null,        // This user's display name
  myMemberId: null,    // Stable member identity for this browser/session
  isHost: false,       // Did this user create the round?
  unsubscribe: null,   // Firestore real-time listener
  roundData: null,     // Latest snapshot from Firestore
  pendingDrink: null,  // Selected drink in modal
  drinkModalMode: "drink", // "drink" or "request"
  memberList: [],      // Members added on start screen
  orderLocked: false,  // True when host has tapped "Ready to order"
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

function safeInitials(name) {
  return escHtml(initials(name));
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


function makeId(prefix = "id") {
  const rand = (crypto?.randomUUID?.() || Math.random().toString(36).slice(2));
  return `${prefix}_${rand.replace(/[^a-zA-Z0-9]/g, "").slice(0, 18)}`;
}

function memberKey(member) {
  return member?.id || slugify(member?.name || "");
}

function drinkOwnerKey(drink) {
  return drink?.memberId || slugify(drink?.member || "");
}

function getMyKey() {
  return state.myMemberId || slugify(state.myName || "");
}

function rememberMember(roundId, memberId, name) {
  if (!roundId || !memberId) return;
  localStorage.setItem(`roundup:${roundId}:memberId`, memberId);
  localStorage.setItem(`roundup:${roundId}:memberName`, name || "");
}

function getRememberedMemberId(roundId) {
  return localStorage.getItem(`roundup:${roundId}:memberId`);
}

function getNextBuyer(members) {
  if (!members.length) return null;
  return [...members].sort((a, b) => {
    const roundsDiff = (a.roundsBought || 0) - (b.roundsBought || 0);
    if (roundsDiff !== 0) return roundsDiff;
    return (a.joinedAtMs || 0) - (b.joinedAtMs || 0);
  })[0];
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
  openAddDrinkModal(mode = null) {
    if (mode === "request" && state.orderLocked) {
      showToast("Someone's at the bar — requests are locked! 🍺", 3500);
      return;
    }
    state.drinkModalMode = mode || (state.isHost ? "drink" : "request");
    state.pendingDrink = null;
    document.querySelectorAll(".preset").forEach(p => p.classList.remove("selected"));
    document.getElementById("custom-drink").value = "";
    const title = document.getElementById("drink-modal-title");
    const btn = document.getElementById("drink-modal-submit");
    if (title) title.textContent = state.drinkModalMode === "request" ? "Request a drink" : "What are you having?";
    if (btn) btn.textContent = state.drinkModalMode === "request" ? "Send request" : "Add to round";
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
  },
  showConfirm(title, message, confirmLabel, onConfirm) {
    // Remove any existing confirm dialog
    const existing = document.getElementById("confirm-dialog");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "confirm-dialog";
    overlay.className = "confirm-overlay";
    overlay.innerHTML = `
      <div class="confirm-box">
        <div class="confirm-title">${escHtml(title)}</div>
        <div class="confirm-msg">${escHtml(message)}</div>
        <div class="confirm-btns">
          <button class="confirm-cancel" id="confirm-cancel-btn">Cancel</button>
          <button class="confirm-ok" id="confirm-ok-btn">${escHtml(confirmLabel)}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    document.getElementById("confirm-cancel-btn").onclick = () => overlay.remove();
    document.getElementById("confirm-ok-btn").onclick = () => { overlay.remove(); onConfirm(); };
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
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

  // Update request button state based on order lock
  const reqBtn = document.querySelector(".btn-outline[onclick*=\"openAddDrinkModal('request')\"]");
  if (reqBtn) {
    if (state.orderLocked) {
      reqBtn.disabled = true;
      reqBtn.title = "Requests locked while someone is at the bar";
      reqBtn.style.opacity = "0.45";
    } else {
      reqBtn.disabled = false;
      reqBtn.title = "";
      reqBtn.style.opacity = "";
    }
  }
}

function renderWhosNext(members) {
  if (!members.length) return;

  // Sort all members by rounds bought (then join time) to get the full queue
  const queue = [...members].sort((a, b) => {
    const diff = (a.roundsBought || 0) - (b.roundsBought || 0);
    return diff !== 0 ? diff : (a.joinedAtMs || 0) - (b.joinedAtMs || 0);
  });
  const next = queue[0];

  document.getElementById("whos-next-name").textContent = next.name;
  const rb = next.roundsBought || 0;
  document.getElementById("whos-next-sub").textContent =
    rb === 0 ? "Hasn't bought a round yet! 👀" : `${rb} round${rb !== 1 ? "s" : ""} bought`;

  // Render the queue pills (up to 6 people shown)
  const queueEl = document.getElementById("round-queue");
  if (!queueEl) return;
  const shown = queue.slice(0, 6);
  queueEl.innerHTML = shown.map((m, i) => {
    const isMe = memberKey(m) === getMyKey();
    const label = i === 0 ? "up now" : `#${i + 1}`;
    return `<div class="queue-pill ${i === 0 ? "queue-pill--next" : ""}">
      <span class="queue-pill-name">${escHtml(m.name)}${isMe ? " (you)" : ""}</span>
      <span class="queue-pill-pos">${label}</span>
    </div>`;
  }).join("") + (queue.length > 6 ? `<div class="queue-more">+${queue.length - 6} more</div>` : "");
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
    const ownerKey = drinkOwnerKey(d);
    const memberIdx = members.findIndex(m => memberKey(m) === ownerKey);
    const color = getColor(memberIdx >= 0 ? memberIdx : i);
    const member = members[memberIdx] || {};
    const rb = member.roundsBought || 0;
    const isMe = ownerKey === getMyKey();

    return `
      <div class="drink-row">
        <div class="d-avatar" style="background:${color.bg};color:${color.fg}">${safeInitials(d.member)}</div>
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
          ${safeInitials(r.name)}
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
  const nextBuyerKey = memberKey(getNextBuyer(members) || {});

  document.getElementById("leaderboard-rows").innerHTML = sorted.map((m, i) => {
    const rb = m.roundsBought || 0;
    const pct = Math.round((rb / max) * 100);
    const color = getColor(members.findIndex(x => memberKey(x) === memberKey(m)));
    const isMe = memberKey(m) === getMyKey();

    let badge = "";
    if (i === 0 && rb > 0) badge = `<span class="lb-badge" style="background:#E1F5EE;color:#0F6E56;">legend 🏆</span>`;
    else if (memberKey(m) === nextBuyerKey) badge = `<span class="lb-badge" style="background:#FFF8EC;color:#854F0B;">up next 👑</span>`;

    return `
      <div class="lb-row">
        <div class="lb-pos">${i + 1}</div>
        <div class="lb-av" style="background:${color.bg};color:${color.fg}">${safeInitials(m.name)}</div>
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
    if (state.memberList.some(n => n.toLowerCase() === name.toLowerCase())) { showToast("Already added!"); return; }
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
          <div class="chip-avatar" style="background:${color.bg};color:${color.fg}">${safeInitials(name)}</div>
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
      let code, roundId;
      for (let attempt = 0; attempt < 8; attempt++) {
        code = randomCode();
        roundId = `${slugify(pub)}-${code}`;
        const existingCode = await getDocs(query(collection(db, "rounds"), where("code", "==", code)));
        const existingDoc = await getDoc(doc(db, "rounds", roundId));
        if (existingCode.empty && !existingDoc.exists()) break;
        if (attempt === 7) throw new Error("Could not generate a unique round code");
      }

      const nowMs = Date.now();
      const hostId = makeId("member");
      const members = [
        { id: hostId, name: hostName, roundsBought: 0, colorIndex: 0, joinedAtMs: nowMs },
        ...state.memberList.map((name, i) => ({
          id: makeId("member"), name, roundsBought: 0, colorIndex: i + 1, joinedAtMs: nowMs + i + 1, placeholder: true
        }))
      ];

      const roundData = {
        code,
        pub,
        host: hostName,
        hostId,
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
      state.myMemberId = hostId;
      state.isHost = true;
      rememberMember(roundId, hostId, hostName);
      state.memberList = [];

      this._subscribeToRound(roundId);
      App.goTo("s-round");
      // Small delay so the round screen renders first, then prompt to share
      setTimeout(() => {
        showToast(`Round created! Code: ${code} — share it with your mates 🍺`, 4000);
      }, 400);

    } catch (err) {
      console.error(err);
      showToast("Couldn't create round. Try again!");
    } finally {
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
    const errEl = document.getElementById("join-error");
    const btn = document.getElementById("join-btn");

    const setError = (msg) => {
      if (errEl) { errEl.textContent = msg; errEl.style.display = msg ? "block" : "none"; }
    };

    setError("");

    if (code.length < 4) { setError("Enter the full 4-character code."); return; }
    if (!name) { setError("Enter your name so your mates know who you are."); return; }

    btn.innerHTML = `<span class="spinner"></span> Joining…`;
    btn.disabled = true;

    try {
      // Find round by code — search across rounds
      const q = query(collection(db, "rounds"), where("code", "==", code));
      const snap = await getDocs(q);

      if (snap.empty) {
        // Clear the code inputs so the user can try again easily
        ["c1","c2","c3","c4"].forEach(id => { document.getElementById(id).value = ""; });
        document.getElementById("c1").focus();
        setError("No round found with that code — double check it with whoever started the round.");
        btn.textContent = "Join Round →";
        btn.disabled = false;
        return;
      }

      const roundDoc = snap.docs[0];
      const roundId = roundDoc.id;
      const data = roundDoc.data();
      const members = data.members || [];

      const rememberedId = getRememberedMemberId(roundId);
      const rememberedMember = rememberedId ? members.find(m => memberKey(m) === rememberedId) : null;
      const placeholderIdx = members.findIndex(m => m.placeholder && m.name.toLowerCase() === name.toLowerCase());
      let myMemberId;
      let nextMembers = [...members];

      if (rememberedMember) {
        myMemberId = memberKey(rememberedMember);
        if (rememberedMember.name !== name) {
          nextMembers = nextMembers.map(m => memberKey(m) === myMemberId ? { ...m, name } : m);
          await updateDoc(doc(db, "rounds", roundId), { members: nextMembers, updatedAt: serverTimestamp() });
        }
        showToast(`Welcome back, ${name}! 🍺`);
      } else if (placeholderIdx >= 0) {
        myMemberId = nextMembers[placeholderIdx].id || makeId("member");
        nextMembers[placeholderIdx] = { ...nextMembers[placeholderIdx], id: myMemberId, name, placeholder: false, joinedAtMs: Date.now() };
        await updateDoc(doc(db, "rounds", roundId), { members: nextMembers, updatedAt: serverTimestamp() });
        showToast(`You're in! Welcome, ${name} 🍻`);
      } else {
        const colorIndex = members.length;
        myMemberId = makeId("member");
        const newMember = { id: myMemberId, name, roundsBought: 0, colorIndex, joinedAtMs: Date.now() };
        await updateDoc(doc(db, "rounds", roundId), {
          members: arrayUnion(newMember),
          updatedAt: serverTimestamp(),
        });
        showToast(`You're in! Welcome, ${name} 🍻`);
      }

      state.roundId = roundId;
      state.roundCode = code;
      state.myName = name;
      state.myMemberId = myMemberId;
      state.isHost = data.hostId ? data.hostId === myMemberId : data.host === name;
      rememberMember(roundId, myMemberId, name);
      this._subscribeToRound(roundId);
      btn.textContent = "Join Round →";
      btn.disabled = false;
      App.goTo("s-round");

    } catch (err) {
      console.error(err);
      setError("Something went wrong. Check your connection and try again.");
      btn.textContent = "Join Round →";
      btn.disabled = false;
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

    document.getElementById("add-drink-modal").classList.remove("open");

    try {
      if (state.drinkModalMode === "request") {
        const requests = [...(data.requests || [])];
        const existingIdx = requests.findIndex(r => (r.memberId && r.memberId === state.myMemberId) || (!r.memberId && r.name === state.myName));
        const request = { id: makeId("request"), memberId: state.myMemberId, name: state.myName, drink, createdAtMs: Date.now() };
        if (existingIdx >= 0) requests[existingIdx] = { ...requests[existingIdx], ...request };
        else requests.push(request);

        await updateDoc(doc(db, "rounds", state.roundId), {
          requests,
          updatedAt: serverTimestamp(),
        });
        showToast(`Request sent: ${drink}`);
        return;
      }

      const drinks = [...(data.drinks || [])];
      const myKey = getMyKey();
      const existingIdx = drinks.findIndex(d => drinkOwnerKey(d) === myKey);
      const entry = { memberId: state.myMemberId, member: state.myName, drink };
      if (existingIdx >= 0) drinks[existingIdx] = { ...drinks[existingIdx], ...entry };
      else drinks.push(entry);

      await updateDoc(doc(db, "rounds", state.roundId), {
        drinks,
        updatedAt: serverTimestamp(),
      });
      showToast(`${drink} added! 🍻`);
    } catch (err) {
      console.error(err);
      showToast("Couldn't save drink. Try again!");
    }
  },

  // ---- REQUESTS ----

  async acceptRequest(idx) {
    if (!state.isHost) { showToast("Only the host can accept requests."); return; }
    const data = state.roundData;
    if (!data) return;
    const requests = [...(data.requests || [])];
    const r = requests[idx];
    if (!r) return;

    requests.splice(idx, 1);
    const members = [...data.members];
    const memberIdx = members.findIndex(m => (r.memberId && memberKey(m) === r.memberId) || (!r.memberId && m.name === r.name));
    let memberId = r.memberId || makeId("member");
    if (memberIdx < 0) {
      const colorIndex = members.length;
      members.push({ id: memberId, name: r.name, roundsBought: 0, colorIndex, joinedAtMs: Date.now() });
    } else {
      memberId = memberKey(members[memberIdx]);
      members[memberIdx] = { ...members[memberIdx], id: memberId, name: r.name, placeholder: false };
    }
    const drinks = [...(data.drinks || [])];
    const existingDrinkIdx = drinks.findIndex(d => drinkOwnerKey(d) === memberId);
    const drinkEntry = { memberId, member: r.name, drink: r.drink };
    if (existingDrinkIdx >= 0) drinks[existingDrinkIdx] = { ...drinks[existingDrinkIdx], ...drinkEntry };
    else drinks.push(drinkEntry);

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
    if (!state.isHost) { showToast("Only the host can reject requests."); return; }
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
    state.orderLocked = true;
    // Notify others that requests are now locked (reflected in UI via state flag)
    renderRound(state.roundData); // re-render to lock the request button
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
    if (!state.isHost) { showToast("Only the host can complete the round."); return; }
    const data = state.roundData;
    if (!data) return;

    const nextBuyer = getNextBuyer(data.members || []);
    if (!nextBuyer) return;
    const nextBuyerKey = memberKey(nextBuyer);

    const members = data.members.map(m => {
      if (memberKey(m) === nextBuyerKey) {
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
      state.orderLocked = false;
      App.goTo("s-round");
      showToast(`Round ${(data.roundsDone || 0) + 1} done! Buyer credited: ${nextBuyer.name}`);
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
    UI.showConfirm(
      "Leave the round?",
      "You'll lose your spot in the order and need to re-join with the code.",
      "Leave round",
      () => {
        if (state.unsubscribe) state.unsubscribe();
        state.roundId = null;
        state.roundCode = null;
        state.myName = null;
        state.myMemberId = null;
        state.isHost = false;
        state.roundData = null;
        state.orderLocked = false;
        App.goTo("s-home");
        showToast("Left the round 👋");
      }
    );
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
      joinCode.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4).split("").forEach((ch, i) => {
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
