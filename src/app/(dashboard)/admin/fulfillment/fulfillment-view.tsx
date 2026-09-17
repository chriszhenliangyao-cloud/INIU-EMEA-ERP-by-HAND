// @ts-nocheck
/* eslint-disable */
'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'

export type FLine = { id: number; sku: string; product: string; qty: number; price: number; po_status: string | null; eta: string | null; delays: any[]; delayActive: boolean; cancel_reason?: string | null; batches: { id: number; qty: number; ship: string | null; deliv: string | null }[] }
export type FPo = { po: string; po_date: string; country: string; flag: string; ka: string; currency: string; lines: FLine[] }

const CSS = `
  #fb-root{
    --blue:#2563eb; --blue-weak:#eff4ff; --ink:#0f172a; --dim:#64748b; --faint:#94a3b8;
    --border:#e6e9ef; --surface:#fff; --bg:#f6f7f9; --soft:#f1f5f9;
    --toship:#64748b; --toship-bg:#f1f5f9; --partial:#d97706; --partial-bg:#fff7ed;
    --shipped:#2563eb; --shipped-bg:#eff4ff; --delivered:#059669; --delivered-bg:#ecfdf5;
    --cancel:#dc2626; --cancel-bg:#fef2f2;
    --delay:#7c3aed; --delay-bg:#f5f3ff;
    --font:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;
    --mono:"SF Mono",ui-monospace,Menlo,Consolas,monospace;
  }
  #fb-root *{box-sizing:border-box}
  #fb-root{margin:0;font-family:var(--font);background:var(--bg);color:var(--ink);font-size:13.5px;line-height:1.45}
  #fb-root .topbar{display:flex;align-items:center;gap:14px;padding:12px 20px;background:#fff;border-bottom:1px solid var(--border);position:sticky;top:0;z-index:20}
  #fb-root .topbar h1{font-size:15px;font-weight:800;margin:0;letter-spacing:-.01em}
  #fb-root .topbar .sub{font-size:11.5px;color:var(--faint)}
  #fb-root .badge-demo{font-size:10px;font-weight:800;color:var(--blue);background:var(--blue-weak);border:1px solid #d5e2ff;border-radius:6px;padding:3px 7px;letter-spacing:.03em}
  #fb-root .layout{display:grid;grid-template-columns:300px 1fr 320px;gap:0;height:calc(100vh - 53px)}
  /* ── PO list ── */
  #fb-root .polist{border-right:1px solid var(--border);background:#fbfcfe;overflow:auto;padding:12px}
  #fb-root .search{width:100%;font-size:12.5px;padding:8px 10px;border:1px solid var(--border);border-radius:9px;outline:none;margin-bottom:10px}
  #fb-root .search:focus{border-color:var(--blue)}
  #fb-root .chips{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:12px}
  #fb-root .chip{font-size:11px;font-weight:700;padding:4px 9px;border-radius:999px;border:1px solid var(--border);background:#fff;color:var(--dim);cursor:pointer}
  #fb-root .chip.on{background:var(--ink);color:#fff;border-color:var(--ink)}
  #fb-root .pocard{background:#fff;border:1px solid var(--border);border-radius:11px;padding:11px 12px;margin-bottom:9px;cursor:pointer;transition:box-shadow .12s,border-color .12s}
  #fb-root .pocard:hover{border-color:#cdd6e4;box-shadow:0 2px 8px rgba(15,23,42,.05)}
  #fb-root .pocard.active{border-color:var(--blue);box-shadow:0 0 0 1.5px var(--blue)}
  #fb-root .pocard-top{display:flex;justify-content:space-between;align-items:center;gap:8px}
  #fb-root .pocard-po{font-family:var(--mono);font-weight:700;font-size:12.5px}
  #fb-root .pocard-meta{font-size:11px;color:var(--dim);margin-top:3px;display:flex;gap:6px;align-items:center;flex-wrap:wrap}
  #fb-root .pbar{height:5px;border-radius:3px;background:#eef1f6;margin-top:9px;overflow:hidden}
  #fb-root .pbar>i{display:block;height:100%;border-radius:3px}
  /* ── document ── */
  #fb-root .docwrap{overflow:auto;padding:22px 26px}
  #fb-root .doc{background:#fff;border:1px solid var(--border);border-radius:14px;box-shadow:0 6px 22px rgba(15,23,42,.06);max-width:1000px;margin:0 auto;overflow:hidden}
  #fb-root .doc-head{padding:20px 24px 16px;border-bottom:2px solid var(--ink);display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
  #fb-root .doc-title{font-size:12px;font-weight:800;letter-spacing:.12em;color:var(--dim)}
  #fb-root .doc-po{font-size:26px;font-weight:800;font-family:var(--mono);letter-spacing:-.5px;margin-top:2px}
  #fb-root .doc-logo{text-align:right}
  #fb-root .doc-logo b{font-size:18px;font-weight:900;letter-spacing:1px}
  #fb-root .doc-logo span{display:block;font-size:10.5px;color:var(--faint);letter-spacing:.05em}
  #fb-root .meta{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--border);border-bottom:1px solid var(--border)}
  #fb-root .meta>div{background:#fff;padding:10px 16px}
  #fb-root .meta .k{font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--faint)}
  #fb-root .meta .v{font-size:13.5px;font-weight:700;margin-top:2px}
  #fb-root .doc-tools{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:12px 16px;background:#fbfcfe;border-bottom:1px solid var(--border)}
  #fb-root .doc-tools .grow{flex:1}
  #fb-root input[type=date]{font-size:12px;padding:6px 8px;border:1px solid var(--border);border-radius:8px;outline:none;font-family:var(--font)}
  #fb-root .btn{font-size:12px;font-weight:700;border:1px solid #d7dce5;background:#fff;color:#334155;border-radius:8px;padding:6px 11px;cursor:pointer;white-space:nowrap}
  #fb-root .btn:hover{background:#f8fafc;border-color:#c7d0de}
  #fb-root .btn.pri{background:var(--blue);border-color:var(--blue);color:#fff}
  #fb-root .btn.pri:hover{background:#1d4fd7}
  #fb-root .btn.good{background:var(--delivered);border-color:var(--delivered);color:#fff}
  #fb-root .btn.ghost{border-color:transparent;background:transparent;color:var(--dim)}
  #fb-root .btn.ghost:hover{background:var(--soft)}
  #fb-root .btn.mini{font-size:11px;padding:4px 8px;border-radius:7px}
  #fb-root .btn.danger{color:var(--cancel)} #fb-root .btn.danger:hover{background:var(--cancel-bg)}
  #fb-root table{width:100%;border-collapse:collapse}
  #fb-root thead th{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:var(--faint);text-align:left;padding:9px 10px;border-bottom:1px solid var(--border);background:#fff;position:sticky;top:0}
  #fb-root td{padding:9px 10px;border-bottom:1px solid var(--soft);vertical-align:middle}
  #fb-root tr.line:hover{background:#fcfdff}
  #fb-root td.r{text-align:right;font-variant-numeric:tabular-nums}
  #fb-root .sku{font-family:var(--mono);font-weight:700;font-size:12px}
  #fb-root .prod{font-size:11.5px;color:var(--dim)}
  #fb-root .pill{display:inline-flex;align-items:center;gap:5px;font-size:10.5px;font-weight:800;padding:3px 8px;border-radius:999px;border:1px solid transparent}
  #fb-root .dot{width:6px;height:6px;border-radius:50%}
  #fb-root .fulfil{min-width:150px}
  #fb-root .fbar{height:5px;border-radius:3px;background:#eef1f6;margin-top:5px;overflow:hidden;max-width:150px}
  #fb-root .fbar>i{display:block;height:100%}
  #fb-root .qtytxt{font-size:10.5px;color:var(--dim);margin-top:3px}
  #fb-root .rsn{font-size:10.5px;margin-top:5px;line-height:1.4;display:flex;gap:4px;align-items:flex-start}
  #fb-root .rsn b{font-weight:800}
  #fb-root .chiplink{cursor:pointer;text-decoration:underline dotted;font-weight:700}
  /* modal */
  #fb-root .ov{position:fixed;inset:0;background:rgba(15,23,42,.42);display:flex;align-items:center;justify-content:center;z-index:60;padding:20px}
  #fb-root .modal{background:#fff;border-radius:14px;box-shadow:0 24px 60px rgba(0,0,0,.32);width:100%;max-width:460px;overflow:hidden}
  #fb-root .modal h4{margin:0;padding:16px 18px;font-size:14px;font-weight:800;border-bottom:1px solid var(--border)}
  #fb-root .modal .mbody{padding:16px 18px}
  #fb-root .fld{margin-bottom:13px}
  #fb-root .fld label{display:block;font-size:10.5px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--faint);margin-bottom:5px}
  #fb-root .fld input[type=date],#fb-root .fld textarea{width:100%;font-size:13px;padding:8px 10px;border:1px solid var(--border);border-radius:9px;outline:none;font-family:var(--font)}
  #fb-root .fld input:focus,#fb-root .fld textarea:focus{border-color:var(--delay)}
  #fb-root .fld textarea{min-height:70px;resize:vertical;line-height:1.5}
  #fb-root .modal .mfoot{display:flex;justify-content:flex-end;gap:8px;padding:12px 18px;border-top:1px solid var(--border);background:#fbfcfe}
  #fb-root .hist{max-height:52vh;overflow:auto}
  #fb-root .hrec{padding:11px 16px;border-bottom:1px solid var(--soft);font-size:12.5px}
  #fb-root .hrec .hn{font-weight:800;color:var(--delay)}
  #fb-root .hrec .hmeta{font-size:11px;color:var(--dim);margin-top:3px;line-height:1.5}
  #fb-root .ops{display:flex;gap:5px;flex-wrap:wrap;justify-content:flex-end}
  #fb-root .foot{display:flex;flex-wrap:wrap;gap:20px;align-items:center;padding:14px 18px;background:#fbfcfe;border-top:2px solid var(--soft)}
  #fb-root .foot .tt{font-size:11px;color:var(--faint);font-weight:800;text-transform:uppercase;letter-spacing:.04em}
  #fb-root .foot .tv{font-size:16px;font-weight:800;font-variant-numeric:tabular-nums}
  /* ── write log ── */
  #fb-root .log{border-left:1px solid var(--border);background:#0f172a;color:#cbd5e1;overflow:auto;padding:14px;font-family:var(--mono)}
  #fb-root .log h3{font-family:var(--font);font-size:12px;font-weight:800;color:#e2e8f0;margin:0 0 3px;display:flex;justify-content:space-between;align-items:center}
  #fb-root .log .note{font-family:var(--font);font-size:10.5px;color:#64748b;margin-bottom:12px;line-height:1.5}
  #fb-root .log .clr{font-family:var(--font);font-size:10px;color:#94a3b8;cursor:pointer;background:#1e293b;border:1px solid #334155;border-radius:6px;padding:3px 7px}
  #fb-root .logitem{font-size:10.5px;line-height:1.5;padding:8px 9px;border-radius:8px;background:#1e293b;margin-bottom:7px;border-left:3px solid var(--blue);white-space:pre-wrap;word-break:break-word}
  #fb-root .logitem.del{border-left-color:#f43f5e} #fb-root .logitem.upd{border-left-color:#f59e0b} #fb-root .logitem.ins{border-left-color:#38bdf8}
  #fb-root .logitem .op{color:#f8fafc;font-weight:700} #fb-root .logitem .tg{color:#94a3b8;display:block;margin-top:3px}
  #fb-root .logempty{font-family:var(--font);font-size:11px;color:#475569;text-align:center;padding:20px 0}
  #fb-root .toast{position:fixed;bottom:18px;left:50%;transform:translateX(-50%);background:var(--ink);color:#fff;font-size:12.5px;font-weight:600;padding:9px 16px;border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.2);opacity:0;transition:opacity .2s,transform .2s;pointer-events:none;z-index:50}
  #fb-root .toast.show{opacity:1;transform:translateX(-50%) translateY(-4px)}
  /* collapsible write-log */
  #fb-root #logtoggle{position:fixed;right:16px;bottom:16px;z-index:40;display:flex;align-items:center;gap:5px;font-size:12px;font-weight:700;color:#334155;background:#fff;border:1px solid var(--border);border-radius:999px;padding:8px 14px;box-shadow:0 6px 18px rgba(15,23,42,.14);cursor:pointer}
  #fb-root #logtoggle:hover{border-color:#c7d0de;background:#fbfcfe}
  #fb-root:not(.logcol) #logtoggle{display:none}
  #fb-root.logcol .log{display:none}
  #fb-root.logcol .layout{grid-template-columns:300px 1fr}
  #fb-root.fin-active .layout{grid-template-columns:300px 1fr}
  @media(max-width:1180px){ #fb-root .layout{grid-template-columns:260px 1fr} #fb-root .log{display:none} #fb-root.logcol .layout{grid-template-columns:260px 1fr} #fb-root #logtoggle{display:none} }
  /* ── 顶部总 tab + SKU 交期看板(与发货履约同源同风格)── */
  #fb-root .appnav{display:flex;gap:8px;padding:10px 20px;background:#fff;border-bottom:1px solid #e6e9ef}
  #fb-root .navtab{border:1px solid #e6e9ef;background:#fff;border-radius:999px;padding:8px 18px;font-weight:800;font-size:13px;color:#64748b;cursor:pointer}
  #fb-root .navtab:hover{border-color:#c7d0de}
  #fb-root .navtab.on{background:#2563eb;border-color:#2563eb;color:#fff}
  #fb-root.sku-active #logtoggle,#fb-root.fin-active #logtoggle{display:none!important}
  #fb-root .sku-wrap{padding:18px 22px;max-width:1200px;margin:0 auto}
  #fb-root .sku-toolbar{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;margin-bottom:16px}
  #fb-root .skf{display:flex;flex-direction:column;gap:4px;min-width:120px}
  #fb-root .skf label{font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8;padding-left:2px}
  #fb-root .skf input,#fb-root .skf select{font-size:12.5px;padding:8px 9px;border:1px solid #dfe4ec;border-radius:9px;background:#fff;outline:none;font-family:inherit;width:100%;color:#0f172a}
  #fb-root .skf input:focus,#fb-root .skf select:focus{border-color:#2563eb;box-shadow:0 0 0 3px #eff4ff}
  #fb-root .sku-subtabs{display:flex;gap:6px;margin-left:auto;align-self:flex-end}
  #fb-root .subtab{border:1px solid #e6e9ef;background:#fff;border-radius:999px;padding:7px 14px;cursor:pointer;color:#64748b;font-weight:700;font-size:12.5px}
  #fb-root .subtab.on{background:#0f172a;color:#fff;border-color:#0f172a}
  #fb-root .sku-panel{display:none}#fb-root .sku-panel.on{display:block}
  #fb-root .skucard{background:#fff;border:1px solid #e6e9ef;border-radius:14px;box-shadow:0 1px 2px rgba(15,23,42,.04);margin-bottom:12px;overflow:hidden}
  #fb-root .skuhead{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid #f1f5f9;background:linear-gradient(180deg,#fff,#fbfcfe)}
  #fb-root .skucode{font-family:ui-monospace,Menlo,Consolas,monospace;font-weight:800;font-size:14px;color:#0f172a}
  #fb-root .skuprod{font-size:11.5px;color:#64748b}
  #fb-root .skuagg{margin-left:auto;display:flex;gap:16px;text-align:right}
  #fb-root .skuagg .t{font-size:9.5px;font-weight:800;text-transform:uppercase;color:#94a3b8;letter-spacing:.04em}
  #fb-root .skuagg .n{font-size:15px;font-weight:800;font-variant-numeric:tabular-nums;color:#0f172a}
  #fb-root .sktab{width:100%;border-collapse:collapse}
  #fb-root .sktab th{font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:#94a3b8;text-align:left;padding:8px 14px;border-bottom:1px solid #f1f5f9}
  #fb-root .sktab td{padding:9px 14px;border-bottom:1px solid #f1f5f9;color:#0f172a}
  #fb-root .sktab tr:last-child td{border-bottom:none}
  #fb-root .sktab tr:hover td{background:#fcfdff}
  #fb-root .sktab td.r{text-align:right;font-variant-numeric:tabular-nums}
  #fb-root .tl{background:#fff;border:1px solid #e6e9ef;border-radius:14px;padding:18px;overflow:auto}
  #fb-root .tlscale{display:grid;grid-template-columns:160px 1fr;gap:12px;margin-bottom:6px;min-width:720px}
  #fb-root .months{position:relative;height:24px;border-bottom:1px solid #e6e9ef}
  #fb-root .mo{position:absolute;bottom:4px;font-size:10px;color:#94a3b8;transform:translateX(-50%)}
  #fb-root .mo.cur{background:#2563eb;color:#fff;border-radius:999px;padding:3px 8px;font-weight:800}
  #fb-root .trow{display:grid;grid-template-columns:160px 1fr;gap:12px;min-height:42px;border-bottom:1px solid #f1f5f9;padding:7px 0;min-width:720px}
  #fb-root .trow .c{font-family:ui-monospace,Menlo,Consolas,monospace;font-weight:700;font-size:12px}#fb-root .trow .s{font-size:10.5px;color:#94a3b8}
  #fb-root .track{position:relative;background:#f4f6fa;border-radius:8px}
  #fb-root .curline{position:absolute;top:-8px;bottom:-8px;border-left:2px dashed #2563eb;opacity:.8;z-index:1}
  #fb-root .tdot{position:absolute;top:6px;transform:translateX(-50%);height:26px;min-width:28px;border-radius:7px;color:#fff;padding:5px 7px;font-size:11px;font-weight:800;text-align:center;z-index:2;white-space:nowrap;box-shadow:0 3px 8px rgba(15,23,42,.18)}
  /* 紧凑双列布局 */
  #fb-root .sku-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;align-items:start}
  #fb-root .sku-list .skucard{margin-bottom:0}
  #fb-root .skuhead{padding:10px 14px}
  #fb-root .skuagg{gap:14px;align-items:baseline}
  #fb-root .skuagg span{font-size:12px;color:#64748b}#fb-root .skuagg b{color:#0f172a;font-size:14px;font-variant-numeric:tabular-nums}
  #fb-root .skuline{display:flex;align-items:center;gap:10px;padding:7px 14px;border-bottom:1px solid #f1f5f9;font-size:12.5px}
  #fb-root .skucard .skuline:last-child{border-bottom:none}
  #fb-root .skuline:hover{background:#fcfdff}
  #fb-root .skuline .po{font-weight:700;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;color:#0f172a}
  #fb-root .skuline .ka{color:#334155;white-space:nowrap}
  #fb-root .skuline .q{font-variant-numeric:tabular-nums;font-weight:600;white-space:nowrap;color:#0f172a}
  #fb-root .skuline .dt{color:#94a3b8;font-size:11px;white-space:nowrap}
  #fb-root .skuline .pill{white-space:nowrap}
  @media(max-width:900px){#fb-root .sku-list{grid-template-columns:1fr}}
  /* 上下结构:上=未发清单可滑动,下=统计图表 */
  #fb-root .sku-top-head{display:flex;align-items:baseline;gap:10px;margin-bottom:9px;font-size:14px;font-weight:800;color:#0f172a}
  #fb-root .sku-top-head .muted{font-size:12px;font-weight:600;color:#94a3b8}
  #fb-root .sku-scroll{max-height:44vh;overflow:auto;padding:12px;border:1px solid #e6e9ef;border-radius:14px;background:#fbfcfe}
  #fb-root .sku-scroll::-webkit-scrollbar{width:9px}#fb-root .sku-scroll::-webkit-scrollbar-thumb{background:#cbd5e1;border-radius:6px}
  #fb-root .sku-bottom{margin-top:20px}
  #fb-root .sk-metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}
  #fb-root .sk-metric{background:#fff;border:1px solid #e6e9ef;border-radius:12px;padding:11px 14px}
  #fb-root .sk-metric .l{font-size:10px;font-weight:800;letter-spacing:.04em;color:#94a3b8}
  #fb-root .sk-metric .v{font-size:22px;font-weight:800;margin-top:4px;font-variant-numeric:tabular-nums;color:#0f172a}
  #fb-root .sk-metric .s{font-size:11px;color:#64748b;margin-top:1px}
  #fb-root .sk-charts{display:grid;grid-template-columns:1.5fr 1fr;gap:12px}
  #fb-root .sk-chart{background:#fff;border:1px solid #e6e9ef;border-radius:14px;padding:14px 16px}
  #fb-root .sk-chart h4{margin:0 0 12px;font-size:12.5px;font-weight:800;color:#0f172a}
  #fb-root .barrow{display:grid;grid-template-columns:132px 1fr 58px;gap:10px;align-items:center;margin-bottom:9px}
  #fb-root .barrow:last-child{margin-bottom:0}
  #fb-root .barrow .bl{font-size:12px;color:#334155;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:600}
  #fb-root .barrow .bl span{color:#94a3b8;font-weight:500;font-size:11px}
  #fb-root .bartrack{height:15px;background:#f1f5f9;border-radius:5px;overflow:hidden}
  #fb-root .bartrack>i{display:block;height:100%;border-radius:5px;background:#2563eb;transition:width .35s}
  #fb-root .barrow .bv{font-size:12px;font-weight:700;text-align:right;font-variant-numeric:tabular-nums;color:#0f172a}
  #fb-root .segbar{display:flex;height:20px;border-radius:6px;overflow:hidden;margin-bottom:12px;background:#f1f5f9}
  #fb-root .segbar>i{height:100%}
  #fb-root .seglegend{display:flex;flex-direction:column;gap:8px}
  #fb-root .seglegend .sg{display:flex;align-items:center;gap:8px;font-size:12.5px;color:#334155}
  #fb-root .seglegend .sg .sw{width:11px;height:11px;border-radius:3px;flex:none}
  #fb-root .seglegend .sg b{margin-left:auto;font-variant-numeric:tabular-nums;color:#0f172a}
  @media(max-width:900px){#fb-root .sk-metrics{grid-template-columns:repeat(2,1fr)}#fb-root .sk-charts{grid-template-columns:1fr}}
  /* 开票批次 · 财务视图 */
  #fb-root .fin-wrap{padding:20px 24px 40px;max-width:1080px;margin:0 auto}
  #fb-root .fin-toolbar{display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap;margin-bottom:14px}
  #fb-root .fin-chk{display:flex;align-items:center;gap:6px;font-size:12.5px;color:#334155;font-weight:600;padding-bottom:6px;cursor:pointer}
  #fb-root .fin-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px}
  #fb-root .fin-summary .sk-metric{background:#fff;border:1px solid #e6e9ef;border-radius:12px;padding:11px 14px}
  #fb-root .po-fin{margin-bottom:22px}
  #fb-root .po-fin-head{display:flex;align-items:center;gap:10px;margin-bottom:10px;flex-wrap:wrap}
  #fb-root .po-fin-head .ponum{font-weight:800;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:15px;color:#0f172a}
  #fb-root .po-fin-head .kaname{font-size:13px;color:#334155;font-weight:600}
  #fb-root .po-fin-head .meta{font-size:12px;color:#94a3b8}
  #fb-root .po-fin-head .po-amt{margin-left:auto;font-size:12.5px;color:#64748b}
  #fb-root .po-fin-head .po-amt b{color:#0f172a;font-variant-numeric:tabular-nums}
  #fb-root .batch{background:#fff;border:1px solid #e6e9ef;border-radius:14px;box-shadow:0 1px 2px rgba(15,23,42,.04);margin-bottom:12px;overflow:hidden}
  #fb-root .batch.done{border-color:#bbf7d0;background:#f6fef9}
  #fb-root .batch-head{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid #f1f5f9;flex-wrap:wrap}
  #fb-root .batch-head .bx{font-size:20px;line-height:1}
  #fb-root .batch-head .bd{font-weight:800;font-size:13.5px;color:#0f172a}
  #fb-root .batch-head .bd small{display:block;font-weight:500;font-size:11px;color:#94a3b8;margin-top:1px}
  #fb-root .batch-head .deliv{font-size:11px;font-weight:700;padding:2px 9px;border-radius:999px}
  #fb-root .batch-head .deliv.transit{color:#2563eb;background:#eff4ff}
  #fb-root .batch-head .deliv.done{color:#059669;background:#e9f9f1}
  #fb-root .batch-head .deliv.part{color:#d97706;background:#fdf4e7}
  #fb-root .batch-head .inv{margin-left:auto;display:flex;align-items:center;gap:10px}
  #fb-root .batch-head .inv .amt{font-size:16px;font-weight:800;color:#0f172a;font-variant-numeric:tabular-nums}
  #fb-root .batch-head .inv .invno{font-size:11px;font-weight:700;color:#059669;font-family:ui-monospace,Menlo,monospace}
  #fb-root .btab{width:100%;border-collapse:collapse;font-size:12.5px}
  #fb-root .btab th{text-align:left;font-size:10.5px;font-weight:800;letter-spacing:.03em;color:#94a3b8;padding:8px 16px;border-bottom:1px solid #f1f5f9;background:#fbfcfe}
  #fb-root .btab th.r,#fb-root .btab td.r{text-align:right;font-variant-numeric:tabular-nums}
  #fb-root .btab td{padding:8px 16px;border-bottom:1px solid #f5f7fa;color:#334155}
  #fb-root .btab tr:last-child td{border-bottom:none}
  #fb-root .btab .sku{font-family:ui-monospace,Menlo,Consolas,monospace;font-weight:700;color:#0f172a}
  #fb-root .btab tfoot td{font-weight:800;color:#0f172a;background:#fbfcfe;border-top:1px solid #e6e9ef}
  #fb-root .btab th.c,#fb-root .btab td.c{text-align:center;width:104px}
  #fb-root .btab tr.rowopen td{background:#fffdf7}
  #fb-root .btab tr.rowopen td:first-child{box-shadow:inset 3px 0 0 #d97706}
  #fb-root .btab tr.rowinv td{background:#f6fef9}
  #fb-root .rowbtn{font-size:11px;font-weight:700;border-radius:7px;padding:4px 10px;cursor:pointer;border:1px solid #d97706;background:#fff;color:#b45309;white-space:nowrap}
  #fb-root .rowbtn:hover{background:#fdf4e7}
  #fb-root .rowbtn.on{border-color:#bbf7d0;background:#e9f9f1;color:#059669}
  #fb-root .batch-head .cov{font-size:11px;font-weight:700;padding:2px 9px;border-radius:999px}
  #fb-root .batch-head .cov.done{color:#059669;background:#e9f9f1}
  #fb-root .batch-head .cov.part{color:#b45309;background:#fdf4e7}
  #fb-root .batch-head .cov.none{color:#64748b;background:#f1f5f9}
  #fb-root .fin-empty{padding:44px;text-align:center;color:var(--faint)}
  #fb-root .po-prog{background:#fff;border:1px solid #e6e9ef;border-radius:12px;padding:12px 16px;margin-bottom:12px}
  #fb-root .pbar{display:flex;height:12px;border-radius:6px;overflow:hidden;background:#f1f5f9;margin-bottom:11px}
  #fb-root .pbar>i{height:100%}
  #fb-root .s-inv{background:#059669}#fb-root .s-pend{background:#d97706}#fb-root .s-un{background:#cbd5e1}
  #fb-root .pbreak{display:flex;gap:22px;flex-wrap:wrap;font-size:12px;color:#64748b}
  #fb-root .pbreak span{display:flex;align-items:center;gap:6px}
  #fb-root .pbreak i{width:10px;height:10px;border-radius:3px;flex:none}
  #fb-root .pbreak b{color:#0f172a;font-variant-numeric:tabular-nums;font-weight:700}
  #fb-root .unship-note{font-size:11.5px;color:#94a3b8;padding:9px 4px 2px;line-height:1.7}
  #fb-root #fin-doc tr.rowopen td{background:#fffdf6}
  #fb-root #fin-doc tr.rowopen td:nth-child(2){box-shadow:inset 3px 0 0 #d97706}
  #fb-root #fin-doc td.dim{color:var(--faint)}
  #fb-root #fin-doc tr.rowun td{background:#fbfcfe}
  #fb-root #fin-doc .bcell{font-size:11.5px;color:#334155;white-space:nowrap}
  #fb-root #fin-doc .bdv{margin-left:7px;font-size:10px;font-weight:700;padding:1px 7px;border-radius:999px}
  #fb-root #fin-doc .bdv.tr{color:#2563eb;background:#eff4ff}
  #fb-root #fin-doc .bdv.done{color:#059669;background:#e9f9f1}
  #fb-root #fin-doc .grphead td{background:#f4f7fb;border-top:1px solid #e6e9ef;border-bottom:1px solid #eef1f6;padding:8px 12px;cursor:pointer}
  #fb-root #fin-doc .grphead:hover td{background:#eef2f8}
  #fb-root #fin-doc .ghd{display:flex;align-items:center;gap:10px}
  #fb-root #fin-doc .ghd .caret{font-size:10px;color:#64748b;width:12px;text-align:center;transition:transform .15s}
  #fb-root #fin-doc .grp.collapsed .ghd .caret{transform:rotate(-90deg)}
  #fb-root #fin-doc .ghd .gt{font-weight:800;font-size:12.5px;color:#0f172a;white-space:nowrap}
  #fb-root #fin-doc .ghd .gmeta{font-size:11.5px;color:#64748b;white-space:nowrap}
  #fb-root #fin-doc .grp.collapsed .line{display:none}
  @media(max-width:900px){#fb-root .fin-summary{grid-template-columns:repeat(2,1fr)}}

/* ERP embed overrides */
#fb-root{height:100%}
#fb-app{height:100%;display:flex;flex-direction:column;background:#f5f6f8;color:#0f172a;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,system-ui,sans-serif}
#fb-app .appnav{flex:none}
#fb-app>#view-ship,#fb-app>#view-sku,#fb-app>#view-fin{flex:1;min-height:0}
#fb-app #view-ship .layout,#fb-app #view-fin .layout{height:100%}
#fb-app #view-sku .sku-wrap{height:100%;overflow:auto}
`

const SHELL = `<div id="fb-app"><div class="appnav">
    <button class="navtab on" data-nav="ship">发货履约 · 单据视图</button>
    <button class="navtab" data-nav="sku">SKU 交期看板</button>
    <button class="navtab" data-nav="fin">开票批次 · 财务</button>
  </div>
  <div id="view-ship"><div class="layout">
    <aside class="polist">
      <input id="search" class="search" placeholder="搜索 PO # / KA / SKU / 产品…">
      <div class="chips" id="chips"></div>
      <div id="polist"></div>
    </aside>
    <main class="docwrap"><div id="doc"></div></main>
    <aside class="log">
      <h3><span>落库预览 · Write log</span><span style="display:flex;gap:6px"><span class="clr" id="collapselog">收起</span><span class="clr" id="clrlog">清空</span></span></h3>
      <div class="note">每个操作已<b>直接写入生产库</b>(po_shipment / channel_po / po_leadtime / po_invoice)。这里同步显示对应的落库语句。</div>
      <div id="loglist"><div class="logempty">操作 PO 后,这里显示对应的落库语句</div></div>
    </aside>
  </div>
  <button id="logtoggle" title="展开落库预览">落库预览<span id="logcount"></span> ▸</button>
  <div id="modal"></div>
  <div class="toast" id="toast"></div>
  </div>
  <div id="view-sku" hidden>
    <div class="sku-wrap">
      <div class="sku-toolbar">
        <div class="skf"><label>SKU</label><select id="sk-sku"><option value="">全部 SKU</option></select></div>
        <div class="skf" style="flex:1.4;min-width:200px"><label>搜索 SKU / 产品 / 订单 / 客户</label><input id="sk-q" placeholder="例:P75、C11、75865、Komsa"></div>
        <div class="skf"><label>客户 KA</label><select id="sk-ka"><option value="">全部客户</option></select></div>
        <div class="skf"><label>未发状态</label><select id="sk-stat"><option value="">全部未发</option><option value="toship">待发</option><option value="partial">部分未发</option><option value="delayed">延期</option></select></div>
      </div>
      <div class="sku-top">
        <div class="sku-top-head"><b>未发 SKU 清单</b> <span id="sk-count" class="muted"></span></div>
        <div class="sku-scroll"><div id="sk-group" class="sku-list"></div></div>
      </div>
      <div id="sk-stats" class="sku-bottom"></div>
    </div>
  </div>
  <div id="view-fin" hidden><div class="layout">
    <aside class="polist">
      <input id="fin-search" class="search" placeholder="搜索 PO # / KA / SKU / 产品…">
      <div class="chips" id="fin-chips"></div>
      <div id="fin-polist"></div>
    </aside>
    <main class="docwrap"><div id="fin-doc"></div></main>
  </div></div></div>`


function makeDB(supabase){
  const up  = (poId, slot, value) => supabase.from('po_leadtime').upsert({ po_line_id: poId, slot, value }, { onConflict: 'po_line_id,slot' })
  const del = (poId, slot)        => supabase.from('po_leadtime').delete().eq('po_line_id', poId).eq('slot', slot)
  const warn = (e, m) => { if (e) { console.error(m, e); alert(m + ':' + e.message); return true } return false }
  return {
    async ship(poId, qty, date, wasCancelled, delaysList){
      const { data, error } = await supabase.from('po_shipment').insert({ po_id: poId, qty, ship_date: date }).select('id').single()
      if (warn(error, '发货写库失败')) return null
      if (wasCancelled){ await supabase.from('channel_po').update({ po_status: null }).eq('id', poId); await del(poId, 'b0_cancel') }
      if (delaysList && delaysList.length){ await up(poId, 'b0_delay', JSON.stringify({ active: false, list: delaysList })) }
      return data.id
    },
    async deliver(poId, date){ const { error } = await supabase.from('po_shipment').update({ delivery_date: date }).eq('po_id', poId).is('delivery_date', null); warn(error, '录送达写库失败') },
    async reopen(poId){ const { error } = await supabase.from('po_shipment').delete().eq('po_id', poId); if (warn(error, '退回写库失败')) return; await supabase.from('channel_po').update({ po_status: null }).eq('id', poId); await del(poId, 'b0_delay') },
    async cancel(poId, reason){ const { error } = await supabase.from('channel_po').update({ po_status: 'cancelled' }).eq('id', poId); if (warn(error, '取消写库失败')) return; await up(poId, 'b0_cancel', reason || '') },
    async restore(poId){ const { error } = await supabase.from('channel_po').update({ po_status: null }).eq('id', poId); if (warn(error, '恢复写库失败')) return; await del(poId, 'b0_cancel') },
    async eta(poId, value){ const { error } = value ? await up(poId, 'b0_eta', value) : await del(poId, 'b0_eta'); warn(error, '交期写库失败') },
    async etaBulk(ids, value){ if (!ids.length) return; const rows = ids.map(id => ({ po_line_id: id, slot: 'b0_eta', value })); const { error } = await supabase.from('po_leadtime').upsert(rows, { onConflict: 'po_line_id,slot' }); warn(error, '批量交期写库失败') },
    async delay(poId, payload, wasCancelled){ const { error } = await up(poId, 'b0_delay', JSON.stringify(payload)); warn(error, '延期写库失败'); if (wasCancelled){ await supabase.from('channel_po').update({ po_status: null }).eq('id', poId); await del(poId, 'b0_cancel') } },
    async invoice(shipmentId, on){ if (on){ const { error } = await supabase.from('po_invoice').upsert({ shipment_id: shipmentId }, { onConflict: 'shipment_id' }); warn(error, '开票写库失败') } else { const { error } = await supabase.from('po_invoice').delete().eq('shipment_id', shipmentId); warn(error, '撤销开票写库失败') } },
  }
}

function runApp(root, FB, DB){
  root.className = "logcol";
  const APP = root.querySelector("#fb-app");

const STAGE = {
  toship:   {label:'待发',   c:'--toship',   bg:'--toship-bg'},
  partial:  {label:'部分发货', c:'--partial',  bg:'--partial-bg'},
  shipped:  {label:'已发货',   c:'--shipped',  bg:'--shipped-bg'},
  delivered:{label:'已送达',   c:'--delivered',bg:'--delivered-bg'},
  delayed:  {label:'延期',     c:'--delay',    bg:'--delay-bg'},
  cancelled:{label:'已取消',   c:'--cancel',   bg:'--cancel-bg'},
};
const cssv = k => getComputedStyle(root).getPropertyValue(k).trim();
const TODAY = FB.today;
let DATA = { pos: [] }, sel = 0, filter = 'all', q = '', log = [], nextBatch = 900;

const fmtNum = n => Number(n||0).toLocaleString('en-US');
const money = (n,c) => (c==='PLN'?'':'€') + Number(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}) + (c==='PLN'?' zł':'');
const shipped = l => l.batches.reduce((s,b)=>s+Number(b.qty||0),0);
const remaining = l => l.qty - shipped(l);
function stageOf(l){
  if(l.po_status==='cancelled') return 'cancelled';
  const sh = shipped(l);
  if(sh>=l.qty) return (l.batches.length && l.batches.every(b=>b.deliv)) ? 'delivered' : 'shipped';
  if(l.delayActive) return 'delayed';    // 未发满且当前处于延期(带记录)
  if(sh>0) return 'partial';
  return 'toship';
}
function poStage(po){
  const ls = po.lines.filter(l=>l.po_status!=='cancelled');
  if(!ls.length) return 'cancelled';
  const st = ls.map(stageOf);
  if(st.every(s=>s==='delivered')) return 'delivered';
  if(st.every(s=>s==='delivered'||s==='shipped')) return 'shipped';
  if(st.every(s=>s==='delayed')) return 'delayed';
  if(st.every(s=>s==='toship')) return 'toship';
  return 'partial';
}
const lastShipDate = l => { let d=null; l.batches.forEach(b=>{ if(b.ship && (!d||b.ship>d)) d=b.ship; }); return d; };
const lastDelivDate = l => { let d=null; l.batches.forEach(b=>{ if(b.deliv && (!d||b.deliv>d)) d=b.deliv; }); return d; };

// ── DB write log (mirrors real ERP persistence) ──
function addLog(kind, op, tag){
  log.unshift({kind, op, tag});
  renderLog();
}
function renderLog(){
  const el = document.getElementById('loglist');
  const cnt = document.getElementById('logcount'); if(cnt) cnt.textContent = log.length? ` · ${log.length}` : '';
  if(!log.length){ el.innerHTML = '<div class="logempty">操作 PO 后,这里显示对应的落库语句</div>'; return; }
  el.innerHTML = log.map(x=>`<div class="logitem ${x.kind}"><span class="op">${esc(x.op)}</span>${x.tag?`<span class="tg">↳ ${esc(x.tag)}</span>`:''}</div>`).join('');
}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}
let toastT;
function toast(m){ const t=document.getElementById('toast'); t.textContent=m; t.classList.add('show'); clearTimeout(toastT); toastT=setTimeout(()=>t.classList.remove('show'),1900); }

// ── actions (batches = source of truth; parent derived, exactly like DB triggers) ──
async function shipLine(l, qty, date){
  qty = Math.floor(qty);
  const rem = remaining(l);
  if(qty<=0 || qty>rem){ toast(`请输入 1 ~ ${rem} 之间的数量`); return; }
  const _wasC=l.po_status==='cancelled';
  const _nb=await DB.ship(l.id, qty, date, _wasC, (l.delays&&l.delays.length)?l.delays:null);
  if(_nb==null) return;
  l.batches.push({id:_nb, qty, ship:date, deliv:null});
  if(_wasC) l.po_status=null;
  l.delayActive = false;                // 发货即推进,解除当前延期(历史记录保留)
  const st = stageOf(l);
  addLog('ins', `INSERT po_shipment (po_id=${l.id}, qty=${qty}, ship_date='${date}')`,
    `触发器派生 channel_po#${l.id}: delivered_qty=${shipped(l)}, ship_date='${date}', po_status=${st==='partial'?"'partial'":'NULL'}  → ${STAGE[st].label}`);
  toast(qty===rem?`${l.sku} 已发满 → 已发货`:`${l.sku} 发 ${qty} → 部分发货`);
  render();
}
async function deliverLine(l, date){
  const n = l.batches.filter(b=>!b.deliv).length;
  if(!shipped(l) || !n){ toast('没有待录送达的批次'); return; }
  await DB.deliver(l.id, date);
  l.batches.forEach(b=>{ if(!b.deliv) b.deliv=date; });
  addLog('upd', `UPDATE po_shipment SET delivery_date='${date}' WHERE po_id=${l.id} AND delivery_date IS NULL`,
    `${n} 个批次;触发器: channel_po#${l.id} delivery_date='${date}' → ${remaining(l)===0?'已送达':'部分送达'}`);
  toast(`${l.sku} 已录送达`); render();
}
async function reopenLine(l){
  if(!l.batches.length && l.po_status!=='cancelled'){ toast('该行本就待发'); return; }
  const ids = l.batches.map(b=>b.id);
  await DB.reopen(l.id);
  l.batches = []; l.po_status = null; l.delayActive=false; l.delays=[];
  addLog('del', `DELETE po_shipment WHERE po_id=${l.id}${ids.length?` (批次 ${ids.join(',')})`:''}; UPDATE channel_po SET po_status=NULL WHERE id=${l.id}`,
    `触发器清空 delivered_qty / ship_date / delivery_date → 待发`);
  toast(`${l.sku} 已退回待发`); render();
}
async function cancelLine(l){
  const r = (prompt('取消原因(必填):','')||'').trim();
  if(!r){ toast('取消必须填写原因'); return; }
  await DB.cancel(l.id, r);
  l.po_status='cancelled'; l.cancel_reason=r; l.delayActive=false;
  addLog('upd', `UPDATE channel_po SET po_status='cancelled', cancel_reason='${r.replace(/'/g,"''")}' WHERE id=${l.id}`, `仍计入总额,仅打状态标签 → 已取消`);
  toast(`${l.sku} 已取消`); render();
}
async function restoreLine(l){
  await DB.restore(l.id);
  l.po_status=null; l.cancel_reason=null;
  addLog('upd', `UPDATE channel_po SET po_status=NULL, cancel_reason=NULL WHERE id=${l.id}`, `恢复取消 → ${STAGE[stageOf(l)].label}`);
  render();
}
function closeModal(){ document.getElementById('modal').innerHTML=''; }
function lineById(id){ for(const p of DATA.pos){ for(const l of p.lines){ if(l.id===id) return {p,l}; } } return null; }
function syncAll(){ render(); renderSku(); }
function openEtaModal(id){
  const r = lineById(id); if(!r) return; const l = r.l;
  document.getElementById('modal').innerHTML = `<div class="ov" data-ovclose><div class="modal">
    <h4>预计交期 (ETA) · ${esc(l.sku)} <span style="font-weight:500;color:var(--dim);font-size:12px">${esc(r.p.po)} · ${esc(l.product)}</span></h4>
    <div class="mbody">
      <div class="fld"><label>ETA · 预计交期</label><input id="eta-in" autocomplete="off" placeholder="例:Week 42 · W42 · 2026-10-16" value="${esc(l.eta||'')}"></div>
      <div style="font-size:11px;color:var(--dim);line-height:1.5">与 ERP 的 <b>po_leadtime.b0_eta</b> 一致;真实系统等价写 po_leadtime(po_line_id=${l.id}, slot='b0_eta', value=…)。发货 / 送达后由实际日期接管。</div>
    </div>
    <div class="mfoot">
      <button class="btn danger" data-etaclear="${id}" ${l.eta?'':'style="visibility:hidden"'}>清除</button>
      <div style="display:flex;gap:8px"><button class="btn" data-ovclose>取消</button><button class="btn pri" data-etaok="${id}">保存</button></div>
    </div></div></div>`;
  setTimeout(()=>{ const i=document.getElementById('eta-in'); if(i){ i.focus(); i.select(); } }, 30);
}
async function saveEta(id){
  const r = lineById(id); if(!r) return; const l = r.l;
  const v = (document.getElementById('eta-in').value||'').trim();
  await DB.eta(l.id, v||null);
  l.eta = v || null; closeModal();
  addLog('upd', l.eta
    ? `INSERT INTO po_leadtime (po_line_id, slot, value) VALUES (${l.id},'b0_eta','${l.eta.replace(/'/g,"''")}') ON CONFLICT (po_line_id,slot) DO UPDATE SET value=EXCLUDED.value`
    : `DELETE FROM po_leadtime WHERE po_line_id=${l.id} AND slot='b0_eta'`,
    l.eta ? `预计交期 ${l.eta}` : '清除预计交期');
  toast(l.eta?`${l.sku} 预计交期 ${l.eta}`:`${l.sku} 已清除交期`); syncAll();
}
async function clearEta(id){ const r=lineById(id); if(!r) return; await DB.eta(r.l.id, null); r.l.eta=null; addLog('del',`DELETE FROM po_leadtime WHERE po_line_id=${r.l.id} AND slot='b0_eta'`,'清除预计交期'); closeModal(); toast('已清除交期'); syncAll(); }
// 整单批量设交期(应用到未完成行)
function openBatchEta(){
  const p=DATA.pos[sel]; const n=p.lines.filter(l=>{ const s=stageOf(l); return s!=='cancelled'&&s!=='delivered'; }).length;
  document.getElementById('modal').innerHTML=`<div class="ov" data-ovclose><div class="modal">
    <h4>整单设交期 · ${esc(p.po)} <span style="font-weight:500;color:var(--dim);font-size:12px">应用到 ${n} 个未完成 SKU</span></h4>
    <div class="mbody">
      <div class="fld"><label>ETA · 预计交期(一次填给整单未发 / 未送达行)</label><input id="beta-in" placeholder="例:Week 42 · W42 · 2026-10-16"></div>
      <div style="font-size:11px;color:var(--dim)">已送达 / 已取消的行不改。真实系统:批量 upsert po_leadtime.b0_eta。</div>
    </div>
    <div class="mfoot"><button class="btn" data-ovclose>取消</button><button class="btn pri" data-betaok>应用到 ${n} 行</button></div>
  </div></div>`;
  setTimeout(()=>{ const i=document.getElementById('beta-in'); if(i) i.focus(); },30);
}
async function saveBatchEta(){
  const p=DATA.pos[sel]; const v=(document.getElementById('beta-in').value||'').trim();
  if(!v){ toast('请填 ETA'); return; }
  const targets=p.lines.filter(l=>{ const s=stageOf(l); return s!=='cancelled'&&s!=='delivered'; });
  await DB.etaBulk(targets.map(l=>l.id), v);
  targets.forEach(l=>l.eta=v); closeModal();
  addLog('upd', `UPSERT po_leadtime SET value='${v.replace(/'/g,"''")}' WHERE slot='b0_eta' AND po_line_id IN (${targets.map(l=>l.id).join(',')})`, `整单设交期 ${targets.length} 行`);
  toast(`整单设交期:${targets.length} 行 → ${v}`); syncAll();
}
function openDelayModal(li){
  const l = DATA.pos[sel].lines[li];
  const last = (l.delays&&l.delays.length) ? l.delays[l.delays.length-1] : null;
  document.getElementById('modal').innerHTML = `<div class="ov" data-ovclose><div class="modal">
    <h4>延期 · ${esc(l.sku)} <span style="font-weight:500;color:var(--dim);font-size:12px">${esc(l.product)}</span></h4>
    <div class="mbody">
      <div class="fld"><label>预计延期至(新预计发货 / 到货日)</label><input type="date" id="dl-date" value="${last&&last.to?last.to:TODAY}"></div>
      <div class="fld"><label>延期原因</label><textarea id="dl-reason" placeholder="如:供应商缺货 / 物流延误 / 客户要求推迟 / 质检未过…"></textarea></div>
      ${(l.delays&&l.delays.length)?`<div style="font-size:11.5px;color:var(--dim)">该 SKU 已延期 <b style="color:var(--delay)">${l.delays.length}</b> 次 · <span class="chiplink" style="color:var(--delay)" data-hist="${li}">查看记录</span></div>`:''}
    </div>
    <div class="mfoot"><button class="btn" data-ovclose>取消</button><button class="btn pri" id="dl-ok" data-l="${li}">确认延期</button></div>
  </div></div>`;
  setTimeout(()=>{ const t=document.getElementById('dl-reason'); if(t) t.focus(); }, 30);
}
async function confirmDelay(li){
  const l = DATA.pos[sel].lines[li];
  const date = (document.getElementById('dl-date').value||'').trim();
  const reason = (document.getElementById('dl-reason').value||'').trim();
  if(!date){ toast('请先选预计延期至的日期'); return; }
  if(!reason){ toast('请填写延期原因'); return; }
  l.delays = l.delays || [];
  l.delays.push({ at:TODAY, to:date, reason });
  l.delayActive = true;
  const _wasC=l.po_status==='cancelled';
  await DB.delay(l.id, {active:true, list:l.delays}, _wasC);
  if(_wasC) l.po_status=null;
  closeModal();
  addLog('upd', `UPDATE channel_po SET po_status='delayed', expected_ship_date='${date}' WHERE id=${l.id};\nINSERT po_delay_log (po_id=${l.id}, delayed_to='${date}', reason='${reason.replace(/'/g,"''")}', logged_at='${TODAY}')`,
    `第 ${l.delays.length} 次延期 → 需新增 po_delay_log 表 + channel_po.expected_ship_date`);
  toast(`${l.sku} 延期至 ${date}(第 ${l.delays.length} 次)`); render();
}
async function undelayLine(l){
  if(l.delays&&l.delays.length) l.delays.pop();
  l.delayActive=false;
  await DB.delay(l.id, {active:false, list:l.delays||[]}, false);
  addLog('upd', `DELETE po_delay_log WHERE po_id=${l.id} AND logged_at=(最近一条); UPDATE channel_po SET po_status=NULL WHERE id=${l.id}`, `撤销最近一次延期 → ${STAGE[stageOf(l)].label}`);
  toast(`${l.sku} 已撤销最近延期`); render();
}
function openHistModal(li){
  const l = DATA.pos[sel].lines[li], recs = l.delays||[];
  document.getElementById('modal').innerHTML = `<div class="ov" data-ovclose><div class="modal">
    <h4>延期记录 · ${esc(l.sku)} <span style="font-weight:500;color:var(--dim);font-size:12px">共 ${recs.length} 次</span></h4>
    <div class="hist">${recs.length? recs.map((r,i)=>`<div class="hrec"><span class="hn">第 ${i+1} 次</span> · 记录于 ${r.at} · 预计延期至 <b>${r.to||'—'}</b><div class="hmeta">原因:${esc(r.reason)}</div></div>`).join('') : '<div class="hrec" style="color:#94a3b8">暂无延期记录</div>'}</div>
    <div class="mfoot"><button class="btn pri" data-ovclose>关闭</button></div>
  </div></div>`;
}
function openPoHist(){
  const p = DATA.pos[sel];
  const lines = p.lines.filter(l=>(l.delays||[]).length);
  const total = lines.reduce((s,l)=>s+l.delays.length,0);
  document.getElementById('modal').innerHTML = `<div class="ov" data-ovclose><div class="modal" style="max-width:560px">
    <h4>本单延期记录 · ${esc(p.po)} <span style="font-weight:500;color:var(--dim);font-size:12px">${lines.length} 个 SKU · 共 ${total} 次</span></h4>
    <div class="hist">${lines.length? lines.map(l=>`<div class="hrec"><span class="sku">${esc(l.sku)}</span> — 延期 <b style="color:var(--delay)">${l.delays.length}</b> 次 <span style="color:var(--faint)">(${l.delayActive?'进行中':'已解除/已发'})</span>${l.delays.map((r,i)=>`<div class="hmeta">· 第${i+1}次 · 记录于 ${r.at} · 预计至 ${r.to||'—'} — ${esc(r.reason)}</div>`).join('')}</div>`).join('') : '<div class="hrec" style="color:#94a3b8">本单暂无延期</div>'}</div>
    <div class="mfoot"><button class="btn pri" data-ovclose>关闭</button></div>
  </div></div>`;
}
async function shipRest(po, date){
  const ls = po.lines.filter(l=>l.po_status!=='cancelled' && remaining(l)>0 && stageOf(l)!=='delayed');
  if(!ls.length){ toast('该单没有可发的剩余量(延期行不自动发)'); return; }
  for(const l of ls){ const rem=remaining(l); const _wasC=l.po_status==='cancelled'; const _nb=await DB.ship(l.id, rem, date, _wasC, (l.delays&&l.delays.length)?l.delays:null); if(_nb!=null){ l.batches.push({id:_nb, qty:rem, ship:date, deliv:null}); if(_wasC) l.po_status=null; l.delayActive=false; } }
  addLog('ins', `INSERT po_shipment ×${ls.length}  (整单发余量, ship_date='${date}')`,
    ls.map(l=>`#${l.id}:${remaining(l)}`).join('  ') + `  → 各行发满归 Shipped`);
  toast(`整单发余量:${ls.length} 行已发出`); render();
}
async function deliverPO(po, date){
  const ls = po.lines.filter(l=>l.po_status!=='cancelled' && shipped(l)>0 && l.batches.some(b=>!b.deliv));
  if(!ls.length){ toast('没有待录送达的行'); return; }
  for(const l of ls){ await DB.deliver(l.id, date); l.batches.forEach(b=>{ if(!b.deliv) b.deliv=date; }); }
  addLog('upd', `UPDATE po_shipment SET delivery_date='${date}' WHERE po_id IN (${ls.map(l=>l.id).join(',')}) AND delivery_date IS NULL`, `整单录送达 ${ls.length} 行`);
  toast(`整单录送达:${ls.length} 行`); render();
}

// ── render ──
function render(){ renderChips(); renderList(); renderDoc(); }
function renderChips(){
  const counts = {all:DATA.pos.length};
  ['toship','partial','shipped','delivered'].forEach(s=>counts[s]=DATA.pos.filter(p=>poStage(p)===s).length);
  counts.delayed = DATA.pos.filter(p=>p.lines.some(l=>stageOf(l)==='delayed')).length;
  counts.cancelled = DATA.pos.filter(p=>p.lines.some(l=>l.po_status==='cancelled')).length;
  const defs = [['all','全部'],['toship','待发'],['partial','部分'],['delayed','延期'],['shipped','已发'],['delivered','已送达'],['cancelled','取消']];
  document.getElementById('chips').innerHTML = defs.map(([k,lab])=>
    `<span class="chip ${filter===k?'on':''}" data-chip="${k}">${lab} ${counts[k]??0}</span>`).join('');
}
function renderList(){
  const el = document.getElementById('polist');
  const rows = DATA.pos.map((p,i)=>({p,i})).filter(({p})=>{
    if(filter==='delayed'){ if(!p.lines.some(l=>stageOf(l)==='delayed')) return false; }
    else if(filter==='cancelled'){ if(!p.lines.some(l=>l.po_status==='cancelled')) return false; }
    else if(filter!=='all' && poStage(p)!==filter) return false;
    if(q && !(p.po.toLowerCase().includes(q) || p.ka.toLowerCase().includes(q)
        || p.lines.some(l=>l.sku.toLowerCase().includes(q) || (l.product||'').toLowerCase().includes(q)))) return false;
    return true;
  });
  if(!rows.length){ el.innerHTML='<div style="color:#94a3b8;font-size:12px;padding:20px 4px;text-align:center">无匹配 PO</div>'; return; }
  el.innerHTML = rows.map(({p,i})=>{
    const st = poStage(p), stc = cssv(STAGE[st].c);
    const tot = p.lines.reduce((s,l)=>s+l.qty,0), sh = p.lines.reduce((s,l)=>s+shipped(l),0);
    const pct = tot? Math.round(sh/tot*100):0;
    const nShip = p.lines.filter(l=>remaining(l)<=0 && l.po_status!=='cancelled').length;
    const nDelay = p.lines.filter(l=>stageOf(l)==='delayed').length;
    const nCancel = p.lines.filter(l=>l.po_status==='cancelled').length;
    const hit = (q && !(p.po.toLowerCase().includes(q)||p.ka.toLowerCase().includes(q)))
      ? p.lines.filter(l=>l.sku.toLowerCase().includes(q)||(l.product||'').toLowerCase().includes(q)).map(l=>l.sku) : [];
    return `<div class="pocard ${i===sel?'active':''}" data-po="${i}">
      <div class="pocard-top"><span class="pocard-po">${esc(p.po)}</span>
        <span class="pill" style="color:${stc};background:${cssv(STAGE[st].bg)}">${STAGE[st].label}</span></div>
      <div class="pocard-meta">${p.flag} ${p.country} · ${esc(p.ka)} · ${p.po_date}</div>
      <div class="pocard-meta">${p.lines.length} SKU · 已发 ${nShip}/${p.lines.length} 行 · ${fmtNum(sh)}/${fmtNum(tot)} 件${nDelay?` · <span style="color:var(--delay);font-weight:700">延期 ${nDelay}</span>`:''}${nCancel?` · <span style="color:var(--cancel);font-weight:700">取消 ${nCancel}</span>`:''}</div>
      ${hit.length?`<div class="pocard-meta" style="color:var(--blue)">命中 SKU:${esc(hit.slice(0,3).join(', '))}${hit.length>3?` +${hit.length-3}`:''}</div>`:''}
      <div class="pbar"><i style="width:${pct}%;background:${stc}"></i></div>
    </div>`;
  }).join('');
}
function renderDoc(){
  const p = DATA.pos[sel];
  if(!p){ document.getElementById('doc').innerHTML=''; return; }
  const st = poStage(p), stc = cssv(STAGE[st].c);
  const totQty = p.lines.reduce((s,l)=>s+l.qty,0);
  const shQty  = p.lines.reduce((s,l)=>s+shipped(l),0);
  const delivQty = p.lines.reduce((s,l)=>s+l.batches.filter(b=>b.deliv).reduce((a,b)=>a+Number(b.qty),0),0);
  const totVal = p.lines.reduce((s,l)=>s+l.qty*l.price,0);
  const shVal  = p.lines.reduce((s,l)=>s+shipped(l)*l.price,0);

  const rows = p.lines.map((l,li)=>{
    const s = stageOf(l), sc = cssv(STAGE[s].c), sh = shipped(l), rem = remaining(l);
    const pct = l.qty? Math.round(sh/l.qty*100):0;
    const B=(cls,act,lab)=>`<button class="btn ${cls} mini" data-act="${act}" data-l="${li}">${lab}</button>`;
    let ops = '';
    if(s==='toship')        ops = B('pri','ship','发货')+B('','partial','分批')+B('','delay','延期')+B('danger','cancel','取消');
    else if(s==='partial')  ops = B('pri','ship','发余量')+B('','partial','分批')+B('','delay','延期')+B('ghost','reopen','退回');
    else if(s==='delayed')  ops = B('pri','ship','发货')+B('','delay','再延期')+B('','undelay','撤销延期')+B('danger','cancel','取消');
    else if(s==='shipped')  ops = B('good','deliver','录送达')+B('ghost','reopen','退回');
    else if(s==='delivered')ops = B('ghost','reopen','退回');
    else if(s==='cancelled')ops = B('','restore','恢复');
    if(s!=='cancelled' && s!=='delivered') ops += B('','eta', l.eta?'改交期':'设交期');
    let base;
    if(s==='cancelled')  base = `<span style="color:var(--faint);font-size:11px">已取消</span>`;
    else if(sh===0)      base = `<span style="color:var(--faint);font-size:11px">未发货</span>`;
    else base = `<span class="qtytxt">已发 <b style="color:${sc}">${fmtNum(sh)}</b>${rem>0?` · 未发 ${fmtNum(rem)}`:''} / ${fmtNum(l.qty)}</span>
         <div class="fbar"><i style="width:${pct}%;background:${sc}"></i></div>`;
    const delays = l.delays || [];
    let rsn = '';
    if(s==='delayed'){ const last = delays[delays.length-1] || {};
      rsn = `<div class="rsn" style="color:var(--delay)"><b>延期·</b><span>预计至 <b>${last.to||'—'}</b> · ${esc(last.reason||'')} <span class="chiplink" data-hist="${li}">×${delays.length} 记录</span></span></div>`; }
    else if(s==='cancelled' && l.cancel_reason){ rsn = `<div class="rsn" style="color:var(--cancel)"><b>因·</b><span>${esc(l.cancel_reason)}</span></div>`; }
    else if(delays.length){ rsn = `<div class="rsn" style="color:var(--delay)"><span class="chiplink" data-hist="${li}">曾延期 ×${delays.length}</span></div>`; }
    const etaChip = (l.eta && s!=='cancelled') ? `<div class="rsn" style="color:var(--shipped)"><b>交期·</b><span>${esc(l.eta)}</span></div>` : '';
    const fulfil = base + rsn + etaChip;
    return `<tr class="line">
      <td><input type="checkbox" data-chk="${li}" ${['toship','partial','delayed'].includes(s)?'':'disabled'}></td>
      <td><div class="sku">${esc(l.sku)}</div></td>
      <td><div class="prod">${esc(l.product)}</div></td>
      <td class="r">${fmtNum(l.qty)}</td>
      <td class="r">${money(l.price,p.currency)}</td>
      <td class="r">${money(l.qty*l.price,p.currency)}</td>
      <td class="fulfil"><span class="pill" style="color:${sc};background:${cssv(STAGE[s].bg)}"><span class="dot" style="background:${sc}"></span>${STAGE[s].label}</span>${fulfil}</td>
      <td class="r" style="font-size:11.5px;color:var(--dim)">${lastShipDate(l)||'—'}</td>
      <td class="r" style="font-size:11.5px;color:var(--dim)">${lastDelivDate(l)||'—'}</td>
      <td><div class="ops">${ops}</div></td>
    </tr>`;
  }).join('');

  document.getElementById('doc').innerHTML = `<div class="doc">
    <div class="doc-head">
      <div><div class="doc-title">PURCHASE ORDER · 采购订单</div><div class="doc-po">${esc(p.po)}</div>
        <span class="pill" style="color:${stc};background:${cssv(STAGE[st].bg)};margin-top:8px"><span class="dot" style="background:${stc}"></span>整单 ${STAGE[st].label}</span></div>
      <div class="doc-logo"><b>INIU</b><span>EMEA Supply</span></div>
    </div>
    <div class="meta">
      <div><div class="k">买方 (KA)</div><div class="v">${p.flag} ${esc(p.ka)}</div></div>
      <div><div class="k">国家</div><div class="v">${p.country}</div></div>
      <div><div class="k">PO 日期</div><div class="v">${p.po_date}</div></div>
      <div><div class="k">币种 / 总额</div><div class="v">${p.currency} · ${money(totVal,p.currency)}</div></div>
    </div>
    <div class="doc-tools">
      <label style="font-size:11px;color:var(--dim);font-weight:700">发货/送达日期</label>
      <input type="date" id="opdate" value="${TODAY}">
      <button class="btn pri" data-poact="shiprest">整单发余量</button>
      <button class="btn good" data-poact="deliver">整单录送达</button>
      <button class="btn" data-poact="shipsel">发所选</button>
      <button class="btn" data-poact="beta">整单设交期</button>
      <span class="grow"></span>
      ${p.lines.some(l=>(l.delays||[]).length)?`<button class="btn" data-poact="pohist" style="color:var(--delay);border-color:#ddd0ff">延期记录 (${p.lines.reduce((s,l)=>s+(l.delays||[]).length,0)})</button>`:''}
      <button class="btn ghost danger" data-poact="reopenall">退回整单</button>
    </div>
    <div style="overflow:auto"><table>
      <thead><tr>
        <th style="width:26px"></th><th>SKU</th><th>产品</th><th class="r">订购</th><th class="r">单价</th><th class="r">金额</th>
        <th>履约状态</th><th class="r">发货日</th><th class="r">送达日</th><th style="text-align:right">操作</th>
      </tr></thead><tbody>${rows}</tbody>
    </table></div>
    <div class="foot">
      <div><div class="tt">订购</div><div class="tv">${fmtNum(totQty)}</div></div>
      <div><div class="tt">已发</div><div class="tv" style="color:var(--shipped)">${fmtNum(shQty)}</div></div>
      <div><div class="tt">未发</div><div class="tv" style="color:${totQty-shQty>0?'var(--partial)':'var(--dim)'}">${fmtNum(totQty-shQty)}</div></div>
      <div><div class="tt">已送达</div><div class="tv" style="color:var(--delivered)">${fmtNum(delivQty)}</div></div>
      <div style="margin-left:auto"><div class="tt">已发金额 / 总额</div><div class="tv">${money(shVal,p.currency)} <span style="font-size:11px;color:var(--faint)">/ ${money(totVal,p.currency)}</span></div></div>
    </div>
  </div>`;
}

// ── events (delegation) ──
APP.addEventListener('click', async e=>{
  const poCard = e.target.closest('[data-po]');
  if(poCard){ sel = +poCard.dataset.po; render(); return; }
  const chip = e.target.closest('[data-chip]');
  if(chip){ filter = chip.dataset.chip; render(); return; }
  if(e.target.id==='clrlog'){ log=[]; renderLog(); return; }
  if(e.target.id==='collapselog'){ root.classList.add('logcol'); return; }
  if(e.target.closest('#logtoggle')){ root.classList.remove('logcol'); return; }
  if(e.target.matches('[data-ovclose]')){ closeModal(); return; }
  const okb = e.target.closest('#dl-ok'); if(okb){ confirmDelay(+okb.dataset.l); return; }
  const histb = e.target.closest('[data-hist]'); if(histb){ openHistModal(+histb.dataset.hist); return; }
  const etaok = e.target.closest('[data-etaok]'); if(etaok){ saveEta(+etaok.dataset.etaok); return; }
  const etacl = e.target.closest('[data-etaclear]'); if(etacl){ clearEta(+etacl.dataset.etaclear); return; }
  const betaok = e.target.closest('[data-betaok]'); if(betaok){ saveBatchEta(); return; }
  const skueta = e.target.closest('[data-skueta]'); if(skueta){ openEtaModal(+skueta.dataset.skueta); return; }
  const p = DATA.pos[sel]; if(!p) return;
  const dateEl = document.getElementById('opdate'); const date = dateEl? dateEl.value : TODAY;
  const act = e.target.closest('[data-act]');
  if(act){
    const l = p.lines[+act.dataset.l], a = act.dataset.act;
    if(a==='ship') shipLine(l, remaining(l), date);
    else if(a==='partial'){ const v=prompt(`分批发货 — 本次发货数量(剩余 ${remaining(l)}):`, ''); if(v!=null) shipLine(l, Number(v), date); }
    else if(a==='deliver') deliverLine(l, date);
    else if(a==='reopen') reopenLine(l);
    else if(a==='delay') openDelayModal(+act.dataset.l);
    else if(a==='undelay') undelayLine(l);
    else if(a==='eta') openEtaModal(l.id);
    else if(a==='cancel') cancelLine(l);
    else if(a==='restore') restoreLine(l);
    return;
  }
  const poact = e.target.closest('[data-poact]');
  if(poact){
    const a = poact.dataset.poact;
    if(a==='shiprest') shipRest(p, date);
    else if(a==='deliver') deliverPO(p, date);
    else if(a==='pohist') openPoHist();
    else if(a==='beta') openBatchEta();
    else if(a==='reopenall'){ if(confirm('退回整单?将删除该单全部批次并清状态。')){ p.lines.forEach(l=>{ l.batches=[]; l.po_status=null; }); addLog('del',`DELETE po_shipment WHERE po_id IN (${p.lines.map(l=>l.id).join(',')}); UPDATE channel_po SET po_status=NULL`,`整单退回待发`); toast('整单已退回待发'); render(); } }
    else if(a==='shipsel'){
      const chks=[...document.querySelectorAll('[data-chk]:checked')].map(c=>p.lines[+c.dataset.chk]).filter(l=>remaining(l)>0);
      if(!chks.length){ toast('请先勾选要发货的行'); return; }
      for(const l of chks){ const rem=remaining(l); const _nb=await DB.ship(l.id, rem, date, l.po_status==='cancelled', (l.delays&&l.delays.length)?l.delays:null); if(_nb!=null){ l.batches.push({id:_nb,qty:rem,ship:date,deliv:null}); if(l.po_status==='cancelled') l.po_status=null; l.delayActive=false; } }
      addLog('ins',`INSERT po_shipment ×${chks.length}  (发所选, ship_date='${date}')`, chks.map(l=>`#${l.id}:${remaining(l)}`).join('  '));
      toast(`已发所选 ${chks.length} 行`); render();
    }
    return;
  }
});
document.getElementById('search').addEventListener('input', e=>{ q=e.target.value.trim().toLowerCase(); renderList(); });

// ══ SKU 交期看板 —— 与发货履约共用同一份 DATA.pos;交期由履约状态派生 ══
let skView='group'; const SF={q:'',sku:'',ka:'',stat:''};
function isoWeek(iso){ if(!iso) return null; const d=new Date(iso+'T00:00:00Z'); const day=d.getUTCDay()||7; d.setUTCDate(d.getUTCDate()+4-day); const y0=new Date(Date.UTC(d.getUTCFullYear(),0,1)); return Math.ceil((((d-y0)/86400000)+1)/7); }
const CURW = isoWeek(TODAY);
function etaVal(l){ if(!l.eta) return null; const m=/(?:week|w)\s*(\d+)/i.exec(l.eta); if(m) return {week:+m[1],label:'W'+m[1]}; if(/^\d{4}-\d{2}-\d{2}$/.test(l.eta)) return {week:isoWeek(l.eta),label:l.eta}; return {week:null,label:l.eta}; }
function etaOf(l){
  const s = stageOf(l);
  if(s==='delivered'){ const d=lastDelivDate(l); return {stage:s,week:isoWeek(d),label:'已送达 '+(d||'')}; }
  if(s==='shipped'){ const d=lastShipDate(l); return {stage:s,week:isoWeek(d),label:'已发 '+(d||'')+' · 在途'}; }
  if(s==='delayed'){ const last=(l.delays||[]).slice(-1)[0]||{}; return {stage:s,week:isoWeek(last.to),label:'延期至 '+(last.to||'—')}; }
  if(s==='partial'){ const d=lastShipDate(l); return {stage:s,week:isoWeek(d),label:'部分发 '+(d||'')}; }
  if(s==='cancelled') return {stage:s,week:null,label:'已取消'};
  const pv=etaVal(l); if(pv) return {stage:'toship',week:pv.week,label:'预计 '+pv.label};   // 手填的预计交期
  return {stage:'toship',week:null,label:'待发'};
}
function allLines(){ return DATA.pos.flatMap(p=>p.lines.map(l=>({p,l}))); }
function skFiltered(){ return allLines().filter(({p,l})=>{
  if(SF.sku && l.sku!==SF.sku) return false;
  if(SF.ka && p.ka!==SF.ka) return false;
  if(SF.stat && etaOf(l).stage!==SF.stat) return false;
  if(SF.q){ const h=`${l.sku} ${l.product} ${p.po} ${p.ka}`.toLowerCase(); if(!h.includes(SF.q)) return false; }
  return true; }); }
function fillSkuOptions(){
  const sel=document.getElementById('sk-sku');
  if(sel && sel.options.length<=1){ const skus=[...new Set(allLines().map(x=>x.l.sku))].sort();
    sel.innerHTML='<option value="">全部 SKU</option>'+skus.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join(''); }
  const kel=document.getElementById('sk-ka');
  if(kel && kel.options.length<=1){ const kas=[...new Set(DATA.pos.map(p=>p.ka))].sort();
    kel.innerHTML='<option value="">全部客户</option>'+kas.map(k=>`<option value="${esc(k)}">${esc(k)}</option>`).join(''); }
}
// 只看未发:remaining>0 且未取消(待发 / 部分未发 / 延期)
const isPending = l => stageOf(l)!=='cancelled' && remaining(l)>0;
function renderSku(){
  fillSkuOptions();
  const items = skFiltered().filter(x=>isPending(x.l));
  renderSkuBoard(items);
  renderSkuStats(items);
}
function renderSkuBoard(items){
  const el=document.getElementById('sk-group');
  const cnt=document.getElementById('sk-count');
  if(cnt) cnt.textContent = items.length
    ? `${new Set(items.map(x=>x.l.sku)).size} 个 SKU · ${items.length} 行 · ${fmtNum(items.reduce((s,x)=>s+remaining(x.l),0))} 件待发`
    : '';
  if(!items.length){ el.innerHTML='<div style="padding:40px;text-align:center;color:var(--faint)">当前筛选下没有未发 SKU 🎉</div>'; return; }
  const groups={}; items.forEach(x=>(groups[x.l.sku]??=[]).push(x));
  el.innerHTML=Object.keys(groups).sort().map(sku=>{
    const rows=groups[sku].slice().sort((a,b)=>(etaOf(a.l).week??9999)-(etaOf(b.l).week??9999));
    const tot=rows.reduce((s,x)=>s+remaining(x.l),0), orders=new Set(rows.map(x=>x.p.po)).size;
    return `<div class="skucard"><div class="skuhead"><span class="skucode">${esc(sku)}</span><span class="skuprod">${esc(rows[0].l.product)}</span>
      <div class="skuagg"><span><b>${orders}</b> 单</span><span><b>${fmtNum(tot)}</b> 件待发</span></div></div>
      ${rows.map(({p,l})=>{ const e=etaOf(l), c=cssv(STAGE[e.stage].c), rem=remaining(l);
        return `<div class="skuline"><span class="pill" style="color:${c};background:${cssv(STAGE[e.stage].bg)}"><span class="dot" style="background:${c}"></span>${esc(e.label)}</span>
          <span class="po">${esc(p.po)}</span><span class="ka">${p.flag||''} ${esc(p.ka)}</span>
          <span style="flex:1"></span><span class="q">${fmtNum(rem)}${rem!==l.qty?` / ${fmtNum(l.qty)}`:''} 件</span><span class="dt">${p.po_date}</span>
          <button class="btn mini" data-skueta="${l.id}">${l.eta?'改交期':'设交期'}</button></div>`; }).join('')}
    </div>`;
  }).join('');
}
function renderSkuStats(items){
  const el=document.getElementById('sk-stats');
  if(!items.length){ el.innerHTML=''; return; }
  const rem=x=>remaining(x.l);
  const totRem=items.reduce((s,x)=>s+rem(x),0);
  const skuN=new Set(items.map(x=>x.l.sku)).size, poN=new Set(items.map(x=>x.p.po)).size, kaN=new Set(items.map(x=>x.p.ka)).size;
  // 各渠道未发件数(降序)
  const byKa={}; items.forEach(x=>{ (byKa[x.p.ka]??={q:0,sku:new Set()}); byKa[x.p.ka].q+=rem(x); byKa[x.p.ka].sku.add(x.l.sku); });
  const kaArr=Object.entries(byKa).sort((a,b)=>b[1].q-a[1].q); const kaMax=Math.max(...kaArr.map(x=>x[1].q),1);
  // 未发状态分布(行数)
  const stC={toship:0,partial:0,delayed:0}; items.forEach(x=>{ stC[stageOf(x.l)]=(stC[stageOf(x.l)]||0)+1; });
  const stArr=['toship','partial','delayed'].filter(s=>stC[s]);
  const M=(l,v,s)=>`<div class="sk-metric"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${s}</div></div>`;
  const bar=(lab,sub,val,max)=>`<div class="barrow"><div class="bl" title="${esc(lab)}">${esc(lab)}<span>${sub}</span></div><div class="bartrack"><i style="width:${Math.max(3,Math.round(val/max*100))}%"></i></div><div class="bv">${fmtNum(val)}</div></div>`;
  const seg=stArr.map(s=>`<i style="width:${stC[s]/items.length*100}%;background:${cssv(STAGE[s].c)}" title="${STAGE[s].label} ${stC[s]}"></i>`).join('');
  const leg=['toship','partial','delayed'].map(s=>`<div class="sg"><span class="sw" style="background:${cssv(STAGE[s].c)}"></span>${STAGE[s].label}<b>${stC[s]||0} 行</b></div>`).join('');
  el.innerHTML=`
    <div class="sk-metrics">${M('未发 SKU 行',items.length,`${skuN} 个 SKU`)}${M('未发件数',fmtNum(totRem),'件')}${M('涉及订单',poN,'张 PO')}${M('涉及渠道',kaN,'个 KA')}</div>
    <div class="sk-charts">
      <div class="sk-chart"><h4>各渠道未发件数</h4>${kaArr.map(([k,o])=>bar(k,` · ${o.sku.size} SKU`,o.q,kaMax)).join('')}</div>
      <div class="sk-chart"><h4>未发状态分布(行数)</h4><div class="segbar">${seg}</div><div class="seglegend">${leg}</div></div>
    </div>`;
}
function renderSkuTimeline(){
  const items=skFiltered().filter(x=>etaOf(x.l).week!=null);
  const el=document.getElementById('sk-timeline');
  if(!items.length){ el.innerHTML='<div class="tl"><div style="padding:44px;text-align:center;color:var(--faint)">当前筛选下没有带日期的交期(待发行无排期节点)</div></div>'; return; }
  const weeks=[...new Set([...items.map(x=>etaOf(x.l).week), CURW])].sort((a,b)=>a-b);
  const lo=weeks[0], hi=weeks[weeks.length-1], span=Math.max(1,hi-lo), pos=w=>((w-lo)/span)*100;
  const groups={}; items.forEach(x=>(groups[x.l.sku]??=[]).push(x));
  const scale=`<div class="tlscale"><div></div><div class="months">${weeks.map(w=>w===CURW?`<span class="mo cur" style="left:${pos(w)}%">当前 W${w}</span>`:`<span class="mo" style="left:${pos(w)}%">W${w}</span>`).join('')}</div></div>`;
  const trows=Object.keys(groups).sort().map(sku=>{
    const rs=groups[sku], by={}; rs.forEach(x=>{ const w=etaOf(x.l).week, st=etaOf(x.l).stage; (by[w]??={q:0,st}); by[w].q+=x.l.qty; by[w].st=st; });
    const dots=Object.entries(by).map(([w,o])=>`<span class="tdot" style="left:${pos(+w)}%;background:${cssv(STAGE[o.st].c)}" title="W${w} · ${fmtNum(o.q)} 件 · ${STAGE[o.st].label}">${fmtNum(o.q)}</span>`).join('');
    return `<div class="trow"><div><div class="c">${esc(sku)}</div><div class="s">${esc(rs[0].l.product)}</div></div><div class="track"><span class="curline" style="left:${pos(CURW)}%"></span>${dots}</div></div>`;
  }).join('');
  el.innerHTML=`<div class="tl">${scale}${trows}</div>`;
}
// 顶部总 tab + 子 tab + SKU 筛选
document.querySelectorAll('.navtab').forEach(t=>t.addEventListener('click',()=>{
  document.querySelectorAll('.navtab').forEach(x=>x.classList.remove('on')); t.classList.add('on');
  const nav=t.dataset.nav;
  document.getElementById('view-ship').hidden = nav!=='ship';
  document.getElementById('view-sku').hidden = nav!=='sku';
  document.getElementById('view-fin').hidden = nav!=='fin';
  root.classList.toggle('sku-active', nav==='sku');
  root.classList.toggle('fin-active', nav==='fin');
  if(nav==='sku') renderSku();
  if(nav==='fin') renderFin();
}));
document.getElementById('sk-sku').addEventListener('change',e=>{ SF.sku=e.target.value; renderSku(); });
document.getElementById('sk-ka').addEventListener('change',e=>{ SF.ka=e.target.value; renderSku(); });
document.getElementById('sk-stat').addEventListener('change',e=>{ SF.stat=e.target.value; renderSku(); });
document.getElementById('sk-q').addEventListener('input',e=>{ SF.q=e.target.value.trim().toLowerCase(); renderSku(); });

// ── 开票 · 财务(单据视图,与发货履约贯通;开票单位 = 已发货批次;同批次折叠)──
const invoiced={};                         // batch.id -> true(该发货批次已开票)
let finSel=0, finFilter='all', finQ='';
const finCollapsed=new Set();              // 折叠的批次组 gid
const FINSTAGE={
  open:  {label:'待开票',  c:'#d97706', bg:'#fdf4e7'},
  part:  {label:'部分开票', c:'#2563eb', bg:'#eff4ff'},
  done:  {label:'已开票',  c:'#059669', bg:'#e9f9f1'},
  unship:{label:'未发货',  c:'#64748b', bg:'#f1f5f9'},
};
// 只有"已发货批次"才可开票:一个 po_shipment 记录 = 一个可开票单元
function poBatches(p){ return p.lines.filter(l=>l.po_status!=='cancelled').flatMap(l=>l.batches.map(b=>({l,b}))); }
function poInvStage(p){
  const bs=poBatches(p);
  if(!bs.length) return 'unship';
  const done=bs.filter(x=>invoiced[x.b.id]).length;
  if(done===0) return 'open';
  if(done<bs.length) return 'part';
  return 'done';
}
function renderFin(){ renderFinChips(); renderFinList(); renderFinDoc(); }
function renderFinChips(){
  const defs=[['all','全部'],['open','待开票'],['part','部分开票'],['done','已开票'],['unship','未发货']];
  const counts={all:DATA.pos.length};
  ['open','part','done','unship'].forEach(s=>counts[s]=DATA.pos.filter(p=>poInvStage(p)===s).length);
  document.getElementById('fin-chips').innerHTML=defs.map(([k,lab])=>
    `<span class="chip ${finFilter===k?'on':''}" data-finchip="${k}">${lab} ${counts[k]??0}</span>`).join('');
}
function finFilterPos(){
  return DATA.pos.map((p,i)=>({p,i})).filter(({p})=>{
    if(finFilter!=='all' && poInvStage(p)!==finFilter) return false;
    if(finQ && !(p.po.toLowerCase().includes(finQ)||p.ka.toLowerCase().includes(finQ)
       || p.lines.some(l=>l.sku.toLowerCase().includes(finQ)||(l.product||'').toLowerCase().includes(finQ)))) return false;
    return true;
  });
}
function renderFinList(){
  const el=document.getElementById('fin-polist');
  const rows=finFilterPos();
  if(!rows.length){ el.innerHTML='<div style="color:#94a3b8;font-size:12px;padding:20px 4px;text-align:center">无匹配 PO</div>'; return; }
  el.innerHTML=rows.map(({p,i})=>{
    const st=poInvStage(p), stc=FINSTAGE[st].c;
    const bs=poBatches(p);
    const doneN=bs.filter(x=>invoiced[x.b.id]).length;
    const shVal=bs.reduce((s,x)=>s+x.b.qty*x.l.price,0);
    const invVal=bs.filter(x=>invoiced[x.b.id]).reduce((s,x)=>s+x.b.qty*x.l.price,0);
    const pct=shVal? Math.round(invVal/shVal*100):0;
    const hit=(finQ && !(p.po.toLowerCase().includes(finQ)||p.ka.toLowerCase().includes(finQ)))
      ? p.lines.filter(l=>l.sku.toLowerCase().includes(finQ)||(l.product||'').toLowerCase().includes(finQ)).map(l=>l.sku):[];
    const meta2 = bs.length ? `已开 ${doneN}/${bs.length} 批 · ${money(invVal,p.currency)} / ${money(shVal,p.currency)} 可开`
                            : '尚未发货 · 暂无可开票批次';
    return `<div class="pocard ${i===finSel?'active':''}" data-finpo="${i}">
      <div class="pocard-top"><span class="pocard-po">${esc(p.po)}</span>
        <span class="pill" style="color:${stc};background:${FINSTAGE[st].bg}">${FINSTAGE[st].label}</span></div>
      <div class="pocard-meta">${p.flag} ${p.country} · ${esc(p.ka)} · ${p.po_date}</div>
      <div class="pocard-meta">${meta2}</div>
      ${hit.length?`<div class="pocard-meta" style="color:var(--blue)">命中 SKU:${esc(hit.slice(0,3).join(', '))}${hit.length>3?` +${hit.length-3}`:''}</div>`:''}
      <div class="pbar"><i style="width:${pct}%;background:${stc}"></i></div>
    </div>`;
  }).join('');
}
function renderFinDoc(){
  const p=DATA.pos[finSel];
  const el=document.getElementById('fin-doc');
  if(!p){ el.innerHTML=''; return; }
  const st=poInvStage(p), stc=FINSTAGE[st].c, cur=p.currency;
  const bs=poBatches(p);
  const totVal=p.lines.reduce((s,l)=>s+l.qty*l.price,0);
  const shVal=bs.reduce((s,x)=>s+x.b.qty*x.l.price,0);
  const invVal=bs.filter(x=>invoiced[x.b.id]).reduce((s,x)=>s+x.b.qty*x.l.price,0);
  const pendVal=Math.max(0,shVal-invVal), unshipVal=Math.max(0,totVal-shVal);
  const totQty=p.lines.reduce((s,l)=>s+l.qty,0);
  const shQty=bs.reduce((s,x)=>s+x.b.qty,0);
  const invQty=bs.filter(x=>invoiced[x.b.id]).reduce((s,x)=>s+x.b.qty,0);
  const nBatch=bs.length, nInv=bs.filter(x=>invoiced[x.b.id]).length;
  const pc=v=> totVal? v/totVal*100:0;

  const memberRow=(l,b)=>{
    const on=!!invoiced[b.id]; const meta=on?FINSTAGE.done:FINSTAGE.open;
    const ops=on?`<button class="btn ghost mini" data-finb="${b.id}" data-act="uninv">撤销发票</button>`
                :`<button class="btn pri mini" data-finb="${b.id}" data-act="inv">开发票</button>`;
    return `<tr class="line ${on?'':'rowopen'}">
      <td><input type="checkbox" data-finchk="${b.id}" ${on?'disabled':''}></td>
      <td><div class="sku">${esc(l.sku)}</div></td>
      <td><div class="prod">${esc(l.product)}</div></td>
      <td class="bcell">${b.deliv?'<span class="bdv done">已送达</span>':'<span class="bdv tr">在途</span>'}</td>
      <td class="r">${fmtNum(b.qty)}</td>
      <td class="r">${money(l.price,cur)}</td>
      <td class="r">${money(b.qty*l.price,cur)}</td>
      <td class="fulfil"><span class="pill" style="color:${meta.c};background:${meta.bg}"><span class="dot" style="background:${meta.c}"></span>${meta.label}</span></td>
      <td class="r dim">${b.deliv||'—'}</td>
      <td><div class="ops">${ops}</div></td></tr>`;
  };

  // 按发货日期分组;未发余量、已取消各一组;整个 PO 全展示
  const grpMap={};
  p.lines.forEach(l=>{ if(l.po_status==='cancelled') return; l.batches.forEach(b=>{ (grpMap[b.ship||'—']??=[]).push({l,b}); }); });
  const unshipRows=p.lines.filter(l=>l.po_status!=='cancelled' && remaining(l)>0);
  const cancelRows=p.lines.filter(l=>l.po_status==='cancelled');
  let body='';
  Object.keys(grpMap).sort().forEach(date=>{
    const mem=grpMap[date], gid='b#'+date;
    const qty=mem.reduce((s,x)=>s+x.b.qty,0), amt=mem.reduce((s,x)=>s+x.b.qty*x.l.price,0);
    const invN=mem.filter(x=>invoiced[x.b.id]).length, tot=mem.length;
    const gstate=invN===0?'open':invN<tot?'part':'done', gm=FINSTAGE[gstate];
    const allDeliv=mem.every(x=>x.b.deliv), someDeliv=mem.some(x=>x.b.deliv);
    const dv=allDeliv?'done':someDeliv?'part':'transit', dvLab={done:'已送达',part:'部分送达',transit:'在途'}[dv];
    const collapsed=finCollapsed.has(gid);
    const gbtn=gstate==='done'
      ? `<button class="btn ghost mini" data-fingrp="${date}" data-act="uninv">撤销整批</button>`
      : `<button class="btn pri mini" data-fingrp="${date}" data-act="inv">开整批(剩 ${tot-invN})</button>`;
    body+=`<tbody class="grp ${collapsed?'collapsed':''}">
      <tr class="grphead" data-grptoggle="${gid}"><td colspan="10"><div class="ghd">
        <span class="caret">▾</span><span class="gt">📦 发货批次 · ${date}</span>
        <span class="bdv ${dv==='transit'?'tr':'done'}">${dvLab}</span>
        <span class="gmeta">${tot} SKU · ${fmtNum(qty)} 件 · ${money(amt,cur)}</span>
        <span class="pill" style="color:${gm.c};background:${gm.bg}">已开 ${invN}/${tot}</span>
        <span style="flex:1"></span>${gbtn}
      </div></td></tr>
      ${mem.map(x=>memberRow(x.l,x.b)).join('')}
    </tbody>`;
  });
  if(unshipRows.length){
    const gid='unship', collapsed=finCollapsed.has(gid);
    const qty=unshipRows.reduce((s,l)=>s+remaining(l),0), amt=unshipRows.reduce((s,l)=>s+remaining(l)*l.price,0);
    body+=`<tbody class="grp ${collapsed?'collapsed':''}">
      <tr class="grphead" data-grptoggle="${gid}"><td colspan="10"><div class="ghd">
        <span class="caret">▾</span><span class="gt" style="color:#64748b">⏳ 未发货余量</span>
        <span class="gmeta">${unshipRows.length} SKU · ${fmtNum(qty)} 件 · ${money(amt,cur)} · 暂不可开票</span>
      </div></td></tr>
      ${unshipRows.map(l=>`<tr class="line rowun"><td></td><td><div class="sku">${esc(l.sku)}</div></td><td><div class="prod">${esc(l.product)}</div></td><td class="dim">未发货</td><td class="r dim">${fmtNum(remaining(l))}</td><td class="r dim">${money(l.price,cur)}</td><td class="r dim">${money(remaining(l)*l.price,cur)}</td><td class="fulfil"><span class="pill" style="color:${FINSTAGE.unship.c};background:${FINSTAGE.unship.bg}"><span class="dot" style="background:${FINSTAGE.unship.c}"></span>未发货</span></td><td class="r dim">—</td><td><div class="ops"><span style="color:var(--faint);font-size:11px">待发货</span></div></td></tr>`).join('')}
    </tbody>`;
  }
  if(cancelRows.length){
    const gid='cancel', collapsed=finCollapsed.has(gid);
    body+=`<tbody class="grp ${collapsed?'collapsed':''}">
      <tr class="grphead" data-grptoggle="${gid}"><td colspan="10"><div class="ghd">
        <span class="caret">▾</span><span class="gt" style="color:#dc2626">✕ 已取消</span>
        <span class="gmeta">${cancelRows.length} SKU · 不开票</span></div></td></tr>
      ${cancelRows.map(l=>`<tr class="line"><td></td><td><div class="sku">${esc(l.sku)}</div></td><td><div class="prod">${esc(l.product)}</div></td><td class="dim">—</td><td class="r dim">${fmtNum(l.qty)}</td><td class="r dim">${money(l.price,cur)}</td><td class="r dim">—</td><td class="fulfil"><span class="pill" style="color:#dc2626;background:#fdecec"><span class="dot" style="background:#dc2626"></span>已取消</span></td><td class="r dim">—</td><td><div class="ops"><span style="color:var(--faint);font-size:11px">—</span></div></td></tr>`).join('')}
    </tbody>`;
  }

  el.innerHTML=`<div class="doc">
    <div class="doc-head">
      <div><div class="doc-title">INVOICE WORKSHEET · 开票工作单</div><div class="doc-po">${esc(p.po)}</div>
        <span class="pill" style="color:${stc};background:${FINSTAGE[st].bg};margin-top:8px"><span class="dot" style="background:${stc}"></span>整单 ${FINSTAGE[st].label} · ${nInv}/${nBatch} 批已开</span></div>
      <div class="doc-logo"><b>INIU</b><span>EMEA Finance</span></div>
    </div>
    <div class="meta">
      <div><div class="k">买方 (KA)</div><div class="v">${p.flag} ${esc(p.ka)}</div></div>
      <div><div class="k">国家</div><div class="v">${p.country}</div></div>
      <div><div class="k">PO 日期</div><div class="v">${p.po_date}</div></div>
      <div><div class="k">币种 / 总额</div><div class="v">${cur} · ${money(totVal,cur)}</div></div>
    </div>
    <div class="po-prog" style="margin:2px 0 0">
      <div class="pbar">${invVal>0?`<i class="s-inv" style="width:${pc(invVal)}%"></i>`:''}${pendVal>0?`<i class="s-pend" style="width:${pc(pendVal)}%"></i>`:''}${unshipVal>0?`<i class="s-un" style="width:${pc(unshipVal)}%"></i>`:''}</div>
      <div class="pbreak"><span><i class="s-inv"></i>已开票 <b>${money(invVal,cur)}</b></span><span><i class="s-pend"></i>待开票 · 已发货 <b>${money(pendVal,cur)}</b></span><span><i class="s-un"></i>未发货 · 暂不可开 <b>${money(unshipVal,cur)}</b></span></div>
    </div>
    <div class="doc-tools">
      <label style="font-size:11px;color:var(--dim);font-weight:700">发票日期</label>
      <input type="date" id="fin-invdate" value="${TODAY}">
      <button class="btn pri" data-finpoact="invall">整单开票(全部已发批次)</button>
      <button class="btn" data-finpoact="invsel">开所选批次</button>
      <span class="grow"></span>
      <button class="btn ghost danger" data-finpoact="uninvall">撤销整单开票</button>
    </div>
    <div style="overflow:auto"><table>
      <thead><tr>
        <th style="width:26px"></th><th>SKU</th><th>产品</th><th>发货批次</th><th class="r">数量</th><th class="r">单价</th><th class="r">金额</th>
        <th>开票状态</th><th class="r">送达日</th><th style="text-align:right">操作</th>
      </tr></thead>${body||'<tbody><tr><td colspan="10" style="text-align:center;color:var(--faint);padding:26px">该单尚未发货,暂无可开票批次</td></tr></tbody>'}
    </table></div>
    <div class="foot">
      <div><div class="tt">订购</div><div class="tv">${fmtNum(totQty)}</div></div>
      <div><div class="tt">已发(可开)</div><div class="tv" style="color:var(--shipped)">${fmtNum(shQty)}</div></div>
      <div><div class="tt">已开票</div><div class="tv" style="color:var(--delivered)">${fmtNum(invQty)}</div></div>
      <div><div class="tt">待开票金额</div><div class="tv" style="color:${pendVal>0?'#d97706':'var(--dim)'}">${money(pendVal,cur)}</div></div>
      <div style="margin-left:auto"><div class="tt">已开票 / 已发 / 整单金额</div><div class="tv">${money(invVal,cur)} <span style="font-size:11px;color:var(--faint)">/ ${money(shVal,cur)} / ${money(totVal,cur)}</span></div></div>
    </div>
  </div>`;
}
document.getElementById('fin-search').addEventListener('input',e=>{ finQ=e.target.value.trim().toLowerCase(); renderFinList(); });
document.getElementById('view-fin').addEventListener('click',async e=>{
  const card=e.target.closest('[data-finpo]'); if(card){ finSel=+card.dataset.finpo; renderFin(); return; }
  const chip=e.target.closest('[data-finchip]'); if(chip){ finFilter=chip.dataset.finchip; renderFin(); return; }
  const p=DATA.pos[finSel]; if(!p) return;
  const grp=e.target.closest('[data-fingrp]');
  if(grp){ const date=grp.dataset.fingrp, a=grp.dataset.act;
    for(const x of poBatches(p).filter(x=>(x.b.ship||'—')===date)){ const on=(a==='inv'); if(on) invoiced[x.b.id]=true; else delete invoiced[x.b.id]; await DB.invoice(x.b.id, on); }
    toast(a==='inv'?'整批已开票':'已撤销整批'); renderFin(); return; }
  const gt=e.target.closest('[data-grptoggle]');
  if(gt){ const gid=gt.dataset.grptoggle; finCollapsed.has(gid)?finCollapsed.delete(gid):finCollapsed.add(gid); renderFinDoc(); return; }
  const bb=e.target.closest('[data-finb]');
  if(bb){ const id=+bb.dataset.finb, a=bb.dataset.act;
    if(a==='inv'){ invoiced[id]=true; toast('批次已开票'); } else { delete invoiced[id]; toast('已撤销该批次发票'); } await DB.invoice(id, a==='inv');
    renderFin(); return; }
  const poact=e.target.closest('[data-finpoact]');
  if(poact){ const a=poact.dataset.finpoact, bs=poBatches(p);
    if(a==='invall'){ const t=bs.filter(x=>!invoiced[x.b.id]); if(!t.length){toast('没有待开票批次');return;} for(const x of t){ invoiced[x.b.id]=true; await DB.invoice(x.b.id, true); } toast(`整单开票 ${t.length} 个批次`); }
    else if(a==='uninvall'){ const t=bs.filter(x=>invoiced[x.b.id]); if(!t.length){toast('该单暂无已开票批次');return;} for(const x of t){ delete invoiced[x.b.id]; await DB.invoice(x.b.id, false); } toast('已撤销整单开票'); }
    else if(a==='invsel'){ const ids=[...document.querySelectorAll('[data-finchk]:checked')].map(c=>+c.dataset.finchk); if(!ids.length){toast('请先勾选要开票的批次');return;} for(const id of ids){ invoiced[id]=true; await DB.invoice(id, true); } toast(`已开所选 ${ids.length} 个批次`); }
    renderFin(); return; }
});

// ── boot ──
DATA = FB.data;
(FB.invoicedIds||[]).forEach(id=>{ invoiced[id]=true; });
render();

}

export function FulfillmentView({ pos, invoicedIds, today }: { pos: FPo[]; invoicedIds: number[]; today: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const root = ref.current; if (!root) return
    const supabase = createClient()
    root.innerHTML = SHELL
    try { runApp(root, { today, data: { pos }, invoicedIds }, makeDB(supabase)) } catch (e) { console.error("fulfillment init", e) }
    return () => { root.innerHTML = "" }
  }, [])
  return (<><style dangerouslySetInnerHTML={{ __html: CSS }} /><div id="fb-root" ref={ref} className="logcol" /></>)
}
