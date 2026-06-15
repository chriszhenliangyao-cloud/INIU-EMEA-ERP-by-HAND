# 权限模型与开发规范（RBAC）

## 核心原则（务必牢记）

> **数据隔离归 RLS 管，UI 决策才用 isAdmin。**

任何场景下，遵循这两条铁律：

1. **后端 RLS 是唯一的数据安全保险**——前端永远不要"信任"用户身份去拉取本不该看到的数据
2. **前端的 `isAdmin` / `canAccessCountry()` 只用来决定 UI 是否显示**——比如要不要显示"主数据管理"菜单、"全部国家"按钮等

## 角色定义

| Role | 说明 | 数据可见性 |
|---|---|---|
| **admin** | HQ 全员（含中国 GTM、IT、Finance）| 所有国家、所有数据 |
| **sales** | 外籍销售（Victor、Juan、Slawek、Lukasz 等）| 仅 `sales_rep_country` 关联的国家 |

具体到当前业务：

| 销售 | 负责国家 |
|---|---|
| Victor Rosiere | 🇫🇷 FR + 🇳🇱 NL（CoolBlue 跨国管理）|
| Juan Cabrera | 🇪🇸 ES |
| Slawek Stanik | 🇵🇱 PL |
| Lukasz Lyzwa | 🇵🇱 PL（与 Slawek 共管）|

## 开发约定

### 1. 任何 Server Component / Route Handler 拿当前用户

```typescript
import { getCurrentUser } from '@/lib/auth/current-user'

export default async function MyPage() {
  const me = await getCurrentUser()  // 自动重定向未登录

  // me.userId          UUID
  // me.email           string
  // me.displayName     string
  // me.role            'admin' | 'sales'
  // me.isAdmin         boolean
  // me.countryIds      number[]
  // me.canAccessCountry(countryId) → boolean
}
```

### 2. 数据查询：不用写国家过滤

❌ **不要这样**：
```typescript
const { data } = await supabase
  .from('shipment')
  .select('*')
  .in('country_id', me.countryIds)  // ← 多此一举
```

✅ **正确**：
```typescript
const { data } = await supabase
  .from('shipment')
  .select('*')
  // RLS 已经自动过滤了，不用加 .in('country_id', ...)
```

RLS 策略 `can_access_country(country_id)` 已经在数据库层强制：
- admin → 所有数据
- sales → 只看自己 `sales_rep_country` 关联的国家

### 3. UI 决策用 isAdmin

```tsx
{/* 仅 admin 看得到的菜单/按钮 */}
{me.isAdmin && <Link href="/admin">⚙️ 主数据管理</Link>}

{/* admin 看到"全部"选项，sales 不显示 */}
<select>
  {me.isAdmin && <option value="ALL">全部国家</option>}
  {me.countryIds.map(id => <option>...</option>)}
</select>
```

### 4. 测试 RLS 隔离

每次添加新表 / 新视图后，**必须**测试：
1. 用 admin 账号登录 → 看到全部数据
2. 用 sales 账号登录 → 只看到自己国家
3. 用 SQL 模拟 sales 身份直接调 REST API → 应被拒绝越权访问

## RLS 策略一览

数据库所有业务表全部启用 RLS，关键策略：

| 表 | SELECT 规则 | 写规则 |
|---|---|---|
| `country` | 全员可读 | admin 写 |
| `sku` / `sku_alias` | 全员可读 | admin 写 |
| `ka` / `ka_alias` | 按 country 过滤（`can_access_country`）/ alias 全员可读 | 按 country / alias admin 写 |
| `sales_rep` | 全员可读（用于显示编辑者）| admin 全权 / 自己改自己（**role 不可自改**，with_check 拦截）|
| `sales_rep_country` | 自己可读自己关系 + admin 全权 | admin |
| `shipment` | 按 country 过滤 | INSERT/UPDATE 按 country，DELETE admin |
| `weekly_psi` / `weekly_psi_v2` | 按 country 过滤 | admin 写 |
| `hq_stock` | 按 country 过滤 | admin 写 |
| `forecast_run` | 全员可读（cycle 表头无国家）| admin 创建 / 状态流转 |
| `forecast_cell` | 通过 ka → country 过滤 | 限 `can_access_country` + 周期 `draft` |
| `*_audit_log` | KA 审计按 country；其余 admin 读 | 仅 trigger 写（with_check=false）|

**视图**：全部 9 个视图（`weekly_psi_long_compat`、`forecast_eu_summary`、`shipment_po_3mo_avg`、`rolling_so_by_ka_sku` 等）均设 `security_invoker=true` —— 以调用者身份跑 RLS，sales 通过视图读到的也只是自己国家的数据，无视图越权。

**权限函数**：`can_access_country` / `is_admin` / `is_super_admin` 均 `SECURITY DEFINER` + 固定 `search_path=public`；`can_access_country` 校验 `is_active` + `valid_to`（已交接国家自动失效）。

**客户端 key**：server / middleware / server actions 全部用 anon key（无 service_role），所有查询走 RLS。

## 全链路审计结论（2026-06）

**读（看）已完全锁到国家粒度**：渠道/发货/PSI/库存/预测明细的 SELECT 全部 `can_access_country`；视图 security_invoker；无 service_role。sales 只能看到自己负责国家的数据。

> 粒度是**国家级**，不是单 KA 级——负责某国的 sales 看得到该国全部 KA（无 sales↔KA 关联表）。若需同国多 sales 分管不同 KA，要加 `sales_rep_ka` 表 + 改 RLS。

**Forecast 提交即冻结**：周期离开 `draft` 后，前端 `editLocked` 让 sales 的输入框 + Save 只读（admin 仍可改）；published/archived 对所有人只读。工作流动作（submit/approve/publish/reopen/rollover/create）的 RPC 全部 `is_admin()` + 状态前置校验。

### ⚠️ 已知且已接受的风险（暂不修）

- **`upsert_forecast_cells(run_id, cells)`**：`SECURITY DEFINER` 但**未做 `can_access_country` / `is_admin` / 周期 `draft` 校验**，且 `authenticated` 可执行。理论上 sales 手搓 PostgREST 请求可**盲写**其他国家 / 非 draft 周期的预测格（仅返回计数，不泄漏读）。
  - **决定（Chris, 2026-06）**：体量小、sales 非技术人员，无现实威胁，暂不修。前端锁定已覆盖所有正常用 UI 的用户。
  - **修法**：函数内加 per-cell `can_access_country(ka.country_id)` + `status='draft'` 守卫（最小改动），或改 `SECURITY INVOKER`。对比：`bulk_upsert_weekly_psi` / `clone_forecast_run` 已有 `is_admin()` 守卫。

## 每个页面的检查清单

新增页面时按这个 checklist 走一遍：

- [ ] Server Component 用 `getCurrentUser()`
- [ ] 数据查询无 `.in('country_id', ...)` 等过滤代码
- [ ] UI 中 admin-only 元素用 `{me.isAdmin && ...}`
- [ ] 本地切换 admin / sales 各登录一次手工验证

