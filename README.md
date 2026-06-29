# INIU EMEA ERP

欧洲市场销售运营系统 — Next.js 14 + Supabase。

支持 7 国（FR / PL / ES / NL / SE 已启动 · DE / GB 预留未启动）业务板块：发货登记 · 客户订单(PO)看板 · 滚动需求预测 · PSI 看板 · 季度 KPI 记分卡 + 季度复盘 · 渠道自助管理 · 主数据管理（SKU / Sales Rep）。

---

## 技术栈

| 层 | 选型 |
|---|---|
| 前端 | Next.js 14 App Router · TypeScript · Tailwind CSS · React Server Components |
| 后端 | Supabase (PostgreSQL 15 + Row Level Security + Auth + REST) |
| 认证 | Google SSO（限定 `@iniushop.com` 域名） |
| 部署 | Vercel（GitHub `main` 分支自动部署） |

---

## 功能与路由

| 路由 | 功能 | 状态 |
|---|---|---|
| `/auth/login` | Google SSO 登录 | ✅ |
| `/shipments` | 发货登记（SheetJS 智能解析 Excel + 列映射 + 批量回滚）| ✅ |
| `/admin/import` | Admin 上传周度 shipment 数据 | ✅ |
| `/admin/history` | 历史 import batch 列表 + 回滚 | ✅ |
| `/admin/sku` | SKU 主数据管理（admin only · drawer 编辑 · audit log）| ✅ |
| `/admin/sku/map` | SKU Product Map（类目→系列→家族→型号→颜色色块树 · 4 级 `＋` 新增入口 · 行内编辑）+ 每型号 **📅 产品生命周期甘特图**（拖拽编辑 5 阶段：规划/研发/在售/退市/停产 + 关键帧 + 价格内嵌行）| ✅ |
| `/admin/sales` | Sales Rep 主数据管理（含 super_admin 角色控制 + 国家分配 chips）| ✅ |
| `/forecast?view=summary` | 4 国 × 动态月数预测 summary（admin 默认 · 含 Total/Stock-FD/Stock-HQ 列）| ✅ |
| `/forecast?view=edit` | 销售填报 + Σ PO/Σ SO 历史参考 + Manage Channels modal（**周期一旦离开 draft，sales 自动锁定只读**）| ✅ |
| `/psi` | PSI 周度看板（SO / ST / Stock / 派生 DOS · 持久 iframe · **Export Excel 完整格式**）| ✅ |
| `/performance` | 季度 KPI 记分卡（FCST vs Achieve vs Attainment% + Score）· 季度复盘翻卡（含上季 Target 列）| ✅ |
| `/po` | 客户订单(PO)看板（按 PO Date × Qty Ordered · 未发货清单可填 notes · 表头内筛选）**暂仅 Chris 可见** | 🔒 |

> **业务口径：Shipment（发货）vs PO（订单）** —— 两者来自同一份"线下零售渠道发货记录表"的不同子表。`/shipments` = 仓库实际发货（按发货日），`/po` = 客户下的订单（按 PO Date，含金额/未发货跟踪）。**Performance 的 Achieve 用 PO（`channel_po.qty_ordered`）对标销售业绩**；`shipment` 仅作履约视角。两者按自然年/月统计会有时间差（下单 vs 发货滞后），属正常。

---

## 权限模型

```
┌─────────────────────────────────────────┐
│ super_admin (你 / chris)                 │
│ ├─ is_super_admin() = true              │
│ └─ 唯一能 change role / 提 super_admin   │
├─────────────────────────────────────────┤
│ admin (HQ)                              │
│ ├─ can_access_country() → 全部 EU       │
│ ├─ is_admin() → 写权限 bypass           │
│ └─ 不能修改 role 字段（trigger 拦截）    │
├─────────────────────────────────────────┤
│ sales (国家销售)                         │
│ └─ sales_rep_country 关联 → 仅自己国家  │
└─────────────────────────────────────────┘
```

- 数据库层 RLS 全量配置（`can_access_country()` / `is_admin()` / `is_super_admin()`），前端无须判断权限
- 销售可以管理自己国家的 KA（新增 / 改名 / 停用 / 重启 / 硬删，自助）
- Admin 可以管理 SKU 主数据（带 reference count 删除保护）
- Admin 可以管理 Sales Rep + 国家分配（valid_from/valid_to 时间区间，历史可追溯）
- Super admin 控制 role 升降级（`enforce_super_admin_for_privileged_changes` trigger）
- 所有 master data 变更写入对应 audit log 表

---

## 数据模型核心表

### 主数据 (Master Data)
| 表 | 用途 |
|---|---|
| `country` | 国家主数据（`is_active=false` 表示未启动，看板自动隐藏）|
| `sku` | SKU 主数据（含 series / family / lifecycle / 价格 / EAN / box_qty） |
| `ka` | 渠道（retailer / distributor），按 country_id 分配 |
| `sales_rep` | 销售人员（含 `is_super_admin` + `left_at` 离职追踪）|
| `sales_rep_country` | 销售 × 国家关联（带 `valid_from` / `valid_to` 历史区间）|

### 业务数据
| 表 | 用途 |
|---|---|
| `shipment` | 发货明细（按 country_id + sku_id + ka_id + source_type）· 仓库实际出货，按发货日 |
| `channel_po` | 客户订单明细（po_number + po_date + sku_id + ka_id + country_id + qty_ordered + ship_date + **delivery_date** + notes）· **Performance Achieve 的数据源**，来自"线下零售渠道发货记录表"的 PO Details 子表 · **已发判定 = ship_date 或 delivery_date 任一有值**（物流偶尔漏填 ship_date，用送达日兜底；delivery_date=PO Details 第 28 列 Delivery Date）|
| `channel_quarterly_review` | 季度复盘（正面=本季进展，背面=下季 Action Plan 的 target/next_move/supports）· 渠道列表复盘自有，不动 KA map |
| `product_lifecycle` | 产品生命周期（按**型号 model_code** 一行）· UI 为 **5 阶段**：规划/研发/**在售**(合并备货+上市+稳定在售)/退市/停产 + initial_price · DB 仍保留 7 列对（pre/launch 列废弃留空，在售复用 active 列）· 驱动 SKU Map 甘特图 · admin only |
| `product_keyframe` | 生命周期关键帧（中标 win / 价格调整 price+price值 / 研发延期 delay）· model_code + phase + kf_date + title/note · admin only |
| `import_batch` | Excel 批次记录（支持整批回滚）|
| `forecast_run` | 预测周期（`month_count` 字段：新 cycle=3 / 历史=4）|
| `forecast_cell` | 每个 SKU × KA × 月的预测填报 |
| `weekly_psi_v2` | PSI 宽表（每行 = country × ka × sku × week, 列 = si/so/st/stock）|
| `hq_stock` | INIU 总部仓库库存（admin only 写，待数据导入）|

### Audit logs（trigger 自动写入，append-only）
| 表 | 触发自 |
|---|---|
| `ka_audit_log` | `ka` 表变更 |
| `sku_audit_log` | `sku` 表变更 |
| `sales_rep_audit_log` | `sales_rep` 表变更（含 role_change / left / rejoined）|
| `sales_rep_country_audit_log` | `sales_rep_country` 关联变更 |

### Views (派生数据)
| View | 派生自 | 用途 |
|---|---|---|
| `weekly_psi_long_compat` | `weekly_psi_v2` | 反 pivot 回 long + 4 周移动均派生 DOS |
| `shipment_po_3mo_avg` | `shipment (channel)` | 出货量过去 3 完整月均（按 country × sku） |
| `rolling_so_by_ka_sku` | `weekly_psi_v2 + ka.ka_type` | SO 过去 3 月均，retailer→so_qty / distributor→st_qty |
| `forecast_eu_summary` | `forecast_cell + ka` | KA 聚合到国家级，admin summary 视图直读 |
| `forecast_run_summary` | `forecast_run + cells + sales_rep` | run 列表 + 填写进度 + 创建人 |

### Helper RPC
| RPC | 用途 |
|---|---|
| `create_forecast_run(region, period_start, month_count=3)` | 新 cycle，默认 3 月窗口 |
| `clone_forecast_run(source, new_period_start)` | 克隆历史 cycle 数据到新周期（沿用 month_count） |
| `assign_rep_country(rep_id, country_id, is_primary)` | 给销售加国家（自动 valid_from=today） |
| `unassign_rep_country(rep_id, country_id)` | 取消国家分配（valid_to=today，不删，保留历史） |
| `mark_rep_left(rep_id, leave_date)` | 原子离职：is_active=false + left_at + 所有国家关联 valid_to |
| `upsert_forecast_cells(run_id, cells)` | 批量保存填报，跳过未变更行 |
| `bulk_upsert_shipments(rows)` / `rollback_import_batch(batch_id)` | Shipment 导入/回滚 |

**PSI 双表架构**：
- 数据写入 → `weekly_psi_v2`（宽表，每行 4 个 metric 列）
- 看板读取 → `weekly_psi_long_compat`（view，含派生 DOS）
- DOS 公式：`stock_qty / avg4(COALESCE(so_qty, st_qty)) * 7`

**Forecast PO/SO 参考体系**：
- PO 列（紫色）= 我们卖给 KA 的出货量（shipment.qty）
- SO 列（绿色）= KA 卖给下游/消费者的数量（PSI 数据按 KA 类型自动选 SO 或 ST）
- 都是过去 3 完整月（不含当前月）平均

---

## 本地启动

```bash
# 1) 安装依赖
npm install

# 2) 配置环境变量
cp .env.example .env.local
# 编辑 .env.local 填入 NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY

# 3) 启动 dev
npm run dev
# → http://localhost:3000
```

构建检查：

```bash
npx tsc --noEmit    # TypeScript 类型检查
npm run build       # 完整构建
```

---

## 项目结构

```
src/
├── app/
│   ├── auth/                          # 登录 + OAuth 回调
│   ├── api/psi/load-all/              # PSI 看板数据 API（pivot long→wide）
│   └── (dashboard)/
│       ├── layout.tsx                 # 持久 iframe 容器 + commit-SHA cache buster
│       ├── dashboard-shell.tsx        # 客户端壳层（侧栏 + 路由显隐）
│       ├── shipments/                 # 发货登记
│       ├── admin/
│       │   ├── import/                # Excel 导入（SheetJS + 列映射）
│       │   ├── history/               # 批次回滚
│       │   ├── sku/                   # SKU 主数据 (admin only)
│       │   │   ├── page.tsx
│       │   │   ├── sku-management-view.tsx  # 表格 + drawer 编辑
│       │   │   └── _actions/manage-sku.ts
│       │   └── sales/                 # Sales Rep 主数据 (admin only)
│       │       ├── page.tsx
│       │       ├── sales-rep-management-view.tsx  # 表格 + 国家 chips
│       │       └── _actions/manage-sales-rep.ts
│       ├── forecast/
│       │   ├── page.tsx               # 路由分发 summary/edit + 数据查询
│       │   ├── summary-view.tsx       # Admin: 表格 + SUB-TOTAL + TOTAL block
│       │   ├── edit-view.tsx          # Sales: 填报 + Σ PO/Σ SO + TOTAL block
│       │   ├── run-controls.tsx       # 周期管理 (+ New cycle / Submit / Publish)
│       │   ├── manage-channels-modal.tsx  # KA self-service modal
│       │   └── _actions/manage-ka.ts
│       └── psi/page.tsx               # 占位（实际看板在 layout 持久 iframe）
├── lib/
│   ├── supabase/{client,server,middleware}.ts
│   ├── auth/current-user.ts           # isSuperAdmin / isAdmin / canAccessCountry
│   └── utils.ts
├── components/
│   ├── ui/                            # 基础 UI 组件
│   └── logout-button.tsx
└── middleware.ts                      # Auth session refresh

public/
└── psi-dashboard.html                 # PSI 看板（2400 行单文件 vanilla JS + Chart.js）
                                       # 从 Apps Script 迁移，fetch /api/psi/load-all
```

---

## Supabase 项目

- ID: `nnoyrfbnyxfnooapbqni`
- Region: EU Central
- URL: <https://nnoyrfbnyxfnooapbqni.supabase.co>
- PostgREST `max-rows`: **100000**（已从默认 1000 提升以兼容 PSI 全量拉取）

---

## 关键架构决策

1. **PSI 看板用 iframe 嵌入**: 原 Google Apps Script 看板 2400 行 vanilla JS + Chart.js，迁移成本高。改用 iframe 嵌入 + 替换 `google.script.run` 为 `fetch('/api/psi/load-all')`。后续可逐步原生化。

2. **iframe 持久挂载**: `DashboardShell` 通过 `display:none/block` 切换可见性而非卸载 DOM，保留图表实例 + 已拉数据。新部署时通过 `?v={commit-sha}` + React `key` 强制 remount 取新版（不用关 tab）。

3. **PSI 宽表 + 兼容 view**: 原 long 格式 4255 行（含已存 DOS），新宽表 2014 行 + view 派生 DOS。5 层交叉验证（MD5 字节级一致）。存储减 53%，DOS 派生消除"漏填"。

4. **Forecast 动态月数 + 统一 3 个月滚动**: `forecast_run.month_count` 控制每个 cycle 月数，前端 KPI / 表格列数 / 标签全部动态。**新建周期固定 3 个月滚动**——前端 `create_forecast_run` 显式传 `p_month_count: 3`，且已删除旧的 4 个月重载 `create_forecast_run(text, date)`（消除 PostgREST 重载歧义）。历史 4 月 cycle 的数据仍按各自 `month_count` 兼容显示。

5. **PO/SO 参考用 view 派生**: `shipment_po_3mo_avg` (按 country × sku) + `rolling_so_by_ka_sku`（按 KA 类型自动选 SO 或 ST）。避免前端复杂聚合，CTE + window function 在 DB 层算完。

6. **Master data self-service + audit**: KA 销售自助、SKU/Sales Rep admin 自助。所有变更走 audit log（trigger 自动写入），删除保护防误删（带历史数据时 raise exception）。

7. **Super admin 一层防护**: `is_super_admin()` 控制 role 变更权限。普通 admin 不能互相提升/降级，super_admin（你）单点控制。trigger 在 DB 层强制（`enforce_super_admin_for_privileged_changes`）。

8. **国家启动状态**: `country.is_active` 字段，未启动国家（DE/SE/GB）在所有看板自动隐藏。Admin 仍能通过 `can_access_country()` bypass 看历史散单。

9. **HQ stock schema 先建好**: 总仓库存 `hq_stock` 表 + RLS 就绪，前端正确显示 `-`（数据未导入），等 admin 导数据后自动生效 — 不需要再改前端。

10. **Forecast 提交即冻结**: 周期一旦离开 `draft`（submitted/approved），**sales 的格子 + Save 在前端自动锁定只读**（`editLocked` 判据，admin 仍可改）；published/archived 则对所有人只读。后端工作流 RPC 全部 `is_admin()` + 状态前置校验。⚠️ 已知例外见 `docs/RBAC.md`：`upsert_forecast_cells` 未在 DB 层做 status/country 校验（小体量已接受风险，前端锁定已覆盖正常用户）。

11. **PSI Export = 完整格式 Excel(.xls)**: 不再是"有什么导什么"。每个 `国家 × 渠道 × 产品` 补齐 SO/SI/Stock/DOS 四行 + 全部周列（缺失留空），隔产品交替高亮，表头深蓝。用 HTML 表格存成 `.xls`，Excel/Sheets 直接打开并保留颜色。retailer 用 SO、distributor 用 ST，全量导出不受筛选影响。

12. **导航加载反馈**: 侧栏改用 `NavLink`（`useTransition`）——点击后保持旧页面、被点菜单项转圈直到新页就绪。配合 `getCurrentUser` 的 React `cache()` 去重 + forecast summary 查询并行化降低实际延迟。

13. **个人称号 flair**: `src/lib/user-flair.ts` 按邮箱集中配置称号。当前 Jiwen Wang = 👑 Majesty（侧栏身份标签 + 销售管理表徽章 + DB `display_name` 带皇冠，名字出现处皆带冠）。

14. **Forecast 编辑页 FD 分组表头**: distributor（有在售子 retailer、且本周期无直接数据）渲染成跨列「大表头」，其子 retailer 为输入列，FD 本身不输入（如 FR 的 Bigben）。逻辑见 `edit-view.tsx` 的 `columnGroups` memo。
    - `FD_GROUPING_DISABLED_COUNTRIES = {ES, PL}` 整国保持扁平表头：ES 数据结构特殊；**PL 因 Komsa 有真实 FD 直发数据，硬分组会降低准确性，故保持原扁平表头**。
    - 完整性兜底：父节点是 `group` 类型的 KA（如 iDream 挂在 Eurotel 下）也保证出现在表里，绝不丢列。
    - 输入列 = `kas`（叶子）；参考列 `Σ SO / Stock-FD` 跨 `allCountryKas` 求和（含被分组的 FD 自身），二者不可混用。

> 预测数据补录：PL 上一周期未填，已用其历史预测（按月对齐）直接写入当前 draft 作为起点；`source`/`updated_by` 留 NULL 表示后端补录。FR/ES 历史数据暂不导入。

---

## 下一步规划

- HQ stock 数据导入（admin 提供数据后从 CSV 或 admin UI 录入）
- PSI 阶段 2：标准 CSV 导入模板 + admin 周度数据清洗 UI
- PSI 阶段 3：LLM 辅助 retailer 原始格式 → 标准模板转换
- Country 主数据面板（目前直接改 DB 即可，低优先级）
- Forecast hover peek 替代品：family/series 级历史聚合作为新品 SI/SO 兜底

详见各 `forecast/`、`psi/`、`admin/` 目录下的内联注释。
