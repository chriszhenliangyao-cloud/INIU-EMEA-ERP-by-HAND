# INIU EMEA ERP

欧洲市场销售运营系统 — Next.js 14 + Supabase。

支持 7 国（FR / PL / ES / NL · DE/SE/GB 预留未启动）4 大业务板块：发货登记 · 需求预测 · PSI 看板 · 渠道自助管理。

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
| `/forecast?view=summary` | 4 国 × 4 月预测 summary（admin 默认）| ✅ |
| `/forecast?view=edit` | 销售填报 + ⚙️ Manage Channels（KA self-service）| ✅ |
| `/psi` | PSI 周度看板（SO / ST / Stock / 派生 DOS · 持久 iframe）| ✅ |

---

## 权限模型

```
┌─────────────────────────────────────────┐
│ admin (HQ)                              │
│ ├─ can_access_country() → 全部 EU       │
│ └─ is_admin() → 写权限 bypass           │
├─────────────────────────────────────────┤
│ sales (国家销售)                         │
│ └─ sales_rep_country 关联 → 仅自己国家  │
└─────────────────────────────────────────┘
```

- 数据库层 RLS 全量配置（`can_access_country()` / `is_admin()`），前端无须判断权限
- 销售可以管理自己国家的 KA（新增 / 改名 / 停用 / 重启 / 硬删，自助）
- 所有 KA 变更写入 `ka_audit_log` 表

---

## 数据模型核心表

| 表 | 用途 |
|---|---|
| `country` | 国家主数据（`is_active=false` 表示未启动，看板自动隐藏）|
| `sku` | SKU 主数据（含 series / family / lifecycle） |
| `ka` | 渠道（retailer / distributor），按 country_id 分配 |
| `ka_audit_log` | KA 变更审计日志（trigger 自动写）|
| `sales_rep` + `sales_rep_country` | 销售人员 + 国家关联 |
| `shipment` | 发货明细（按 country_id + sku_id + ka_id）|
| `import_batch` | Excel 批次记录（支持整批回滚）|
| `forecast_run` + `forecast_cell` | 4 个月滚动预测（按 run × sku × ka × month） |
| `forecast_eu_summary` | Summary view（KA 聚合到国家级别） |
| `weekly_psi_v2` | PSI 宽表（每行 = country × ka × sku × week，列 = si/so/st/stock）|
| `weekly_psi_long_compat` | 兼容 view（反 pivot 回 long + 4 周移动平均 DOS 派生）|

**PSI 双表架构**：
- 数据写入 → `weekly_psi_v2`（宽表，存储紧凑）
- 看板读取 → `weekly_psi_long_compat`（view，包含派生 DOS）
- DOS 公式：`stock_qty / avg4(COALESCE(so_qty, st_qty)) * 7`

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
npm run build       # 完整构建（含 ESLint）
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
│       │   └── history/               # 批次回滚
│       ├── forecast/
│       │   ├── page.tsx               # 路由分发 summary/edit
│       │   ├── summary-view.tsx       # Admin: 4 国 KPI + 主表（sticky thead）
│       │   ├── edit-view.tsx          # Sales: 填报 + Manage Channels 入口
│       │   ├── run-controls.tsx       # 周期管理（new cycle / submit / publish）
│       │   ├── manage-channels-modal.tsx  # KA self-service modal
│       │   └── _actions/manage-ka.ts  # KA CRUD server actions
│       └── psi/page.tsx               # 占位（实际看板在 layout 持久 iframe）
├── lib/
│   ├── supabase/{client,server,middleware}.ts
│   ├── auth/current-user.ts
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

1. **PSI 看板为何用 iframe**: 原 Google Apps Script 看板有 2400 行 vanilla JS + Chart.js，迁移成本高。改用 iframe 嵌入 + 替换 `google.script.run` 为 `fetch('/api/psi/load-all')` 即可上线。后续可逐步原生化。

2. **iframe 持久挂载**: `DashboardShell` 通过 `display:none/block` 切换可见性而非卸载 DOM，保留图表实例 + 已拉数据。新部署时通过 `?v={commit-sha}` + React `key` 强制 remount 取新版。

3. **PSI 宽表 + 兼容 view**: 原 long 格式 4255 行（含已存 DOS），新宽表 2014 行 + view 派生 DOS。5 层交叉验证（MD5 字节级一致）。优势：存储减 53%，DOS 派生消除"漏填"。

4. **KA self-service**: 销售自助加/改/停用本国渠道。`BEFORE DELETE` trigger 拦截带历史数据的硬删（防止破坏 forecast/shipment/PSI 引用完整性）。`ka_audit_log` 表全量审计。

5. **国家启动状态**: `country.is_active` 字段，未启动国家（DE/SE/GB）在所有看板自动隐藏。Admin 仍能通过 `can_access_country()` bypass 看历史散单。

---

## 下一步规划

- PSI 阶段 2：标准 CSV 导入模板 + admin 周度数据清洗 UI
- PSI 阶段 3：LLM 辅助 retailer 原始格式 → 标准模板转换
- Master Data 管理面板（侧栏现在显示 "coming soon"）

详见各 `forecast/`、`psi/` 目录下的内联注释。
