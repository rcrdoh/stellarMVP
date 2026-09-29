# React ACP x402 frontend — Phase 0 recon

Recon for the SDD *Frontend: Autonomous Agentic Commerce (ACP x402 on Stellar)*.
This file records every `[VERIFY]` resolution, the final package choices, and the
**blocking mismatches between the SDD and the backend contract**. Per §0.4
("the backend wins and the UI adapts") and §0.1 ("if a decision blocks you, stop
and report it"), the mismatches below change the checkout design and are called
out for a decision before Phase 6.

Recon only — no code was changed. Sources inspected:
`scripts/serve-ui.ts`, `package.json`, `tsconfig*.json`, `specs/openapi.json`
(via `bun run spec:check`), `src/domain/payments.ts`, `src/domain/agents/*`,
`src/services/payment-intent-service.ts`, `src/http/payment-routes.ts`,
`src/services/agents/shopping-agent.ts`, `tests/*`.

## 1. Repository integration facts

| Topic | Finding |
| --- | --- |
| Runtime | Bun `1.4.2` (engines `>=1.4.0`). |
| Branch at recon | `feature/code-base` at `b686d1f`. SDD asks for a new `feature/react-acp-frontend` branch. |
| Dev server | `scripts/serve-ui.ts` bundles `src/ui/browser/entry.ts` with `Bun.build`, serves `src/ui/index.html`, and proxies `/v1/*` → `UI_API_TARGET` (default `http://127.0.0.1:3000`). Port **3001** (`UI_PORT`). The proxy accepts a second optional argument `UI_HOST` (default `127.0.0.1`). |
| Entry today | `index.html` is read once at boot and served for `/` and `/index.html`; the bundle is served for `/entry.js`. A React entry can follow the exact same pattern behind a flag. |
| `check-types` | `tsconfig.check.json` includes `src/**/*.ts`. Since `src/react-app/**` lives under `src/`, `tsc` already covers it — but it currently has **no `.tsx`** in `include`, and `tsconfig.json` lacks `"jsx": "react-jsx"`. Both MUST be added (see §3 of the SDD). |
| Lint | Biome `2.5.10` (`biome.json`) lints `src/**`. New `.tsx` files are covered once created; verify formatter config for JSX. |
| Tests | `bun test`; DOM tests use `happy-dom` (`Window`) and install `document`/`window`/`HTMLElement` onto `globalThis` (see `tests/ui.test.ts`). No `@testing-library/react` yet. |
| Existing `data-role` contract | Only `cart-items`, `cart-checkout`, `cart-subtotal`, `cart-close`, `cart-badge`, `cart-toggle`, `problem`, `empty` are asserted today (in `tests/ui.test.ts`). The SDD §11 list (`search-form`, `cart-toggle`, `cart-badge`, `cart-checkout`, `wallet-slot` …) is **not** currently enforced for `search-form` or `wallet-slot`; add them in the React app to satisfy §11. |

## 2. Dependency resolutions ([VERIFY] items)

| SDD item | Resolution |
| --- | --- |
| D6 — wallet kit package name | **Already installed: `@creit.tech/stellar-wallets-kit@^2.7.0`.** The SDD's `@credo/stellar-wallets-kit` does not exist here; use `@creit.tech/stellar-wallets-kit`. Wrap behind `WalletController` (SDD §8.2). |
| `@stellar/stellar-sdk` | Already installed (`^17.1.0`). Used for out-of-band helpers (e.g. network passphrases, XDR sanity checks). |
| React | **Not installed.** `react`/`react-dom` resolve to `19.3.0` on npm. SDD titles the work "React 18"; React 19 is available and is the current major. Decision needed (see §5, Q-A). |
| `@types/react` `@types/react-dom` | Not installed. Add as dev deps. |
| Tailwind | **Not installed.** Bun `1.4.2` supports `bun-plugin-tailwind` (Tailwind v4). This is the simplest path with no Vite/Next — recommended. `tailwind.config` tokens map from `tokens.css`. |
| Fonts | `@fontsource/inter`, `@fontsource/geist-mono` — not installed; add (SDD §3). |
| Test libs | `happy-dom` already present. `@testing-library/react` NOT present. Either add it (SDD allows) or test components through `react-dom/client` + `happy-dom` directly to avoid a new dep. Default: add `@testing-library/react` only if component tests need it; otherwise use `react-dom/client` render + `act`. |
| Streaming format ([VERIFY] §8) | **`POST /v1/agent/catalog/search` is a single JSON response** (`CatalogSearchResponse { results, count, fallback }`), **not** NDJSON/SSE. There is no streaming; the SDD's `streamSearch` async-generator shape does not match the backend. See §4 below. |
| Auth headers ([VERIFY] §8) | `/v1/agent/*` requires `agentToken` (bearer). Payment-intents require `serviceToken` (bearer) **plus** `x-principal-id` on every call, and `Idempotency-Key` on create. The dev server proxy forwards headers, so the app must be able to supply these — see §4 (blocker). |
| Phase events ([VERIFY] §10.4) | No phase events in the catalog response. The indigo "Discovering/Ranking" label MUST be omitted, or driven purely client-side. Default: omit. |
| Multi-asset carts ([VERIFY] §7.2) | **Not supported.** `PaymentIntent` is hard-wired to `assetCode: "USDC"`, `assetDecimals: 7` (`src/domain/payments.ts`). Reject mixed assets as the SDD already specifies. **§17 Q2 answered: no multi-asset carts.** |
| Spending policies ([VERIFY] §10.8) | **No `SpendPolicy` endpoint exists** in `specs/openapi.json` (no such schema). Panels stay **local preview only**, labelled "Preview". **§17 Q2 answered: no policy endpoint.** |
| Horizon health for console (§10.8) | No backend proxy for Horizon health beyond `/v1/health/*`. Best-effort direct `GET` of each network's Horizon root from the browser will hit CORS for non-localhost networks. Plan: mark hosted networks "unreachable (cross-origin)" rather than failing, or drive status only for the active network via the existing `/v1/health/ready`. |
| Legacy `src/ui/` | SDD non-goal to replace it on this branch. `ui:dev` MUST keep serving the legacy UI by default. |

## 3. Backend contract — exact shapes (authoritative)

Extracted from `specs/openapi.json` and `src/domain/payments.ts`. **These
supersede the SDD's §6/§8 sketches.**

### 3.1 Catalog search — `POST /v1/agent/catalog/search` (agentToken, scope `agent:search`)

Request (`CatalogSearchRequest`, `additionalProperties: false`, exactly one of
`queryText` or `vector` required):

```jsonc
{ "queryText": "wireless headphones", "category": "electronics",
  "maxPrice": 250, "minScore": 0.6, "limit": 10 }
```

Response `200` (`CatalogSearchResponse`):

```jsonc
{ "results": [
    { "id": "…", "merchantId": "…", "title": "…", "description": "…",
      "price": 129.99, "currency": "USD", "category": "electronics",
      "inStock": true, "metadata": {},
      "url": "https://…", "score": 0.98 } ],
  "count": 1, "fallback": false }
```

Notes:
- `MerchantProduct` prices are **numbers** (`price`, `exclusiveMinimum: 0`) in a
  minor-unit-free decimal; currency defaults to `"USD"`. This is the *offer*
  representation, distinct from the Stellar `USDC` settlement asset.
- `score` is `0..1` (optional) → `matchScore`. `merchantId` is the merchant;
  there is no `merchant` name field — display `merchantId`.
- The SDD's `Offer { id, title, merchant, price: Money, matchScore, url }` maps to
  this as `id = id`, `title = title`, `merchant = merchantId`,
  `price = { amount: String(price), asset: currency }` (display only),
  `matchScore = score ?? 0`.
- Errors: `401/403/422/429/503` RFC 9457 `Problem`.

### 3.2 Create intent — `POST /v1/payment-intents` (serviceToken)

Headers: `x-principal-id` (required), `Idempotency-Key` (required, 8..128).
Body (`createPaymentIntentRequestSchema`): **`{ "quoteId": "…" }` only.**

Response `201`/`200` (`PaymentIntent`): `intentId` (uuid), `quoteId`, `orderId`,
`principalId`, `quoteHash`, `idempotencyKey`, `requestFingerprint`, `status`
(`awaiting_signature|submitting|submitted|confirmed|failed|expired`),
`networkPassphrase`, `payerAddress`, `assetCode: "USDC"`, `assetIssuer`,
`assetDecimals: 7`, `totalAmountAtomic` (stroops string), `paymentLeg`,
**`unsignedXdr`** (string, up to 100k — the wallet signs this),
`transactionHash`, `ledger`, `expiresAt`, `createdAt`, `updatedAt`.

### 3.3 Submit — `POST /v1/payment-intents/{intentId}/submission` (serviceToken)

Headers: `x-principal-id`. Body (`submitPaymentTransactionRequestSchema`):
**`{ "signedXdr": "…" }`.** Responses: `200` (terminal `PaymentIntent`) or `202`
(pending reconciliation) → `PaymentIntent`.

> **Path differs from the SDD.** SDD §8 says `POST /v1/payment-intents/submission`;
> the spec is `POST /v1/payment-intents/{intentId}/submission`. Use the spec path.

### 3.4 Reconcile — `POST /v1/payment-intents/{intentId}/reconcile` (serviceToken)

Headers: `x-principal-id`. Optional body (`ReconcilePaymentRequest`):
`{ "transactionHash"?: "…" }`. Response `200`: **`PaymentReceipt`** —
`intentId`, `orderId`, `status` (`pending_confirmation|submitted|paid|failed`),
`transactionHash`, `ledger`, `amountAtomic`, `assetCode`, `payerAddress`,
`networkPassphrase`, `confirmedAt?`, `updatedAt`, **`stellarExpertUrl`** (use this
for the explorer link in §10.7).

> A batch variant `POST /v1/payment-intents/reconcile` also exists (not needed).

### 3.5 Errors — RFC 9457 `Problem`

```jsonc
{ "type": "…", "title": "…", "status": 409, "code": "SVC-XXX-0000",
  "category": "VALIDATION|AUTHN_AUTHZ|DECISION_DENY|STATE_CONFLICT|DEPENDENCY|INDETERMINATE|INTERNAL",
  "detail_key": "…", "behavior": {…}, "correlation": {…}, "occurred_at": "…" }
```

`additionalProperties: false`. The SDD's `ProblemDetails` sketch must be aligned:
there is **no `detail`** field — the human string is `title` (and `detail_key` for
i18n). `ProblemBanner` (§10.9) should render `status · title` and
`code`/`detail_key`, not `${detail} (${code})`.

## 4. Blocking mismatches (SDD vs backend) — decision required

These are the "stop and report" items. Everything else can be built as written.

**B1 — The checkout cannot be driven from a cart alone.**
`createPaymentIntent` accepts **only a `quoteId`**; amounts, payer, asset and
expiry all come from a server-side **approved quote** resolved from
`paymentQuoteApprovalStore`. There is no public HTTP endpoint to create a quote;
quotes are produced by the agent shopping graph (`/v1/agent/shopping`,
`approve_quote` interrupt → `saveApprovedQuote`), which requires the agent
runtime (Redis, DB, LLM keys) enabled.
→ A UI that goes *cart → Confirm & Pay → POST /v1/payment-intents* has **no
`quoteId` to send**. The SDD's checkout state machine (§9, stages 1–2) presupposes
a quote-creation step that the backend does not expose over HTTP.

**B2 — Auth model.** The browser app has no credentials. `/v1/agent/*` needs an
`agentToken` with scopes; payment-intents need a `serviceToken` + `x-principal-id`.
A browser app cannot hold a service token safely. The dev proxy forwards headers
but does not inject them.

**B3 — Streaming.** §8/§10.4 assume a streamed, progressively-rendered search.
The endpoint is a single JSON response. Skeleton→progressive replacement is not
backed by the API.

Consequence: SDD §15 acceptance criteria for **Phase 6** ("walks all
`ACP_STAGES.length` stages to settlement") and parts of **Phase 4** ("skeletons
appear then resolve incrementally") **cannot be met against the real backend**
without either (a) a backend quote/agent facade, or (b) the UI being built and
tested against mocked endpoints/fetch — which the SDD already permits for tests
("mocked fetch + Fake wallet") but which would still leave the manual DoD
(checkout §16) non-runnable end-to-end.

### Proposed handling (option chosen unless you object)

Build the full React app per the SDD, with the backend contract corrected to
§3 above, and:
- `lib/api.ts` implements the **real** shapes/paths (§3), abstracted behind small
  client interfaces (`CatalogClient`, `PaymentClient`) so both real and mock
  implementations exist.
- The **manual end-to-end DoD** (§16) is gated on enabling the agent+payments
  runtime; document the required `.env` and note that without it the checkout
  runs against the mock client (`?mockCheckout=1` style dev flag, never in prod).
- `streamSearch` becomes `search()` returning `Offer[]`; the skeleton state
  covers the **single in-flight request** (still useful, no CLS), not batches.
- All Phase-6 integration tests use a mocked fetch + `FakeWalletController`
  (explicitly allowed by SDD §15) and assert `ACP_STAGES.length`.

This keeps every SDD requirement (R1/R2/R3, `data-role`s, 5 stages, tests)
while not inventing a nonexistent backend capability.

## 5. Open questions carried to the PR

- **Q-A (new):** React version — SDD says **18** in the title, npm latest is
  **19.3.0**. Propose React 19 (current, no code differences for this app) unless
  18 is required. — *needs your call.*
- Q1 (SDD §17): primary-button foreground — keep white on `#10b981` (spec) or
  switch to `#022c22` for WCAG AA? Exposed as `--btn-primary-fg`; default =
  spec (white).
- Q2 (SDD §17): **Answered** — no multi-asset carts (USDC-only
  `PaymentIntent`); no spending-policy endpoint.
- Q3 (SDD §17): **Answered** — `catalog/search` returns a single JSON
  `CatalogSearchResponse`; no streaming, no phase events.
- Q4 (SDD §17): legacy `src/ui/` removal — defer to a follow-up once the React
  app reaches parity; out of scope here.

## 6. Phase 0 acceptance

- [x] Every `[VERIFY]` answered or explicitly deferred (see §2–§4).
- [x] Final package names/versions recorded (§2; wallet kit = `@creit.tech/stellar-wallets-kit@2.7.0`).
- [x] Blocking SDD↔backend mismatches surfaced with a proposed handling (§4).
- [ ] **Awaiting your decision on B1/B2 handling and Q-A (React 18 vs 19)** before Phase 1.
