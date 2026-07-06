const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

// Weekly PO default: use missing-sql / insert-only-sql. merge-sql is non-default
// and should only be used when the user explicitly approves updating old rows.
const sourceDir = "/Users/chrisyao/Desktop/线下零售渠道发货记录表周度整理";

function findLatestSource() {
  const files = fs.readdirSync(sourceDir)
    .map((name) => {
      const match = name.match(/^线下零售渠道发货记录表w(\d+)\.xls$/);
      return match ? { name, week: Number(match[1]), fullPath: path.join(sourceDir, name) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.week - a.week);

  if (files.length === 0) {
    throw new Error(`No weekly xls files found in ${sourceDir}`);
  }
  return { latest: files[0], ignored: files.slice(1) };
}

function excelDate(value) {
  if (value == null || value === "" || value === "-") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    const date = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d));
    return date.toISOString().slice(0, 10);
  }
  const text = String(value).trim();
  if (!text || text === "-") return null;
  const direct = new Date(text);
  if (!Number.isNaN(direct.getTime())) return direct.toISOString().slice(0, 10);
  const match = text.match(/^(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})$/);
  if (match) {
    return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
  }
  return null;
}

function text(value) {
  if (value == null) return "";
  return String(value).trim();
}

function num(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const cleaned = String(value).replace(/,/g, "").trim();
  if (!cleaned || cleaned === "-") return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function intQty(value) {
  const parsed = num(value);
  if (parsed == null || parsed < 0) return null;
  return Math.trunc(parsed);
}

function sqlString(value) {
  if (value == null || value === "") return "null";
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlNumber(value) {
  return value == null || Number.isNaN(value) ? "null" : String(value);
}

function parseSource() {
  const { latest, ignored } = findLatestSource();
  const wb = XLSX.readFile(latest.fullPath, { cellDates: false, raw: true });
  const sheet = wb.Sheets["PO Details"];
  if (!sheet) throw new Error("PO Details sheet not found");
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: true });

  const regionCounts = {};
  const europeRows = [];
  const valid = [];
  const skipped = [];
  const newQtyRows = [];

  for (let i = 2; i < rows.length; i += 1) {
    const row = rows[i] || [];
    const region = text(row[0]);
    if (region) regionCounts[region] = (regionCounts[region] || 0) + 1;
    if (region !== "Europe") continue;

    const sourceRow = i + 1;
    const item = {
      source_row: sourceRow,
      po_number: text(row[1]) || null,
      po_date: excelDate(row[2]),
      customer: text(row[5]) || null,
      part_number: text(row[7]) || null,
      qty_ordered: intQty(row[9]),
      new_qty: text(row[10]) || null,
      fd_buying_price: num(row[12]),
      turnover: num(row[13]),
      currency: text(row[15]) || null,
      ship_date: excelDate(row[26]),
      delivery_date: excelDate(row[28]),
    };
    europeRows.push(item);
    if (item.new_qty) newQtyRows.push(item);

    const partNorm = (item.part_number || "").toLowerCase();
    const skipReasons = [];
    if (!item.po_date) skipReasons.push("missing_po_date");
    if (!item.customer) skipReasons.push("missing_customer");
    if (!item.part_number) skipReasons.push("missing_part_number");
    if (item.qty_ordered == null) skipReasons.push("missing_or_invalid_qty");
    if (!item.currency) skipReasons.push("missing_currency");
    if (
      partNorm.includes("expositor")
      || partNorm === "c11+c12"
      || partNorm === "wal101+c11"
      || partNorm.includes("hanger")
      || partNorm.includes("zawieszka")
    ) skipReasons.push("non_product");

    if (skipReasons.length) {
      skipped.push({ ...item, reason: skipReasons.join("+") });
    } else {
      valid.push(item);
    }
  }

  return { latest, ignored, regionCounts, europeRows, valid, skipped, newQtyRows };
}

function valuesSql(rows) {
  return rows.map((r) => `(${[
    sqlNumber(r.source_row),
    sqlString(r.po_number),
    sqlString(r.po_date),
    sqlString(r.customer),
    sqlString(r.part_number),
    sqlNumber(r.qty_ordered),
    sqlNumber(r.fd_buying_price),
    sqlNumber(r.turnover),
    sqlString(r.currency),
    sqlString(r.ship_date),
    sqlString(r.delivery_date),
    sqlString(r.new_qty),
  ].join(", ")})`).join(",\n");
}

function cte(rows, sourceFile) {
  return `with src(source_row, po_number, po_date, customer_raw, part_raw, qty_ordered, fd_buying_price, turnover, currency, ship_date, delivery_date, new_qty) as (
  values
${valuesSql(rows)}
),
src_norm as (
  select *,
    lower(regexp_replace(trim(customer_raw), '\\s+', ' ', 'g')) as customer_norm,
    trim(part_raw) as part_trim,
    lower(trim(part_raw)) as part_norm
  from src
),
mapped as (
  select
    s.*,
    coalesce(k_alias.id, k_name.id) as ka_id,
    coalesce(k_alias.country_id, k_name.country_id) as country_id,
    coalesce(sku_exact.id, sku_alias.sku_id, sku_clean.id, sku_clean_alias.sku_id) as sku_id,
    coalesce(sku_exact.code, sku_alias_code.code, sku_clean.code, sku_clean_alias_code.code) as sku_code,
    ${sqlString(sourceFile)}::text as source_file
  from src_norm s
  left join public.ka_alias kaa on kaa.alias_norm = s.customer_norm
  left join public.ka k_alias on k_alias.id = kaa.ka_id
  left join public.ka k_name on lower(trim(k_name.name)) = s.customer_norm
  left join public.sku sku_exact on lower(sku_exact.code) = s.part_norm
  left join public.sku_alias sku_alias on sku_alias.alias_norm = s.part_norm
  left join public.sku sku_alias_code on sku_alias_code.id = sku_alias.sku_id
  left join public.sku sku_clean on lower(sku_clean.code) = regexp_replace(s.part_norm, '-1p$', '')
  left join public.sku_alias sku_clean_alias on sku_clean_alias.alias_norm = regexp_replace(s.part_norm, '-1p$', '')
  left join public.sku sku_clean_alias_code on sku_clean_alias_code.id = sku_clean_alias.sku_id
)`;
}

function withSlice(data) {
  const start = process.argv[3] == null ? 0 : Number(process.argv[3]);
  const count = process.argv[4] == null ? data.valid.length : Number(process.argv[4]);
  return { ...data, valid: data.valid.slice(start, start + count), sliceStart: start, sliceCount: count };
}

function dryRunSql(data) {
  return `${cte(data.valid, data.latest.name)}
select
  count(*) as valid_rows,
  count(*) filter (where ka_id is null or country_id is null) as unmapped_customer_rows,
  count(*) filter (where sku_id is null) as unmapped_sku_rows,
  json_agg(json_build_object('source_row', source_row, 'po_number', po_number, 'customer', customer_raw, 'qty', qty_ordered) order by source_row)
    filter (where ka_id is null or country_id is null) as unmapped_customers,
  json_agg(json_build_object('source_row', source_row, 'po_number', po_number, 'customer', customer_raw, 'part_number', part_raw, 'qty', qty_ordered) order by source_row)
    filter (where sku_id is null) as unmapped_skus
from mapped;`;
}

function mergeSql(data) {
  return `${cte(data.valid, data.latest.name)},
ready as (
  select * from mapped where ka_id is not null and country_id is not null and sku_id is not null
),
matched as (
  select
    p.id,
    r.*,
    (
      p.ka_id is not distinct from r.ka_id
      and p.qty_ordered is not distinct from r.qty_ordered
      and p.fd_buying_price is not distinct from r.fd_buying_price
      and p.turnover is not distinct from r.turnover
      and p.currency is not distinct from r.currency
      and p.ship_date is not distinct from r.ship_date::date
      and p.delivery_date is not distinct from r.delivery_date::date
      and p.source_file is not distinct from r.source_file
      and p.source_row is not distinct from r.source_row
    ) as unchanged
  from ready r
  left join public.channel_po p
    on p.po_number is not distinct from r.po_number
   and p.sku_id = r.sku_id
   and p.country_id = r.country_id
   and p.po_date = r.po_date::date
),
updated as (
  update public.channel_po p
  set
    ka_id = m.ka_id,
    qty_ordered = m.qty_ordered,
    fd_buying_price = m.fd_buying_price,
    turnover = m.turnover,
    currency = m.currency,
    ship_date = m.ship_date::date,
    delivery_date = m.delivery_date::date,
    source_file = m.source_file,
    source_row = m.source_row
  from matched m
  where p.id = m.id and m.id is not null and not m.unchanged
  returning p.id
),
inserted as (
  insert into public.channel_po (
    country_id, ka_id, sku_id, po_date, qty_ordered, fd_buying_price, turnover, currency,
    po_number, ship_date, delivery_date, source_file, source_row
  )
  select
    country_id, ka_id, sku_id, po_date::date, qty_ordered, fd_buying_price, turnover, currency,
    po_number, ship_date::date, delivery_date::date, source_file, source_row
  from matched
  where id is null
  returning id
)
select
  (select count(*) from inserted) as inserted,
  (select count(*) from updated) as updated,
  (select count(*) from matched where id is not null and unchanged) as unchanged,
  (select count(*) from ready) as ready_rows;`;
}

function insertOnlySql(data) {
  return `${cte(data.valid, data.latest.name)},
ready as (
  select * from mapped where ka_id is not null and country_id is not null and sku_id is not null
),
missing as (
  select r.*
  from ready r
  left join public.channel_po p
    on p.po_number is not distinct from r.po_number
   and p.sku_id = r.sku_id
   and p.country_id = r.country_id
   and p.po_date = r.po_date::date
  where p.id is null
),
inserted as (
  insert into public.channel_po (
    country_id, ka_id, sku_id, po_date, qty_ordered, fd_buying_price, turnover, currency,
    po_number, ship_date, delivery_date, source_file, source_row
  )
  select
    country_id, ka_id, sku_id, po_date::date, qty_ordered, fd_buying_price, turnover, currency,
    po_number, ship_date::date, delivery_date::date, source_file, source_row
  from missing
  returning id
)
select
  (select count(*) from ready) as ready_rows,
  (select count(*) from missing) as missing_rows,
  (select count(*) from inserted) as inserted_rows;`;
}

function missingOnlySql(data) {
  return `${cte(data.valid, data.latest.name)},
ready as (
  select * from mapped where ka_id is not null and country_id is not null and sku_id is not null
),
missing as (
  select r.*
  from ready r
  left join public.channel_po p
    on p.po_number is not distinct from r.po_number
   and p.sku_id = r.sku_id
   and p.country_id = r.country_id
   and p.po_date = r.po_date::date
  where p.id is null
)
select
  count(*) as ready_rows,
  count(*) filter (where ka_id is null or country_id is null) as unmapped_customer_rows,
  count(*) filter (where sku_id is null) as unmapped_sku_rows,
  (select count(*) from missing) as missing_rows,
  (select json_agg(json_build_object('source_row', source_row, 'po_number', po_number, 'customer', customer_raw, 'part_number', part_raw, 'qty', qty_ordered, 'currency', currency) order by source_row) from missing) as missing_samples
from ready;`;
}

function validationSql(sourceFile) {
  return `
select source_file, count(*) from public.channel_po group by 1 order by 1;
select currency, count(*) from public.channel_po group by 1 order by 1;
select c.code, count(*) as rows, sum(p.qty_ordered) as qty, sum(p.turnover) as turnover
from public.channel_po p join public.country c on c.id = p.country_id
group by c.code order by c.code;
select count(*) as turnover_mismatch_count
from public.channel_po
where fd_buying_price is not null and abs(coalesce(turnover,0)-fd_buying_price*qty_ordered)>1;
select p.id, p.po_number, p.source_file, p.source_row, p.qty_ordered, p.fd_buying_price, p.turnover
from public.channel_po p
where fd_buying_price is not null and abs(coalesce(turnover,0)-fd_buying_price*qty_ordered)>1
order by p.source_file, p.source_row limit 10;
select count(*) as ka_id_null_count from public.channel_po where ka_id is null;
select id, po_number, source_file, source_row from public.channel_po where ka_id is null order by source_file, source_row limit 10;
select coalesce(po_status, '(null)') as po_status, count(*) from public.channel_po group by 1 order by 1;
select
  count(*) filter (where ship_date is null and delivery_date is null and po_status is null) as unshipped,
  count(*) filter (where po_status = 'partial') as partial,
  count(*) filter (where po_status = 'cancelled') as cancelled,
  count(*) filter (where ship_date is not null or delivery_date is not null) as shipped
from public.channel_po;
select po_number, sku_id, country_id, po_date, count(*) as duplicates
from public.channel_po
group by po_number, sku_id, country_id, po_date
having count(*) > 1
order by duplicates desc, po_date, po_number limit 20;
select c.code, k.name as ka, p.currency, count(*) as rows, sum(p.qty_ordered) as qty, sum(p.turnover) as turnover
from public.channel_po p
join public.country c on c.id = p.country_id
left join public.ka k on k.id = p.ka_id
where p.source_file = ${sqlString(sourceFile)}
group by c.code, k.name, p.currency
order by c.code, k.name, p.currency;
select s.code as sku, count(*) as rows, sum(p.qty_ordered) as qty
from public.channel_po p join public.sku s on s.id = p.sku_id
where p.source_file = ${sqlString(sourceFile)}
group by s.code order by s.code;`;
}

function summarize(rows, groupBy) {
  const out = new Map();
  for (const row of rows) {
    const key = groupBy(row);
    const current = out.get(key) || { count: 0, qty: 0, turnover: 0 };
    current.count += 1;
    current.qty += row.qty_ordered || 0;
    current.turnover += row.turnover || 0;
    out.set(key, current);
  }
  return [...out.entries()].sort(([a], [b]) => String(a).localeCompare(String(b)));
}

function reportJson(data) {
  return {
    source_file: data.latest.name,
    source_path: data.latest.fullPath,
    selected_week: data.latest.week,
    ignored_weeks: data.ignored.map((f) => f.week),
    region_counts: data.regionCounts,
    europe_raw_rows: data.europeRows.length,
    valid_candidate_rows: data.valid.length,
    skipped_rows: data.skipped,
    new_qty_rows: data.newQtyRows,
    source_currency_summary: summarize(data.valid, (r) => r.currency),
    source_customer_summary: summarize(data.valid, (r) => r.customer),
    source_sku_raw_summary: summarize(data.valid, (r) => r.part_number),
  };
}

const mode = process.argv[2] || "report";
const data = parseSource();

if (mode === "report") {
  console.log(JSON.stringify(reportJson(data), null, 2));
} else if (mode === "dry-run-sql") {
  console.log(dryRunSql(withSlice(data)));
} else if (mode === "merge-sql") {
  console.log(mergeSql(withSlice(data)));
} else if (mode === "insert-only-sql") {
  console.log(insertOnlySql(withSlice(data)));
} else if (mode === "missing-sql") {
  console.log(missingOnlySql(withSlice(data)));
} else if (mode === "validation-sql") {
  console.log(validationSql(data.latest.name));
} else if (mode === "chunks") {
  const size = Number(process.argv[3] || 50);
  const chunks = [];
  for (let start = 0; start < data.valid.length; start += size) {
    chunks.push({ start, count: Math.min(size, data.valid.length - start) });
  }
  console.log(JSON.stringify(chunks));
} else if (mode === "source-rows") {
  const sliced = withSlice(data).valid;
  console.log(sliced.map((r) => r.source_row).join(","));
} else {
  throw new Error(`Unknown mode: ${mode}`);
}
