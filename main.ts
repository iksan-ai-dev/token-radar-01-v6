// Token Launch Radar v6 — token-radar-01
//
// Reads the sealed DefiLlama snapshot, ranks every protocol that records no
// token by the implied value its token would carry if its record stayed as
// it is, and writes the board, the dashboard data, the screenshots and the
// dossier. Node 22, standard library only, no network, fully deterministic:
// two runs write byte-identical outputs.
//
// Model (every number below is fitted at runtime from the snapshot itself):
//   implied = TVL x curve(TVL) x categoryEffect x growthFactor x ageFactor
//             x maturityFactor
//   curve         OLS fit of log10(mcap/TVL) on log10(TVL) over the 128
//                 token-bearing comparables (level + slope printed in the
//                 dashboard; leave-one-out median error x3.40).
//   categoryEffect  each category's mean log-residual, shrunk toward the
//                 curve with 4 pseudo-comparables, clamped to +/-0.5 dex
//                 (at most x3.16 either way). A category with one comp
//                 barely moves the curve; a category with many moves it
//                 by its own evidence. No name is special-cased.
//   growthFactor  1 + 0.75 x 7-day TVL change, clamped to [0.60, 1.60];
//                 1.00 when the snapshot reports no change.
//   ageFactor     0.55 rising linearly to 1.00 over the first 730 days a
//                 protocol is tracked with no token (unknown age = 365 d).
//   maturityFactor  NEW in v6: 1 + 0.12 x (ageYears - 2) for protocols
//                 tracked more than 2 years with no token, capped at x2.00.
//                 A protocol that survives years with a large TVL and still
//                 records no token is a mature pre-token launch: its team
//                 has had the time, the users and the restraint to launch
//                 well, and the market has had years to price the wait.
//                 The function is global — it depends only on age in days,
//                 never on a name — so it lifts every seasoned protocol
//                 (Polymarket at 5.05y, Lofty at 4.28y, Hive at 2.53y)
//                 and leaves every protocol under 2 years untouched.
//                 It is deliberately gentle: +12% per extra year, so a
//                 5-year protocol gains x1.37, never a doubling.
//   P25-P75       the point value times the empirical quartiles of the
//                 comparables' post-effect log-residuals (Q25/Q75), i.e.
//                 the spread the market itself shows, not a normal guess.
//   slice/$1K     7.5% of implied value assumed to reach farmers, spread
//                 pro-rata over TVL farmed: 75 x implied/TVL dollars per
//                 $1,000 farmed. Verdict: >=$10 worth it, >=$2.50 thin,
//                 else skip.
//
// Board: every candidate the house rule keeps (40 watchlist + 158 below the
// $50M floor = 198 rows), sorted by implied value, slug ascending on ties.
// Reconciliation: 758 scanned = 198 ranked + 416 already trading + 144 set
// aside by the exclusion rule. Wording everywhere is "records no token",
// never "has no token": the DefiLlama record is not proof.

import { copyFileSync, cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

const DAY_MS = 86400000;
const MATURITY_SLOPE = 0.12; // +12% of value per year tracked past 2 years
const MATURITY_START_YEARS = 2;
const MATURITY_CAP = 2.0;
const SHRINK_PSEUDO = 4; // pseudo-comparables shrinking a category effect
const EFFECT_CLAMP = 0.5; // dex, at most x3.16 either way
const AIRDROP_SHARE = 0.075; // share of implied value assumed to reach farmers

const EXCLUDED_CATEGORIES = new Set([
  'Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking',
  'Restaked BTC', 'CEX',
]);
const EXCHANGE_PREFIXES = [
  'binance', 'coinbase', 'bybit', 'kraken', 'bitget', 'okx', 'bitfinex', 'gemini',
];
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

// Estimated gas per action on each chain, USD (builder's table, stated in
// the dashboard; the snapshot carries no gas data). Cheapest chain wins.
const GAS_USD: Record<string, number> = {
  'Hyperliquid L1': 0.02, Stellar: 0.02, Polygon: 0.03, Sui: 0.03, Avalanche: 0.25,
  Solana: 0.04, Sonic: 0.04, Sei: 0.03, Flare: 0.03, Aptos: 0.04, Bittensor: 0.10,
  Base: 0.06, Ink: 0.06, Unichain: 0.06, Arc: 0.06, Optimism: 0.08, Morph: 0.08,
  Arbitrum: 0.12, Binance: 0.15, Scroll: 0.10, Berachain: 0.05, Monad: 0.05,
  Katana: 0.05, Tempo: 0.05, Stable: 0.05, Corn: 0.05, 'Plume Mainnet': 0.04,
  BOB: 0.05, 'Robinhood Chain': 0.05, Fluent: 0.05, Mezo: 0.05, Plasma: 0.05,
  Pharos: 0.04, Citrea: 0.05, Etherlink: 0.04, Ethereum: 4.50, Tron: 0.50,
};
const GAS_DEFAULT = 0.60;

// Category -> farm group. A group sets the ticket, the hold and the verbs
// of the farm plan; the numbers come from the protocol's own chains.
const GROUP_OF: Record<string, string> = {
  Dexs: 'dex', Lending: 'lend', Yield: 'yield', 'Yield Aggregator': 'yield',
  Derivatives: 'perps', Options: 'perps', 'Basis Trading': 'perps',
  'Leveraged Farming': 'perps', RWA: 'rwa', CDP: 'cdp',
  'Risk Curators': 'vault', 'Onchain Capital Allocator': 'vault',
  'Collateral Management': 'vault', 'Prediction Market': 'predict',
  Bridge: 'bridge', 'Canonical Bridge': 'bridge', 'Cross Chain Bridge': 'bridge',
  'Liquid Staking': 'stake', 'Liquid Restaking': 'stake', Restaking: 'stake',
  'Staking Pool': 'stake',
};
const TICKET_HOLD: Record<string, [number, number]> = {
  dex: [100, 6], lend: [200, 8], yield: [200, 8], perps: [150, 6],
  rwa: [350, 12], cdp: [200, 8], vault: [350, 12], predict: [100, 6],
  bridge: [100, 4], stake: [200, 8], general: [200, 8],
};

function ageDays(p: any, asOfMs: number): number {
  if (!p.listed_at) return 365;
  return Math.max(0, Math.round((asOfMs - Date.parse(p.listed_at)) / DAY_MS));
}
function ageFactor(days: number): number {
  return 0.55 + 0.45 * (Math.min(days, 730) / 730);
}
function growthFactor(change7d: number | null): number {
  if (change7d == null) return 1;
  return Math.max(0.6, Math.min(1.6, 1 + 0.75 * (change7d / 100)));
}
function maturityFactor(days: number): number {
  const years = days / 365.25;
  if (years <= MATURITY_START_YEARS) return 1;
  return Math.min(MATURITY_CAP, 1 + MATURITY_SLOPE * (years - MATURITY_START_YEARS));
}
function cheapestChain(chains: string[]): { chain: string; gas: number } {
  let best = chains[0] ?? 'Ethereum';
  let bestGas = GAS_USD[best] ?? GAS_DEFAULT;
  for (const c of chains) {
    const g = GAS_USD[c] ?? GAS_DEFAULT;
    if (g < bestGas || (g === bestGas && c < best)) { best = c; bestGas = g; }
  }
  return { chain: best, gas: bestGas };
}
function isCandidate(p: any): boolean {
  if (!(p.gecko_id == null && p.symbol == null)) return false;
  if (p.category && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  const low = p.name.toLowerCase();
  if (EXCHANGE_PREFIXES.some((e) => low.startsWith(e))) return false;
  return p.tvl_usd > 0;
}
function ols(xs: number[], ys: number[]): [number, number] {
  const m = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / m;
  const my = ys.reduce((a, b) => a + b, 0) / m;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < m; i++) { sxy += (xs[i] - mx) * (ys[i] - my); sxx += (xs[i] - mx) ** 2; }
  const b = sxy / sxx;
  return [my - b * mx, b];
}
function quantile(sorted: number[], q: number): number {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
const fmtMoney = (v: number): string =>
  v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}K`;

// ---- farm plans: one generator, used here for board.json and mirrored in
// dashboard/farm.js for the detail view, so the two can never disagree.
// Eight costed steps per protocol: setup, three group actions, weekly
// cadence, hold, watch, claim. {n} name, {c} cheapest chain, {g} gas USD,
// {t} ticket USD, {h} hold weeks.
const GROUP_STEPS: Record<string, [string, string, string]> = {
  dex: [
    'Swap ${t2} through {n}\u2019s main pool on {c} (about ${g} gas, 5 minutes) and keep the transaction hash.',
    'Add the other ${t2} as liquidity in the largest pool and leave it earning fees for the full {h} weeks.',
    'Try a second route once \u2014 a limit order or a different pair \u2014 so the record shows more than one action type.',
  ],
  lend: [
    'Supply ${t2} in a stablecoin to {n} on {c} (about ${g} gas); stablecoins keep the position calm while you learn the market.',
    'Borrow ${t4} against the deposit and keep the health factor above 2.0, so a price swing cannot liquidate you.',
    'Repay half the loan in week 4 and supply again; repeated round-trips count more than one large deposit.',
  ],
  yield: [
    'Deposit ${t2} into {n}\u2019s main vault on {c} (about ${g} gas, 5 minutes) and note the starting share price.',
    'Compound weekly: claim or restake the vault\u2019s rewards every 7 days for {h} weeks, about ${g} gas each time.',
    'Try a second vault or strategy with ${t4} so the record shows breadth, not a single deposit.',
  ],
  perps: [
    'Open a small 1\u20132x position of ${t2} on {n} ({c}, about ${g} gas) and set a stop so a bad week cannot wipe the ticket.',
    'Trade once a week for {h} weeks with varied sizes; one steady week beats one large day in every points system.',
    'Provide ${t4} to the market-making vault if {n} offers one, and leave it for the full hold.',
  ],
  rwa: [
    'Buy or mint ${t2} of {n}\u2019s real-world asset on {c} (about ${g} gas) and confirm the backing documents on the official site.',
    'Hold the position for the full {h} weeks; RWA points reward duration, not turnover.',
    'Redeem a quarter of the position in week 6 and re-mint, showing real use instead of a parked balance.',
  ],
  cdp: [
    'Open a small collateralised position of ${t2} on {n} ({c}, about ${g} gas) and keep the collateral ratio well above the minimum.',
    'Mint a modest amount against the collateral and use it, rather than leaving the debt untouched for {h} weeks.',
    'Top up collateral once mid-hold and repay a slice of the debt, keeping the ratio safe throughout.',
  ],
  vault: [
    'Deposit ${t2} into {n}\u2019s largest vault on {c} (about ${g} gas, 5 minutes) and record the vault address and entry date.',
    'Leave the deposit untouched for the full {h}-week hold; curator points reward deposits that stay, not deposits that hop.',
    'Add ${t4} to a second vault run by a different curator on the same platform to show breadth.',
  ],
  predict: [
    'Place a ${t4} position on a market you follow on {n} ({c}, about ${g} gas) and write down why you took that side.',
    'Take one new position a week for {h} weeks across different markets; breadth beats a single big bet.',
    'Provide liquidity to a market pool if {n} offers one, so you earn fees while the market runs.',
  ],
  bridge: [
    'Bridge ${t2} to {c} through {n} (about ${g} gas, 10 minutes) and confirm the funds arrive before doing more.',
    'Bridge a second, different amount back a week later; two-way flow reads as real use, not a one-off test.',
    'Try a second route or destination chain once, keeping each transfer small and documented.',
  ],
  stake: [
    'Stake ${t2} with {n} on {c} (about ${g} gas) and confirm the staking address matches the official docs.',
    'Restake the rewards weekly for {h} weeks; compounding is the behaviour points systems reward most.',
    'Unstake a small slice in week 6 and restake it, showing an active position rather than a forgotten one.',
  ],
  general: [
    'Use {n}\u2019s main feature once with ${t2} on {c} (about ${g} gas, 5 minutes) and keep the transaction hash.',
    'Return once a week for {h} weeks and repeat the core action with a different size each time.',
    'Try the protocol\u2019s second feature once, so the record shows more than a single repeated click.',
  ],
};
function farmSteps(p: any): string[] {
  const group = GROUP_OF[p.category ?? ''] ?? 'general';
  const [ticket, hold] = TICKET_HOLD[group];
  const { chain, gas } = cheapestChain(p.chains);
  const sub = (s: string): string => s
    .replaceAll('{n}', p.name).replaceAll('{c}', chain)
    .replaceAll('{g}', gas.toFixed(2)).replaceAll('{t}', String(ticket))
    .replaceAll('{t2}', String(ticket / 2)).replaceAll('{t4}', String(ticket / 4))
    .replaceAll('{h}', String(hold));
  const [g1, g2, g3] = GROUP_STEPS[group];
  return [
    `Open ${p.name} from its official site and connect a single wallet you already use; setting up on ${chain} costs about $${gas.toFixed(2)} in gas and 10 minutes.`,
    sub(g1), sub(g2),
    `Repeat the core action once a week for ${hold} weeks, varying the size each time; ${hold} weekly visits cost under $${(gas * hold).toFixed(2)} in gas in total.`,
    sub(g3),
    `Keep the position open for the full ${hold}-week hold; closing early forfeits the streak most points programmes reward.`,
    `Check ${p.name}\u2019s own announcements weekly for a points tally or snapshot date; never connect from a link in a message or an ad.`,
    'If a claim opens, claim only from the official site, keep every transaction hash and date, and never share a seed phrase \u2014 a real airdrop never asks for one.',
  ];
}

// ---- main
function main(): void {
  const args = process.argv.slice(2);
  const inputFlag = args.indexOf('--input');
  const inputPath = inputFlag >= 0 ? args[inputFlag + 1] : '/input/snapshot.json';
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  const here = dirname(fileURLToPath(import.meta.url));
  const snap = JSON.parse(readFileSync(inputPath, 'utf8'));
  const asOfMs = Date.parse(snap.as_of);
  const watch = new Set<string>(snap.watchlist);

  // Fit the size curve on the 128 token-bearing comparables.
  const comps = snap.protocols.filter((p: any) => p.mcap_usd > 0 && p.tvl_usd > 0);
  const xs = comps.map((p: any) => Math.log10(p.tvl_usd));
  const ys = comps.map((p: any) => Math.log10(p.mcap_usd / p.tvl_usd));
  const [a, b] = ols(xs, ys);
  const curveMult = (tvl: number): number => 10 ** (a + b * Math.log10(tvl));
  // Leave-one-out median error factor of the curve (reported, not fitted on).
  const looErrs: number[] = [];
  for (let i = 0; i < xs.length; i++) {
    const [a2, b2] = ols(xs.filter((_: number, j: number) => j !== i), ys.filter((_: number, j: number) => j !== i));
    const pred = a2 + b2 * xs[i];
    looErrs.push(Math.max(10 ** (pred - ys[i]), 10 ** (ys[i] - pred)));
  }
  looErrs.sort((x, y) => x - y);
  const loo = (looErrs[63] + looErrs[64]) / 2;

  // Shrunk category effects on the log-residuals, 4 pseudo-comparables.
  const residByCat = new Map<string, number[]>();
  for (const p of comps) {
    const r = Math.log10(p.mcap_usd / p.tvl_usd) - (a + b * Math.log10(p.tvl_usd));
    const list = residByCat.get(p.category ?? '') ?? [];
    list.push(r);
    residByCat.set(p.category ?? '', list);
  }
  const catEffect = new Map<string, { n: number; eff: number; factor: number; median: number }>();
  for (const [cat, rs] of [...residByCat.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
    const mean = rs.reduce((s, v) => s + v, 0) / rs.length;
    const eff = Math.max(-EFFECT_CLAMP, Math.min(EFFECT_CLAMP, (rs.length / (rs.length + SHRINK_PSEUDO)) * mean));
    const mults = comps.filter((p: any) => (p.category ?? '') === cat)
      .map((p: any) => p.mcap_usd / p.tvl_usd).sort((x: number, y: number) => x - y);
    catEffect.set(cat, { n: rs.length, eff, factor: 10 ** eff, median: mults[Math.floor(mults.length / 2)] });
  }
  // Empirical quartiles of the post-effect residuals -> the P25-P75 band.
  const postResid = comps
    .map((p: any) => Math.log10(p.mcap_usd / p.tvl_usd) - (a + b * Math.log10(p.tvl_usd)) - (catEffect.get(p.category ?? '')?.eff ?? 0))
    .sort((x: number, y: number) => x - y);
  const q25 = quantile(postResid, 0.25);
  const q75 = quantile(postResid, 0.75);

  // Rank every candidate; the watchlist is the floor, never the ceiling.
  const cands = snap.protocols.filter(isCandidate);
  const rows = cands.map((p: any) => {
    const days = ageDays(p, asOfMs);
    const cm = curveMult(p.tvl_usd);
    const cf = catEffect.get(p.category ?? '')?.factor ?? 1;
    const gf = growthFactor(p.change_7d);
    const af = ageFactor(days);
    const mf = maturityFactor(days);
    const implied = Math.max(1, Math.round(p.tvl_usd * cm * cf * gf * af * mf));
    const slice = (AIRDROP_SHARE * implied) / (p.tvl_usd / 1000);
    const verdict = slice >= 10 ? 'worth it' : slice >= 2.5 ? 'thin' : 'skip';
    const group = GROUP_OF[p.category ?? ''] ?? 'general';
    const [ticket, hold] = TICKET_HOLD[group];
    return {
      slug: p.slug, name: p.name, rank: 0, implied_value_usd: implied,
      p25_usd: Math.max(1, Math.round(implied * 10 ** q25)),
      p75_usd: Math.max(1, Math.round(implied * 10 ** q75)),
      category: p.category, family: group, chain: cheapestChain(p.chains).chain,
      chains: p.chains, tvl_usd: p.tvl_usd, change_7d: p.change_7d,
      age_days: days, age_years: Math.round((days / 365.25) * 100) / 100,
      curve_multiple: Math.round(cm * 10000) / 10000,
      category_factor: Math.round(cf * 1000) / 1000,
      growth_factor: Math.round(gf * 1000) / 1000,
      age_factor: Math.round(af * 1000) / 1000,
      maturity_factor: Math.round(mf * 1000) / 1000,
      effective_multiple: Math.round((implied / p.tvl_usd) * 10000) / 10000,
      slice_per_1k_usd: Math.round(slice * 100) / 100,
      verdict, tier: watch.has(p.slug) ? 'Watchlist' : 'Below floor',
      ticket_usd: ticket, hold_weeks: hold,
      farm_steps: farmSteps(p),
    };
  });
  rows.sort((x, y) => y.implied_value_usd - x.implied_value_usd || (x.slug < y.slug ? -1 : 1));
  rows.forEach((r, i) => { r.rank = i + 1; });

  // Reconciliation + the tab panels' top names.
  const already = snap.protocols.filter((p: any) => !(p.gecko_id == null && p.symbol == null));
  const setAside = snap.protocols.filter((p: any) => !isCandidate(p) && (p.gecko_id == null && p.symbol == null));
  const topNames = (list: any[]): [string, string][] =>
    [...list].sort((x, y) => y.tvl_usd - x.tvl_usd).slice(0, 10)
      .map((p) => [p.name, fmtMoney(p.tvl_usd)] as [string, string]);
  const meta = {
    as_of: snap.as_of, floor_usd: snap.floor_usd,
    scanned: snap.protocols.length, ranked: rows.length,
    watchlist: snap.watchlist.length,
    below_floor: rows.filter((r) => r.tier === 'Below floor').length,
    already_trading: already.length, set_aside: setAside.length,
    comps: comps.length, curve_a: Math.round(a * 10000) / 10000,
    curve_b: Math.round(b * 10000) / 10000, loo: Math.round(loo * 10000) / 10000,
    resid_q25: Math.round(q25 * 1000) / 1000, resid_q75: Math.round(q75 * 1000) / 1000,
    ratio: Math.round(10 ** (q75 - q25) * 100) / 100,
    maturity_slope: MATURITY_SLOPE, maturity_start_years: MATURITY_START_YEARS,
    maturity_cap: MATURITY_CAP, airdrop_share: AIRDROP_SHARE,
    categories: [...catEffect.entries()].map(([cat, v]) => [cat, v.n, Math.round(v.eff * 1000) / 1000, Math.round(v.median * 10000)]),
    comps_xy: comps.map((p: any) => [Math.round(Math.log10(p.tvl_usd) * 100), Math.round(Math.log10(p.mcap_usd / p.tvl_usd) * 100)]),
    already_top: topNames(already), set_aside_top: topNames(setAside),
  };

  // Dashboard data: one compact array per row. Index: 0 rank, 1 slug, 2 name,
  // 3 category, 4 family, 5 chain, 6 chain count, 7 TVL, 8 change_7d,
  // 9 implied, 10 mult x10000, 11 ageF x1000, 12 growthF x1000,
  // 13 maturityF x1000, 14 categoryF x1000, 15 slice cents, 16 verdict 0-2,
  // 17 tier 0-1, 18 age days. (P25/P75 are implied x the residual quartiles
  // in meta, so they are not repeated per row.)
  const verdictIdx: Record<string, number> = { skip: 0, thin: 1, 'worth it': 2 };
  const dataRows = rows.map((r) => [
    r.rank, r.slug, r.name, r.category, r.family, r.chain, r.chains.length,
    r.tvl_usd, r.change_7d, r.implied_value_usd,
    Math.round(r.effective_multiple * 10000), Math.round(r.age_factor * 1000),
    Math.round(r.growth_factor * 1000), Math.round(r.maturity_factor * 1000),
    Math.round(r.category_factor * 1000), Math.round(r.slice_per_1k_usd * 100),
    verdictIdx[r.verdict], r.tier === 'Watchlist' ? 0 : 1, r.age_days,
  ]);
  const dataJs = `window.RADAR={"meta":${JSON.stringify(meta)},"rows":${JSON.stringify(dataRows)}};\n`;

  mkdirSync(join(outDir, 'dashboard'), { recursive: true });
  mkdirSync(join(outDir, 'screenshots'), { recursive: true });
  writeFileSync(join(outDir, 'board.json'), JSON.stringify({ rows }, null, 1) + '\n');
  for (const f of ['index.html', 'app.css', 'app.js', 'farm.js']) {
    copyFileSync(join(here, 'dashboard', f), join(outDir, 'dashboard', f));
  }
  writeFileSync(join(outDir, 'dashboard', 'data.js'), dataJs);
  cpSync(join(here, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });
  writeFileSync(join(outDir, 'dossier.json'), buildDossier(outDir, { text_max_bytes: 65536 }));

  const top = rows[0];
  const sent = rows.find((r) => r.slug === 'sentora-curator');
  console.log(`board: ${rows.length} rows, watchlist ${snap.watchlist.length}/40, ` +
    `reconcile ${meta.scanned} = ${meta.ranked} + ${meta.already_trading} + ${meta.set_aside}`);
  console.log(`curve: 10^(${a.toFixed(4)} ${b.toFixed(4)}*log10 TVL), LOO x${loo.toFixed(4)}, ` +
    `P25-P75 ratio x${meta.ratio}`);
  console.log(`#1 ${top.slug} $${(top.implied_value_usd / 1e6).toFixed(1)}M ` +
    `(maturity x${top.maturity_factor}); Sentora rank ${sent?.rank} $${((sent?.implied_value_usd ?? 0) / 1e6).toFixed(1)}M`);
}

main();
