# slottelegraph

The office is night-black; oak and telegraph-green baize take the weight of the desk.
A coal-oil lamp pools amber on the blotter. The Morse sounder sits tarnished, coils faintly ozone-sharp.
Each confirmed slot slams the armature and lurches the ticker tape one stamp forward — never a dashboard scroll.
Fee heat flares the lamp and sparks the coils; failed txs garble the Morse and tear a smudge that lingers a beat.
Hold **BREAK** and the circuit opens: the desk keeps its last sample. This is a night instrument, not a product.

Live Solana **mainnet** as a Victorian telegraph office. Not an explorer. Not a dashboard. Not a newspaper.
Distinct from slotswitch (telephone cords), slotwire (bare wire), slotneon (shop tubes), slotradar (CRT),
and slotmutoscope (peephole cards).

Live: https://robertkodes.github.io/slottelegraph/

## How to read the desk

| Desk | Chain |
| --- | --- |
| Sounder click / key cadence | Confirmed slot clock |
| Inked ticker line | A recent transaction |
| Ink hue | Program family: system, JUP, RAY, token, stake, unknown |
| Coil spark / lamp flare / denser tape | `getRecentPrioritizationFees` pressure, log-scaled |
| Garbled Morse, torn or smudged tape | Sampled signature with `err` — lingers a beat longer |
| **BREAK** / Space | Freeze the current desk sample |
| RESUME / Space again | Resume the live wire |

No wallet. No keys. Browser talks JSON-RPC.

## Palette

Named hex, night telegraph desk, six dyes:

| Token | Hex | Use |
| --- | --- | --- |
| **pitch** | `#121610` | Night office, unused corners |
| **oak** | `#5C3A22` | Desk grain, token ink |
| **baize** | `#234033` | Green felt blotter |
| **brass** | `#B08A42` | Sounder, key, JUP ink |
| **amber** | `#E6A23C` | Coal-oil lamp, live digits |
| **ivory** | `#E8D5B0` | Ticker paper, labels |

RAY ember (`#C47A30`) is amber cooled toward oak. Stake leaf (`#4A6A52`) is baize lifted toward ivory. Unknown ash (`#6E6450`) is ivory dimmed into pitch. Lamp-black system ink is pitch with a drop of oak. None is a seventh brand color.

## Type

- **IM Fell English SC** — office plate and BREAK lever. Victorian small-caps, not Inter, not a SaaS geometric.
- **Cutive Mono** — ticker stamps, instrument figures. Reads as a clerk’s ribbon, not a terminal theme.

## Tinkerer notes

```bash
npm i
npm run dev
```

Vite serves at `/slottelegraph/`. Open that path, not `/`.

```bash
npm run build
```

must pass. Static `dist/` is force-pushed to the `gh-pages` branch at root (`index.html`, `assets/`, `.nojekyll`). Repo Pages source should be **branch `gh-pages` / folder `/`**. Enabling Pages via API may return **403** (token cannot write Pages settings). One click: GitHub → Settings → Pages → source **`gh-pages` / root**.

Public RPC, rotating on failure (no API keys):

- `solana-rpc.publicnode.com`
- `solana.publicnode.com`
- `solana-mainnet.publicnode.com`
- `api.mainnet-beta.solana.com`
- `solana.drpc.org`

Override with `VITE_RPC_URL`. Methods: `getSlot`, `getRecentPerformanceSamples`, `getRecentPrioritizationFees`, rotating `getSignaturesForAddress` on a short program roster via `@solana/web3.js`. If RPC flakes, the desk keeps the last tape and the plate marks **degraded**.

`prefers-reduced-motion`: static desk (no armature spring, no tape lurch, no sparks, no lamp flicker); slot / TPS / RTT still update until you hold BREAK.

Space or the BREAK knife-switch freezes the sample. The sounder click is mute until you open **sounder** — and stays silent if Web Audio fails.
