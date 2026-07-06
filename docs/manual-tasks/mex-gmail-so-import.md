# Manual Task: Import MEX SO Emails To PSI

This is a manually triggered Codex task for importing MEX weekly SO data from Gmail into Supabase `weekly_psi_v2`.

Use this when Chris asks something like:

> Execute the MEX Gmail SO import task.

Do not run this on a schedule. The task depends on selecting the intended Gmail messages and confirming the week mapping.

## Scope

- Source: Gmail messages forwarded by Lukasz containing MEX SO table text.
- Destination: Supabase project `INIU-EMEA-ERP-by-HAND`, table `public.weekly_psi_v2`.
- Country / KA: `PL / MEX`.
- Metric: retailer SO, so write `Sprzed T-1 total` to `so_qty`.
- Do not write inventory unless the source includes a stock column.

## Required Connectors

- Gmail connector: search/read emails.
- Supabase connector: read/write `sku_alias` and `weekly_psi_v2`.

## Fixed Data Model Rules

### Country And KA

Query before import:

```sql
select c.id as country_id, c.code as country_code, k.id as ka_id, k.name as ka_name
from public.country c
join public.ka k on k.country_id = c.id
where c.code = 'PL' and k.name = 'MEX';
```

Expected:

```text
country_id = 2
ka_id = 11
```

Use queried values if they ever differ.

### Week Calculation

Use the original email date in the forwarded body, not necessarily the Gmail received timestamp of Lukasz's forward.

Examples:

```text
Sent: Monday, June 1, 2026 15:34   -> 2026W23, week_start 2026-06-01
Sent: Monday, June 8, 2026 15:18   -> 2026W24, week_start 2026-06-08
Sent: Tuesday, June 16, 2026 13:22 -> 2026W25, week_start 2026-06-15
```

Use Postgres to verify week labels:

```sql
select
  to_char(d::date, 'IYYY"W"IW') as week_label,
  date_trunc('week', d::date)::date as week_start
from (values ('YYYY-MM-DD')) v(d);
```

### Metric Mapping

MEX is a retailer, so:

| Source column | Destination column |
|---|---|
| `Sprzed T-1 total` | `so_qty` |
| stock column, if present | `stock_qty` |
| blank SO cell | `0` |
| blank stock cell | `0` only when importing stock from a stock-bearing file; otherwise leave `stock_qty` null |
| no SI data | `si_qty = null` |
| no ST data | `st_qty = null` |

If importing SO-only emails, do not clear existing `stock_qty` during upsert.

## SKU Alias Rules

Before importing, ensure every MEX `KOD` resolves through `public.sku_alias.alias_norm`.

Current MEX mapping:

| KOD | SKU code |
|---|---|
| `2058115` | `C11-P1` |
| `2058116` | `C12-P1` |
| `2124322` | `C11-P1-Blue` |
| `2124321` | `C11-P1-Orange` |
| `2058117` | `C21-P1` |
| `2058118` | `C22-P1` |
| `2128090` | `CD11` |
| `2108297` | `PX51` |
| `2058110` | `P72-P1` |
| `2058113` | `P76-P1-Black` |
| `2092883` | `PM61-Titan` |
| `2058114` | `P76-P1-White` |
| `2092886` | `PX11` |
| `2058104` | `P61L-P1` |
| `2092880` | `PPT01-Black` |
| `2058103` | `P41L-P1` |
| `2058107` | `PPT51` |
| `2077413` | `P62-P1` |
| `2092887` | `PX21` |
| `2058105` | `P51L-P1` |
| `2058108` | `P63-P1` |
| `2058109` | `P64-P1` |
| `2119629` | `P75-P1-Blue` |
| `2119628` | `P75-P1-Orange` |
| `2058111` | `P75-P1-Black` |
| `2092882` | `P75-P1-DesertTitan` |
| `2092881` | `P75-P1-Titan` |
| `2058112` | `P75-P1-White` |

Important product decisions:

- `2092883` is `PM61-Titan`.
- `2058107` slim is `PPT51`.
- `2092880` small is `PPT01-Black`.
- `2108297` MagPro Neo 10K currently defaults to `PX51`.

Insert missing aliases only:

```sql
insert into public.sku_alias (alias_norm, sku_id, note)
select m.alias_norm, s.id, 'MEX PSI KOD'
from (values
  ('2058115', 'C11-P1')
) as m(alias_norm, sku_code)
join public.sku s on s.code = m.sku_code
on conflict (alias_norm) do nothing;
```

Never overwrite existing aliases unless Chris explicitly confirms a correction.

## Gmail Search Workflow

Start broad, then narrow:

```text
from:lukasz has:attachment -in:trash newer_than:90d
from:lukasz (MEX OR mex OR SO OR stock OR sales) -in:trash newer_than:90d
from:mariusz (Iniu OR iniu OR MEX OR mex) -in:trash newer_than:90d
```

Read the candidate messages. Target messages usually have:

```text
Subject: Fw: Iniu
From: Lukasz Lyzwa
Body contains forwarded original:
From: Mariusz Wegner
Subject: Iniu
KOD / GRUPA / NAZWA / Sprzed T-1 total
```

If the data appears in the body, parse the body directly. If a real spreadsheet attachment exists, read the attachment and parse the workbook.

## Parsing Body Tables

The body can be line-broken like this:

```text
KOD
GRUPA
NAZWA
Sprzed T-1 total

2119629
LADOWARKI PRZENOSNE
POWERBANK 5000 MAH INIU MAGPRO SLIM BLUE
525
```

Parse records by `KOD`, then consume the next two text lines as group/name, and the next numeric line as SO. If the next record starts immediately, treat SO as `0`.

Use the `KOD` as the reliable key; product names are for audit notes only.

## PSI Upsert Pattern

Use the functional unique index:

```sql
on conflict (
  country_id,
  ka_id,
  sku_id,
  iso_year,
  iso_week,
  (COALESCE(through_ka_id, 0::bigint))
)
```

SO-only email import:

```sql
on conflict (...) do update set
  week_label = excluded.week_label,
  week_start = excluded.week_start,
  so_qty = excluded.so_qty,
  source = excluded.source,
  source_file = excluded.source_file,
  notes = excluded.notes,
  updated_at = now()
```

Do not set `stock_qty = excluded.stock_qty` for SO-only emails.

Stock-bearing file import may update both `so_qty` and `stock_qty`.

## Verification

Validation is required after every database write. Do not report success until these checks pass.

After import, verify each target week:

```sql
select
  iso_year,
  iso_week,
  week_label,
  week_start,
  count(*) as rows,
  sum(coalesce(so_qty, 0)) as so_qty,
  sum(coalesce(stock_qty, 0)) as stock_qty
from public.weekly_psi_v2 w
join public.country c on c.id = w.country_id
join public.ka k on k.id = w.ka_id
where c.code = 'PL'
  and k.name = 'MEX'
  and iso_year = 2026
  and iso_week in (23, 24, 25, 26)
group by iso_year, iso_week, week_label, week_start
order by iso_week;
```

Also spot-check important SKUs:

```sql
select w.week_label, s.code, w.so_qty, w.stock_qty, w.source, w.notes
from public.weekly_psi_v2 w
join public.country c on c.id = w.country_id
join public.ka k on k.id = w.ka_id
join public.sku s on s.id = w.sku_id
where c.code = 'PL'
  and k.name = 'MEX'
  and s.code in ('P75-P1-Blue', 'PX51', 'PM61-Titan', 'PPT01-Black', 'PPT51')
order by w.iso_week, s.code;
```

For SO-only email imports, explicitly confirm:

- Row count matches the number of parsed KOD rows for each week.
- `sum(so_qty)` matches the parsed email total for each week.
- `week_label` and `week_start` match the original email date's ISO week.
- Every parsed `KOD` resolves to exactly one `sku_id`.
- `stock_qty` was not cleared or overwritten by the SO-only upsert.
- Ambiguous or unmatched rows are reported instead of silently skipped.

## Final Response Format

Report:

- Gmail messages used, with original email dates.
- Week labels imported.
- Row count per week.
- SO total per week.
- Whether stock was written or left untouched.
- Validation results after the write.
- Any unmatched KODs or ambiguous rows.
