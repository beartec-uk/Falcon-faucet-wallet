-- Additive, non-destructive schema enhancement for uncapped lifetime run totals.
-- NOT applied to production automatically (awaiting Scott's approval).
--
-- Background (audited 2026-11-25):
--   1. arcade_scores already stores daily rows keyed by (network, address, game, day_utc)
--      starting 2026-07-20 UTC (score = best single run that day).
--   2. Run-sum accumulation (progress, runs) and Falcon PL linking (pl_account)
--      started 2026-10-18 UTC. Currently progress caps each run at GAME_MAX_RUN_CREDIT (500)
--      and decrements by 500 on each claim; earned run-credit totals can be reconstructed
--      from progress + (finalized_claims * 500) for post-2026-10-18 rows.
--   3. To persist uncapped raw run-score sums separately from claim progress going forward,
--      apply this additive column + index (no existing columns or rows are altered/deleted).

ALTER TABLE arcade_scores
  ADD COLUMN IF NOT EXISTS total_run_score DOUBLE PRECISION NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS arcade_scores_pl_day_idx
  ON arcade_scores (network, pl_account, day_utc)
  WHERE pl_account IS NOT NULL;
