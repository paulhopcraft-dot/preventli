# 1. Claim cost framing — show implications, not premium estimates

**Date:** 2026-05-18
**Status:** Accepted
**Slice:** funding-bundle 2.1

## Context

For the funding-bundle build we needed to surface a "$ impact" number per case. The instinct was to call it a "premium impact calculator" and pitch it as "this case costs you $X in premium." This would be:

- **Technically deniable** — WorkSafe Victoria (and equivalent state authorities) are the underwriters. They calculate premiums using complex multi-year formulas with industry-classification multipliers, claims experience, and remuneration data. No third party can replicate this accurately.

- **Politically risky** — Preventli's funding path benefits enormously from WorkSafe as partner-of-record. Positioning ourselves as "we predict premiums better than WorkSafe" would be read as encroaching on the regulator's role. WorkSafe is the gatekeeper for any official endorsement that funders want to see.

- **Defensibility weak** — in a WorkSafe audit, "Preventli told us this case would cost $X in premium" is unsupportable. Auditors can disprove the number by reference to the actual premium formula.

## Decision

Reframe the per-case dollar number as **estimated claim cost implications**, not premium estimates.

The number shown represents:
- Estimated cost-to-employer of the case in current state (duration × baseline + severity adjustments)
- Computed from the **client's own historical case data** (their dollars, their averages)
- NOT from industry/scheme coefficients
- NOT presented as a premium prediction

Every UI surface that displays the number MUST include a visible disclaimer: **"Estimated claim cost — for implication only. Actual premium impact is determined by WorkSafe Victoria."**

## Alternatives considered

- **"Premium impact calculator"** — rejected (see Context). Looks adversarial to WorkSafe and is unsupportable in audit.
- **No dollar number, qualitative only** — rejected. Funders + WorkSafe both ask for the quantitative case. Qualitative-only loses the demo moment.
- **Industry-coefficient estimate (e.g. ABS/Safe Work Australia data)** — rejected. Generic averages don't reflect a specific employer's actual cost basis, and we'd still be implying premium prediction.

## Consequences

**Makes easy:**
- Demo line: "Marcus's case is currently sitting at $42k estimated claim cost — down from $61k peak last week as the RTW plan caught hold." Defensible because it's the client's own data.
- WorkSafe positioning: we estimate implications, they determine premium. Clear separation of role.
- Per-client tuning: averages come from their own historical cases, so the number is contextual.

**Makes hard:**
- Phase 2 needs the client to have meaningful historical case data before the estimate is non-trivial. Wallara has 5 demo cases — enough for proof-of-concept but not a robust average. The estimate for a NEW client will be coarse until they accumulate cases.
- Fallback for cold-start: when the client has <N historical cases, use a labeled "industry baseline (last updated YYYY-MM-DD)" with explicit citation. This is OK because we're estimating implications, not predicting premiums.

**Revisit if:**
- A funder explicitly requests a premium prediction (push back; explain the framing).
- WorkSafe expresses interest in a co-branded "premium impact" feature (then it stops being adversarial — different conversation).
- Industry coefficient sources update meaningfully.

## Schema implications

- Table: `case_cost_estimates` (renamed from `case_premium_impacts`)
- API: `GET /api/cases/:id/cost-estimate` (renamed from `/premium-impact`)
- Component: `<ClaimCostCard>` (renamed from `<PremiumImpactCard>`)
- Portfolio component: `<PortfolioCostCard>` (renamed from `<PortfolioImpactCard>`)
- Config: `config/cost-estimate-formula.ts` (renamed from `config/premium-formula.ts`)

The number stored on the case has fields: `estimatedCostDollars`, `componentBreakdown`, `formulaVersion`, `baselineSource` (one of "client_history" | "industry_baseline"), `calculatedAt`.

## Disclaimer string (canonical)

> Estimated claim cost — for implication only. Actual premium impact is determined by WorkSafe Victoria.

This string MUST appear on:
1. `<ClaimCostCard>` (case detail)
2. `<PortfolioCostCard>` (CFO dashboard)
3. The JSON response of `GET /api/cases/:id/cost-estimate` as a `disclaimer` field
4. Any export of cost data (PDF report, CSV, etc.)

Verify scripts grep for the string to ensure it isn't accidentally removed.
