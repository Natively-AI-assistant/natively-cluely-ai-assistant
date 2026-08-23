-- ============================================================================
-- READ-ONLY.  SELECT only — no writes, no schema/permission/config changes.
--
-- RUN THIS TWICE, ~10 MINUTES APART, and keep both outputs.
--
-- pg_stat_statements totals are cumulative since `pgss_stats_since` (months old
-- on this database, so they include the 2026-08-14 outage). Subtracting two
-- samples taken 10 minutes apart gives the write rate RIGHT NOW, which is the
-- only number that should drive a fix.
--
-- PG17: checkpoint counters live in pg_stat_checkpointer, not pg_stat_bgwriter.
-- ============================================================================

select jsonb_pretty(jsonb_build_object(

  'sampled_at',      now(),
  'pg_version',      current_setting('server_version'),
  'pgss_stats_since',(select stats_reset from pg_stat_statements_info),
  'db_stats_since',  (select stats_reset from pg_stat_database where datname = current_database()),

  -- Cluster-wide WAL position. The difference between two samples is the exact
  -- number of WAL bytes produced in between — the most useful single number
  -- here, and it needs no per-statement attribution to be meaningful.
  'wal_bytes_total', pg_wal_lsn_diff(pg_current_wal_lsn(), '0/0'),

  'checkpointer',    (select jsonb_build_object(
                        'num_timed',       num_timed,
                        'num_requested',   num_requested,
                        'write_time_ms',   write_time,
                        'sync_time_ms',    sync_time,
                        'buffers_written', buffers_written)
                      from pg_stat_checkpointer),

  -- Directly about the bottleneck: physical reads/writes/fsyncs by context.
  -- 'normal' writes are backend/bgwriter activity; high fsyncs on a burst-credit
  -- volume is what exhausts the budget.
  'io',              (select coalesce(jsonb_agg(x order by x.writes desc), '[]'::jsonb) from (
                        select backend_type, object, context,
                               sum(reads)     as reads,
                               sum(writes)    as writes,
                               sum(extends)   as extends,
                               sum(fsyncs)    as fsyncs,
                               sum(evictions) as evictions
                        from pg_stat_io
                        where coalesce(reads,0) + coalesce(writes,0) + coalesce(fsyncs,0) > 0
                        group by backend_type, object, context
                        order by sum(writes) desc nulls last
                        limit 10
                      ) x),

  'top_wal',         (select coalesce(jsonb_agg(x order by x.wal_raw desc), '[]'::jsonb) from (
                        select substr(query, 1, 70) as query,
                               calls,
                               wal_bytes as wal_raw,
                               wal_fpi   as fpi
                        from pg_stat_statements
                        order by wal_bytes desc
                        limit 12
                      ) x),

  'table_writes',    (select coalesce(jsonb_agg(x order by x.w desc), '[]'::jsonb) from (
                        select relname,
                               n_tup_ins + n_tup_upd + n_tup_del as w,
                               n_tup_ins as ins, n_tup_upd as upd, n_tup_del as del,
                               autovacuum_count as autovac
                        from pg_stat_user_tables
                        order by (n_tup_ins + n_tup_upd + n_tup_del) desc
                        limit 10
                      ) x)

)) as delta_sample;
