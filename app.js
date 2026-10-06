"use strict";
(() => {
  /* ================= configuração ================= */
  const CFG = window.CADERNETA_CONFIG || {};
  const DEFAULT_PREFS = {
    categorias_despesa: ["Moradia", "Mercado", "Alimentação fora", "Transporte", "Saúde", "Educação", "Assinaturas", "Lazer", "Compras", "Outros"],
    categorias_receita: ["Salário", "Freelance", "Rendimentos", "Reembolso", "Outros"],
    contas: ["Conta corrente", "Cartão de crédito", "Pix", "Dinheiro"]
  };
  const COLS = "id,tipo,valor_centavos,descricao,categoria,conta,data,criado_em,atualizado_em";
  const AUTH_KEY = "caderneta-auth";

  /* ================= utilidades ================= */
  const $ = id => document.getElementById(id);
  const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const money = c => BRL.format((c || 0) / 100);
  const pad = n => String(n).padStart(2, "0");
  const clone = o => JSON.parse(JSON.stringify(o));
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const curMonth = () => todayISO().slice(0, 7);
  const monthOf = r => String(r.data || "").slice(0, 7);
  const shiftMonth = (ym, k) => { let [y, m] = ym.split("-").map(Number); m += k; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return `${y}-${pad(m)}`; };
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const monthName = (ym, opts = { month: "long", year: "numeric" }) => { const [y, m] = ym.split("-").map(Number); return cap(new Date(y, m - 1, 1).toLocaleDateString("pt-BR", opts).replace(".", "")); };
  const dayLabel = iso => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "short" }).replace(/\./g, ""); };
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const h = [...b].map(x => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  // "1.234,56" → 123456 · "49,9" → 4990 · "12.50" → 1250
  function parseBRL(raw) {
    let s = String(raw || "").trim().replace(/R\$|\s/g, "");
    if (!s) return NaN;
    if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
    if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
    return Math.round(parseFloat(s) * 100);
  }

  function isNetErr(e) {
    if (!e) return false;
    if (!navigator.onLine) return true;
    const m = String(e.message || e);
    return e.name === "AuthRetryableFetchError" || e.status === 0 || /failed to fetch|networkerror|network request failed|load failed|fetch failed|timed? ?out/i.test(m);
  }

  /* ================= armazenamento local ================= */
  const store = {
    get(k, fb) { try { const v = localStorage.getItem(k); return v == null ? fb : JSON.parse(v); } catch { return fb; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* cheio ou bloqueado */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* ignora */ } }
  };
  const K = {
    last: "cad:v1:last",
    installLater: "cad:v1:install-later",
    rows: u => `cad:v1:${u}:rows`,
    prefs: u => `cad:v1:${u}:prefs`,
    outbox: u => `cad:v1:${u}:outbox`,
    synced: u => `cad:v1:${u}:synced`
  };

  function normPrefs(p) {
    const ok = a => Array.isArray(a) && a.length && a.every(x => typeof x === "string");
    return {
      categorias_despesa: ok(p?.categorias_despesa) ? [...p.categorias_despesa] : [...DEFAULT_PREFS.categorias_despesa],
      categorias_receita: ok(p?.categorias_receita) ? [...p.categorias_receita] : [...DEFAULT_PREFS.categorias_receita],
      contas: ok(p?.contas) ? [...p.contas] : [...DEFAULT_PREFS.contas]
    };
  }

  /* ================= estado ================= */
  const state = {
    user: null, rows: [], prefs: normPrefs(null), outbox: [], syncedAt: null,
    month: curMonth(), filter: "todos", q: "", type: "despesa", editing: null,
    syncing: false, online: navigator.onLine, syncError: null, lastAttempt: 0,
    installEvt: null, loggingOut: false
  };

  function loadUser(u) {
    state.user = u;
    state.rows = store.get(K.rows(u.id), []);
    state.prefs = normPrefs(store.get(K.prefs(u.id), null));
    state.outbox = store.get(K.outbox(u.id), []);
    state.syncedAt = store.get(K.synced(u.id), null);
  }
  function persist() {
    if (!state.user) return;
    const u = state.user.id;
    store.set(K.rows(u), state.rows);
    store.set(K.prefs(u), state.prefs);
    store.set(K.outbox(u), state.outbox);
    store.set(K.synced(u), state.syncedAt);
  }
  const pendingIds = () => new Set(state.outbox.filter(o => o.kind === "upsert").map(o => o.row.id));

  /* ================= Supabase ================= */
  const configured = typeof CFG.supabaseUrl === "string" && /^https:\/\/\S+$/.test(CFG.supabaseUrl)
    && typeof CFG.supabaseKey === "string" && CFG.supabaseKey.length > 20
    && !/COLE_AQUI/.test(CFG.supabaseUrl + CFG.supabaseKey);
  let sb = null;
  if (configured && window.supabase && window.supabase.createClient) {
    sb = window.supabase.createClient(CFG.supabaseUrl.replace(/\/+$/, ""), CFG.supabaseKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: AUTH_KEY }
    });
  }

  async function sessionState() {
    if (!navigator.onLine && state.user) return { offline: true };
    try {
      const { data, error } = await sb.auth.getSession();
      if (data && data.session) return { session: data.session };
      if (error && isNetErr(error)) return { offline: true };
      return { none: true };
    } catch (e) {
      return isNetErr(e) ? { offline: true } : { none: true };
    }
  }

  const pick = r => ({
    id: r.id, tipo: r.tipo, valor_centavos: r.valor_centavos, descricao: r.descricao || "",
    categoria: r.categoria, conta: r.conta, data: r.data, criado_em: r.criado_em, atualizado_em: r.atualizado_em
  });

  async function pushOp(op) {
    try {
      if (op.kind === "upsert") {
        const { error } = await sb.from("lancamentos").upsert({ ...pick(op.row), user_id: state.user.id });
        return error || null;
      }
      if (op.kind === "delete") {
        const { error } = await sb.from("lancamentos").delete().eq("id", op.id);
        return error || null;
      }
      if (op.kind === "prefs") {
        const { error } = await sb.from("preferencias").upsert({ user_id: state.user.id, ...op.prefs, atualizado_em: new Date().toISOString() });
        return error || null;
      }
    } catch (e) { return e; }
    return null;
  }

  async function pullAll() {
    const PAGE = 1000, out = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb.from("lancamentos").select(COLS)
        .order("data", { ascending: false }).order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      out.push(...data);
      if (data.length < PAGE) break;
    }
    return out.map(r => ({ ...r, valor_centavos: Number(r.valor_centavos) }));
  }

  async function pullPrefs() {
    const { data, error } = await sb.from("preferencias").select("categorias_despesa,categorias_receita,contas").maybeSingle();
    if (error) throw error;
    return data;
  }

  function applyOutbox(rows) {
    const m = new Map(rows.map(r => [r.id, r]));
    for (const op of state.outbox) {
      if (op.kind === "upsert") m.set(op.row.id, op.row);
      else if (op.kind === "delete") m.delete(op.id);
    }
    return [...m.values()];
  }

  /* ================= sincronização ================= */
  let syncRun = null, syncAgain = false;
  function requestSync() {
    if (!sb || !state.user) return Promise.resolve();
    if (syncRun) { syncAgain = true; return syncRun; }
    syncRun = (async () => {
      try { await doSync(); }
      finally {
        syncRun = null;
        if (syncAgain) { syncAgain = false; requestSync(); }
      }
    })();
    return syncRun;
  }

  async function doSync() {
    state.lastAttempt = Date.now();
    if (!navigator.onLine) { state.online = false; setStatus(); return; }
    state.syncing = true; setStatus();
    try {
      const s = await sessionState();
      if (s.offline) { state.online = false; return; }
      if (s.none) {
        state.online = true;
        showLogin("Sua sessão expirou. Entre de novo para sincronizar.");
        return;
      }
      if (s.session.user.id !== state.user.id) return;
      state.online = true;

      // 1) envia o que foi feito no aparelho
      while (state.outbox.length) {
        const op = state.outbox[0];
        const err = await pushOp(op);
        if (err && isNetErr(err)) { state.online = false; return; }
        const i = state.outbox.indexOf(op);
        if (i >= 0) state.outbox.splice(i, 1);
        persist();
        if (err) toast(`Um item não foi aceito pelo servidor e foi descartado: ${err.message || "erro desconhecido"}`, 5000);
      }

      // 2) baixa a versão mais recente do servidor
      const [rows, prefs] = await Promise.all([pullAll(), pullPrefs()]);
      state.rows = applyOutbox(rows);
      if (prefs && !state.outbox.some(o => o.kind === "prefs")) state.prefs = normPrefs(prefs);
      state.syncedAt = Date.now();
      state.syncError = null;
      persist();
      render();
      if (!$("catScrim").hidden) renderCatEditor();
    } catch (e) {
      if (isNetErr(e)) state.online = false;
      else state.syncError = humanError(e);
    } finally {
      state.syncing = false;
      setStatus();
    }
  }

  function humanError(e) {
    const m = String(e?.message || e || "");
    if (/relation .* does not exist|Could not find the table/i.test(m)) return "As tabelas ainda não existem no Supabase. Rode o arquivo schema.sql no SQL Editor.";
    if (/JWT|token/i.test(m)) return "Sua sessão expirou. Saia e entre de novo.";
    if (/permission denied|row-level security/i.test(m)) return "O Supabase recusou o acesso. Confira se o schema.sql foi executado inteiro.";
    return m || "Erro desconhecido ao sincronizar.";
  }

  /* ================= alterações locais ================= */
  function upsertLocal(row) {
    const i = state.rows.findIndex(r => r.id === row.id);
    if (i >= 0) state.rows[i] = row; else state.rows.push(row);
    state.outbox.push({ kind: "upsert", row });
    persist(); render(); requestSync();
  }
  function deleteLocal(id) {
    state.rows = state.rows.filter(r => r.id !== id);
    state.outbox.push({ kind: "delete", id });
    persist(); render(); requestSync();
  }
  function savePrefsLocal() {
    state.outbox = state.outbox.filter(o => o.kind !== "prefs" || o === state.outbox[0]);
    state.outbox.push({ kind: "prefs", prefs: clone(state.prefs) });
    persist(); setStatus(); requestSync();
  }

  /* ================= telas ================= */
  function show(which) {
    $("screen-setup").hidden = which !== "setup";
    $("screen-login").hidden = which !== "login";
    $("screen-app").hidden = which !== "app";
    if (which !== "app") closeAll();
  }
  function showLogin(msg) {
    show("login");
    if (state.user && !$("lEmail").value) $("lEmail").value = state.user.email || "";
    $("lErr").textContent = msg || "";
  }

  let toastT;
  function toast(msg, ms = 2800) {
    const t = $("toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, ms);
  }

  function setStatus() {
    const el = $("sync"); if (!el) return;
    const n = state.outbox.length;
    let cls, text;
    if (state.syncing) { cls = "busy"; text = "Sincronizando…"; }
    else if (!state.online || !navigator.onLine) { cls = "off"; text = n ? `Offline · ${n} pendente${n > 1 ? "s" : ""}` : "Offline"; }
    else if (state.syncError) { cls = "err"; text = "Erro ao sincronizar"; }
    else if (n) { cls = "off"; text = `${n} pendente${n > 1 ? "s" : ""}`; }
    else if (!state.syncedAt) { cls = "busy"; text = "Conectando…"; }
    else { cls = "ok"; text = "Sincronizado"; }
    el.className = "sync " + cls;
    $("syncText").textContent = text;
    el.title = state.syncedAt ? `Última sincronização: ${new Date(state.syncedAt).toLocaleString("pt-BR")}. Toque para sincronizar.` : "Toque para sincronizar";
  }

  /* ================= render ================= */
  const monthRows = () => state.rows.filter(r => monthOf(r) === state.month);

  function render() {
    $("mLabel").textContent = monthName(state.month);
    $("todayM").hidden = state.month === curMonth();
    const tx = monthRows();
    let inc = 0, out = 0, nIn = 0, nOut = 0;
    for (const t of tx) { if (t.tipo === "receita") { inc += t.valor_centavos; nIn++; } else { out += t.valor_centavos; nOut++; } }
    const bal = inc - out;
    $("sumBal").textContent = money(bal);
    $("sumBal").className = "big num " + (bal < 0 ? "neg" : bal > 0 ? "pos" : "");
    $("sumIn").textContent = money(inc);
    $("sumOut").textContent = money(out);
    $("sumInN").textContent = plural(nIn, "lançamento", "lançamentos");
    $("sumOutN").textContent = plural(nOut, "lançamento", "lançamentos");
    $("sumHint").textContent = inc > 0
      ? (bal >= 0 ? `sobrou ${Math.round(bal / inc * 100)}% do que entrou` : `gastou ${money(-bal)} além do que entrou`)
      : "receitas menos despesas";
    renderCats(tx, out);
    renderTrend();
    renderAccts(tx);
    renderList(tx);
    setStatus();
  }

  function renderCats(tx, out) {
    const by = {};
    for (const t of tx) if (t.tipo === "despesa") by[t.categoria] = (by[t.categoria] || 0) + t.valor_centavos;
    const rows = Object.entries(by).sort((a, b) => b[1] - a[1]);
    $("catTotal").textContent = out ? money(out) : "";
    if (!rows.length) { $("cats").innerHTML = `<div class="empty small">Nenhuma despesa em ${esc(monthName(state.month, { month: "long" }).toLowerCase())}.</div>`; return; }
    const max = rows[0][1];
    $("cats").innerHTML = rows.map(([c, v]) => `
      <div class="cat-row"><span class="n">${esc(c)}</span><span class="v num">${money(v)}<span class="pct">${Math.round(v / out * 100)}%</span></span>
      <div class="bar"><i style="width:${Math.max(2, v / max * 100).toFixed(1)}%"></i></div></div>`).join("");
  }

  function renderTrend() {
    const months = [5, 4, 3, 2, 1, 0].map(k => shiftMonth(state.month, -k));
    const data = months.map(m => {
      let i = 0, o = 0;
      for (const t of state.rows) if (monthOf(t) === m) { if (t.tipo === "receita") i += t.valor_centavos; else o += t.valor_centavos; }
      return { m, i, o };
    });
    const max = Math.max(1, ...data.map(d => Math.max(d.i, d.o)));
    const W = 360, H = 150, top = 18, bottom = 24, left = 4, right = 4, ch = H - top - bottom, gw = (W - left - right) / 6, bw = Math.min(16, gw * 0.28);
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Receitas e despesas dos últimos seis meses">`;
    s += `<line class="t-grid" x1="${left}" x2="${W - right}" y1="${top + ch}" y2="${top + ch}"/>`;
    s += `<line class="t-grid" x1="${left}" x2="${W - right}" y1="${top}" y2="${top}" stroke-dasharray="3 4"/>`;
    s += `<text class="t-axis" x="${W - right}" y="${top - 6}" text-anchor="end">${esc(max > 1 ? money(max) : "")}</text>`;
    data.forEach((d, k) => {
      const cx = left + gw * k + gw / 2;
      if (d.m === state.month) s += `<rect class="t-sel" x="${cx - gw / 2 + 3}" y="${top - 2}" width="${gw - 6}" height="${ch + 4}" rx="6"/>`;
      const hi = d.i / max * ch, ho = d.o / max * ch;
      s += `<rect class="t-in" x="${cx - bw - 1.5}" y="${top + ch - hi}" width="${bw}" height="${hi}" rx="3"><title>${esc(monthName(d.m))} · receitas ${esc(money(d.i))}</title></rect>`;
      s += `<rect class="t-out" x="${cx + 1.5}" y="${top + ch - ho}" width="${bw}" height="${ho}" rx="3"><title>${esc(monthName(d.m))} · despesas ${esc(money(d.o))}</title></rect>`;
      s += `<text class="t-axis" x="${cx}" y="${H - 7}" text-anchor="middle">${esc(monthName(d.m, { month: "short" }))}</text>`;
    });
    $("trend").innerHTML = s + "</svg>";
  }

  function renderAccts(tx) {
    const by = {};
    for (const t of tx) { const k = t.conta || "Sem conta"; by[k] = (by[k] || 0) + (t.tipo === "receita" ? t.valor_centavos : -t.valor_centavos); }
    const rows = Object.entries(by).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    $("accts").innerHTML = rows.length
      ? rows.map(([a, v]) => `<div class="acct"><span>${esc(a)}</span><span class="num ${v < 0 ? "neg" : "pos"}">${v > 0 ? "+" : ""}${money(v)}</span></div>`).join("")
      : `<div class="empty small">Sem movimento neste mês.</div>`;
  }

  function renderList(tx) {
    const q = state.q.trim().toLowerCase();
    const rows = tx
      .filter(t => state.filter === "todos" || t.tipo === state.filter)
      .filter(t => !q || (t.descricao || "").toLowerCase().includes(q) || (t.categoria || "").toLowerCase().includes(q))
      .sort((a, b) => b.data.localeCompare(a.data) || (Date.parse(b.criado_em) || 0) - (Date.parse(a.criado_em) || 0));
    if (!tx.length) {
      const fresh = !state.syncedAt && state.online && !state.syncError && state.user;
      $("list").innerHTML = fresh
        ? `<div class="empty">Buscando seus lançamentos…</div>`
        : `<div class="empty"><strong>Nada lançado em ${esc(monthName(state.month, { month: "long" }).toLowerCase())}</strong>Registre salário, contas e gastos do dia a dia. Funciona até sem internet e sincroniza sozinho depois.<br><button class="btn primary" type="button" data-new>Adicionar lançamento</button></div>`;
      return;
    }
    if (!rows.length) { $("list").innerHTML = `<div class="empty">Nenhum lançamento encontrado com esse filtro.</div>`; return; }
    const pend = pendingIds();
    const groups = new Map();
    for (const t of rows) { if (!groups.has(t.data)) groups.set(t.data, []); groups.get(t.data).push(t); }
    let h = "";
    for (const [date, items] of groups) {
      const net = items.reduce((s, t) => s + (t.tipo === "receita" ? t.valor_centavos : -t.valor_centavos), 0);
      h += `<div class="day"><div class="day-h"><span class="label">${esc(dayLabel(date))}</span><span class="num">${net > 0 ? "+" : ""}${money(net)}</span></div>`;
      for (const t of items) {
        const cls = t.tipo === "receita" ? "in" : "out";
        h += `<button type="button" class="tx ${cls}" data-id="${esc(t.id)}">
          <span class="dot" aria-hidden="true">${esc((t.categoria || "?").charAt(0).toUpperCase())}</span>
          <span class="txt"><span class="d">${esc(t.descricao || t.categoria)}</span><span class="m">${esc(t.categoria)} · ${esc(t.conta || "")}</span></span>
          <span class="a num">${t.tipo === "receita" ? "+" : "−"}${money(t.valor_centavos)}${pend.has(t.id) ? `<span class="pend">a sincronizar</span>` : ""}</span></button>`;
      }
      h += `</div>`;
    }
    $("list").innerHTML = h;
  }

  /* ================= formulário de lançamento ================= */
  function fillSelect(sel, items, value) {
    const list = items.slice();
    if (value && !list.includes(value)) list.push(value);
    sel.innerHTML = list.map(v => `<option${v === value ? " selected" : ""}>${esc(v)}</option>`).join("");
  }
  function catsFor(tipo) { return tipo === "receita" ? state.prefs.categorias_receita : state.prefs.categorias_despesa; }
  function setType(t) {
    state.type = t;
    document.querySelectorAll(".typeswitch button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.t === t)));
    const cur = $("fCat").value, cats = catsFor(t);
    const keep = state.editing && state.editing.tipo === t ? state.editing.categoria : (cats.includes(cur) ? cur : cats[0]);
    fillSelect($("fCat"), cats, keep);
  }
  function openTx(row) {
    closeAll();
    state.editing = row || null;
    $("txTitle").textContent = row ? "Editar lançamento" : "Novo lançamento";
    $("fAmount").value = row ? (row.valor_centavos / 100).toFixed(2).replace(".", ",") : "";
    $("fDesc").value = row ? (row.descricao || "") : "";
    $("fDate").value = row ? row.data : (state.month === curMonth() ? todayISO() : `${state.month}-01`);
    fillSelect($("fAcct"), state.prefs.contas, row ? row.conta : state.prefs.contas[0]);
    $("fCat").innerHTML = "";
    setType(row ? row.tipo : "despesa");
    $("fErr").textContent = "";
    $("delZone").innerHTML = row ? `<button type="button" class="btn danger" id="delAsk">Excluir</button>` : "";
    $("txScrim").hidden = false;
    if (!row) setTimeout(() => $("fAmount").focus(), 60);
  }
  function closeAll() {
    ["txScrim", "menuScrim", "catScrim"].forEach(id => { $(id).hidden = true; });
    state.editing = null;
    $("logoutZone").innerHTML = "";
  }

  function saveTx(ev) {
    ev.preventDefault();
    const cents = parseBRL($("fAmount").value);
    const date = $("fDate").value;
    if (!(cents > 0)) { $("fErr").textContent = "Digite um valor maior que zero, por exemplo 49,90."; $("fAmount").focus(); return; }
    if (cents > 99999999999) { $("fErr").textContent = "Esse valor está alto demais. Confira os dígitos."; return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { $("fErr").textContent = "Escolha a data do lançamento."; return; }
    const now = new Date().toISOString();
    const wasEdit = !!state.editing;
    const row = {
      id: state.editing ? state.editing.id : uuid(),
      tipo: state.type, valor_centavos: cents,
      descricao: $("fDesc").value.trim().slice(0, 80),
      categoria: $("fCat").value, conta: $("fAcct").value, data: date,
      criado_em: state.editing ? state.editing.criado_em : now, atualizado_em: now
    };
    closeAll();
    if (monthOf(row) !== state.month) state.month = monthOf(row);
    upsertLocal(row);
    const off = !navigator.onLine || !state.online;
    toast(off ? "Salvo no aparelho. Sincroniza quando a internet voltar." : (wasEdit ? "Lançamento atualizado" : "Lançamento salvo"));
  }

  /* ================= categorias e contas ================= */
  const XICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>`;
  function listFor(key) { return state.prefs[key]; }
  function renderCatEditor() {
    const block = (title, key) => `
      <div class="label">${title}</div>
      <div class="chips">${listFor(key).map((c, i) => `<span class="chip">${esc(c)}<button type="button" data-rm="${key}" data-i="${i}" aria-label="Remover ${esc(c)}">${XICON}</button></span>`).join("")}</div>
      <form class="addrow" data-add="${key}"><input id="add-${key}" maxlength="40" placeholder="Adicionar" aria-label="Adicionar em ${title}" autocomplete="off"><button class="btn" type="submit">Adicionar</button></form>`;
    $("catEditor").innerHTML =
      block("Categorias de despesa", "categorias_despesa") +
      block("Categorias de receita", "categorias_receita") +
      block("Contas e meios de pagamento", "contas") +
      `<p class="hint" style="margin:0">Remover uma categoria não apaga os lançamentos antigos que usam ela.</p>`;
  }

  /* ================= exportar CSV ================= */
  function exportCsv() {
    const tx = monthRows().sort((a, b) => a.data.localeCompare(b.data));
    if (!tx.length) { toast("Não há lançamentos neste mês para exportar."); return; }
    const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [["Data", "Tipo", "Descrição", "Categoria", "Conta", "Valor"].join(";")];
    for (const t of tx) {
      const [y, m, d] = t.data.split("-");
      const v = (t.tipo === "receita" ? 1 : -1) * t.valor_centavos / 100;
      lines.push([`${d}/${m}/${y}`, t.tipo === "receita" ? "Receita" : "Despesa", q(t.descricao), q(t.categoria), q(t.conta), v.toFixed(2).replace(".", ",")].join(";"));
    }
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `caderneta-${state.month}.csv`;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    toast("CSV gerado. Abre direto no Excel.");
  }

  /* ================= sair ================= */
  async function logout(force) {
    const n = state.outbox.length;
    if (n && !force) {
      $("logoutZone").innerHTML = `<span>Você tem ${plural(n, "alteração", "alterações")} que ainda não ${n === 1 ? "foi enviada" : "foram enviadas"} ao servidor. Se sair agora, ${n === 1 ? "ela se perde" : "elas se perdem"}.</span>
        <div class="row"><button type="button" class="btn danger" id="logoutYes">Sair mesmo assim</button><button type="button" class="btn" id="logoutNo">Cancelar</button></div>`;
      return;
    }
    state.loggingOut = true;
    try { await sb.auth.signOut({ scope: "local" }); } catch { /* segue */ }
    store.del(AUTH_KEY);
    if (state.user) { const u = state.user.id; [K.rows(u), K.prefs(u), K.outbox(u), K.synced(u)].forEach(k => store.del(k)); }
    store.del(K.last);
    location.reload();
  }

  /* ================= login ================= */
  async function onLogin(ev) {
    ev.preventDefault();
    const email = $("lEmail").value.trim(), pass = $("lPass").value;
    if (!email || !pass) { $("lErr").textContent = "Preencha e-mail e senha."; return; }
    const btn = $("lBtn"); btn.disabled = true; btn.textContent = "Entrando…"; $("lErr").textContent = "";
    try {
      const { data, error } = await sb.auth.signInWithPassword({ email, password: pass });
      if (error) throw error;
      $("lPass").value = "";
      startSession(data.session);
    } catch (e) {
      const m = String(e?.message || "");
      $("lErr").textContent =
        isNetErr(e) ? "Sem internet agora. Conecte-se para entrar." :
        /invalid login credentials/i.test(m) ? "E-mail ou senha incorretos." :
        /email not confirmed/i.test(m) ? "Esse e-mail ainda não foi confirmado no Supabase." :
        (m || "Não foi possível entrar.");
    } finally { btn.disabled = false; btn.textContent = "Entrar"; }
  }

  function startSession(session) {
    const u = { id: session.user.id, email: session.user.email || "" };
    const last = store.get(K.last, null);
    if (!last || last.id !== u.id || !state.user || state.user.id !== u.id) loadUser(u);
    state.user = u;
    store.set(K.last, u);
    state.online = true;
    show("app"); render(); openFromHash();
    requestSync();
  }

  function openFromHash() {
    if (location.hash === "#novo") { history.replaceState(null, "", location.pathname + location.search); openTx(); }
  }

  /* ================= instalação e atualização ================= */
  let swReg = null;
  function registerSW() {
    if (!("serviceWorker" in navigator)) return;
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register("./sw.js").then(r => { swReg = r; }).catch(() => { /* sem modo offline */ });
    navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController) $("updateBar").hidden = false; });
  }
  function updateInstallUI() {
    const can = !!state.installEvt;
    $("miInstall").hidden = !can;
    const later = store.get(K.installLater, 0);
    $("installBanner").hidden = !can || (Date.now() - later < 7 * 864e5);
  }
  async function doInstall() {
    if (!state.installEvt) return;
    const evt = state.installEvt;
    state.installEvt = null; updateInstallUI(); closeAll();
    evt.prompt();
    try { await evt.userChoice; } catch { /* ignora */ }
  }

  /* ================= eventos ================= */
  $("loginForm").addEventListener("submit", onLogin);
  $("prevM").onclick = () => { state.month = shiftMonth(state.month, -1); render(); };
  $("nextM").onclick = () => { state.month = shiftMonth(state.month, 1); render(); };
  $("todayM").onclick = () => { state.month = curMonth(); render(); };
  $("btnAdd").onclick = () => openTx();
  $("fab").onclick = () => openTx();
  $("btnMenu").onclick = () => {
    closeAll();
    $("menuFoot").textContent = `Conectado como ${state.user?.email || "—"}` + (state.syncedAt ? ` · última sincronização ${new Date(state.syncedAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}` : "");
    $("menuScrim").hidden = false;
  };
  $("sync").onclick = () => {
    if (state.syncError) toast(state.syncError, 6000);
    else if (!navigator.onLine) toast("Sem internet. As alterações ficam salvas no aparelho.");
    requestSync();
  };
  $("miSync").onclick = () => { closeAll(); requestSync().then(() => { if (!state.syncError && state.online) toast("Tudo sincronizado"); }); };
  $("miCats").onclick = () => { closeAll(); renderCatEditor(); $("catScrim").hidden = false; };
  $("miCsv").onclick = () => { closeAll(); exportCsv(); };
  $("miInstall").onclick = doInstall;
  $("installBtn").onclick = doInstall;
  $("installLater").onclick = () => { store.set(K.installLater, Date.now()); updateInstallUI(); };
  $("miLogout").onclick = () => logout(false);
  $("logoutZone").addEventListener("click", e => {
    if (e.target.id === "logoutYes") logout(true);
    else if (e.target.id === "logoutNo") $("logoutZone").innerHTML = "";
  });
  $("updateBtn").onclick = () => location.reload();

  $("q").addEventListener("input", e => { state.q = e.target.value; renderList(monthRows()); });
  document.querySelectorAll(".seg button").forEach(b => b.onclick = () => {
    state.filter = b.dataset.f;
    document.querySelectorAll(".seg button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    renderList(monthRows());
  });
  $("list").addEventListener("click", e => {
    if (e.target.closest("[data-new]")) return openTx();
    const b = e.target.closest(".tx"); if (!b) return;
    const t = state.rows.find(x => x.id === b.dataset.id); if (t) openTx(t);
  });
  document.querySelectorAll(".typeswitch button").forEach(b => b.onclick = () => setType(b.dataset.t));
  $("txForm").addEventListener("submit", saveTx);
  $("delZone").addEventListener("click", e => {
    if (e.target.id === "delAsk") $("delZone").innerHTML = `<span class="confirm">Excluir de vez? <button type="button" class="btn danger" id="delYes">Sim, excluir</button><button type="button" class="btn" id="delNo">Não</button></span>`;
    else if (e.target.id === "delYes") { const id = state.editing?.id; closeAll(); if (id) { deleteLocal(id); toast("Lançamento excluído"); } }
    else if (e.target.id === "delNo") $("delZone").innerHTML = `<button type="button" class="btn danger" id="delAsk">Excluir</button>`;
  });
  document.querySelectorAll(".scrim").forEach(s => s.addEventListener("click", e => {
    if (e.target === s || e.target.closest("[data-close]")) closeAll();
  }));
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeAll(); });

  $("catEditor").addEventListener("click", e => {
    const b = e.target.closest("[data-rm]"); if (!b) return;
    const list = listFor(b.dataset.rm);
    if (list.length <= 1) { toast("Mantenha pelo menos um item."); return; }
    list.splice(Number(b.dataset.i), 1);
    renderCatEditor(); savePrefsLocal();
  });
  $("catEditor").addEventListener("submit", e => {
    e.preventDefault();
    const f = e.target.closest("[data-add]"); if (!f) return;
    const inp = f.querySelector("input"); const v = inp.value.trim();
    if (!v) return;
    const key = f.dataset.add, list = listFor(key);
    if (list.some(x => x.toLowerCase() === v.toLowerCase())) { toast("Esse item já existe."); return; }
    list.push(v);
    renderCatEditor(); savePrefsLocal();
    setTimeout(() => { const n = $(`add-${key}`); if (n) n.focus(); }, 0);
  });

  window.addEventListener("online", () => { state.online = true; setStatus(); requestSync(); });
  window.addEventListener("offline", () => { state.online = false; setStatus(); });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (state.user && Date.now() - state.lastAttempt > 20000) requestSync();
    if (swReg) swReg.update().catch(() => {});
  });
  window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); state.installEvt = e; updateInstallUI(); });
  window.addEventListener("appinstalled", () => { state.installEvt = null; updateInstallUI(); toast("App instalado! Procure o ícone Caderneta."); });
  window.addEventListener("hashchange", () => { if (state.user && !$("screen-app").hidden) openFromHash(); });

  /* ================= início ================= */
  async function boot() {
    registerSW();
    if (!configured) {
      show("setup");
      $("setupDetail").textContent = "O app está publicado, mas o config.js ainda tem os textos COLE_AQUI.";
      return;
    }
    if (!sb) {
      show("setup");
      $("setupDetail").textContent = "A biblioteca do Supabase não carregou. Confira se a pasta vendor foi publicada junto.";
      return;
    }
    const last = store.get(K.last, null);
    if (last) { loadUser(last); show("app"); render(); openFromHash(); }

    const s = await sessionState();
    if (s.session) startSession(s.session);
    else if (s.offline) {
      if (last) { state.online = false; setStatus(); }
      else showLogin("Conecte-se à internet para entrar pela primeira vez.");
    } else showLogin("");

    sb.auth.onAuthStateChange(event => {
      if (event === "SIGNED_OUT" && !state.loggingOut) showLogin("Sua sessão foi encerrada. Entre de novo.");
    });
  }

  boot();
})();
