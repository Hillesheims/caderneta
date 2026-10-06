// Caderneta · função "mercado"
// Busca cotações de ações da B3 (Yahoo Finance) e a série diária do CDI (Banco Central, SGS 12).
// O app chama com o usuário logado; ninguém de fora consegue usar.
const EXIGIR_LOGIN = true;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";

// Cache simples em memória para não bater nas fontes a cada abertura do app.
const cache = new Map<string, { ate: number; valor: unknown }>();
async function emCache<T>(chave: string, ttlMs: number, buscar: () => Promise<T>): Promise<T> {
  const agora = Date.now();
  const guardado = cache.get(chave);
  if (guardado && guardado.ate > agora) return guardado.valor as T;
  const valor = await buscar();
  cache.set(chave, { ate: agora + ttlMs, valor });
  return valor;
}

function responder(corpo: unknown, status = 200) {
  return new Response(JSON.stringify(corpo), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" },
  });
}

// O gateway do Supabase já validou a assinatura do token; aqui só conferimos se é um usuário logado.
function papelDoToken(req: Request): string | null {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const partes = token.split(".");
  if (partes.length !== 3) return null;
  try {
    const b64 = partes[1].replace(/-/g, "+").replace(/_/g, "/");
    const json = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="));
    return JSON.parse(json).role ?? null;
  } catch {
    return null;
  }
}

async function cotacao(ticker: string) {
  const simbolo = /[.^=]/.test(ticker) ? ticker : `${ticker}.SA`;
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(simbolo)}?range=1d&interval=1d`;
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
  if (r.status === 404) throw new Error("ticker não encontrado");
  if (!r.ok) throw new Error(`cotação indisponível (HTTP ${r.status})`);
  const j = await r.json();
  const m = j?.chart?.result?.[0]?.meta;
  if (!m || typeof m.regularMarketPrice !== "number") throw new Error("ticker não encontrado");
  const anterior = typeof m.chartPreviousClose === "number" ? m.chartPreviousClose
    : typeof m.previousClose === "number" ? m.previousClose : null;
  return {
    preco: m.regularMarketPrice,
    anterior,
    moeda: m.currency || "BRL",
    nome: m.longName || m.shortName || ticker,
    horario: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null,
  };
}

// Fechamento de cada mês desde "YYYY-MM" (para a evolução do patrimônio)
async function historico(ticker: string, desde: string) {
  const simbolo = /[.^=]/.test(ticker) ? ticker : `${ticker}.SA`;
  const [y, m] = desde.split("-").map(Number);
  const inicio = Math.floor(Date.UTC(y, m - 1, 1) / 1000) - 3 * 86400;
  const fim = Math.floor(Date.now() / 1000);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(simbolo)}?period1=${inicio}&period2=${fim}&interval=1mo`;
  const r = await fetch(url, { headers: { "User-Agent": UA, "Accept": "application/json" } });
  if (r.status === 404) throw new Error("ticker não encontrado");
  if (!r.ok) throw new Error(`histórico indisponível (HTTP ${r.status})`);
  const j = await r.json();
  const res = j?.chart?.result?.[0];
  const ts: number[] = res?.timestamp || [];
  const fech: (number | null)[] = res?.indicators?.quote?.[0]?.close || [];
  const fuso = typeof res?.meta?.gmtoffset === "number" ? res.meta.gmtoffset : -10800;
  const meses: Record<string, number> = {};
  ts.forEach((t, i) => {
    const c = fech[i];
    if (typeof c === "number" && Number.isFinite(c)) meses[new Date((t + fuso) * 1000).toISOString().slice(0, 7)] = c;
  });
  return meses;
}

const br = (iso: string) => { const [y, m, d] = iso.split("-"); return `${d}/${m}/${y}`; };
const hojeSP = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

async function cdiDiario(desde: string) {
  const hoje = hojeSP();
  const limite = `${Number(hoje.slice(0, 4)) - 10}${hoje.slice(4)}`; // o BC aceita até 10 anos por consulta
  const inicio = desde < limite ? limite : desde;
  if (inicio > hoje) return [];
  const url = `https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados?formato=json&dataInicial=${br(inicio)}&dataFinal=${br(hoje)}`;
  const r = await fetch(url, { headers: { "Accept": "application/json", "User-Agent": UA } });
  if (r.status === 404) return [];
  if (!r.ok) throw new Error(`CDI indisponível (HTTP ${r.status})`);
  const lista = await r.json();
  if (!Array.isArray(lista)) throw new Error("resposta inesperada do Banco Central");
  return lista
    .map((x: { data: string; valor: string }) => {
      const [d, m, y] = String(x.data).split("/");
      return { data: `${y}-${m}-${d}`, taxa: Number(String(x.valor).replace(",", ".")) };
    })
    .filter((x: { taxa: number }) => Number.isFinite(x.taxa));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (EXIGIR_LOGIN && papelDoToken(req) !== "authenticated") {
    return responder({ erro: "Entre no app para ver as cotações." }, 401);
  }

  let pedido: { tickers?: unknown; cdiDesde?: unknown; historico?: { tickers?: unknown; desde?: unknown } } = {};
  if (req.method === "POST") {
    pedido = await req.json().catch(() => ({}));
  } else {
    const u = new URL(req.url);
    pedido = {
      tickers: u.searchParams.get("tickers")?.split(","),
      cdiDesde: u.searchParams.get("cdiDesde") ?? undefined,
      historico: u.searchParams.get("historico") ? { tickers: u.searchParams.get("historico")?.split(","), desde: u.searchParams.get("desde") ?? undefined } : undefined,
    };
  }
  const limpar = (lista: unknown[]) => [...new Set(lista.map((t) => String(t).trim().toUpperCase()))]
    .filter((t) => /^[A-Z0-9.^=-]{1,15}$/.test(t))
    .slice(0, 40);

  const saida: Record<string, unknown> = { geradoEm: new Date().toISOString() };

  if (Array.isArray(pedido.tickers)) {
    const tickers = limpar(pedido.tickers);
    const cotacoes: Record<string, unknown> = {};
    const erros: Record<string, string> = {};
    await Promise.all(tickers.map(async (t) => {
      try { cotacoes[t] = await emCache(`q:${t}`, 60_000, () => cotacao(t)); }
      catch (e) { erros[t] = e instanceof Error ? e.message : String(e); }
    }));
    saida.cotacoes = cotacoes;
    saida.erros = erros;
  }

  if (typeof pedido.cdiDesde === "string" && /^\d{4}-\d{2}-\d{2}$/.test(pedido.cdiDesde)) {
    const desde = pedido.cdiDesde;
    try { saida.cdi = await emCache(`cdi:${desde}`, 3 * 3600_000, () => cdiDiario(desde)); }
    catch (e) { saida.cdiErro = e instanceof Error ? e.message : String(e); }
  }

  const h = pedido.historico;
  if (h && Array.isArray(h.tickers) && typeof h.desde === "string" && /^\d{4}-\d{2}$/.test(h.desde)) {
    const desde = h.desde;
    const hist: Record<string, unknown> = {};
    const erros: Record<string, string> = {};
    await Promise.all(limpar(h.tickers).map(async (t) => {
      try { hist[t] = await emCache(`h:${t}:${desde}`, 6 * 3600_000, () => historico(t, desde)); }
      catch (e) { erros[t] = e instanceof Error ? e.message : String(e); }
    }));
    saida.historico = hist;
    saida.historicoErros = erros;
  }

  return responder(saida);
});
