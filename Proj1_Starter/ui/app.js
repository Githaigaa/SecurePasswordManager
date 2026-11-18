"use strict";
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const state = {
  page: "dashboard",
  items: [],
  search: "",
  category: "All categories",
  favorites: false,
  sort: "updatedAt",
  generator: null,
  deleteId: null
};
const categories = ["Social Media", "Banking", "Email", "Work", "Shopping", "Entertainment", "Development", "Other"];
const api = async (path, options = {}) => {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await res.json();
  if (res.status === 423) {
    state.items = [];
    $("#view")?.replaceChildren();
    $("#app")?.classList.add("hidden");
    $("#auth")?.classList.remove("hidden");
    checkStatus().catch(() => {});
  }
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
};

function toast(message) {
  const el = $("#toast");
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 2600);
}

function strength(p = "") {
  let n = (p.length >= 12) + (p.length >= 16) + (/[a-z]/.test(p) && /[A-Z]/.test(p)) + /\d/.test(p) + /[^A-Za-z0-9]/
    .test(p);
  return n >= 4 ? "Strong" : n >= 2 ? "Moderate" : "Weak";
}
const initials = name => (name || "?").split(/[\s.-]+/).slice(0, 2).map(s => s[0]).join("").toUpperCase();
const date = value => value ? new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric"
}).format(new Date(value)) : "—";
async function refresh() {
  const d = await api("/api/summary");
  state.items = d.items;
  state.score = d.score;
  state.counts = d.counts;
  state.duplicates = d.duplicates;
  $("#nav-count").textContent = d.items.length;
  render();
}
async function checkStatus() {
  const d = await api("/api/status");
  $("#auth-title").innerHTML = d.exists ? 'Your passwords,<br><span>under your control.</span>' :
    'A safer home<br><span>for every login.</span>';
  $("#auth-copy").textContent = d.exists ? "Unlock your encrypted vault to continue." :
    "Create a master password to set up your private vault.";
  $("#confirm-wrap").classList.toggle("hidden", d.exists);
  $("#auth-submit").innerHTML = d.exists ? 'Unlock vault <span>→</span>' : 'Create vault <span>→</span>';
  $("#master").autocomplete = d.exists ? "current-password" : "new-password";
  $("#auth-form").dataset.setup = String(!d.exists);
}

function enter() {
  $("#auth").classList.add("hidden");
  $("#app").classList.remove("hidden");
  resetIdleTimer();
  refresh().catch(e => toast(e.message));
}
$("#auth-form").addEventListener("submit", async e => {
  e.preventDefault();
  const btn = $("#auth-submit");
  const setup = $("#auth-form").dataset.setup === "true";
  const password = $("#master").value;
  $("#auth-error").textContent = "";
  if (setup && password !== $("#confirm").value) {
    $("#auth-error").textContent = "Those passwords don't match.";
    return;
  }
  btn.disabled = true;
  btn.textContent = setup ? "Creating vault…" : "Unlocking…";
  try {
    await api(setup ? "/api/setup" : "/api/unlock", {
      method: "POST",
      body: JSON.stringify({
        password
      })
    });
    $("#master").value = "";
    $("#confirm").value = "";
    enter();
    toast(setup ? "Your encrypted vault is ready." : "Vault unlocked.");
  } catch (err) {
    $("#auth-error").textContent = err.message;
  } finally {
    btn.disabled = false;
    await checkStatus();
  }
});
$("#nav").addEventListener("click", e => {
  const button = e.target.closest("[data-page]");
  if (button) navigate(button.dataset.page);
});
$$('[data-page]').forEach(b => b.addEventListener("click", () => navigate(b.dataset.page)));

function navigate(page) {
  state.page = page;
  $$("nav [data-page]").forEach(b => b.classList.toggle("active", b.dataset.page === page));
  $("#page-name").textContent = ({
    dashboard: "Dashboard",
    vault: "Password vault",
    favorites: "Favorites",
    generator: "Password generator",
    security: "Security center",
    settings: "Settings"
  })[page];
  render();
}
async function lockVault(showMessage = true) {
  try {
    await api("/api/lock", {
      method: "POST"
    });
  } catch {}
  state.items = [];
  state.generated = null;
  $("#view").replaceChildren();
  $("#app").classList.add("hidden");
  $("#auth").classList.remove("hidden");
  await checkStatus();
  if (showMessage) toast("Vault locked.");
}
$("#lock").addEventListener("click", () => lockVault());
let idleTimer;

function resetIdleTimer() {
  clearTimeout(idleTimer);
  if (!$("#app").classList.contains("hidden")) idleTimer = setTimeout(() => lockVault(), 15 * 60 * 1000);
}
["pointerdown", "keydown", "input", "touchstart"].forEach(event => document.addEventListener(event, resetIdleTimer, {
  passive: true
}));
resetIdleTimer();

function pageHead(kicker, title, sub, action = "") {
  return `<div class="page-head"><div><p class="eyebrow">${kicker}</p><h1>${title}</h1><p class="muted">${sub}</p></div>${action}</div>`;
}

function itemCard(x) {
  const s = strength(x.password);
  return `<article class="credential-card"><div class="card-top"><div class="service-icon icon-${(x.category||"other").toLowerCase().replace(/\s/g, "")}">${initials(x.name)}</div><div class="card-title"><b>${esc(x.name)}</b><small>${esc(x.url)}</small></div><button class="icon-btn favorite ${x.favorite ? "on" : ""}" data-fav="${escAttr(x.id)}" title="Toggle favorite">${x.favorite ? "★" : "☆"}</button></div><div class="card-user"><span class="muted">USERNAME</span><span aria-label="Username hidden">••••••••</span></div><div class="card-password"><span class="muted">PASSWORD</span><div><code>••••••••••••</code><button class="icon-btn mini" data-copy="${escAttr(x.id)}" title="Copy password">▢</button></div></div><div class="card-bottom"><span class="pill category">${esc(x.category || "Other")}</span><span class="strength ${s.toLowerCase()}"><i></i>${s}</span><div class="spacer"></div><button class="icon-btn mini" data-edit="${escAttr(x.id)}" title="Edit">✎</button><button class="icon-btn mini" data-delete="${escAttr(x.id)}" title="Delete">⌫</button></div></article>`;
}

function render() {
  const view = $("#view"),
    items = state.items;
  const count = items.length;
  const strong = items.filter(x => strength(x.password) === "Strong").length;
  const weak = items.filter(x => strength(x.password) === "Weak").length;
  const favorites = items.filter(x => x.favorite).length;
  const duplicates = state.duplicates || 0;
  const score = state.score || 0;
  if (state.page === "dashboard") {
    const recent = [...items].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt)).slice(0, 4);
    view.innerHTML =
      `${pageHead(`${new Intl.DateTimeFormat(undefined,{weekday:"long",month:"long",day:"numeric"}).format(new Date()).toUpperCase()}`, "Good to see you, Jordan", "Your digital life, secured in one place.", '<button class="btn primary" data-action="add">＋ Add password</button>')}<div class="search-row"><label class="search"><span>⌕</span><input id="global-search" placeholder="Search your vault…" value="${esc(state.search)}"><kbd>⌘ K</kbd></label><button class="btn outline" data-action="generator">⚄ Generate password</button></div><section class="stat-grid"><div class="stat-card"><div class="stat-icon blue">▤</div><span>Total passwords</span><b>${count}</b><small>Across your vault</small></div><div class="stat-card"><div class="stat-icon green">✓</div><span>Strong passwords</span><b>${strong}</b><small>${count ? Math.round(strong/count*100) : 0}% of your vault</small></div><div class="stat-card"><div class="stat-icon amber">⚠</div><span>Weak passwords</span><b>${weak}</b><small>Could use an update</small></div><div class="stat-card"><div class="stat-icon violet">⧉</div><span>Reused passwords</span><b>${duplicates}</b><small>Unique passwords recommended</small></div></section><div class="dashboard-grid"><section class="panel security-score"><div class="panel-head"><div><p class="eyebrow">VAULT HEALTH</p><h2>Security overview</h2></div><button class="icon-btn" data-action="security">↗</button></div><div class="score-body"><div class="ring" style="--score:${score}"><div><b>${score}</b><small>out of 100</small></div></div><div class="score-copy"><span class="score-status">${score >= 80 ? "Looking good" : score >= 55 ? "Room to improve" : "Needs attention"}</span><p class="muted">A local assessment based on password strength, reuse, and credential completeness.</p><a href="#" data-action="security">Review security center →</a></div></div><div class="score-foot"><span><i class="legend strong-dot"></i> Strong <b>${strong}</b></span><span><i class="legend mid-dot"></i> Moderate <b>${items.filter(x=>strength(x.password)==="Moderate").length}</b></span><span><i class="legend weak-dot"></i> Weak <b>${weak}</b></span></div></section><section class="panel quick-panel"><div class="panel-head"><div><p class="eyebrow">GET STARTED</p><h2>Quick actions</h2></div></div><button class="action-row" data-action="add"><span class="action-icon">＋</span><span><b>Add a password</b><small>Save a new login to your vault</small></span><span class="arrow">→</span></button><button class="action-row" data-action="generator"><span class="action-icon">⚄</span><span><b>Generate a password</b><small>Create a strong, unique password</small></span><span class="arrow">→</span></button><button class="action-row" data-action="vault"><span class="action-icon">▤</span><span><b>Browse your vault</b><small>View and manage saved logins</small></span><span class="arrow">→</span></button></section></div><section class="panel recent-panel"><div class="panel-head"><div><p class="eyebrow">YOUR VAULT</p><h2>Recently updated</h2></div><button class="text-btn" data-action="vault">View all →</button></div>${recent.length ? `<div class="recent-list">${recent.map(x=>`<div class="recent-row"><div class="service-icon small-icon">${initials(x.name)}</div><div class="recent-name"><b>${esc(x.name)}</b><small>••••••••</small></div><span class="pill category">${esc(x.category||"Other")}</span><span class="strength ${strength(x.password).toLowerCase()}"><i></i>${strength(x.password)}</span><span class="muted date">${date(x.updatedAt)}</span><button class="icon-btn mini" data-edit="${escAttr(x.id)}">✎</button></div>`).join("")}</div>` : empty("No passwords saved yet", "Add your first credential to get started.", "Add password")}</section><p class="disclaimer">Security score is an application-level assessment based on your saved entries. It is not a guarantee of security.</p>`;
  } else if (state.page === "vault" || state.page === "favorites") {
    const fav = state.page === "favorites";
    let filtered = items.filter(x => !fav || x.favorite).filter(x => `${x.name} ${x.url} ${x.username}`.toLowerCase()
      .includes(state.search.toLowerCase())).filter(x => state.category === "All categories" || x.category === state
      .category).sort((a, b) => String(a[state.sort] || "").localeCompare(String(b[state.sort] || "")));
    view.innerHTML =
      `${pageHead(fav ? "SAVED FOR LATER" : "ALL YOUR LOGINS", fav ? "Favorites" : "Password vault", fav ? `${filtered.length} favorite ${filtered.length===1?"entry":"entries"} for quick access.` : `${count} encrypted ${count===1?"entry":"entries"} in your vault.`, '<button class="btn primary" data-action="add">＋ Add password</button>')}<div class="vault-toolbar"><label class="search"><span>⌕</span><input id="vault-search" placeholder="Search name, URL, username…" value="${esc(state.search)}"></label><select id="category-filter"><option>All categories</option>${categories.map(c=>`<option ${state.category===c?"selected":""}>${c}</option>`).join("")}</select><select id="sort-filter"><option value="updatedAt" ${state.sort==="updatedAt"?"selected":""}>Recently updated</option><option value="name" ${state.sort==="name"?"selected":""}>Name</option><option value="createdAt" ${state.sort==="createdAt"?"selected":""}>Date added</option></select></div>${filtered.length ? `<div class="credential-grid">${filtered.map(itemCard).join("")}</div>` : empty(fav ? "No favorites yet" : "No matching passwords", fav ? "Mark a vault entry with a star to find it here." : "Try a different search or add a new entry.", fav ? "Browse vault" : "Add password")}`;
  } else if (state.page === "generator") {
    view.innerHTML =
      `${pageHead("PASSWORD GENERATOR", "Create a strong password", "Generate a unique password using secure random numbers.")}<div class="generator-layout"><section class="panel generator-panel"><div class="panel-head"><div><p class="eyebrow">YOUR NEW PASSWORD</p><h2>Make it hard to guess</h2></div><span class="secure-badge">◈ Secure random</span></div><div class="generated-output"><code id="generated">${esc(state.generated||"Click generate to begin")}</code><button class="icon-btn" data-action="copy-generated">▢</button></div><div class="generator-strength"><div><span class="strength ${state.generated?strength(state.generated).toLowerCase():"moderate"}"><i></i>${state.generated?strength(state.generated):"Ready"}</span><span class="muted">Estimated entropy: ${state.generated ? Math.min(128, Math.round(state.generated.length * 5.5)) : "—"} bits</span></div><div class="strength-bars"><i class="filled"></i><i class="${state.generated?"filled":""}"></i><i class="${state.generated&&strength(state.generated)==="Strong"?"filled":""}"></i><i class="${state.generated&&strength(state.generated)==="Strong"?"filled":""}"></i></div></div><label class="range-label">Password length <b id="length-label">20 characters</b></label><input id="gen-length" type="range" min="8" max="64" value="20"><div class="range-limits"><span>8</span><span>64</span></div><div class="option-list"><label><span><b>Uppercase letters</b><small>A–Z</small></span><input type="checkbox" data-gen="upper" checked></label><label><span><b>Lowercase letters</b><small>a–z</small></span><input type="checkbox" data-gen="lower" checked></label><label><span><b>Numbers</b><small>0–9</small></span><input type="checkbox" data-gen="numbers" checked></label><label><span><b>Symbols</b><small>!@#$%^&*</small></span><input type="checkbox" data-gen="symbols" checked></label><label><span><b>Exclude ambiguous characters</b><small>i, l, 1, o, 0</small></span><input type="checkbox" data-gen="ambiguous" checked></label></div><div class="generator-actions"><button class="btn outline" data-action="generate">↻ Regenerate</button><button class="btn primary" data-action="save-generated">＋ Save to vault</button></div></section><aside class="panel tip-panel"><div class="tip-icon">✦</div><p class="eyebrow">A QUICK TIP</p><h3>One password.<br>One account.</h3><p class="muted">Unique passwords help protect your other accounts if one service is compromised.</p><div class="tip-line"></div><span class="secure-badge">✓ Generated on this device</span></aside></div>`;
  } else if (state.page === "security") {
    view.innerHTML =
      `${pageHead("SECURITY CENTER", "Your security overview", "Practical insights based only on the credentials in this vault.")}<div class="security-hero panel"><div class="ring large-ring" style="--score:${score}"><div><b>${score}</b><small>out of 100</small></div></div><div><p class="eyebrow">APPLICATION LEVEL ASSESSMENT</p><h2>${score >= 80 ? "A strong foundation" : "A few ways to improve"}</h2><p class="muted">Your score reflects password strength, reuse, and completeness. It does not check breaches or guarantee account safety.</p></div></div><div class="health-grid"><section class="panel"><div class="panel-head"><div><p class="eyebrow">PASSWORD HEALTH</p><h2>Strength breakdown</h2></div></div>${["Strong","Moderate","Weak"].map(t=>`<div class="health-row"><div><span class="strength ${t.toLowerCase()}"><i></i>${t}</span><b>${state.counts?.[t]||0}</b></div><div class="health-track"><i class="${t.toLowerCase()}" style="width:${count?100*(state.counts[t]||0)/count:0}%"></i></div></div>`).join("")}<p class="fineprint">Strength is estimated locally from length and character variety.</p></section><section class="panel"><div class="panel-head"><div><p class="eyebrow">RECOMMENDATIONS</p><h2>Next best steps</h2></div></div><div class="recommendations">${weak?`<div><span class="rec-icon warn">!</span><span><b>Update ${weak} weak ${weak===1?"password":"passwords"}</b><small>Use longer, unique passwords for important accounts.</small></span></div>`:""}${duplicates?`<div><span class="rec-icon warn">⧉</span><span><b>Replace reused passwords</b><small>${duplicates} repeated password${duplicates===1?"":"s"} detected in this vault.</small></span></div>`:""}${items.some(x=>!x.username)?`<div><span class="rec-icon">＋</span><span><b>Add missing usernames</b><small>Complete entries so they're easier to use.</small></span></div>`:""}${!weak&&!duplicates&&!items.some(x=>!x.username)?`<div><span class="rec-icon good">✓</span><span><b>Nice work</b><small>No password health issues detected in your saved entries.</small></span></div>`:""}</div></section></div>`;
  } else view.innerHTML =
    `${pageHead("PREFERENCES", "Settings", "Manage your local vault and encrypted backups.")}<div class="settings-grid"><section class="panel setting-block"><div><p class="eyebrow">VAULT SECURITY</p><h2>Session & access</h2><p class="muted">Your vault locks automatically after 15 minutes of inactivity. The timer is managed by the local app process.</p></div><button class="btn outline" data-action="lock">Lock vault now</button></section><section class="panel setting-block"><div><p class="eyebrow">BACKUP & RESTORE</p><h2>Encrypted vault backup</h2><p class="muted">Your backup contains encrypted vault data and an integrity checksum. Anyone with your master password can unlock it.</p></div><div class="setting-actions"><button class="btn outline" data-action="backup">↓ Export backup</button><label class="btn outline file-label">↑ Import backup<input type="file" id="restore-file" accept="application/json,.json" hidden></label></div></section><section class="panel setting-block"><div><p class="eyebrow">LOCAL STORAGE</p><h2>Encryption at rest</h2><p class="muted">Only the encrypted Keychain dump is written to this computer. Decrypted credentials and keys stay in the app process while unlocked.</p></div><span class="secure-badge">◈ AES-GCM</span></section></div>`;
  bindView();
}

function empty(title, sub, action) {
  return `<div class="empty-state"><div class="empty-icon">⌑</div><h3>${title}</h3><p class="muted">${sub}</p><button class="btn outline" data-action="${action==="Browse vault"?"vault":"add"}">${action}</button></div>`;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  } [c]));
}

function escAttr(s) {
  return esc(s).replace(/`/g, "&#96;");
}

function bindView() {
  $$("[data-action]").forEach(b => b.addEventListener("click", e => {
    e.preventDefault();
    action(b.dataset.action);
  }));
  $$("[data-edit]").forEach(b => b.onclick = () => openEditor(state.items.find(x => x.id === b.dataset.edit)));
  $$("[data-delete]").forEach(b => b.onclick = () => {
    state.deleteId = b.dataset.delete;
    $("#confirm").showModal();
  });
  $$("[data-fav]").forEach(b => b.onclick = () => {
    const x = state.items.find(i => i.id === b.dataset.fav);
    save({
      ...x,
      favorite: !x.favorite
    }, true);
  });
  $$("[data-copy]").forEach(b => b.onclick = () => copy(state.items.find(i => i.id === b.dataset.copy).password,
    "Password copied"));
  const search = $("#vault-search") || $("#global-search");
  if (search) search.oninput = () => {
    state.search = search.value;
    const start = search.selectionStart;
    render();
    const again = $("#vault-search") || $("#global-search");
    again.focus();
    again.setSelectionRange(start, start);
  };
  if ($("#category-filter")) $("#category-filter").onchange = e => {
    state.category = e.target.value;
    render();
  };
  if ($("#sort-filter")) $("#sort-filter").onchange = e => {
    state.sort = e.target.value;
    render();
  };
  if ($("#gen-length")) $("#gen-length").oninput = e => $("#length-label").textContent = `${e.target.value} characters`;
  if ($("#make-password")) $("#make-password").onclick = async () => {
    const d = await api("/api/generate?length=20");
    $("#entry-password").value = d.password;
    updateStrength();
  };
  if ($("#entry-password")) $("#entry-password").oninput = updateStrength;
  if ($("#restore-file")) $("#restore-file").onchange = restore;
}

function action(name) {
  if (name === "add") openEditor();
  else if (name === "generator") navigate("generator");
  else if (name === "vault" || name === "security") navigate(name);
  else if (name === "generate") generate();
  else if (name === "copy-generated") state.generated && copy(state.generated, "Password copied");
  else if (name === "save-generated") state.generated ? openEditor({
    password: state.generated
  }) : toast("Generate a password first.");
  else if (name === "backup") backup();
  else if (name === "lock") lockVault();
}

function openEditor(item = {}) {
  $("#credential-form").reset();
  $("#entry-id").value = item.id || "";
  $("#entry-name").value = item.name || "";
  $("#entry-url").value = item.url || "";
  $("#entry-username").value = item.username || "";
  $("#entry-password").value = item.password || "";
  $("#entry-category").value = item.category || "Other";
  $("#entry-notes").value = item.notes || "";
  $("#entry-favorite").checked = !!item.favorite;
  $("#modal-title").textContent = item.id ? "Edit password" : "Add a password";
  updateStrength();
  $("#editor").showModal();
}

function updateStrength() {
  const s = strength($("#entry-password").value);
  $("#strength").innerHTML = `<span class="strength ${s.toLowerCase()}"><i></i>${s} password</span>`;
}
$("#credential-form").addEventListener("submit", async e => {
  e.preventDefault();
  const item = {
    id: $("#entry-id").value || undefined,
    name: $("#entry-name").value,
    url: $("#entry-url").value,
    username: $("#entry-username").value,
    password: $("#entry-password").value,
    category: $("#entry-category").value,
    notes: $("#entry-notes").value,
    favorite: $("#entry-favorite").checked
  };
  if (item.url && !/^https?:\/\//i.test(item.url)) item.url = `https://${item.url}`;
  try {
    await api("/api/credentials", {
      method: "POST",
      body: JSON.stringify(item)
    });
    $("#editor").close();
    await refresh();
    toast(item.id ? "Password updated." : "Password saved to your vault.");
  } catch (err) {
    toast(err.message);
  }
});
$$("[data-close]").forEach(b => b.addEventListener("click", () => b.closest("dialog").close()));
$("#confirm-delete").onclick = async () => {
  try {
    await api(`/api/credentials/${encodeURIComponent(state.deleteId)}`, {
      method: "DELETE"
    });
    $("#confirm").close();
    await refresh();
    toast("Password deleted.");
  } catch (e) {
    toast(e.message);
  }
};
async function generate() {
  const len = $("#gen-length")?.value || 20;
  const params = new URLSearchParams({
    length: len
  });
  $$("[data-gen]").forEach(input => params.set(input.dataset.gen, String(input.checked)));
  try {
    const d = await api(`/api/generate?${params}`);
    state.generated = d.password;
    render();
  } catch (e) {
    toast(e.message);
  }
}
async function copy(value, label) {
  try {
    await navigator.clipboard.writeText(value);
    toast(`${label} · clears from clipboard when you replace it`);
  } catch {
    toast("Clipboard access is unavailable in this browser.");
  }
}
async function save(item, quiet = false) {
  try {
    await api("/api/credentials", {
      method: "POST",
      body: JSON.stringify(item)
    });
    await refresh();
    if (!quiet) toast("Password updated.");
  } catch (e) {
    toast(e.message);
  }
}
async function backup() {
  try {
    const data = await api("/api/backup");
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json"
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `keychain-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast("Encrypted backup exported.");
  } catch (e) {
    toast(e.message);
  }
}
async function restore(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const password = prompt("Enter the master password for this backup to verify it before restoring.");
    if (!password) return;
    await api("/api/restore", {
      method: "POST",
      body: JSON.stringify({
        ...data,
        password
      })
    });
    await refresh();
    toast("Vault backup restored.");
  } catch (err) {
    toast(err.message || "Could not read backup.");
  } finally {
    e.target.value = "";
  }
}
$$('[data-toggle]').forEach(b => b.onclick = () => {
  const input = $(`#${b.dataset.toggle}`);
  input.type = input.type === "password" ? "text" : "password";
});
document.addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    navigate("vault");
    setTimeout(() => $("#vault-search")?.focus(), 0);
  }
  if (e.key === "Escape") $$('dialog[open]').forEach(d => d.close());
});
checkStatus().catch(e => {
  $("#auth-error").textContent = e.message;
});
