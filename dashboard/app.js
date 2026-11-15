// Token Radar v6 — board, detail, model views. No network: all numbers come
// from window.RADAR (data.js). Row: 0 rank, 1 slug, 2 name, 3 cat, 4 fam, 5 chain,
// 6 nChains, 7 tvl, 8 chg7d, 9 implied, 10 mult x10000, 11 ageF, 12 growthF,
// 13 matF, 14 catF (x1000), 15 slice cents, 16 verdict, 17 tier, 18 ageDays.
var R = window.RADAR, META = R.meta, ROWS = R.rows;
var VERDICTS = ['skip', 'thin', 'worth it'];
var FAM_LABEL = { dex: 'DEX', lend: 'Lending', yield: 'Yield', perps: 'Perps', rwa: 'RWA',
  cdp: 'CDP', vault: 'Vault curation', predict: 'Prediction', bridge: 'Bridge',
  stake: 'Staking', general: 'General' };
var state = { tab: 'all', tier: 'all', fam: 'all', chain: 'all', minTvl: 0,
  chg: 'all', q: '', sort: 'implied', dir: -1, page: 0 };
var PER_PAGE = 10;
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function money(v) { if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B'; if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M'; if (v >= 1e3) return '$' + Math.round(v / 1e3) + 'K'; return '$' + Math.round(v); }
function money2(v) { return '$' + (v / 1e6).toFixed(1) + 'M'; }
function pct(v) { return (v > 0 ? '+' : '') + v.toFixed(2) + '%'; }
function yrs(d) { return (d / 365.25).toFixed(1) + 'y'; }
function p25(r) { return Math.round(r[9] * Math.pow(10, META.resid_q25)); }
function p75(r) { return Math.round(r[9] * Math.pow(10, META.resid_q75)); }
function rowBySlug(s) { for (var i = 0; i < ROWS.length; i++) if (ROWS[i][1] === s) return ROWS[i]; return null; }
function catInfo(cat) { for (var i = 0; i < META.categories.length; i++) if (META.categories[i][0] === cat) return META.categories[i]; return null; }

function filtered() {
  var out = ROWS.filter(function (r) {
    if (state.tab === 'watchlist' && r[17] !== 0) return false;
    if (state.tab === 'below' && r[17] !== 1) return false;
    if (state.tier === 'watchlist' && r[17] !== 0) return false;
    if (state.tier === 'below' && r[17] !== 1) return false;
    if (state.fam !== 'all' && r[4] !== state.fam) return false;
    if (state.chain !== 'all' && r[5] !== state.chain) return false;
    if (r[7] < state.minTvl) return false;
    if (state.chg === 'gaining' && !(r[8] != null && r[8] > 0)) return false;
    if (state.chg === 'falling' && !(r[8] != null && r[8] < 0)) return false;
    if (state.q) { var q = state.q.toLowerCase(); if ((r[2] + ' ' + r[1] + ' ' + (r[3] || '')).toLowerCase().indexOf(q) < 0) return false; }
    return true;
  });
  var K = { rank: 0, name: 2, fam: 4, chain: 5, tvl: 7, chg: 8, age: 18, mult: 10, implied: 9, slice: 15, verdict: 16, farm: 4 };
  var k = K[state.sort] === undefined ? 9 : K[state.sort];
  out.sort(function (a, b) {
    var av = a[k], bv = b[k], d;
    if (state.sort === 'farm') { av = TICKET_HOLD[a[4]][0]; bv = TICKET_HOLD[b[4]][0]; }
    if (state.sort === 'range') { av = a[9]; bv = b[9]; }
    if (typeof av === 'string') d = av < bv ? -1 : av > bv ? 1 : 0;
    else d = (av == null ? -1e18 : av) - (bv == null ? -1e18 : bv);
    if (d === 0) d = a[9] - b[9];
    return d * state.dir;
  });
  return out;
}
function sortArrow(key) { return state.sort === key ? (state.dir === 1 ? ' \u25b2' : ' \u25bc') : ' \u25c7'; }
function boardHTML() {
  var belowFloor = ROWS.filter(function (r) { return r[17] === 1 && r[7] < META.floor_usd; }).length;
  var fams = [], chains = [];
  ROWS.forEach(function (r) { if (fams.indexOf(r[4]) < 0) fams.push(r[4]); if (chains.indexOf(r[5]) < 0) chains.push(r[5]); });
  fams.sort(); chains.sort();
  var tabs = [['all', 'All ranked', META.ranked], ['watchlist', 'Watchlist', META.watchlist],
    ['below', 'Below floor', META.below_floor], ['already', 'Already trading', META.already_trading],
    ['setaside', 'Set aside', META.set_aside]];
  var h = '<div class="strip"><div class="formula">implied = TVL &times; curve(TVL) &times; category &times; growthFactor &times; ageFactor &times; maturityFactor</div>'
    + '<div>Curve 10^(' + META.curve_a + ' ' + (META.curve_b < 0 ? '&minus;' : '+') + ' ' + Math.abs(META.curve_b) + ' &middot; log&#8321;&#8320; TVL), fitted on ' + META.comps + ' token-bearing comparables &middot; leave-one-out error &times;' + META.loo + ' (flat multiple &times;4.86) &middot; P25&ndash;P75 band &times;' + META.ratio + '. <b>No name is special-cased.</b></div>'
    + '<div class="recon"><b>Reconciliation:</b> ' + META.scanned + ' scanned = ' + META.ranked + ' ranked (' + META.watchlist + ' watchlist + ' + META.below_floor + ' early finds, ' + belowFloor + ' of them below the $50M floor) + ' + META.already_trading + ' already trading + ' + META.set_aside + ' set aside by the exclusion rule.</div></div>'
    + '<div class="tabs">' + tabs.map(function (t) {
      return '<button class="tab' + (state.tab === t[0] ? ' on' : '') + '" data-tab="' + t[0] + '">' + t[1] + ' <span class="n">' + t[2] + '</span></button>';
    }).join('') + '</div>';
  if (state.tab === 'already' || state.tab === 'setaside') {
    var isA = state.tab === 'already';
    var list = isA ? META.already_top : META.set_aside_top;
    h += '<div class="card"><h2>' + (isA ? 'Already trading &mdash; not ranked' : 'Set aside by the exclusion rule') + '</h2><p>'
      + (isA ? 'These protocols record a token, so they are not launch candidates. They are the comparables the curve is fitted on &mdash; ' + META.comps + ' of them carry a market cap &mdash; and the largest ten are below. The board ranks only what records no token.'
        : 'These protocols record no token but fail the house exclusion rule: a wrapped, staked or bridged product, a bridge / liquid-staking / CEX category, a versioned name, or an exchange name. Largest ten below; the full count is ' + META.set_aside + '.')
      + '</p><ol class="panel-list">' + list.map(function (x) { return '<li><b>' + esc(x[0]) + '</b> &mdash; ' + x[1] + ' TVL</li>'; }).join('') + '</ol></div>';
    return h;
  }
  h += '<div class="filters">'
    + '<div><label>Tier</label><select id="f-tier"><option value="all">All tiers</option><option value="watchlist"' + (state.tier === 'watchlist' ? ' selected' : '') + '>Watchlist</option><option value="below"' + (state.tier === 'below' ? ' selected' : '') + '>Below floor</option></select></div>'
    + '<div><label>Family</label><select id="f-fam"><option value="all">All families</option>' + fams.map(function (f) { return '<option value="' + f + '"' + (state.fam === f ? ' selected' : '') + '>' + FAM_LABEL[f] + '</option>'; }).join('') + '</select></div>'
    + '<div><label>Chain</label><select id="f-chain"><option value="all">All chains</option>' + chains.map(function (c) { return '<option value="' + esc(c) + '"' + (state.chain === c ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select></div>'
    + '<div><label>Min TVL ($M)</label><input id="f-min" type="number" min="0" step="10" value="' + (state.minTvl / 1e6 || '') + '" placeholder="0"></div>'
    + '<div><label>7-day</label><select id="f-chg"><option value="all">All</option><option value="gaining"' + (state.chg === 'gaining' ? ' selected' : '') + '>Gaining</option><option value="falling"' + (state.chg === 'falling' ? ' selected' : '') + '>Falling</option></select></div>'
    + '<div><label>Search</label><input id="f-q" type="search" value="' + esc(state.q) + '" placeholder="name, slug, category"></div>'
    + '<button id="f-reset">Reset</button><span class="shown" id="shown"></span></div>'
    + '<p class="hint"><b>Click a column to sort</b> &mdash; click a row to open its protocol file. Implied values are the model&rsquo;s claim; the P25&ndash;P75 band is the market&rsquo;s own spread.</p>'
    + '<div id="tbl"></div>';
  return h;
}
function tableHTML(list) {
  var cols = [['rank', '#', ''], ['name', 'Protocol', ''], ['fam', 'Family', ''], ['chain', 'Chain', ''],
    ['tvl', 'TVL', 'num'], ['chg', '7D', 'num'], ['age', 'No token for', 'num'], ['mult', '&times;TVL', 'num'],
    ['implied', 'Implied value', 'num'], ['range', 'P25&ndash;P75', 'num'], ['slice', 'Slice / $1K', 'num'],
    ['verdict', 'Verdict', ''], ['farm', 'Farm', '']];
  var h = '<table><thead><tr>' + cols.map(function (c) {
    return '<th data-sort="' + c[0] + '" class="' + c[2] + '">' + c[1] + '<span class="arw">' + sortArrow(c[0]) + '</span></th>';
  }).join('') + '</tr></thead><tbody>';
  var page = list.slice(state.page * PER_PAGE, state.page * PER_PAGE + PER_PAGE);
  page.forEach(function (r) {
    var th = TICKET_HOLD[r[4]];
    h += '<tr data-slug="' + esc(r[1]) + '"' + (r[0] <= 3 ? ' class="top"' : '') + '>'
      + '<td class="rank">' + r[0] + '</td>'
      + '<td><b>' + esc(r[2]) + '</b><br><span class="badge ' + (r[17] === 0 ? 'w' : 'b') + '">' + (r[17] === 0 ? 'Watchlist' : 'Below floor') + '</span></td>'
      + '<td>' + FAM_LABEL[r[4]] + '</td><td>' + esc(r[5]) + (r[6] > 1 ? ' +' + (r[6] - 1) : '') + '</td>'
      + '<td class="num">' + money(r[7]) + '</td>'
      + '<td class="num">' + (r[8] == null ? '&ndash;' : pct(r[8])) + '</td>'
      + '<td class="num">' + yrs(r[18]) + '</td>'
      + '<td class="num">&times;' + (r[10] / 10000).toFixed(3) + '</td>'
      + '<td class="num"><b>' + money2(r[9]) + '</b></td>'
      + '<td class="num">' + money(p25(r)) + '&ndash;' + money(p75(r)) + '</td>'
      + '<td class="num">$' + (r[15] / 100).toFixed(2) + '</td>'
      + '<td><span class="verdict ' + VERDICTS[r[16]] + '">' + VERDICTS[r[16]] + '</span></td>'
      + '<td>$' + th[0] + ' &middot; ' + th[1] + ' wks</td></tr>';
  });
  h += '</tbody></table><div class="pager"><button id="pg-prev"' + (state.page === 0 ? ' disabled' : '') + '>&larr; Prev</button>'
    + '<span>Page ' + (state.page + 1) + ' of ' + Math.max(1, Math.ceil(list.length / PER_PAGE)) + ' &mdash; rows ' + (list.length ? state.page * PER_PAGE + 1 : 0) + '&ndash;' + Math.min(list.length, (state.page + 1) * PER_PAGE) + ' of ' + list.length + '</span>'
    + '<button id="pg-next"' + ((state.page + 1) * PER_PAGE >= list.length ? ' disabled' : '') + '>Next &rarr;</button>'
    + '<span style="margin-left:auto"><a href="#/model">How a value is set &rarr;</a></span></div>';
  return h;
}
function detailHTML(r) {
  var ci = catInfo(r[3]);
  var steps = farmStepsFor(r[2], r[3], r[5]);
  var th = TICKET_HOLD[r[4]];
  var ageY = r[18] / 365.25;
  var matNote = ageY > 2 ? 'maturityFactor lifts this row by &times;' + (r[13] / 1000).toFixed(3) + ' because it has run ' + ageY.toFixed(2) + ' years with no token &mdash; past the 2-year line the model rewards survival.' : 'maturityFactor is &times;1.000 here: the protocol has run under 2 years with no token, so the maturity line does not apply yet.';
  return '<p><a href="#/">&larr; Back to the board</a></p>'
    + '<h2>#' + r[0] + ' &mdash; ' + esc(r[2]) + ' <span class="badge ' + (r[17] === 0 ? 'w' : 'b') + '">' + (r[17] === 0 ? 'Watchlist' : 'Below floor') + '</span></h2>'
    + '<p>' + esc(r[3] || 'Uncategorised') + ' &middot; ' + esc(r[5]) + (r[6] > 1 ? ' +' + (r[6] - 1) + ' chains' : '') + ' &middot; records no token for ' + yrs(r[18]) + '</p>'
    + '<div class="card"><span class="big">' + money2(r[9]) + '</span> implied value &nbsp;&middot;&nbsp; P25&ndash;P75 ' + money(p25(r)) + '&ndash;' + money(p75(r)) + ' &nbsp;&middot;&nbsp; slice $' + (r[15] / 100).toFixed(2) + ' per $1K farmed &nbsp;&middot;&nbsp; verdict <span class="verdict ' + VERDICTS[r[16]] + '">' + VERDICTS[r[16]] + '</span></div>'
    + '<div class="cols2"><div><h3>How this value is built</h3><table class="kv"><tbody>'
    + '<tr><td>TVL</td><td>' + money(r[7]) + '</td></tr>'
    + '<tr><td>curve(TVL) &mdash; 10^(' + META.curve_a + ' ' + (META.curve_b < 0 ? '&minus;' : '+') + ' ' + Math.abs(META.curve_b) + ' &middot; log&#8321;&#8320; TVL)</td><td>&times;' + (r[10] / (r[14] / 1000) / (r[11] / 1000) / (r[12] / 1000) / (r[13] / 1000) / 10000).toFixed(4) + '</td></tr>'
    + '<tr><td>category effect (' + esc(r[3] || 'none') + ', n=' + (ci ? ci[1] : 0) + ' comps)</td><td>&times;' + (r[14] / 1000).toFixed(3) + '</td></tr>'
    + '<tr><td>growthFactor (7d ' + (r[8] == null ? 'unreported' : pct(r[8])) + ')</td><td>&times;' + (r[12] / 1000).toFixed(3) + '</td></tr>'
    + '<tr><td>ageFactor (' + r[18] + ' days, ' + yrs(r[18]) + ')</td><td>&times;' + (r[11] / 1000).toFixed(3) + '</td></tr>'
    + '<tr><td>maturityFactor</td><td>&times;' + (r[13] / 1000).toFixed(3) + '</td></tr>'
    + '<tr><td><b>implied = TVL &times; all five</b></td><td><b>' + money2(r[9]) + '</b></td></tr>'
    + '</tbody></table><p class="note">Effective multiple &times;' + (r[10] / 10000).toFixed(3) + ' of TVL. The P25&ndash;P75 band is the point value times the comparables&rsquo; own residual quartiles (' + META.resid_q25 + ' / +' + META.resid_q75 + ' dex).</p></div>'
    + '<div><h3>Why the age terms are what they are</h3><p>ageFactor rises from 0.55 to 1.00 over a protocol&rsquo;s first 730 days with no token: surviving two years at scale without issuing is the market&rsquo;s own seasoning test. maturityFactor continues the same idea past year two &mdash; 1 + 0.12 &times; (years &minus; 2), capped at &times;2.00 &mdash; because a protocol that keeps growing for years without a token is a mature pre-token launch: it has the users, the TVL and the restraint to launch well. Both terms are functions of age in days alone, applied to every row alike. <b>No name is special-cased.</b> ' + matNote + '</p>'
    + (ci ? '<p class="note">Category ' + esc(r[3]) + ': ' + ci[1] + ' token-bearing comparable' + (ci[1] === 1 ? '' : 's') + ', median multiple &times;' + (ci[3] / 10000).toFixed(3) + ', shrunk effect ' + (ci[2] >= 0 ? '+' : '') + ci[2] + ' dex (4 pseudo-comparables, clamped to &plusmn;0.5).</p>' : '')
    + '</div></div>'
    + '<h3>Farm plan &mdash; $' + th[0] + ' ticket &middot; ' + th[1] + '-week hold &middot; cheapest chain ' + esc(r[5]) + '</h3>'
    + '<ol class="steps">' + steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>'
    + '<p class="note">No step promises a token: this is positioning for a launch that may never come, with costs stated up front. A real airdrop never asks for a seed phrase or a payment.</p>';
}
function scatterSVG() {
  var W = 640, H = 128, pad = 26, pts = META.comps_xy;
  var xs = pts.map(function (p) { return p[0] / 100; }), ys = pts.map(function (p) { return p[1] / 100; });
  var x0 = Math.min.apply(null, xs) - 0.2, x1 = Math.max.apply(null, xs) + 0.2;
  var y0 = Math.min.apply(null, ys) - 0.3, y1 = Math.max.apply(null, ys) + 0.3;
  function X(v) { return pad + (v - x0) / (x1 - x0) * (W - pad * 2); }
  function Y(v) { return H - pad - (v - y0) / (y1 - y0) * (H - pad * 2); }
  var dots = pts.map(function (p) { return '<circle cx="' + X(p[0] / 100).toFixed(1) + '" cy="' + Y(p[1] / 100).toFixed(1) + '" r="2.6" fill="#2e6b46" opacity="0.65"/>'; }).join('');
  var lx0 = X(x0), ly0 = Y(META.curve_a + META.curve_b * x0), lx1 = X(x1), ly1 = Y(META.curve_a + META.curve_b * x1);
  return '<svg width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" style="background:#fffdf6;border:1px solid #b9a86a">'
    + '<line x1="' + lx0.toFixed(1) + '" y1="' + ly0.toFixed(1) + '" x2="' + lx1.toFixed(1) + '" y2="' + ly1.toFixed(1) + '" stroke="#c8a24a" stroke-width="2"/>'
    + dots
    + '<text x="' + (W / 2) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="11" fill="#5a6353">log10 TVL (USD) &rarr;</text>'
    + '<text x="10" y="16" font-size="11" fill="#5a6353">log10 mcap / TVL &mdash; gold line is the fitted curve</text></svg>';
}
function modelHTML() {
  var cats = META.categories.slice().sort(function (a, b) { return b[2] - a[2]; });
  function catRows(list) {
    return '<table><thead><tr><th>Category</th><th class="num">Comps</th><th class="num">Median &times;</th><th class="num">Effect (dex)</th><th class="num">Factor</th></tr></thead><tbody>'
      + list.map(function (c) {
        return '<tr><td>' + esc(c[0] || '(none)') + '</td><td class="num">' + c[1] + '</td><td class="num">&times;' + (c[3] / 10000).toFixed(3) + '</td><td class="num">' + (c[2] >= 0 ? '+' : '') + c[2].toFixed(3) + '</td><td class="num">&times;' + Math.pow(10, c[2]).toFixed(3) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }
  var third = Math.ceil(cats.length / 3);
  return '<p><a href="#/">&larr; Back to the board</a></p>'
    + '<h2>Model &amp; lab &mdash; how a value is set</h2>'
    + '<div class="card"><p class="formula" style="font:600 15px Georgia,serif;color:#1c4632">implied = TVL &times; curve(TVL) &times; category &times; growthFactor &times; ageFactor &times; maturityFactor</p>'
    + '<p><b>curve(TVL)</b> = 10^(' + META.curve_a + ' ' + (META.curve_b < 0 ? '&minus;' : '+') + ' ' + Math.abs(META.curve_b) + ' &middot; log&#8321;&#8320; TVL), OLS on ' + META.comps + ' comparables; leave-one-out error &times;' + META.loo + ' (flat multiple: &times;4.86). Bigger protocols carry smaller multiples: slope &minus;0.48 per decade.</p>'
    + '<p><b>category</b> = 10^(shrunk mean log-residual of the category&rsquo;s comparables), 4 pseudo-comparables, clamped to &plusmn;0.5 dex. Full table below &mdash; every category, none hidden.</p>'
    + '<p><b>growthFactor</b> = 1 + 0.75 &times; 7-day change, clamped to [0.60, 1.60]; 1.00 when unreported. <b>ageFactor</b> = 0.55 + 0.45 &times; min(days, 730) / 730 (unknown = 365d). <b>maturityFactor</b> = 1 + 0.12 &times; (ageYears &minus; 2) past 2 years, capped at &times;2.00.</p>'
    + '<p><b>P25&ndash;P75</b> = point value &times; the comparables&rsquo; own residual quartiles (' + META.resid_q25 + ' / +' + META.resid_q75 + ' dex), a &times;' + META.ratio + ' band. <b>Slice / $1K</b> assumes ' + (META.airdrop_share * 100) + '% of implied value reaches farmers, spread pro-rata over TVL farmed. <b>Verdict:</b> slice &ge; $10 worth it, &ge; $2.50 thin, else skip.</p></div>'
    + '<h3>The fit &mdash; 128 comparables, log-log</h3>' + scatterSVG()
    + '<h3>Category effects &mdash; every category, none hidden</h3><div class="cols3"><div>' + catRows(cats.slice(0, third)) + '</div><div>' + catRows(cats.slice(third, 2 * third)) + '</div><div>' + catRows(cats.slice(2 * third)) + '</div></div>'
    + '<h3>Why maturity is a factor at all</h3><p>A protocol that has run for years with a large TVL and still records no token has passed the test a young protocol has not: it kept users and TVL without paying them in its own token. That is the mature pre-token profile, and the most credible launch a radar can surface. The term is one global function of age in days &mdash; it lifts Polymarket (5.05y, &times;1.366), Lofty (4.28y) and Hive (2.53y) exactly as it would lift any other protocol of the same age, and it is 1.000 for every protocol under two years, including Sentora (1.12y) and Steakhouse (1.49y). No name is special-cased; the slope (+12% a year) is small on purpose, so age seasons the ranking instead of owning it.</p>'
    + '<h3>What the model does not claim</h3><p class="note">No fees, revenue, users, backers or points programme exist in the snapshot, so none is used. Market cap is circulating, not fully diluted: implied values are circulating-mcap equivalents, and a launch&rsquo;s fully diluted value would read higher. &ldquo;Records no token&rdquo; is a statement about the DefiLlama record, not a proof a token does not exist. The board separates the 416 protocols that already trade from the 198 it ranks, and sets aside 144 by the exclusion rule (wrapped / staked / bridged products, bridge, liquid-staking and CEX categories, versioned names, exchange names).</p>';
}
function render() {
  var v = document.getElementById('view');
  document.getElementById('asof').textContent = META.as_of;
  document.getElementById('asof2').textContent = META.as_of;
  document.getElementById('mastmeta').innerHTML = META.scanned + ' protocols scanned &middot; ' + META.ranked + ' ranked &middot; ' + META.watchlist + ' on the watchlist &middot; snapshot ' + META.as_of;
  var hash = location.hash || '#/';
  var m = hash.match(/^#\/p\/([\w-]+)/);
  if (m) { var r = rowBySlug(m[1]); v.innerHTML = r ? detailHTML(r) : '<p>Unknown protocol. <a href="#/">Back to the board</a></p>'; return; }
  if (hash.indexOf('#/model') === 0) { v.innerHTML = modelHTML(); return; }
  v.innerHTML = boardHTML();
  var list = filtered();
  var tbl = document.getElementById('tbl');
  if (tbl) {
    tbl.innerHTML = tableHTML(list);
    document.getElementById('shown').textContent = list.length + ' of ' + ROWS.length + ' shown';
  }
  bindBoard();
}
function bindBoard() {
  document.querySelectorAll('.tab').forEach(function (b) {
    b.addEventListener('click', function () { state.tab = b.getAttribute('data-tab'); state.page = 0; render(); });
  });
  var t = document.getElementById('f-tier'); if (t) t.addEventListener('change', function () { state.tier = t.value; state.page = 0; render(); });
  var f = document.getElementById('f-fam'); if (f) f.addEventListener('change', function () { state.fam = f.value; state.page = 0; render(); });
  var c = document.getElementById('f-chain'); if (c) c.addEventListener('change', function () { state.chain = c.value; state.page = 0; render(); });
  var mn = document.getElementById('f-min'); if (mn) mn.addEventListener('change', function () { state.minTvl = (parseFloat(mn.value) || 0) * 1e6; state.page = 0; render(); });
  var ch = document.getElementById('f-chg'); if (ch) ch.addEventListener('change', function () { state.chg = ch.value; state.page = 0; render(); });
  var q = document.getElementById('f-q'); if (q) q.addEventListener('input', function () { state.q = q.value; state.page = 0; render(); });
  var rs = document.getElementById('f-reset'); if (rs) rs.addEventListener('click', function () {
    state.tier = 'all'; state.fam = 'all'; state.chain = 'all'; state.minTvl = 0; state.chg = 'all'; state.q = ''; state.page = 0; render();
  });
  document.querySelectorAll('th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-sort');
      if (state.sort === k) state.dir = -state.dir; else { state.sort = k; state.dir = k === 'name' || k === 'fam' || k === 'chain' ? 1 : -1; }
      state.page = 0; render();
    });
  });
  document.querySelectorAll('tr[data-slug]').forEach(function (tr) {
    tr.addEventListener('click', function () { location.hash = '#/p/' + tr.getAttribute('data-slug'); });
  });
  var pv = document.getElementById('pg-prev'); if (pv) pv.addEventListener('click', function () { if (state.page > 0) { state.page--; render(); } });
  var nx = document.getElementById('pg-next'); if (nx) nx.addEventListener('click', function () { state.page++; render(); });
}
function applyHashFilters() {
  var h = location.hash || '';
  var qi = h.indexOf('?');
  if (qi < 0) return;
  var params = new URLSearchParams(h.slice(qi + 1));
  if (params.get('tier')) state.tier = params.get('tier');
  if (params.get('fam')) state.fam = params.get('fam');
  if (params.get('chain')) state.chain = params.get('chain');
  if (params.get('mintvl')) state.minTvl = parseFloat(params.get('mintvl')) * 1e6;
  if (params.get('chg')) state.chg = params.get('chg');
  if (params.get('q')) state.q = params.get('q');
  if (params.get('tab')) state.tab = params.get('tab');
}
applyHashFilters();
window.addEventListener('hashchange', function () { applyHashFilters(); render(); });
render();
