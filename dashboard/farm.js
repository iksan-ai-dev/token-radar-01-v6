// farm.js — farm-plan generator for the detail view. Mirrors main.ts
// farmSteps() exactly (same tables, wording, order), so the plan a reader
// sees is the plan board.json carries. Pure functions, no DOM.
var GAS_USD = {
  'Hyperliquid L1': 0.02, Stellar: 0.02, Polygon: 0.03, Sui: 0.03, Avalanche: 0.25,
  Solana: 0.04, Sonic: 0.04, Sei: 0.03, Flare: 0.03, Aptos: 0.04, Bittensor: 0.10,
  Base: 0.06, Ink: 0.06, Unichain: 0.06, Arc: 0.06, Optimism: 0.08, Morph: 0.08,
  Arbitrum: 0.12, Binance: 0.15, Scroll: 0.10, Berachain: 0.05, Monad: 0.05,
  Katana: 0.05, Tempo: 0.05, Stable: 0.05, Corn: 0.05, 'Plume Mainnet': 0.04,
  BOB: 0.05, 'Robinhood Chain': 0.05, Fluent: 0.05, Mezo: 0.05, Plasma: 0.05,
  Pharos: 0.04, Citrea: 0.05, Etherlink: 0.04, Ethereum: 4.50, Tron: 0.50
};
var GAS_DEFAULT = 0.60;
var GROUP_OF = {
  Dexs: 'dex', Lending: 'lend', Yield: 'yield', 'Yield Aggregator': 'yield',
  Derivatives: 'perps', Options: 'perps', 'Basis Trading': 'perps',
  'Leveraged Farming': 'perps', RWA: 'rwa', CDP: 'cdp',
  'Risk Curators': 'vault', 'Onchain Capital Allocator': 'vault',
  'Collateral Management': 'vault', 'Prediction Market': 'predict',
  Bridge: 'bridge', 'Canonical Bridge': 'bridge', 'Cross Chain Bridge': 'bridge',
  'Liquid Staking': 'stake', 'Liquid Restaking': 'stake', Restaking: 'stake',
  'Staking Pool': 'stake'
};
var TICKET_HOLD = {
  dex: [100, 6], lend: [200, 8], yield: [200, 8], perps: [150, 6],
  rwa: [350, 12], cdp: [200, 8], vault: [350, 12], predict: [100, 6],
  bridge: [100, 4], stake: [200, 8], general: [200, 8]
};
var GROUP_STEPS = {
  dex: [
    'Swap ${t2} through {n}\u2019s main pool on {c} (about ${g} gas, 5 minutes) and keep the transaction hash.',
    'Add the other ${t2} as liquidity in the largest pool and leave it earning fees for the full {h} weeks.',
    'Try a second route once \u2014 a limit order or a different pair \u2014 so the record shows more than one action type.'
  ],
  lend: [
    'Supply ${t2} in a stablecoin to {n} on {c} (about ${g} gas); stablecoins keep the position calm while you learn the market.',
    'Borrow ${t4} against the deposit and keep the health factor above 2.0, so a price swing cannot liquidate you.',
    'Repay half the loan in week 4 and supply again; repeated round-trips count more than one large deposit.'
  ],
  yield: [
    'Deposit ${t2} into {n}\u2019s main vault on {c} (about ${g} gas, 5 minutes) and note the starting share price.',
    'Compound weekly: claim or restake the vault\u2019s rewards every 7 days for {h} weeks, about ${g} gas each time.',
    'Try a second vault or strategy with ${t4} so the record shows breadth, not a single deposit.'
  ],
  perps: [
    'Open a small 1\u20132x position of ${t2} on {n} ({c}, about ${g} gas) and set a stop so a bad week cannot wipe the ticket.',
    'Trade once a week for {h} weeks with varied sizes; one steady week beats one large day in every points system.',
    'Provide ${t4} to the market-making vault if {n} offers one, and leave it for the full hold.'
  ],
  rwa: [
    'Buy or mint ${t2} of {n}\u2019s real-world asset on {c} (about ${g} gas) and confirm the backing documents on the official site.',
    'Hold the position for the full {h} weeks; RWA points reward duration, not turnover.',
    'Redeem a quarter of the position in week 6 and re-mint, showing real use instead of a parked balance.'
  ],
  cdp: [
    'Open a small collateralised position of ${t2} on {n} ({c}, about ${g} gas) and keep the collateral ratio well above the minimum.',
    'Mint a modest amount against the collateral and use it, rather than leaving the debt untouched for {h} weeks.',
    'Top up collateral once mid-hold and repay a slice of the debt, keeping the ratio safe throughout.'
  ],
  vault: [
    'Deposit ${t2} into {n}\u2019s largest vault on {c} (about ${g} gas, 5 minutes) and record the vault address and entry date.',
    'Leave the deposit untouched for the full {h}-week hold; curator points reward deposits that stay, not deposits that hop.',
    'Add ${t4} to a second vault run by a different curator on the same platform to show breadth.'
  ],
  predict: [
    'Place a ${t4} position on a market you follow on {n} ({c}, about ${g} gas) and write down why you took that side.',
    'Take one new position a week for {h} weeks across different markets; breadth beats a single big bet.',
    'Provide liquidity to a market pool if {n} offers one, so you earn fees while the market runs.'
  ],
  bridge: [
    'Bridge ${t2} to {c} through {n} (about ${g} gas, 10 minutes) and confirm the funds arrive before doing more.',
    'Bridge a second, different amount back a week later; two-way flow reads as real use, not a one-off test.',
    'Try a second route or destination chain once, keeping each transfer small and documented.'
  ],
  stake: [
    'Stake ${t2} with {n} on {c} (about ${g} gas) and confirm the staking address matches the official docs.',
    'Restake the rewards weekly for {h} weeks; compounding is the behaviour points systems reward most.',
    'Unstake a small slice in week 6 and restake it, showing an active position rather than a forgotten one.'
  ],
  general: [
    'Use {n}\u2019s main feature once with ${t2} on {c} (about ${g} gas, 5 minutes) and keep the transaction hash.',
    'Return once a week for {h} weeks and repeat the core action with a different size each time.',
    'Try the protocol\u2019s second feature once, so the record shows more than a single repeated click.'
  ]
};
// Eight costed steps. name/category/chain are one dashboard row's fields;
// chain is already the protocol's cheapest chain (main.ts picks it).
function farmStepsFor(name, category, chain) {
  var group = GROUP_OF[category || ''] || 'general';
  var th = TICKET_HOLD[group], ticket = th[0], hold = th[1];
  var gas = (GAS_USD[chain] === undefined ? GAS_DEFAULT : GAS_USD[chain]);
  function sub(s) {
    return s.split('{n}').join(name).split('{c}').join(chain)
      .split('{g}').join(gas.toFixed(2)).split('{t}').join(String(ticket))
      .split('{t2}').join(String(ticket / 2)).split('{t4}').join(String(ticket / 4))
      .split('{h}').join(String(hold));
  }
  var g = GROUP_STEPS[group];
  return [
    'Open ' + name + ' from its official site and connect a single wallet you already use; setting up on ' + chain + ' costs about $' + gas.toFixed(2) + ' in gas and 10 minutes.',
    sub(g[0]), sub(g[1]),
    'Repeat the core action once a week for ' + hold + ' weeks, varying the size each time; ' + hold + ' weekly visits cost under $' + (gas * hold).toFixed(2) + ' in gas in total.',
    sub(g[2]),
    'Keep the position open for the full ' + hold + '-week hold; closing early forfeits the streak most points programmes reward.',
    'Check ' + name + '\u2019s own announcements weekly for a points tally or snapshot date; never connect from a link in a message or an ad.',
    'If a claim opens, claim only from the official site, keep every transaction hash and date, and never share a seed phrase \u2014 a real airdrop never asks for one.'
  ];
}
