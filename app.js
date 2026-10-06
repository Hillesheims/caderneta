"use strict";
(() => {
  /* ================= configuração ================= */
  const CFG = window.CADERNETA_CONFIG || {};
  const DEFAULT_PREFS = {
    categorias_despesa: ["Moradia", "Mercado", "Alimentação fora", "Transporte", "Saúde", "Educação", "Assinaturas", "Lazer", "Compras", "Outros"],
    categorias_receita: ["Salário", "Freelance", "Rendimentos", "Reembolso", "Outros"],
    contas: ["Conta corrente", "Cartão de crédito", "Pix", "Dinheiro"],
    meta_mensal_centavos: null,
    metas_categoria: {}
  };
  const AUTH_KEY = "caderneta-auth";
  const TABS = ["painel", "mes", "investimentos", "metas", "fixos"];

  // Tabelas do Supabase e as colunas que o app lê e grava
  const TABLES = ["lancamentos", "gastos_fixos", "acoes_ops", "caixinhas", "caixinha_movs"];
  const COLS = {
    lancamentos: "id,tipo,valor_centavos,descricao,categoria,conta,data,fixo_id,criado_em,atualizado_em",
    gastos_fixos: "id,descricao,valor_centavos,categoria,conta,dia,ativo,ultimo_mes_lancado,criado_em,atualizado_em",
    acoes_ops: "id,ticker,tipo,quantidade,preco,taxas_centavos,data,criado_em,atualizado_em",
    caixinhas: "id,nome,percentual_cdi,criado_em,atualizado_em",
    caixinha_movs: "id,caixinha_id,tipo,valor_centavos,data,criado_em,atualizado_em"
  };
  const NUMERIC = {
    lancamentos: ["valor_centavos"], gastos_fixos: ["valor_centavos", "dia"],
    acoes_ops: ["quantidade", "preco", "taxas_centavos"], caixinhas: ["percentual_cdi"], caixinha_movs: ["valor_centavos"]
  };

  /* ================= utilidades ================= */
  const $ = id => document.getElementById(id);
  const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
  const QTD = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 6 });
  const PCT = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const money = c => BRL.format(Math.round(c || 0) / 100);
  const moneySigned = c => (c > 0.5 ? "+" : c < -0.5 ? "−" : "") + money(Math.abs(c || 0));
  const reais = v => BRL.format(v || 0);
  const pct = v => `${PCT.format(v)}%`;
  const pctSigned = v => (v > 0.05 ? "+" : v < -0.05 ? "−" : "") + pct(Math.abs(v));
  const fmtQtd = q => QTD.format(q || 0);
  const signCls = v => (v > 0.5 ? "pos" : v < -0.5 ? "neg" : "");
  const pad = n => String(n).padStart(2, "0");
  const clone = o => JSON.parse(JSON.stringify(o));
  const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const curMonth = () => todayISO().slice(0, 7);
  const monthOf = r => String(r.data || "").slice(0, 7);
  const shiftMonth = (ym, k) => { let [y, m] = ym.split("-").map(Number); m += k; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return `${y}-${pad(m)}`; };
  const daysInMonth = ym => { const [y, m] = ym.split("-").map(Number); return new Date(y, m, 0).getDate(); };
  const dataNoMes = (ym, dia) => `${ym}-${pad(Math.min(Number(dia) || 1, daysInMonth(ym)))}`;
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  const monthName = (ym, opts = { month: "long", year: "numeric" }) => { const [y, m] = ym.split("-").map(Number); return cap(new Date(y, m - 1, 1).toLocaleDateString("pt-BR", opts).replace(".", "")); };
  const monthLower = ym => monthName(ym, { month: "long" }).toLowerCase();
  const dayLabel = iso => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("pt-BR", { weekday: "short", day: "numeric", month: "short" }).replace(/\./g, ""); };
  const dateBR = iso => { const [y, m, d] = String(iso).split("-"); return `${d}/${m}/${y}`; };
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
  const byDateDesc = (a, b) => b.data.localeCompare(a.data) || (Date.parse(b.criado_em) || 0) - (Date.parse(a.criado_em) || 0);
  const byDateAsc = (a, b) => -byDateDesc(a, b);
  const numIn = v => (v == null || v === "" ? "" : Number(v).toLocaleString("pt-BR", { useGrouping: false, maximumFractionDigits: 8 }));
  const centsIn = c => (c ? (c / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "");

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
    const h = [...b].map(x => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  // Id fixo para "gasto fixo X no mês Y": o celular e o PC geram o mesmo id e nada duplica.
  function idFixo(fixoId, mes) {
    const s = `${fixoId}|${mes}`;
    let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
    for (let i = 0; i < s.length; i++) {
      const k = s.charCodeAt(i);
      h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
      h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
      h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
      h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
    }
    h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
    h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
    h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
    h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
    h1 ^= h2 ^ h3 ^ h4; h2 ^= h1; h3 ^= h1; h4 ^= h1;
    const x = [h1, h2, h3, h4].map(h => (h >>> 0).toString(16).padStart(8, "0")).join("");
    const variant = ((parseInt(x[16], 16) & 3) | 8).toString(16);
    return `${x.slice(0, 8)}-${x.slice(8, 12)}-5${x.slice(13, 16)}-${variant}${x.slice(17, 20)}-${x.slice(20, 32)}`;
  }

  // "1.234,56" → 1234.56 · "0,5" → 0.5 · "12.50" → 12.5
  function parseNum(raw) {
    let s = String(raw || "").trim().replace(/R\$|\s/g, "");
    if (!s) return NaN;
    if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
    if (!/^\d+(\.\d+)?$/.test(s)) return NaN;
    return parseFloat(s);
  }
  const parseBRL = raw => { const v = parseNum(raw); return Number.isFinite(v) ? Math.round(v * 100) : NaN; };

  function isNetErr(e) {
    if (!e) return false;
    if (!navigator.onLine) return true;
    const m = String(e.message || e);
    return e.name === "AuthRetryableFetchError" || e.name === "FunctionsFetchError" || e.status === 0
      || /failed to fetch|networkerror|network request failed|load failed|fetch failed|timed? ?out|failed to send a request/i.test(m);
  }
  // Erro de estrutura do banco (tabela/coluna ainda não existe): guarda a alteração em vez de descartar
  const isSchemaErr = e => /^(PGRST204|PGRST205|42P01|42703)$/.test(String(e?.code || ""));

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
    data: u => `cad:v1:${u}:data`,
    prefs: u => `cad:v1:${u}:prefs`,
    outbox: u => `cad:v1:${u}:outbox`,
    synced: u => `cad:v1:${u}:synced`,
    mercado: u => `cad:v1:${u}:mercado`
  };

  function normPrefs(p) {
    const ok = a => Array.isArray(a) && a.length && a.every(x => typeof x === "string");
    const metas = {};
    if (p && p.metas_categoria && typeof p.metas_categoria === "object") {
      for (const [k, v] of Object.entries(p.metas_categoria)) { const n = Number(v); if (n > 0) metas[k] = Math.round(n); }
    }
    const meta = Number(p?.meta_mensal_centavos);
    return {
      categorias_despesa: ok(p?.categorias_despesa) ? [...p.categorias_despesa] : [...DEFAULT_PREFS.categorias_despesa],
      categorias_receita: ok(p?.categorias_receita) ? [...p.categorias_receita] : [...DEFAULT_PREFS.categorias_receita],
      contas: ok(p?.contas) ? [...p.contas] : [...DEFAULT_PREFS.contas],
      meta_mensal_centavos: meta > 0 ? Math.round(meta) : null,
      metas_categoria: metas
    };
  }
  const emptyData = () => Object.fromEntries(TABLES.map(t => [t, []]));
  const emptyMercado = () => ({ cotacoes: {}, erros: {}, cotacoesEm: null, cdi: [], cdiDesde: null, cdiEm: null, historico: {}, histErros: {}, histEm: null, histDesde: null, carregando: false, erro: null });

  /* ================= estado ================= */
  const state = {
    user: null, data: emptyData(), prefs: normPrefs(null), outbox: [], syncedAt: null, mercado: emptyMercado(),
    tab: "painel", invSub: "acoes", month: curMonth(), filter: "todos", q: "",
    periodo: [3, 6, 12].includes(Number(store.get("cad:v1:periodo", 6))) ? Number(store.get("cad:v1:periodo", 6)) : 6, tabela: { fluxo: false, pat: false },
    syncing: false, online: navigator.onLine, syncError: null, lastAttempt: 0,
    installEvt: null, loggingOut: false,
    edit: { tx: null, op: null, cx: null, mov: null, fx: null }, det: null, voltar: null
  };

  function loadUser(u) {
    state.user = u;
    const d = store.get(K.data(u.id), null);
    state.data = emptyData();
    if (d && typeof d === "object") { for (const t of TABLES) if (Array.isArray(d[t])) state.data[t] = d[t]; }
    else state.data.lancamentos = store.get(K.rows(u.id), []);
    state.prefs = normPrefs(store.get(K.prefs(u.id), null));
    state.outbox = store.get(K.outbox(u.id), []).map(op => (op.kind !== "prefs" && !op.table ? { ...op, table: "lancamentos" } : op));
    state.syncedAt = store.get(K.synced(u.id), null);
    state.mercado = { ...emptyMercado(), ...store.get(K.mercado(u.id), {}), carregando: false, erro: null };
  }
  function persist() {
    if (!state.user) return;
    const u = state.user.id;
    store.set(K.data(u), state.data);
    store.del(K.rows(u));
    store.set(K.prefs(u), state.prefs);
    store.set(K.outbox(u), state.outbox);
    store.set(K.synced(u), state.syncedAt);
  }
  function persistMercado() {
    if (!state.user) return;
    const { cotacoes, erros, cotacoesEm, cdi, cdiDesde, cdiEm, historico, histErros, histEm, histDesde } = state.mercado;
    store.set(K.mercado(state.user.id), { cotacoes, erros, cotacoesEm, cdi, cdiDesde, cdiEm, historico, histErros, histEm, histDesde });
  }
  const pendingIds = () => new Set(state.outbox.filter(o => o.kind === "upsert").map(o => o.row.id));

  /* ================= Supabase ================= */
  function projectUrl(raw) {
    try {
      const u = new URL(String(raw || "").trim());
      if (u.protocol !== "https:") return null;
      const painel = u.hostname === "supabase.com" && u.pathname.match(/\/project\/([a-z0-9]+)/i);
      if (painel) return `https://${painel[1].toLowerCase()}.supabase.co`;
      return u.origin;
    } catch { return null; }
  }
  const SB_URL = projectUrl(CFG.supabaseUrl);
  const SB_KEY = typeof CFG.supabaseKey === "string" ? CFG.supabaseKey.trim() : "";
  const configured = !!SB_URL && SB_KEY.length > 20 && !/COLE_AQUI/.test(String(CFG.supabaseUrl) + SB_KEY);
  let sb = null;
  if (configured && window.supabase && window.supabase.createClient) {
    sb = window.supabase.createClient(SB_URL, SB_KEY, {
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

  function pickCols(table, r) {
    const out = {};
    for (const c of COLS[table].split(",")) if (r[c] !== undefined) out[c] = r[c];
    return out;
  }
  function normRow(table, r) {
    const o = { ...r };
    for (const c of NUMERIC[table]) if (o[c] != null) o[c] = Number(o[c]);
    return o;
  }
  const prefsRow = p => ({
    categorias_despesa: p.categorias_despesa, categorias_receita: p.categorias_receita, contas: p.contas,
    meta_mensal_centavos: p.meta_mensal_centavos, metas_categoria: p.metas_categoria
  });

  async function pushOp(op) {
    try {
      if (op.kind === "upsert") {
        const { error } = await sb.from(op.table).upsert({ ...pickCols(op.table, op.row), user_id: state.user.id });
        return error || null;
      }
      if (op.kind === "delete") {
        const { error } = await sb.from(op.table).delete().eq("id", op.id);
        return error || null;
      }
      if (op.kind === "prefs") {
        const { error } = await sb.from("preferencias").upsert({ user_id: state.user.id, ...prefsRow(op.prefs), atualizado_em: new Date().toISOString() });
        return error || null;
      }
    } catch (e) { return e; }
    return null;
  }

  async function pullTable(table) {
    const PAGE = 1000, out = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb.from(table).select(COLS[table]).order("id", { ascending: true }).range(from, from + PAGE - 1);
      if (error) throw error;
      out.push(...data);
      if (data.length < PAGE) break;
    }
    return out.map(r => normRow(table, r));
  }
  async function pullPrefs() {
    const { data, error } = await sb.from("preferencias").select("categorias_despesa,categorias_receita,contas,meta_mensal_centavos,metas_categoria").maybeSingle();
    if (error) throw error;
    return data;
  }
  function applyOutboxTo(table, rows) {
    const m = new Map(rows.map(r => [r.id, r]));
    for (const op of state.outbox) {
      if (op.table !== table) continue;
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
      if (s.none) { state.online = true; showLogin("Sua sessão expirou. Entre de novo para sincronizar."); return; }
      if (s.session.user.id !== state.user.id) return;
      state.online = true;

      // 1) envia o que foi feito no aparelho
      while (state.outbox.length) {
        const op = state.outbox[0];
        const err = await pushOp(op);
        if (err && isNetErr(err)) { state.online = false; return; }
        if (err && isSchemaErr(err)) { state.syncError = "O banco ainda não tem as tabelas novas. Rode a atualização do schema.sql no Supabase."; return; }
        const i = state.outbox.indexOf(op);
        if (i >= 0) state.outbox.splice(i, 1);
        persist();
        if (err) toast(`Um item não foi aceito pelo servidor e foi descartado: ${err.message || "erro desconhecido"}`, 5000);
      }

      // 2) baixa a versão mais recente do servidor
      const [prefs, ...tabelas] = await Promise.all([pullPrefs(), ...TABLES.map(pullTable)]);
      TABLES.forEach((t, i) => { state.data[t] = applyOutboxTo(t, tabelas[i]); });
      if (prefs && !state.outbox.some(o => o.kind === "prefs")) state.prefs = normPrefs(prefs);
      state.syncedAt = Date.now();
      state.syncError = null;
      persist();
      autoLancarFixos();
      render();
      if (!$("catScrim").hidden) renderCatEditor();
      if (state.tab === "investimentos" || state.tab === "painel") atualizarMercado(false);
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
    if (isSchemaErr(e) || /relation .* does not exist|Could not find the table/i.test(m)) return "O banco ainda não tem as tabelas novas. Rode a atualização do schema.sql no Supabase.";
    if (/JWT|token/i.test(m)) return "Sua sessão expirou. Saia e entre de novo.";
    if (/permission denied|row-level security/i.test(m)) return "O Supabase recusou o acesso. Confira se o schema.sql foi executado inteiro.";
    return m || "Erro desconhecido ao sincronizar.";
  }

  /* ================= alterações locais ================= */
  function upsertLocal(table, row, opts = {}) {
    const list = state.data[table];
    const i = list.findIndex(r => r.id === row.id);
    if (i >= 0) list[i] = row; else list.push(row);
    state.outbox.push({ kind: "upsert", table, row });
    if (!opts.quiet) { persist(); render(); requestSync(); }
  }
  function deleteLocal(table, id, opts = {}) {
    state.data[table] = state.data[table].filter(r => r.id !== id);
    state.outbox.push({ kind: "delete", table, id });
    if (!opts.quiet) { persist(); render(); requestSync(); }
  }
  function savePrefsLocal() {
    state.outbox = state.outbox.filter(o => o.kind !== "prefs" || o === state.outbox[0]);
    state.outbox.push({ kind: "prefs", prefs: clone(state.prefs) });
    persist(); setStatus(); requestSync();
  }
  const salvo = () => (!navigator.onLine || !state.online ? "Salvo no aparelho. Sincroniza quando a internet voltar." : null);

  /* ================= gastos fixos automáticos ================= */
  function lancDoFixo(f, mes, agora) {
    return {
      id: idFixo(f.id, mes), tipo: "despesa", valor_centavos: f.valor_centavos, descricao: f.descricao,
      categoria: f.categoria, conta: f.conta, data: dataNoMes(mes, f.dia), fixo_id: f.id, criado_em: agora, atualizado_em: agora
    };
  }
  const fixoLancado = (f, mes) => state.data.lancamentos.find(r => r.fixo_id === f.id && monthOf(r) === mes);

  // Todo mês, os fixos ativos entram sozinhos (inclusive meses em que o app não foi aberto, até 12 meses).
  function autoLancarFixos() {
    if (!state.user) return;
    const atual = curMonth(), agora = new Date().toISOString();
    let mudou = false;
    for (const f of state.data.gastos_fixos.slice()) {
      if (!f.ativo || (f.ultimo_mes_lancado && f.ultimo_mes_lancado >= atual)) continue;
      let m = f.ultimo_mes_lancado ? shiftMonth(f.ultimo_mes_lancado, 1) : atual;
      const piso = shiftMonth(atual, -11);
      if (m < piso) m = piso;
      for (; m <= atual; m = shiftMonth(m, 1)) {
        if (!fixoLancado(f, m)) upsertLocal("lancamentos", lancDoFixo(f, m, agora), { quiet: true });
      }
      upsertLocal("gastos_fixos", { ...f, ultimo_mes_lancado: atual, atualizado_em: agora }, { quiet: true });
      mudou = true;
    }
    if (mudou) { persist(); render(); requestSync(); }
  }

  /* ================= cotações e CDI ================= */
  async function atualizarMercado(force) {
    if (!sb || !state.user || state.mercado.carregando || !navigator.onLine) return;
    const tickers = calcPosicoes().filter(p => p.qtd > 0).map(p => p.ticker);
    const datas = state.data.caixinha_movs.map(m => m.data).sort();
    const cdiDesde = datas[0] || null;
    const agora = Date.now(), M = state.mercado;
    const precisaCot = tickers.length > 0 && (force || !M.cotacoesEm || agora - M.cotacoesEm > 5 * 60_000 || tickers.some(t => !M.cotacoes[t] && !M.erros[t]));
    const precisaCdi = !!cdiDesde && (force || !M.cdiEm || agora - M.cdiEm > 6 * 3600_000 || !M.cdiDesde || cdiDesde < M.cdiDesde);
    // histórico mensal (só para o painel): fechamento de cada mês dos últimos 12 meses
    const todos = [...new Set(state.data.acoes_ops.map(o => o.ticker))];
    const primeiraOp = state.data.acoes_ops.map(o => o.data).sort()[0];
    const histDesde = primeiraOp ? [primeiraOp.slice(0, 7), shiftMonth(curMonth(), -11)].sort()[1] : null;
    const precisaHist = state.tab === "painel" && todos.length > 0 && !!histDesde
      && (force || !M.histEm || agora - M.histEm > 12 * 3600_000 || !M.histDesde || histDesde < M.histDesde || todos.some(t => !M.historico[t] && !M.histErros[t]));
    if (!precisaCot && !precisaCdi && !precisaHist) return;
    M.carregando = true; M.erro = null; renderInvest();
    try {
      const body = {};
      if (precisaCot) body.tickers = tickers;
      if (precisaCdi) body.cdiDesde = cdiDesde;
      if (precisaHist) body.historico = { tickers: todos, desde: histDesde };
      const { data, error } = await sb.functions.invoke("mercado", { body });
      if (error) throw error;
      if (data && data.cotacoes) { M.cotacoes = { ...M.cotacoes, ...data.cotacoes }; M.erros = data.erros || {}; M.cotacoesEm = Date.now(); }
      if (data && Array.isArray(data.cdi)) { M.cdi = data.cdi; M.cdiDesde = cdiDesde; M.cdiEm = Date.now(); }
      if (data && data.cdiErro) M.erro = `CDI: ${data.cdiErro}`;
      if (data && data.historico) { M.historico = { ...M.historico, ...data.historico }; M.histErros = data.historicoErros || {}; M.histEm = Date.now(); M.histDesde = histDesde; }
      persistMercado();
    } catch (e) {
      M.erro = isNetErr(e) ? "Sem internet: mostrando os últimos valores salvos." : "Não foi possível buscar as cotações agora. Tente de novo em instantes.";
    } finally {
      M.carregando = false;
      render();
    }
  }

  /* ================= cálculos ================= */
  // Preço médio pelo método brasileiro: compras (com taxas) formam o custo; vendas baixam a quantidade pelo preço médio.
  function calcPosicoes() {
    const by = new Map();
    for (const o of state.data.acoes_ops.slice().sort(byDateAsc)) {
      let p = by.get(o.ticker);
      if (!p) by.set(o.ticker, p = { ticker: o.ticker, qtd: 0, custo: 0, realizado: 0, ops: [], aviso: null });
      p.ops.push(o);
      if (o.tipo === "compra") {
        p.custo += o.quantidade * o.preco * 100 + (o.taxas_centavos || 0);
        p.qtd += o.quantidade;
      } else {
        if (o.quantidade > p.qtd + 1e-9) p.aviso = "Há venda maior que a quantidade em carteira";
        const q = Math.min(o.quantidade, p.qtd);
        const pm = p.qtd > 0 ? p.custo / p.qtd : 0;
        p.realizado += q * o.preco * 100 - (o.taxas_centavos || 0) - q * pm;
        p.custo -= q * pm;
        p.qtd -= q;
        if (p.qtd < 1e-9) { p.qtd = 0; p.custo = 0; }
      }
    }
    return [...by.values()].map(p => {
      const c = state.mercado.cotacoes[p.ticker] || null;
      const pm = p.qtd > 0 ? p.custo / p.qtd : 0;
      const valor = c ? p.qtd * c.preco * 100 : null;
      const resultado = valor != null ? valor - p.custo : null;
      return {
        ...p, pm, cot: c, erro: state.mercado.erros[p.ticker] || null, valor, resultado,
        resultadoPct: resultado != null && p.custo > 0 ? resultado / p.custo * 100 : null,
        diaPct: c && c.anterior ? (c.preco / c.anterior - 1) * 100 : null
      };
    }).sort((a, b) => (b.valor ?? b.custo) - (a.valor ?? a.custo));
  }

  // Saldo bruto estimado: cada dia útil rende (CDI do dia × % do CDI), a partir do dia seguinte ao aporte.
  function calcCaixinhas() {
    const cdi = state.mercado.cdi || [];
    return state.data.caixinhas.map(cx => {
      const movs = state.data.caixinha_movs.filter(m => m.caixinha_id === cx.id).sort(byDateAsc);
      let aportado = 0;
      for (const m of movs) aportado += m.tipo === "aporte" ? m.valor_centavos : -m.valor_centavos;
      const temCdi = cdi.length > 0 && movs.length > 0 && !!state.mercado.cdiDesde && state.mercado.cdiDesde <= movs[0].data;
      let saldo = 0;
      const aplicar = m => { saldo += m.tipo === "aporte" ? m.valor_centavos : -m.valor_centavos; if (saldo < 0) saldo = 0; };
      if (temCdi) {
        const fator = (cx.percentual_cdi || 100) / 100;
        let j = 0;
        for (const d of cdi) {
          while (j < movs.length && movs[j].data < d.data) aplicar(movs[j++]);
          saldo *= 1 + (d.taxa / 100) * fator;
        }
        while (j < movs.length) aplicar(movs[j++]);
      } else {
        saldo = Math.max(0, aportado);
      }
      return { cx, movs, aportado, saldo, rendimento: saldo - aportado, estimado: temCdi };
    }).sort((a, b) => b.saldo - a.saldo);
  }
  function cdiAnual() {
    const cdi = state.mercado.cdi || [];
    if (!cdi.length) return null;
    return (Math.pow(1 + cdi[cdi.length - 1].taxa / 100, 252) - 1) * 100;
  }

  const monthRows = (m = state.month) => state.data.lancamentos.filter(r => monthOf(r) === m);
  function gastosMes(m = state.month) {
    let total = 0, fixos = 0;
    const porCat = {};
    for (const r of monthRows(m)) {
      if (r.tipo !== "despesa") continue;
      total += r.valor_centavos;
      if (r.fixo_id) fixos += r.valor_centavos;
      porCat[r.categoria] = (porCat[r.categoria] || 0) + r.valor_centavos;
    }
    return { total, fixos, porCat };
  }
  const meterCls = p => (p > 100 ? "over" : p >= 80 ? "warn" : "");
  const meter = (p, big) => `<div class="meter${big ? " big" : ""} ${meterCls(p)}"><i style="width:${Math.min(100, Math.max(p > 0 ? 1.5 : 0, p)).toFixed(1)}%"></i></div>`;

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

  /* ================= abas ================= */
  function setTab(tab, opts = {}) {
    if (!TABS.includes(tab)) tab = "painel";
    state.tab = tab;
    for (const t of TABS) $(`tab-${t}`).hidden = t !== tab;
    document.querySelectorAll("[data-tab]").forEach(b => { if (b.dataset.tab === tab) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); });
    $("monthNav").hidden = tab === "investimentos" || tab === "painel";
    updateAddButtons();
    if (!opts.keepHash) history.replaceState(null, "", tab === "painel" ? location.pathname + location.search : `#${tab}`);
    if (!opts.keepScroll) window.scrollTo(0, 0);
    if (tab === "painel") renderPainel();
    if (tab === "investimentos" || tab === "painel") atualizarMercado(false);
  }
  function updateAddButtons() {
    const t = state.tab;
    const label = t === "mes" || t === "painel" ? "Novo lançamento"
      : t === "investimentos" ? (state.invSub === "acoes" ? "Nova operação" : (state.data.caixinhas.length ? "Novo aporte" : "Nova caixinha"))
      : t === "fixos" ? "Novo gasto fixo" : "";
    $("btnAddText").textContent = label;
    $("btnAdd").hidden = !label;
    $("fab").hidden = !label;
    $("fab").setAttribute("aria-label", label || "Adicionar");
  }
  function addForTab() {
    if (state.tab === "mes" || state.tab === "painel") openTx();
    else if (state.tab === "investimentos") {
      if (state.invSub === "acoes") openOp();
      else if (state.data.caixinhas.length) openMov();
      else openCx();
    } else if (state.tab === "fixos") openFx();
  }

  /* ================= render ================= */
  function render() {
    $("mLabel").textContent = monthName(state.month);
    $("todayM").hidden = state.month === curMonth();
    renderMes();
    renderInvest();
    renderMetas();
    renderFixos();
    if (state.tab === "painel") renderPainel();
    updateAddButtons();
    setStatus();
    if (!$("detScrim").hidden) renderDetalhe();
  }

  /* ---------- aba Painel ---------- */
  const COMPACT = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", notation: "compact", maximumFractionDigits: 1 });
  const moneyCompact = c => COMPACT.format(Math.round(c || 0) / 100);
  const mesCurto = m => monthName(m, { month: "short" });
  const fimDoMes = m => `${m}-${pad(daysInMonth(m))}`;
  const mesesAte = (fim, n) => Array.from({ length: n }, (_, i) => shiftMonth(fim, i - n + 1));
  const soma = a => a.reduce((s, v) => s + v, 0);

  // Escala com valores redondos (em centavos): 0, metade e o topo
  function topoBonito(v) {
    if (!(v > 0)) return 10000;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  }
  // Coluna com ponta arredondada (4px) e base reta
  function barra(x, y, w, h) {
    const r = Math.min(4, w / 2, h);
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }

  function fluxo(meses) {
    const idx = new Map(meses.map((m, i) => [m, i]));
    const z = () => meses.map(() => 0);
    const rec = z(), desp = z(), fixos = z(), qtd = z(), cats = {};
    for (const r of state.data.lancamentos) {
      const i = idx.get(monthOf(r)); if (i == null) continue;
      qtd[i]++;
      if (r.tipo === "receita") rec[i] += r.valor_centavos;
      else {
        desp[i] += r.valor_centavos;
        if (r.fixo_id) fixos[i] += r.valor_centavos;
        (cats[r.categoria] = cats[r.categoria] || z())[i] += r.valor_centavos;
      }
    }
    return { rec, desp, fixos, qtd, cats, comDados: qtd.filter(n => n > 0).length };
  }

  // Patrimônio no fim de cada mês: ações a preço de fechamento do mês, caixinhas com o CDI diário
  function evolucao(meses) {
    const hist = state.mercado.historico || {}, atual = curMonth();
    const ops = state.data.acoes_ops.slice().sort(byDateAsc);
    const pos = new Map();
    let j = 0, semPreco = false;
    const acoes = [], custo = [];
    for (const m of meses) {
      const fim = fimDoMes(m);
      while (j < ops.length && ops[j].data <= fim) {
        const o = ops[j++];
        let p = pos.get(o.ticker);
        if (!p) pos.set(o.ticker, p = { qtd: 0, custo: 0 });
        if (o.tipo === "compra") { p.custo += o.quantidade * o.preco * 100 + (o.taxas_centavos || 0); p.qtd += o.quantidade; }
        else {
          const q = Math.min(o.quantidade, p.qtd), pm = p.qtd > 0 ? p.custo / p.qtd : 0;
          p.custo -= q * pm; p.qtd -= q;
          if (p.qtd < 1e-9) { p.qtd = 0; p.custo = 0; }
        }
      }
      let v = 0, c = 0;
      for (const [t, p] of pos) {
        if (p.qtd <= 0) continue;
        c += p.custo;
        const agora = m === atual && state.mercado.cotacoes[t] ? state.mercado.cotacoes[t].preco : null;
        const preco = agora ?? (hist[t] ? hist[t][m] : null);
        if (preco != null) v += p.qtd * preco * 100; else { v += p.custo; semPreco = true; }
      }
      acoes.push(v); custo.push(c);
    }

    const cdi = state.mercado.cdi || [];
    const rf = meses.map(() => 0), aportRf = meses.map(() => 0);
    let rfSemCdi = false;
    for (const cx of state.data.caixinhas) {
      const movs = state.data.caixinha_movs.filter(m => m.caixinha_id === cx.id).sort(byDateAsc);
      if (!movs.length) continue;
      const fator = (cx.percentual_cdi || 100) / 100;
      const usaCdi = cdi.length > 0 && !!state.mercado.cdiDesde && state.mercado.cdiDesde <= movs[0].data;
      if (!usaCdi) rfSemCdi = true;
      let saldo = 0, aport = 0, k = 0, d = 0;
      const aplicar = mv => { const val = mv.tipo === "aporte" ? mv.valor_centavos : -mv.valor_centavos; saldo = Math.max(0, saldo + val); aport += val; };
      meses.forEach((m, i) => {
        const fim = fimDoMes(m);
        if (usaCdi) {
          while (d < cdi.length && cdi[d].data <= fim) {
            while (k < movs.length && movs[k].data < cdi[d].data) aplicar(movs[k++]);
            saldo *= 1 + (cdi[d].taxa / 100) * fator;
            d++;
          }
        }
        while (k < movs.length && movs[k].data <= fim) aplicar(movs[k++]);
        rf[i] += saldo; aportRf[i] += aport;
      });
    }
    return { acoes, rf, aplicado: meses.map((_, i) => custo[i] + aportRf[i]), semPreco, rfSemCdi };
  }

  function kpi(label, valor, sub, cls = "", texto = false) {
    return `<div class="kpi"><span class="label">${label}</span><span class="kv-v${texto ? " txt" : ""}">${valor}</span>${sub ? `<span class="kv-s ${cls}">${sub}</span>` : ""}</div>`;
  }

  function renderPainel() {
    const n = state.periodo, atual = curMonth();
    const meses = mesesAte(atual, n), antes = mesesAte(shiftMonth(atual, -n), n);
    document.querySelectorAll("[data-per]").forEach(b => b.setAttribute("aria-pressed", String(Number(b.dataset.per) === n)));
    $("dashPer").textContent = `${mesCurto(meses[0])} a ${monthName(atual, { month: "short", year: "numeric" }).toLowerCase()}`;

    /* ----- gastos ----- */
    const f = fluxo(meses), fa = fluxo(antes);
    const totRec = soma(f.rec), totDesp = soma(f.desp), totFix = soma(f.fixos);
    const medio = f.comDados ? totDesp / f.comDados : 0;
    const medioAntes = fa.comDados ? soma(fa.desp) / fa.comDados : 0;
    let delta = "", deltaCls = "";
    if (f.comDados && fa.comDados && medioAntes > 0) {
      const d = (medio / medioAntes - 1) * 100;
      delta = `${d >= 0 ? "▲" : "▼"} ${pct(Math.abs(d))} vs ${n} meses antes`;
      deltaCls = d > 0.5 ? "ruim" : d < -0.5 ? "bom" : "";
    } else delta = f.comDados ? `média de ${plural(f.comDados, "mês com registro", "meses com registro")}` : "";
    const catsOrd = Object.entries(f.cats).map(([c, arr]) => ({ c, arr, total: soma(arr) })).sort((a, b) => b.total - a.total);
    const poup = totRec > 0 ? (totRec - totDesp) / totRec * 100 : null;
    $("kpiGastos").innerHTML = f.comDados
      ? kpi("Gasto médio por mês", money(medio), delta, deltaCls)
        + kpi("Sobrou da renda", poup != null ? pct(poup) : "—", poup != null ? `${moneySigned(totRec - totDesp)} no período` : "sem receitas no período", poup != null ? (poup >= 0 ? "bom" : "ruim") : "")
        + kpi("Gastos fixos", totDesp > 0 ? pct(totFix / totDesp * 100) : "—", totDesp > 0 ? `${money(totFix)} dos gastos` : "")
        + kpi("Maior categoria", catsOrd[0] ? esc(catsOrd[0].c) : "—", catsOrd[0] ? `${money(catsOrd[0].total / f.comDados)} por mês` : "", "", true)
      : `<div class="dash-empty" style="grid-column:1/-1">Ainda não há lançamentos nesses meses. Os gráficos aparecem conforme você registra receitas e despesas.</div>`;
    $("cardFluxo").hidden = !f.comDados;
    $("cardCats").hidden = !catsOrd.length;
    if (f.comDados) desenharFluxo(meses, f);
    $("dashCats").innerHTML = catsOrd.map(({ c, arr, total }) => {
      const media = total / f.comDados, meta = state.prefs.metas_categoria[c];
      const chip = meta ? (media > meta ? `<span class="chip-s bad">acima da meta de ${money(meta)}</span>` : `<span class="chip-s ok">dentro da meta de ${money(meta)}</span>`) : "";
      return `<div class="crow">
        <div style="min-width:0"><div class="n">${esc(c)}</div><div class="s">${money(media)} por mês · ${pct(totDesp ? total / totDesp * 100 : 0)} dos gastos</div>${chip}</div>
        ${sparkline(arr)}
        <div class="v">${money(total)}</div></div>`;
    }).join("");

    /* ----- investimentos ----- */
    const pos = calcPosicoes().filter(p => p.qtd > 0), cxs = calcCaixinhas().filter(c => c.movs.length);
    const tem = pos.length > 0 || cxs.length > 0;
    let aValor = 0, aCusto = 0;
    for (const p of pos) { aCusto += p.custo; aValor += p.valor != null ? p.valor : p.custo; }
    const rSaldo = soma(cxs.map(c => c.saldo)), rAport = soma(cxs.map(c => c.aportado));
    const patrimonio = aValor + rSaldo, aplicado = aCusto + rAport, resultado = patrimonio - aplicado;
    const mesSet = new Set(meses);
    let aportes = 0;
    for (const o of state.data.acoes_ops) if (mesSet.has(monthOf(o))) aportes += o.tipo === "compra" ? o.quantidade * o.preco * 100 + (o.taxas_centavos || 0) : -(o.quantidade * o.preco * 100 - (o.taxas_centavos || 0));
    for (const m of state.data.caixinha_movs) if (mesSet.has(monthOf(m))) aportes += m.tipo === "aporte" ? m.valor_centavos : -m.valor_centavos;
    $("kpiInv").innerHTML = tem
      ? kpi("Patrimônio investido", money(patrimonio), `${money(aplicado)} aplicados`)
        + kpi("Resultado", moneySigned(resultado), aplicado > 0 ? `${pctSigned(resultado / aplicado * 100)} sobre o aplicado` : "", resultado > 0.5 ? "bom" : resultado < -0.5 ? "ruim" : "")
        + kpi("Aportes no período", moneySigned(aportes), "compras e aportes menos vendas e resgates")
        + kpi("Investiu da renda", totRec > 0 ? pct(Math.max(0, aportes) / totRec * 100) : "—", totRec > 0 ? "dos ganhos no período" : "sem receitas no período")
      : `<div class="dash-empty" style="grid-column:1/-1">Nenhum investimento registrado ainda.<br><button type="button" class="btn" data-act="ir-invest">Registrar investimento</button></div>`;
    $("cardPat").hidden = !tem;
    $("cardAloc").hidden = !tem;
    if (tem) {
      const ev = evolucao(meses);
      desenharPatrimonio(meses, ev);
      const notas = [];
      if (ev.semPreco) notas.push(state.mercado.carregando ? "buscando o histórico de cotações…" : "meses sem cotação usam o valor aplicado");
      if (ev.rfSemCdi) notas.push("caixinhas sem CDI carregado aparecem sem rendimento");
      $("patNota").textContent = `Valor no fim de cada mês${notas.length ? ` · ${notas.join(" · ")}` : ""}.`;
      desenharAlocacao(pos, cxs, aValor, rSaldo);
    }
  }

  function sparkline(arr) {
    const w = 84, h = 26, nb = arr.length, gap = nb > 6 ? 1.5 : 2;
    const bw = (w - gap * (nb - 1)) / nb, max = Math.max(1, ...arr);
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true">${arr.map((v, i) => {
      const bh = v > 0 ? Math.max(2, v / max * h) : 0;
      return bh ? `<rect class="${i === nb - 1 ? "cur" : ""}" x="${(i * (bw + gap)).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="1.5"/>` : "";
    }).join("")}</svg>`;
  }

  function eixoY(svgW, padL, padT, ph, topo) {
    let s = "";
    for (const f of [0, 0.5, 1]) {
      const y = (padT + ph - f * ph).toFixed(1);
      s += `<line class="${f === 0 ? "axis" : "gl"}" x1="${padL}" x2="${svgW}" y1="${y}" y2="${y}"/>`;
      s += `<text class="ax num" x="${padL - 8}" y="${(Number(y) + 3.5).toFixed(1)}" text-anchor="end">${esc(f === 0 ? "0" : moneyCompact(topo * f))}</text>`;
    }
    return s;
  }
  const mostrarRotulo = (i, total, largura) => total <= 6 || largura >= 520 || i % 2 === (total - 1) % 2;

  function desenharFluxo(meses, f) {
    const el = $("chFluxo");
    if (state.tabela.fluxo) {
      el.innerHTML = `<div class="table-wrap"><table class="dtable"><thead><tr><th>Mês</th><th>Receitas</th><th>Despesas</th><th>Saldo</th></tr></thead><tbody>${meses.map((m, i) =>
        `<tr><td>${esc(monthName(m))}</td><td>${money(f.rec[i])}</td><td>${money(f.desp[i])}</td><td>${moneySigned(f.rec[i] - f.desp[i])}</td></tr>`).join("")}</tbody></table></div>`;
      return;
    }
    const W = Math.max(260, el.clientWidth || 600), H = 210, padL = 58, padT = 10, padB = 26, ph = H - padT - padB, pw = W - padL;
    const topo = topoBonito(Math.max(...f.rec, ...f.desp));
    const band = pw / meses.length, bw = Math.max(4, Math.min(24, (band * 0.72 - 2) / 2)), grupo = bw * 2 + 2;
    const y = v => padT + ph - v / topo * ph;
    let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Receitas e despesas por mês">` + eixoY(W, padL, padT, ph, topo);
    meses.forEach((m, i) => {
      const x0 = padL + band * i + (band - grupo) / 2;
      s += `<g class="col" data-i="${i}">`;
      if (f.rec[i] > 0) s += `<path class="b-rec" d="${barra(x0, y(f.rec[i]), bw, padT + ph - y(f.rec[i]))}"/>`;
      if (f.desp[i] > 0) s += `<path class="b-desp" d="${barra(x0 + bw + 2, y(f.desp[i]), bw, padT + ph - y(f.desp[i]))}"/>`;
      s += `</g>`;
      if (mostrarRotulo(i, meses.length, W)) s += `<text class="ax" x="${(padL + band * i + band / 2).toFixed(1)}" y="${H - 7}" text-anchor="middle">${esc(mesCurto(m))}</text>`;
    });
    meses.forEach((m, i) => { s += `<rect class="hit" data-i="${i}" x="${(padL + band * i).toFixed(1)}" y="${padT}" width="${band.toFixed(1)}" height="${ph}" tabindex="0" aria-label="${esc(monthName(m))}: receitas ${esc(money(f.rec[i]))}, despesas ${esc(money(f.desp[i]))}"/>`; });
    el.innerHTML = s + `</svg><div class="tip" hidden></div>`;
    ligarDica(el, i => ({
      titulo: monthName(meses[i]),
      x: padL + band * i + band / 2,
      linhas: [
        { cor: "var(--c-rec)", valor: money(f.rec[i]), nome: "Receitas" },
        { cor: "var(--c-desp)", valor: money(f.desp[i]), nome: "Despesas" },
        { cor: null, valor: moneySigned(f.rec[i] - f.desp[i]), nome: "Saldo" }
      ]
    }), "col");
  }

  function desenharPatrimonio(meses, ev) {
    const el = $("chPat");
    const tot = meses.map((_, i) => ev.acoes[i] + ev.rf[i]);
    if (state.tabela.pat) {
      el.innerHTML = `<div class="table-wrap"><table class="dtable"><thead><tr><th>Mês</th><th>Ações</th><th>Renda fixa</th><th>Total</th><th>Aplicado</th></tr></thead><tbody>${meses.map((m, i) =>
        `<tr><td>${esc(monthName(m))}</td><td>${money(ev.acoes[i])}</td><td>${money(ev.rf[i])}</td><td>${money(tot[i])}</td><td>${money(ev.aplicado[i])}</td></tr>`).join("")}</tbody></table></div>`;
      return;
    }
    const W = Math.max(260, el.clientWidth || 600), H = 220, padL = 58, padR = 14, padT = 22, padB = 26, ph = H - padT - padB, pw = W - padL - padR;
    const topo = topoBonito(Math.max(...tot, ...ev.aplicado));
    const passo = meses.length > 1 ? pw / (meses.length - 1) : 0;
    const x = i => (meses.length > 1 ? padL + passo * i : padL + pw / 2);
    const y = v => padT + ph - v / topo * ph;
    const linha = vals => vals.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
    const area = (baixo, cima) => `${linha(cima)}${baixo.map((v, i) => [i, v]).reverse().map(([i, v]) => `L${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("")}Z`;
    const zero = meses.map(() => 0);
    let s = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Evolução do patrimônio investido">` + eixoY(W - padR, padL, padT, ph, topo);
    s += `<path class="a-acoes" d="${area(zero, ev.acoes)}"/><path class="a-rf" d="${area(ev.acoes, tot)}"/>`;
    s += `<path class="l-acoes" d="${linha(ev.acoes)}"/><path class="l-rf" d="${linha(tot)}"/><path class="l-apl" d="${linha(ev.aplicado)}"/>`;
    const u = meses.length - 1;
    s += `<circle class="d-rf ring" cx="${x(u).toFixed(1)}" cy="${y(tot[u]).toFixed(1)}" r="4.5"/>`;
    s += `<text class="end-lbl" x="${x(u).toFixed(1)}" y="${(y(tot[u]) - 10).toFixed(1)}" text-anchor="end">${esc(moneyCompact(tot[u]))}</text>`;
    meses.forEach((m, i) => { if (mostrarRotulo(i, meses.length, W)) s += `<text class="ax" x="${x(i).toFixed(1)}" y="${H - 7}" text-anchor="${i === 0 && meses.length > 1 ? "start" : i === u && meses.length > 1 ? "end" : "middle"}">${esc(mesCurto(m))}</text>`; });
    s += `<g class="cross-g" visibility="hidden"><line class="cross" y1="${padT}" y2="${padT + ph}"/><circle class="d-acoes ring" r="4.5"/><circle class="d-rf ring" r="4.5"/><circle class="d-apl ring" r="4.5"/></g>`;
    meses.forEach((m, i) => {
      const larg = meses.length > 1 ? passo : pw, x0 = meses.length > 1 ? x(i) - passo / 2 : padL;
      s += `<rect class="hit" data-i="${i}" x="${Math.max(padL - 8, x0).toFixed(1)}" y="${padT}" width="${larg.toFixed(1)}" height="${ph}" tabindex="0" aria-label="${esc(monthName(m))}: total ${esc(money(tot[i]))}"/>`;
    });
    el.innerHTML = s + `</svg><div class="tip" hidden></div>`;
    ligarDica(el, i => {
      const g = el.querySelector(".cross-g");
      g.setAttribute("visibility", "visible");
      g.querySelector(".cross").setAttribute("x1", x(i)); g.querySelector(".cross").setAttribute("x2", x(i));
      [[".d-acoes", ev.acoes[i]], [".d-rf", tot[i]], [".d-apl", ev.aplicado[i]]].forEach(([sel, v]) => { const c = g.querySelector(sel); c.setAttribute("cx", x(i)); c.setAttribute("cy", y(v)); });
      const res = tot[i] - ev.aplicado[i];
      return {
        titulo: monthName(meses[i]), x: x(i),
        linhas: [
          { cor: null, valor: money(tot[i]), nome: "Total" },
          { cor: "var(--c-acoes)", valor: money(ev.acoes[i]), nome: "Ações" },
          { cor: "var(--c-rf)", valor: money(ev.rf[i]), nome: "Renda fixa" },
          { cor: "var(--c-apl)", valor: money(ev.aplicado[i]), nome: "Aplicado" },
          { cor: null, valor: moneySigned(res), nome: "Resultado" }
        ]
      };
    }, null, () => { const g = el.querySelector(".cross-g"); if (g) g.setAttribute("visibility", "hidden"); });
  }

  function desenharAlocacao(pos, cxs, aValor, rSaldo) {
    const total = aValor + rSaldo;
    const itens = [
      ...pos.map(p => ({ nome: p.ticker, cor: "var(--c-acoes)", v: p.valor != null ? p.valor : p.custo })),
      ...cxs.map(c => ({ nome: c.cx.nome, cor: "var(--c-rf)", v: c.saldo }))
    ].sort((a, b) => b.v - a.v);
    const pa = total > 0 ? aValor / total * 100 : 0, pr = total > 0 ? rSaldo / total * 100 : 0;
    $("dashAloc").innerHTML = `
      <div class="aloc-sum"><span><i class="sw" style="display:inline-block;width:10px;height:10px;border-radius:3px;background:var(--c-acoes)"></i> Ações <b>${pct(pa)}</b></span><span><i class="sw" style="display:inline-block;width:10px;height:10px;border-radius:3px;background:var(--c-rf)"></i> Renda fixa <b>${pct(pr)}</b></span></div>
      <div class="aloc-bar" role="img" aria-label="Ações ${pct(pa)}, renda fixa ${pct(pr)}">${pa > 0 ? `<i style="width:${pa}%;background:var(--c-acoes)"></i>` : ""}${pr > 0 ? `<i style="width:${pr}%;background:var(--c-rf)"></i>` : ""}</div>
      ${itens.map(it => `<div class="arow"><span class="dot" style="background:${it.cor}"></span><span class="nm">${esc(it.nome)}</span><span class="v">${money(it.v)}</span><span class="p">${pct(total > 0 ? it.v / total * 100 : 0)}</span></div>`).join("")}`;
  }

  // Dica ao passar o mouse ou tocar: mostra os valores do mês; teclado também funciona
  function ligarDica(el, conteudo, classeCol, aoSair) {
    const tip = el.querySelector(".tip");
    const esconder = () => {
      tip.hidden = true;
      if (classeCol) el.querySelectorAll(`.${classeCol}`).forEach(g => g.classList.remove("dim"));
      if (aoSair) aoSair();
    };
    const mostrar = hit => {
      const i = Number(hit.dataset.i), c = conteudo(i);
      if (classeCol) el.querySelectorAll(`.${classeCol}`).forEach(g => g.classList.toggle("dim", Number(g.dataset.i) !== i));
      tip.textContent = "";
      const h = document.createElement("div"); h.className = "tip-h"; h.textContent = c.titulo; tip.appendChild(h);
      for (const l of c.linhas) {
        const r = document.createElement("div"); r.className = "tip-r";
        const k = document.createElement("i"); if (l.cor) k.style.background = l.cor; else k.className = "none";
        const b = document.createElement("b"); b.textContent = l.valor;
        const sp = document.createElement("span"); sp.textContent = l.nome;
        r.append(k, b, sp); tip.appendChild(r);
      }
      tip.hidden = false;
      const svg = el.querySelector("svg"), escala = svg.getBoundingClientRect().width / Number(svg.getAttribute("width"));
      const larg = tip.offsetWidth, maxX = el.clientWidth - larg;
      let left = c.x * escala + 12;
      if (left > maxX) left = c.x * escala - larg - 12;
      tip.style.left = `${Math.max(0, Math.min(maxX, left))}px`;
      tip.style.top = "0px";
    };
    el.onpointermove = e => { const hit = e.target.closest(".hit"); if (hit) mostrar(hit); };
    el.onpointerdown = e => { const hit = e.target.closest(".hit"); if (hit) mostrar(hit); };
    el.onpointerleave = e => { if (e.pointerType !== "touch") esconder(); };
    el.onfocusin = e => { const hit = e.target.closest(".hit"); if (hit) mostrar(hit); };
    el.onfocusout = esconder;
    el._esconder = esconder;
  }

  /* ---------- aba Mês ---------- */
  function renderMes() {
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

    const meta = state.prefs.meta_mensal_centavos;
    const goal = $("mesMeta");
    if (meta) {
      const p = out / meta * 100;
      goal.hidden = false;
      goal.innerHTML = `<div class="row"><span>Meta do mês <b class="num">${money(meta)}</b></span><span>${p > 100 ? `passou <b class="num">${money(out - meta)}</b>` : `restam <b class="num">${money(meta - out)}</b>`} · ${Math.round(p)}% usado</span></div>${meter(p)}`;
    } else goal.hidden = true;

    renderCats(tx, out);
    renderTrend();
    renderAccts(tx);
    renderList(tx);
  }

  function renderCats(tx, out) {
    const by = {};
    for (const t of tx) if (t.tipo === "despesa") by[t.categoria] = (by[t.categoria] || 0) + t.valor_centavos;
    const rows = Object.entries(by).sort((a, b) => b[1] - a[1]);
    $("catTotal").textContent = out ? money(out) : "";
    if (!rows.length) { $("cats").innerHTML = `<div class="empty small">Nenhuma despesa em ${esc(monthLower(state.month))}.</div>`; return; }
    const max = rows[0][1];
    $("cats").innerHTML = rows.map(([c, v]) => `
      <div class="cat-row"><span class="n">${esc(c)}</span><span class="v num">${money(v)}<span class="pct">${Math.round(v / out * 100)}%</span></span>
      <div class="bar"><i style="width:${Math.max(2, v / max * 100).toFixed(1)}%"></i></div></div>`).join("");
  }

  function renderTrend() {
    const months = [5, 4, 3, 2, 1, 0].map(k => shiftMonth(state.month, -k));
    const data = months.map(m => {
      let i = 0, o = 0;
      for (const t of state.data.lancamentos) if (monthOf(t) === m) { if (t.tipo === "receita") i += t.valor_centavos; else o += t.valor_centavos; }
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
      .sort(byDateDesc);
    if (!tx.length) {
      const fresh = !state.syncedAt && state.online && !state.syncError && state.user;
      $("list").innerHTML = fresh
        ? `<div class="empty">Buscando seus lançamentos…</div>`
        : `<div class="empty"><strong>Nada lançado em ${esc(monthLower(state.month))}</strong>Registre salário, contas e gastos do dia a dia. Funciona até sem internet e sincroniza sozinho depois.<br><button class="btn primary" type="button" data-new>Adicionar lançamento</button></div>`;
      return;
    }
    if (!rows.length) { $("list").innerHTML = `<div class="empty">Nenhum lançamento encontrado com esse filtro.</div>`; return; }
    const pend = pendingIds(), hoje = todayISO();
    const groups = new Map();
    for (const t of rows) { if (!groups.has(t.data)) groups.set(t.data, []); groups.get(t.data).push(t); }
    let h = "";
    for (const [date, items] of groups) {
      const net = items.reduce((s, t) => s + (t.tipo === "receita" ? t.valor_centavos : -t.valor_centavos), 0);
      h += `<div class="day"><div class="day-h"><span class="label">${esc(dayLabel(date))}</span><span class="num">${net > 0 ? "+" : ""}${money(net)}</span></div>`;
      for (const t of items) {
        const cls = t.tipo === "receita" ? "in" : "out";
        const chips = (t.fixo_id ? `<span class="chip-s info">fixo</span> ` : "") + (t.data > hoje ? `<span class="chip-s">agendado</span> ` : "");
        h += `<button type="button" class="tx ${cls}" data-id="${esc(t.id)}">
          <span class="dot" aria-hidden="true">${esc((t.categoria || "?").charAt(0).toUpperCase())}</span>
          <span class="txt"><span class="d">${esc(t.descricao || t.categoria)}</span><span class="m">${chips}${esc(t.categoria)} · ${esc(t.conta || "")}</span></span>
          <span class="a num">${t.tipo === "receita" ? "+" : "−"}${money(t.valor_centavos)}${pend.has(t.id) ? `<span class="pend">a sincronizar</span>` : ""}</span></button>`;
      }
      h += `</div>`;
    }
    $("list").innerHTML = h;
  }

  /* ---------- aba Investimentos ---------- */
  function renderInvest() {
    const pos = calcPosicoes();
    const abertas = pos.filter(p => p.qtd > 0), fechadas = pos.filter(p => p.qtd === 0);
    const cxs = calcCaixinhas();
    const M = state.mercado;

    let acoesValor = 0, acoesCusto = 0, semCot = 0;
    for (const p of abertas) { acoesCusto += p.custo; if (p.valor != null) acoesValor += p.valor; else { acoesValor += p.custo; semCot++; } }
    const acoesRes = acoesValor - acoesCusto;
    const rfSaldo = cxs.reduce((s, c) => s + c.saldo, 0), rfRend = cxs.reduce((s, c) => s + c.rendimento, 0);

    $("invTotal").textContent = money(acoesValor + rfSaldo);
    $("invAcoes").textContent = money(acoesValor);
    $("invAcoesSub").innerHTML = abertas.length
      ? `<span class="num ${signCls(acoesRes)}">${moneySigned(acoesRes)}${acoesCusto > 0 ? ` (${pctSigned(acoesRes / acoesCusto * 100)})` : ""}</span>`
      : "nenhuma ação";
    $("invRf").textContent = money(rfSaldo);
    $("invRfSub").innerHTML = cxs.length ? `<span class="num ${signCls(rfRend)}">${moneySigned(rfRend)}</span> de rendimento` : "nenhuma caixinha";

    document.querySelectorAll("[data-sub]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.sub === state.invSub)));
    $("acoesPanel").hidden = state.invSub !== "acoes";
    $("rfPanel").hidden = state.invSub !== "rf";

    // informações de cotação
    const horarios = abertas.map(p => p.cot && p.cot.horario).filter(Boolean).sort();
    const ult = horarios[horarios.length - 1];
    $("cotInfo").textContent = M.carregando ? "Buscando cotações…"
      : M.erro ? M.erro
      : ult ? `Preços de ${new Date(ult).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · B3 com atraso de até 15 min`
      : abertas.length ? "Toque em Atualizar para buscar as cotações." : "";
    $("btnCot").disabled = M.carregando || !abertas.length;

    if (!pos.length) {
      $("acoesList").innerHTML = `<div class="empty"><strong>Nenhuma ação ainda</strong>Registre suas compras com ticker, quantidade, preço e data. O app calcula o preço médio e busca a cotação.<br><button class="btn primary" type="button" data-act="nova-op">Registrar compra</button></div>`;
    } else {
      let h = `<div class="rows">` + abertas.map(p => {
        const dia = p.diaPct != null ? ` · <span class="${signCls(p.diaPct * 100)}">${pctSigned(p.diaPct)}</span> hoje` : "";
        const dir = p.resultado != null
          ? `<span class="v num">${money(p.valor)}</span><span class="s num ${signCls(p.resultado)}"><span class="hide-sm">${moneySigned(p.resultado)} · </span>${p.resultadoPct != null ? pctSigned(p.resultadoPct) : moneySigned(p.resultado)}</span>`
          : `<span class="v num">${money(p.custo)}</span><span class="s"><span class="chip-s ${p.erro ? "bad" : ""}">${p.erro ? "sem cotação" : "custo"}</span></span>`;
        return `<button type="button" class="irow" data-ticker="${esc(p.ticker)}">
          <span class="badge">${esc(p.ticker)}</span>
          <span><span class="t1" style="display:block">${fmtQtd(p.qtd)} un. · PM ${money(p.pm)}</span>
          <span class="t2" style="display:block">${p.cot ? `${reais(p.cot.preco)}${dia}` : esc(p.erro ? "sem cotação para este ticker" : "aguardando cotação")}</span></span>
          <span class="r">${dir}</span></button>`;
      }).join("") + `</div>`;
      if (fechadas.length) {
        h += `<div class="label sec-label">Posições encerradas</div><div class="rows">` + fechadas.map(p => `
          <button type="button" class="irow off" data-ticker="${esc(p.ticker)}">
            <span class="badge">${esc(p.ticker)}</span>
            <span><span class="t1" style="display:block">${esc(p.ticker)}</span><span class="t2" style="display:block">${plural(p.ops.length, "operação", "operações")} · resultado realizado</span></span>
            <span class="r"><span class="v num ${signCls(p.realizado)}">${moneySigned(p.realizado)}</span></span></button>`).join("") + `</div>`;
      }
      $("acoesList").innerHTML = h;
    }

    // renda fixa
    const anual = cdiAnual();
    $("cdiInfo").textContent = M.carregando && state.invSub === "rf" ? "Buscando CDI…"
      : anual != null ? `CDI atual: ${pct(anual)} ao ano · saldos brutos, antes do IR`
      : cxs.length ? "O saldo aparece sem rendimento até o CDI ser carregado." : "";
    if (!cxs.length) {
      $("rfList").innerHTML = `<div class="empty"><strong>Nenhuma caixinha ainda</strong>Crie uma caixinha, informe quanto do CDI ela rende e registre os aportes. O saldo é estimado dia a dia.<br><button class="btn primary" type="button" data-act="nova-cx">Criar caixinha</button></div>`;
    } else {
      $("rfList").innerHTML = `<div class="rows">` + cxs.map(c => `
        <button type="button" class="irow" data-cx="${esc(c.cx.id)}">
          <span class="badge">${esc(numIn(c.cx.percentual_cdi))}%<br>CDI</span>
          <span><span class="t1" style="display:block">${esc(c.cx.nome)}</span>
          <span class="t2" style="display:block">aportou ${money(c.aportado)}</span></span>
          <span class="r"><span class="v num">${money(c.saldo)}</span><span class="s num ${signCls(c.rendimento)}">${c.estimado ? `${moneySigned(c.rendimento)}` : `<span class="chip-s">sem CDI</span>`}</span></span>
        </button>`).join("") + `</div>`;
    }
  }

  /* ---------- aba Metas ---------- */
  function renderMetas() {
    const m = state.month, meta = state.prefs.meta_mensal_centavos;
    const g = gastosMes(m);
    const atual = m === curMonth();
    const diasRest = atual ? daysInMonth(m) - Number(todayISO().slice(8)) + 1 : 0;
    let h = `<div class="head-txt"><h2>Meta de gastos de ${esc(monthLower(m))}</h2><span class="hint">A mesma meta vale para todos os meses. Os gastos fixos já entram desde o dia 1º.</span></div>`;
    if (meta) {
      const p = g.total / meta * 100, resta = meta - g.total;
      h += `<div class="goal-big"><span class="num ${p > 100 ? "neg" : ""}">${money(g.total)}</span><span class="of">de ${money(meta)} · ${Math.round(p)}%</span></div>${meter(p, true)}
        <div class="goal-stats">
          <div><span class="label">${resta >= 0 ? "Ainda pode gastar" : "Passou da meta"}</span><span class="v ${resta < 0 ? "neg" : "pos"}">${money(Math.abs(resta))}</span></div>
          <div><span class="label">Por dia até o fim</span><span class="v">${atual && resta > 0 ? money(resta / diasRest) : "—"}</span></div>
          <div><span class="label">Gastos fixos</span><span class="v">${money(g.fixos)}</span></div>
        </div>`;
    } else {
      h += `<p class="muted" style="margin:10px 0 0">Defina quanto quer gastar por mês. Neste mês você já gastou <b class="num">${money(g.total)}</b>.</p>`;
    }
    h += `<form class="goal-edit" id="metaGeralForm" novalidate>
        <label class="money-in" for="metaGeralIn"><span>R$</span><input id="metaGeralIn" inputmode="decimal" autocomplete="off" placeholder="Ex.: 3.000,00" value="${esc(centsIn(meta))}" aria-label="Meta de gastos do mês"></label>
        <button class="btn primary" type="submit">${meta ? "Atualizar meta" : "Definir meta"}</button>
        ${meta ? `<button class="btn" type="button" data-act="tirar-meta">Remover</button>` : ""}
      </form>`;
    const el = $("metaGeral");
    if (!el.contains(document.activeElement)) el.innerHTML = h;

    // por categoria
    const cats = [...new Set([...state.prefs.categorias_despesa, ...Object.keys(state.prefs.metas_categoria), ...Object.keys(g.porCat)])];
    const box = $("metasCats");
    if (box.contains(document.activeElement)) return; // não atrapalha quem está digitando
    box.innerHTML = cats.map(c => {
      const mc = state.prefs.metas_categoria[c] || 0, gasto = g.porCat[c] || 0;
      const p = mc ? gasto / mc * 100 : 0;
      return `<div class="gcat">
        <div style="min-width:0"><div class="n">${esc(c)}</div><div class="s">${mc ? `${money(gasto)} de ${money(mc)}${p > 100 ? ` · <span class="neg">passou ${money(gasto - mc)}</span>` : ""}` : `${money(gasto)} gasto · sem meta`}</div></div>
        <label class="money-in"><span>R$</span><input data-cat="${esc(c)}" inputmode="decimal" autocomplete="off" placeholder="sem meta" value="${esc(centsIn(mc))}" aria-label="Meta de ${esc(c)}"></label>
        ${mc ? meter(p) : ""}
      </div>`;
    }).join("");
  }

  /* ---------- aba Fixos ---------- */
  function renderFixos() {
    const m = state.month, atual = curMonth();
    const fixos = state.data.gastos_fixos.slice().sort((a, b) => (b.ativo - a.ativo) || a.dia - b.dia || a.descricao.localeCompare(b.descricao));
    const ativos = fixos.filter(f => f.ativo);
    const totalAtivos = ativos.reduce((s, f) => s + f.valor_centavos, 0);
    const lancMes = monthRows(m).filter(r => r.fixo_id);
    const totalLanc = lancMes.reduce((s, r) => s + r.valor_centavos, 0);
    const receitas = monthRows(m).filter(r => r.tipo === "receita").reduce((s, r) => s + r.valor_centavos, 0);

    $("fxTotal").textContent = money(totalAtivos);
    $("fxTotalSub").textContent = plural(ativos.length, "gasto ativo", "gastos ativos");
    $("fxLancLabel").textContent = `Lançados em ${monthLower(m)}`;
    $("fxLanc").textContent = money(totalLanc);
    $("fxLancSub").textContent = `${lancMes.length} de ${ativos.length} fixos`;
    $("fxPeso").textContent = receitas ? pct(totalAtivos / receitas * 100) : "—";
    $("fxPesoSub").textContent = receitas ? `das receitas de ${monthLower(m)}` : "sem receitas no mês";

    if (!fixos.length) {
      $("fixosList").innerHTML = `<div class="empty"><strong>Nenhum gasto fixo ainda</strong>Cadastre aluguel, internet, assinaturas e outras contas que se repetem. Eles entram sozinhos todo mês.<br><button class="btn primary" type="button" data-act="novo-fx">Adicionar gasto fixo</button></div>`;
      return;
    }
    let pendentes = 0;
    let h = `<div class="rows">` + fixos.map(f => {
      const l = fixoLancado(f, m);
      let chip;
      if (l) chip = `<span class="chip-s ok">lançado ${esc(dateBR(l.data).slice(0, 5))}</span>`;
      else if (!f.ativo) chip = `<span class="chip-s">pausado</span>`;
      else if (m > atual) chip = `<span class="chip-s info">entra em 1º/${esc(m.slice(5))}</span>`;
      else { chip = `<span class="chip-s warn">não lançado</span>`; pendentes++; }
      return `<button type="button" class="irow${f.ativo ? "" : " off"}" data-fx="${esc(f.id)}">
        <span class="badge">dia<br>${pad(f.dia)}</span>
        <span><span class="t1" style="display:block">${esc(f.descricao)}</span><span class="t2" style="display:block">${esc(f.categoria)} · ${esc(f.conta)}</span></span>
        <span class="r"><span class="v num">${money(f.valor_centavos)}</span><span class="s">${chip}</span></span></button>`;
    }).join("") + `</div>`;
    if (pendentes) h += `<div class="panel-actions"><button type="button" class="btn" data-act="lancar-pendentes">Lançar ${plural(pendentes, "pendente", "pendentes")} em ${esc(monthLower(m))}</button></div>`;
    $("fixosList").innerHTML = h;
  }

  /* ================= folhas (formulários) ================= */
  const SCRIMS = ["txScrim", "opScrim", "detScrim", "cxScrim", "movScrim", "fxScrim", "menuScrim", "catScrim"];
  function closeAll() {
    SCRIMS.forEach(id => { $(id).hidden = true; });
    state.edit = { tx: null, op: null, cx: null, mov: null, fx: null };
    $("logoutZone").innerHTML = "";
  }
  function openSheet(id, focusId) {
    $(id).hidden = false;
    if (focusId) setTimeout(() => { const el = $(focusId); if (el) el.focus(); }, 60);
  }
  function voltar() {
    const v = state.voltar; state.voltar = null;
    if (v) openDetalhe(v);
  }
  function fillSelect(sel, items, value) {
    const list = items.slice();
    if (value && !list.includes(value)) list.push(value);
    sel.innerHTML = list.map(v => `<option${v === value ? " selected" : ""}>${esc(v)}</option>`).join("");
  }
  function setSwitch(groupId, value) {
    document.querySelectorAll(`#${groupId} button`).forEach(b => b.setAttribute("aria-pressed", String(b.dataset.t === value)));
  }
  const switchVal = groupId => document.querySelector(`#${groupId} button[aria-pressed="true"]`)?.dataset.t;

  // Excluir com confirmação dentro da folha
  const DEL = {
    tx: { ask: "Excluir de vez?", run: () => { const r = state.edit.tx; closeAll(); if (r) { deleteLocal("lancamentos", r.id); toast("Lançamento excluído"); } } },
    op: { ask: "Excluir operação?", run: () => { const r = state.edit.op; closeAll(); if (r) { deleteLocal("acoes_ops", r.id); toast("Operação excluída"); } voltar(); } },
    mov: { ask: "Excluir movimento?", run: () => { const r = state.edit.mov; closeAll(); if (r) { deleteLocal("caixinha_movs", r.id); toast("Movimento excluído"); } voltar(); } },
    cx: {
      ask: "Excluir a caixinha e todos os movimentos?",
      run: () => {
        const r = state.edit.cx; closeAll(); state.voltar = null;
        if (r) { state.data.caixinha_movs = state.data.caixinha_movs.filter(m => m.caixinha_id !== r.id); deleteLocal("caixinhas", r.id); toast("Caixinha excluída"); }
      }
    },
    fx: { ask: "Excluir este gasto fixo? Os lançamentos já feitos continuam.", run: () => { const r = state.edit.fx; closeAll(); if (r) { deleteLocal("gastos_fixos", r.id); toast("Gasto fixo excluído"); } } }
  };
  function resetDel(kind, show) {
    const z = document.querySelector(`.del-zone[data-del="${kind}"]`);
    z.innerHTML = show ? `<button type="button" class="btn danger" data-act="ask">Excluir</button>` : "";
  }

  /* ---------- lançamento ---------- */
  function catsFor(tipo) { return tipo === "receita" ? state.prefs.categorias_receita : state.prefs.categorias_despesa; }
  function setTxType(t) {
    setSwitch("txType", t);
    const cur = $("fCat").value, cats = catsFor(t), ed = state.edit.tx;
    fillSelect($("fCat"), cats, ed && ed.tipo === t ? ed.categoria : (cats.includes(cur) ? cur : cats[0]));
  }
  function openTx(row) {
    closeAll();
    state.edit.tx = row || null;
    $("txTitle").textContent = row ? "Editar lançamento" : "Novo lançamento";
    $("fAmount").value = row ? centsIn(row.valor_centavos) : "";
    $("fDesc").value = row ? (row.descricao || "") : "";
    $("fDate").value = row ? row.data : (state.month === curMonth() ? todayISO() : `${state.month}-01`);
    fillSelect($("fAcct"), state.prefs.contas, row ? row.conta : state.prefs.contas[0]);
    $("fCat").innerHTML = "";
    setTxType(row ? row.tipo : "despesa");
    const fx = row && row.fixo_id ? state.data.gastos_fixos.find(f => f.id === row.fixo_id) : null;
    $("txNote").hidden = !(row && row.fixo_id);
    $("txNote").textContent = fx ? `Lançado automaticamente pelo gasto fixo “${fx.descricao}”. Mudar aqui vale só para este mês.` : "Lançado automaticamente por um gasto fixo.";
    $("fErr").textContent = "";
    resetDel("tx", !!row);
    openSheet("txScrim", row ? null : "fAmount");
  }
  function saveTx(ev) {
    ev.preventDefault();
    const cents = parseBRL($("fAmount").value), date = $("fDate").value;
    if (!(cents > 0)) { $("fErr").textContent = "Digite um valor maior que zero, por exemplo 49,90."; $("fAmount").focus(); return; }
    if (cents > 99999999999) { $("fErr").textContent = "Esse valor está alto demais. Confira os dígitos."; return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { $("fErr").textContent = "Escolha a data do lançamento."; return; }
    const now = new Date().toISOString(), ed = state.edit.tx;
    const row = {
      id: ed ? ed.id : uuid(), tipo: switchVal("txType"), valor_centavos: cents,
      descricao: $("fDesc").value.trim().slice(0, 80), categoria: $("fCat").value, conta: $("fAcct").value, data: date,
      fixo_id: ed ? (ed.fixo_id ?? null) : null, criado_em: ed ? ed.criado_em : now, atualizado_em: now
    };
    closeAll();
    if (monthOf(row) !== state.month) state.month = monthOf(row);
    upsertLocal("lancamentos", row);
    toast(salvo() || (ed ? "Lançamento atualizado" : "Lançamento salvo"));
  }

  /* ---------- operação de ação ---------- */
  function openOp(op, preset = {}) {
    closeAll();
    state.edit.op = op || null;
    $("opTitle").textContent = op ? "Editar operação" : "Nova operação";
    setSwitch("opType", op ? op.tipo : (preset.tipo || "compra"));
    $("oTicker").value = op ? op.ticker : (preset.ticker || "");
    $("oQtd").value = op ? numIn(op.quantidade) : "";
    $("oPreco").value = op ? numIn(op.preco) : "";
    $("oData").value = op ? op.data : todayISO();
    $("oTaxas").value = op ? centsIn(op.taxas_centavos) : "";
    $("tickersList").innerHTML = [...new Set(state.data.acoes_ops.map(o => o.ticker))].sort().map(t => `<option value="${esc(t)}">`).join("");
    $("oErr").textContent = "";
    resetDel("op", !!op);
    opTotal();
    openSheet("opScrim", op ? null : (preset.ticker ? "oQtd" : "oTicker"));
  }
  function opTotal() {
    const q = parseNum($("oQtd").value), p = parseNum($("oPreco").value), tx = parseBRL($("oTaxas").value) || 0;
    const ok = q > 0 && p > 0;
    $("opTotal").textContent = ok ? `Total da operação: ${money(q * p * 100 + (switchVal("opType") === "compra" ? tx : -tx))}${tx ? " (com taxas)" : ""}` : "Ações, FIIs e ETFs da B3. O preço médio é recalculado a cada compra.";
  }
  function saveOp(ev) {
    ev.preventDefault();
    const tipo = switchVal("opType"), ed = state.edit.op;
    const ticker = $("oTicker").value.trim().toUpperCase().replace(/\.SA$/, "");
    const q = parseNum($("oQtd").value), p = parseNum($("oPreco").value), data = $("oData").value;
    const taxasTxt = $("oTaxas").value.trim(), taxas = taxasTxt ? parseBRL(taxasTxt) : 0;
    const err = m => { $("oErr").textContent = m; };
    if (!/^[A-Z0-9.^=-]{1,15}$/.test(ticker)) return err("Digite o código da ação, por exemplo PETR4.");
    if (!(q > 0)) return err("Digite a quantidade, por exemplo 100.");
    if (!(p > 0)) return err("Digite o preço por ação, por exemplo 32,50.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) return err("Escolha a data da operação.");
    if (!(taxas >= 0)) return err("As taxas precisam ser um valor como 4,90, ou fique em branco.");
    if (tipo === "venda") {
      let disp = 0;
      for (const o of state.data.acoes_ops) if (o.ticker === ticker && (!ed || o.id !== ed.id)) disp += o.tipo === "compra" ? o.quantidade : -o.quantidade;
      if (q > disp + 1e-9) return err(disp > 0 ? `Você tem só ${fmtQtd(disp)} ${ticker} em carteira.` : `Você não tem ${ticker} em carteira para vender.`);
    }
    const now = new Date().toISOString();
    const novoTicker = !state.data.acoes_ops.some(o => o.ticker === ticker);
    const row = { id: ed ? ed.id : uuid(), ticker, tipo, quantidade: q, preco: p, taxas_centavos: taxas, data, criado_em: ed ? ed.criado_em : now, atualizado_em: now };
    closeAll();
    upsertLocal("acoes_ops", row);
    toast(salvo() || (ed ? "Operação atualizada" : tipo === "compra" ? `Compra de ${ticker} registrada` : `Venda de ${ticker} registrada`));
    if (novoTicker) atualizarMercado(false);
    if (state.voltar) voltar();
  }

  /* ---------- caixinha ---------- */
  function openCx(cx) {
    closeAll();
    state.edit.cx = cx || null;
    $("cxTitle").textContent = cx ? "Editar caixinha" : "Nova caixinha";
    $("cNome").value = cx ? cx.nome : "";
    $("cPct").value = cx ? numIn(cx.percentual_cdi) : "100";
    $("cErr").textContent = "";
    resetDel("cx", !!cx);
    openSheet("cxScrim", cx ? null : "cNome");
  }
  function saveCx(ev) {
    ev.preventDefault();
    const nome = $("cNome").value.trim(), pctCdi = parseNum($("cPct").value), ed = state.edit.cx;
    if (!nome) { $("cErr").textContent = "Dê um nome para a caixinha."; return; }
    if (!(pctCdi > 0 && pctCdi <= 1000)) { $("cErr").textContent = "Informe quanto do CDI ela rende, por exemplo 100."; return; }
    const now = new Date().toISOString();
    const row = { id: ed ? ed.id : uuid(), nome: nome.slice(0, 60), percentual_cdi: Math.round(pctCdi * 100) / 100, criado_em: ed ? ed.criado_em : now, atualizado_em: now };
    closeAll();
    upsertLocal("caixinhas", row);
    if (ed) { toast(salvo() || "Caixinha atualizada"); voltar(); }
    else { toast(salvo() || "Caixinha criada. Agora registre o primeiro aporte."); openMov(null, { caixinha: row.id }); }
  }

  /* ---------- aporte / resgate ---------- */
  function openMov(mov, preset = {}) {
    if (!state.data.caixinhas.length) { openCx(); return; }
    closeAll();
    state.edit.mov = mov || null;
    const tipo = mov ? mov.tipo : (preset.tipo || "aporte");
    setSwitch("movType", tipo);
    $("movTitle").textContent = mov ? "Editar movimento" : (tipo === "aporte" ? "Novo aporte" : "Novo resgate");
    $("mValor").value = mov ? centsIn(mov.valor_centavos) : "";
    $("mData").value = mov ? mov.data : todayISO();
    const cxId = mov ? mov.caixinha_id : (preset.caixinha || state.data.caixinhas[0].id);
    $("mCx").innerHTML = state.data.caixinhas.map(c => `<option value="${esc(c.id)}"${c.id === cxId ? " selected" : ""}>${esc(c.nome)}</option>`).join("");
    $("mErr").textContent = "";
    resetDel("mov", !!mov);
    openSheet("movScrim", mov ? null : "mValor");
  }
  function saveMov(ev) {
    ev.preventDefault();
    const cents = parseBRL($("mValor").value), data = $("mData").value, ed = state.edit.mov;
    if (!(cents > 0)) { $("mErr").textContent = "Digite um valor maior que zero, por exemplo 500,00."; return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) { $("mErr").textContent = "Escolha a data do movimento."; return; }
    const now = new Date().toISOString(), tipo = switchVal("movType");
    const row = { id: ed ? ed.id : uuid(), caixinha_id: $("mCx").value, tipo, valor_centavos: cents, data, criado_em: ed ? ed.criado_em : now, atualizado_em: now };
    const cdiAntes = state.mercado.cdiDesde;
    closeAll();
    upsertLocal("caixinha_movs", row);
    toast(salvo() || (ed ? "Movimento atualizado" : tipo === "aporte" ? "Aporte registrado" : "Resgate registrado"));
    if (!cdiAntes || data < cdiAntes) atualizarMercado(false);
    if (state.voltar) voltar();
  }

  /* ---------- gasto fixo ---------- */
  function openFx(f) {
    closeAll();
    state.edit.fx = f || null;
    $("fxTitle").textContent = f ? "Editar gasto fixo" : "Novo gasto fixo";
    $("xValor").value = f ? centsIn(f.valor_centavos) : "";
    $("xDesc").value = f ? f.descricao : "";
    fillSelect($("xCat"), state.prefs.categorias_despesa, f ? f.categoria : state.prefs.categorias_despesa[0]);
    fillSelect($("xAcct"), state.prefs.contas, f ? f.conta : state.prefs.contas[0]);
    $("xDia").value = f ? f.dia : "";
    $("xAtivo").checked = f ? !!f.ativo : true;
    $("xAgoraWrap").hidden = !!f;
    $("xAgora").checked = true;
    $("xAgoraTxt").textContent = `Lançar também em ${monthLower(curMonth())} (desmarque se já lançou esse gasto neste mês)`;
    $("xNote").hidden = !f;
    $("xNote").textContent = "Mudanças valem a partir do próximo lançamento. O que já foi lançado você edita na aba Mês.";
    $("xErr").textContent = "";
    resetDel("fx", !!f);
    openSheet("fxScrim", f ? null : "xValor");
  }
  function saveFx(ev) {
    ev.preventDefault();
    const cents = parseBRL($("xValor").value), desc = $("xDesc").value.trim(), dia = Number($("xDia").value), ed = state.edit.fx;
    const err = m => { $("xErr").textContent = m; };
    if (!(cents > 0)) return err("Digite o valor, por exemplo 1.850,00.");
    if (!desc) return err("Dê um nome, por exemplo Aluguel.");
    if (!(Number.isInteger(dia) && dia >= 1 && dia <= 31)) return err("O dia do vencimento vai de 1 a 31.");
    const now = new Date().toISOString(), atual = curMonth(), ativo = $("xAtivo").checked;
    const row = {
      id: ed ? ed.id : uuid(), descricao: desc.slice(0, 80), valor_centavos: cents, categoria: $("xCat").value, conta: $("xAcct").value,
      dia, ativo, ultimo_mes_lancado: ed ? (ed.ultimo_mes_lancado ?? null) : atual, criado_em: ed ? ed.criado_em : now, atualizado_em: now
    };
    const lancarAgora = !ed && ativo && $("xAgora").checked;
    closeAll();
    upsertLocal("gastos_fixos", row, { quiet: true });
    if (lancarAgora && !fixoLancado(row, atual)) upsertLocal("lancamentos", lancDoFixo(row, atual, now), { quiet: true });
    persist(); render(); requestSync();
    toast(salvo() || (ed ? "Gasto fixo atualizado" : lancarAgora ? `Gasto fixo criado e lançado em ${monthLower(atual)}` : "Gasto fixo criado"));
  }
  function lancarPendentes() {
    const m = state.month, now = new Date().toISOString();
    let n = 0;
    for (const f of state.data.gastos_fixos) {
      if (!f.ativo || fixoLancado(f, m)) continue;
      upsertLocal("lancamentos", lancDoFixo(f, m, now), { quiet: true });
      n++;
    }
    if (n) { persist(); render(); requestSync(); toast(`${plural(n, "gasto fixo lançado", "gastos fixos lançados")} em ${monthLower(m)}`); }
  }

  /* ---------- detalhes de ação ou caixinha ---------- */
  function openDetalhe(det) {
    closeAll();
    state.det = det;
    renderDetalhe();
    if (state.det) openSheet("detScrim");
  }
  function renderDetalhe() {
    const det = state.det; if (!det) return;
    if (det.kind === "acao") {
      const p = calcPosicoes().find(x => x.ticker === det.ticker);
      if (!p) { $("detScrim").hidden = true; state.det = null; return; }
      $("detTitle").textContent = p.ticker;
      $("detSub").textContent = p.cot ? p.cot.nome : (p.erro ? `Sem cotação: ${p.erro}` : "");
      const kv = [
        ["Quantidade", fmtQtd(p.qtd)],
        ["Preço médio", p.qtd > 0 ? money(p.pm) : "—"],
        ["Cotação", p.cot ? `${reais(p.cot.preco)}${p.diaPct != null ? ` <span class="${signCls(p.diaPct * 100)}">(${pctSigned(p.diaPct)})</span>` : ""}` : "—"],
        ["Valor atual", p.valor != null ? money(p.valor) : "—"],
        ["Total investido", money(p.custo)],
        ["Resultado", p.resultado != null ? `<span class="${signCls(p.resultado)}">${moneySigned(p.resultado)}${p.resultadoPct != null ? ` (${pctSigned(p.resultadoPct)})` : ""}</span>` : "—"]
      ];
      if (Math.abs(p.realizado) > 0.5) kv.push(["Lucro em vendas", `<span class="${signCls(p.realizado)}">${moneySigned(p.realizado)}</span>`]);
      let h = `<div class="kv">${kv.map(([k, v]) => `<div><span class="label">${k}</span><span class="v">${v}</span></div>`).join("")}</div>`;
      if (p.aviso) h += `<p class="hint" style="color:var(--warn);margin:0 0 10px">${esc(p.aviso)}. Confira as datas e quantidades.</p>`;
      h += `<div class="label sec-label">Operações</div><div class="det-list rows">` + p.ops.slice().sort(byDateDesc).map(o => `
        <button type="button" class="irow" data-op="${esc(o.id)}">
          <span class="chip-s ${o.tipo === "compra" ? "ok" : "bad"}">${o.tipo}</span>
          <span><span class="t1" style="display:block">${fmtQtd(o.quantidade)} × ${reais(o.preco)}</span><span class="t2" style="display:block">${dateBR(o.data)}${o.taxas_centavos ? ` · taxas ${money(o.taxas_centavos)}` : ""}</span></span>
          <span class="r"><span class="v num">${money(o.quantidade * o.preco * 100)}</span></span></button>`).join("") + `</div>
        <div class="det-actions"><button type="button" class="btn primary" data-act="comprar">Comprar mais</button>${p.qtd > 0 ? `<button type="button" class="btn" data-act="vender">Vender</button>` : ""}</div>`;
      $("detBody").innerHTML = h;
    } else {
      const c = calcCaixinhas().find(x => x.cx.id === det.id);
      if (!c) { $("detScrim").hidden = true; state.det = null; return; }
      $("detTitle").textContent = c.cx.nome;
      $("detSub").textContent = `Rende ${numIn(c.cx.percentual_cdi)}% do CDI`;
      const rent = c.aportado > 0 ? c.rendimento / c.aportado * 100 : null;
      const kv = [
        ["Saldo estimado", money(c.saldo)],
        ["Total aportado", money(c.aportado)],
        ["Rendimento bruto", c.estimado ? `<span class="${signCls(c.rendimento)}">${moneySigned(c.rendimento)}</span>` : "—"],
        ["Rentabilidade", c.estimado && rent != null ? pctSigned(rent) : "—"]
      ];
      let h = `<div class="kv">${kv.map(([k, v]) => `<div><span class="label">${k}</span><span class="v">${v}</span></div>`).join("")}</div>`;
      h += `<div class="label sec-label">Movimentos</div>`;
      h += c.movs.length ? `<div class="det-list rows">` + c.movs.slice().sort(byDateDesc).map(m => `
        <button type="button" class="irow" data-mov="${esc(m.id)}">
          <span class="chip-s ${m.tipo === "aporte" ? "ok" : "bad"}">${m.tipo}</span>
          <span><span class="t1" style="display:block">${dateBR(m.data)}</span></span>
          <span class="r"><span class="v num ${m.tipo === "aporte" ? "pos" : "neg"}">${m.tipo === "aporte" ? "+" : "−"}${money(m.valor_centavos)}</span></span></button>`).join("") + `</div>`
        : `<div class="empty small">Nenhum movimento ainda.</div>`;
      h += `<div class="det-actions"><button type="button" class="btn primary" data-act="aporte">Aporte</button><button type="button" class="btn" data-act="resgate">Resgate</button><button type="button" class="btn" data-act="editar-cx">Editar caixinha</button></div>`;
      $("detBody").innerHTML = h;
    }
  }

  /* ================= categorias e contas ================= */
  const XICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>`;
  const listFor = key => state.prefs[key];
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
    const tx = monthRows().sort(byDateAsc);
    if (!tx.length) { toast("Não há lançamentos neste mês para exportar."); return; }
    const q = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [["Data", "Tipo", "Descrição", "Categoria", "Conta", "Valor"].join(";")];
    for (const t of tx) {
      const v = (t.tipo === "receita" ? 1 : -1) * t.valor_centavos / 100;
      lines.push([dateBR(t.data), t.tipo === "receita" ? "Receita" : "Despesa", q(t.descricao), q(t.categoria), q(t.conta), v.toFixed(2).replace(".", ",")].join(";"));
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
    if (state.user) { const u = state.user.id; [K.rows(u), K.data(u), K.prefs(u), K.outbox(u), K.synced(u), K.mercado(u)].forEach(k => store.del(k)); }
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
        /invalid path|PGRST125|requested path is invalid/i.test(m) ? "O endereço do Supabase no config.js está errado. Use só https://SEU-PROJETO.supabase.co" :
        /invalid api key|no api key/i.test(m) ? "A chave do config.js não foi aceita. Copie de novo a Publishable key do Supabase." :
        (m || "Não foi possível entrar.");
    } finally { btn.disabled = false; btn.textContent = "Entrar"; }
  }

  function startSession(session) {
    const u = { id: session.user.id, email: session.user.email || "" };
    if (!state.user || state.user.id !== u.id) loadUser(u);
    state.user = u;
    store.set(K.last, u);
    state.online = true;
    show("app"); render(); openFromHash();
    requestSync();
  }

  function openFromHash() {
    const h = location.hash.replace("#", "");
    if (h === "novo") { setTab("mes", { keepHash: true }); history.replaceState(null, "", location.pathname + location.search); openTx(); }
    else if (TABS.includes(h)) setTab(h, { keepHash: true });
    else setTab(state.tab, { keepHash: true, keepScroll: true });
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
  $("btnAdd").onclick = addForTab;
  $("fab").onclick = addForTab;
  document.querySelectorAll("[data-tab]").forEach(b => { b.onclick = () => setTab(b.dataset.tab); });
  document.querySelectorAll("[data-sub]").forEach(b => {
    b.onclick = () => { state.invSub = b.dataset.sub; renderInvest(); updateAddButtons(); atualizarMercado(false); };
  });
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
  $("btnCot").onclick = () => atualizarMercado(true);
  $("btnNovaCx").onclick = () => openCx();
  $("mesMeta").onclick = () => setTab("metas");

  // Painel
  document.querySelectorAll("[data-per]").forEach(b => {
    b.onclick = () => { state.periodo = Number(b.dataset.per); store.set("cad:v1:periodo", state.periodo); renderPainel(); };
  });
  document.querySelectorAll("[data-tabela]").forEach(b => {
    b.onclick = () => {
      const k = b.dataset.tabela;
      state.tabela[k] = !state.tabela[k];
      b.textContent = state.tabela[k] ? "Ver gráfico" : "Ver tabela";
      renderPainel();
    };
  });
  $("tab-painel").addEventListener("click", e => { if (e.target.closest('[data-act="ir-invest"]')) setTab("investimentos"); });
  document.addEventListener("pointerdown", e => {
    if (e.target.closest(".chart")) return;
    document.querySelectorAll(".chart").forEach(c => { if (c._esconder) c._esconder(); });
  });
  let resizeT;
  window.addEventListener("resize", () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => { if (state.tab === "painel" && !$("screen-app").hidden) renderPainel(); }, 150);
  });

  // Mês
  $("q").addEventListener("input", e => { state.q = e.target.value; renderList(monthRows()); });
  document.querySelectorAll(".seg button[data-f]").forEach(b => b.onclick = () => {
    state.filter = b.dataset.f;
    document.querySelectorAll(".seg button[data-f]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    renderList(monthRows());
  });
  $("list").addEventListener("click", e => {
    if (e.target.closest("[data-new]")) return openTx();
    const b = e.target.closest(".tx"); if (!b) return;
    const t = state.data.lancamentos.find(x => x.id === b.dataset.id); if (t) openTx(t);
  });

  // Investimentos
  $("acoesList").addEventListener("click", e => {
    if (e.target.closest('[data-act="nova-op"]')) return openOp();
    const b = e.target.closest("[data-ticker]"); if (b) openDetalhe({ kind: "acao", ticker: b.dataset.ticker });
  });
  $("rfList").addEventListener("click", e => {
    if (e.target.closest('[data-act="nova-cx"]')) return openCx();
    const b = e.target.closest("[data-cx]"); if (b) openDetalhe({ kind: "cx", id: b.dataset.cx });
  });
  $("detBody").addEventListener("click", e => {
    const det = state.det; if (!det) return;
    const op = e.target.closest("[data-op]"), mov = e.target.closest("[data-mov]"), act = e.target.closest("[data-act]")?.dataset.act;
    if (op) { const o = state.data.acoes_ops.find(x => x.id === op.dataset.op); if (o) { state.voltar = det; openOp(o); } }
    else if (mov) { const m = state.data.caixinha_movs.find(x => x.id === mov.dataset.mov); if (m) { state.voltar = det; openMov(m); } }
    else if (act === "comprar" || act === "vender") { state.voltar = det; openOp(null, { ticker: det.ticker, tipo: act === "comprar" ? "compra" : "venda" }); }
    else if (act === "aporte" || act === "resgate") { state.voltar = det; openMov(null, { caixinha: det.id, tipo: act }); }
    else if (act === "editar-cx") { const c = state.data.caixinhas.find(x => x.id === det.id); if (c) { state.voltar = det; openCx(c); } }
  });

  // Metas
  $("metaGeral").addEventListener("submit", e => {
    e.preventDefault();
    const raw = $("metaGeralIn").value.trim(), cents = parseBRL(raw);
    if (raw && !(cents > 0)) { toast("Digite a meta como 3.000,00."); return; }
    state.prefs.meta_mensal_centavos = raw ? cents : null;
    document.activeElement?.blur();
    savePrefsLocal(); render();
    toast(raw ? `Meta de ${money(cents)} por mês salva` : "Meta removida");
  });
  $("metaGeral").addEventListener("click", e => {
    if (!e.target.closest('[data-act="tirar-meta"]')) return;
    state.prefs.meta_mensal_centavos = null;
    savePrefsLocal(); render(); toast("Meta removida");
  });
  $("metasCats").addEventListener("change", e => {
    const inp = e.target.closest("input[data-cat]"); if (!inp) return;
    const cat = inp.dataset.cat, raw = inp.value.trim(), cents = parseBRL(raw);
    if (raw && !(cents > 0)) { toast("Digite a meta como 500,00, ou deixe em branco."); return; }
    const metas = { ...state.prefs.metas_categoria };
    if (raw) metas[cat] = cents; else delete metas[cat];
    state.prefs.metas_categoria = metas;
    savePrefsLocal();
    inp.blur(); render();
    toast(raw ? `Meta de ${cat}: ${money(cents)}` : `Meta de ${cat} removida`);
  });
  $("metasCats").addEventListener("keydown", e => { if (e.key === "Enter" && e.target.matches("input[data-cat]")) e.target.blur(); });

  // Fixos
  $("fixosList").addEventListener("click", e => {
    if (e.target.closest('[data-act="novo-fx"]')) return openFx();
    if (e.target.closest('[data-act="lancar-pendentes"]')) return lancarPendentes();
    const b = e.target.closest("[data-fx]"); if (!b) return;
    const f = state.data.gastos_fixos.find(x => x.id === b.dataset.fx); if (f) openFx(f);
  });

  // Formulários
  document.querySelectorAll("#txType button").forEach(b => b.onclick = () => setTxType(b.dataset.t));
  document.querySelectorAll("#opType button").forEach(b => b.onclick = () => { setSwitch("opType", b.dataset.t); opTotal(); });
  document.querySelectorAll("#movType button").forEach(b => b.onclick = () => {
    setSwitch("movType", b.dataset.t);
    if (!state.edit.mov) $("movTitle").textContent = b.dataset.t === "aporte" ? "Novo aporte" : "Novo resgate";
  });
  ["oQtd", "oPreco", "oTaxas"].forEach(id => $(id).addEventListener("input", opTotal));
  $("oTicker").addEventListener("input", e => { const p = e.target.selectionStart; e.target.value = e.target.value.toUpperCase(); e.target.setSelectionRange(p, p); });
  $("txForm").addEventListener("submit", saveTx);
  $("opForm").addEventListener("submit", saveOp);
  $("cxForm").addEventListener("submit", saveCx);
  $("movForm").addEventListener("submit", saveMov);
  $("fxForm").addEventListener("submit", saveFx);
  $("xAtivo").addEventListener("change", () => { $("xAgoraWrap").hidden = !!state.edit.fx || !$("xAtivo").checked; });
  document.querySelectorAll(".del-zone").forEach(z => z.addEventListener("click", e => {
    const kind = z.dataset.del, act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "ask") z.innerHTML = `<span class="confirm">${esc(DEL[kind].ask)} <button type="button" class="btn danger" data-act="yes">Sim, excluir</button><button type="button" class="btn" data-act="no">Não</button></span>`;
    else if (act === "yes") DEL[kind].run();
    else if (act === "no") resetDel(kind, true);
  }));
  document.querySelectorAll(".scrim").forEach(s => s.addEventListener("click", e => {
    if (e.target === s || e.target.closest("[data-close]")) { const back = s.id !== "detScrim" && state.voltar; closeAll(); if (back) voltar(); else { state.voltar = null; state.det = null; } }
  }));
  document.addEventListener("keydown", e => { if (e.key === "Escape") { closeAll(); state.voltar = null; state.det = null; } });

  // Categorias e contas
  $("catEditor").addEventListener("click", e => {
    const b = e.target.closest("[data-rm]"); if (!b) return;
    const list = listFor(b.dataset.rm);
    if (list.length <= 1) { toast("Mantenha pelo menos um item."); return; }
    list.splice(Number(b.dataset.i), 1);
    renderCatEditor(); savePrefsLocal(); render();
  });
  $("catEditor").addEventListener("submit", e => {
    e.preventDefault();
    const f = e.target.closest("[data-add]"); if (!f) return;
    const inp = f.querySelector("input"); const v = inp.value.trim();
    if (!v) return;
    const key = f.dataset.add, list = listFor(key);
    if (list.some(x => x.toLowerCase() === v.toLowerCase())) { toast("Esse item já existe."); return; }
    list.push(v);
    renderCatEditor(); savePrefsLocal(); render();
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
