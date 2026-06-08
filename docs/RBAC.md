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

数据库当前 8 张表全部启用 RLS，关键策略：

| 表 | SELECT 规则 | 写规则 |
|---|---|---|
| `country` | 全员可读 | admin 写 |
| `sku` | 全员可读 | admin 写 |
| `ka` | 按 country 过滤（can_access_country）| admin 写 |
| `sales_rep` | 全员可读（用于显示编辑者）| admin 全权 / 自己改自己（除 role）|
| `sales_rep_country` | 自己可读自己关系 + admin 全权 | admin |
| `shipment` | 按 country 过滤 | 按 country + 角色 |
| `forecast_run` | 全员可读 | admin 创建 / 状态流转 |
| `forecast_cell` | 通过 ka → country 过滤 | 编辑限 draft 状态 |

## 每个页面的检查清单

新增页面时按这个 checklist 走一遍：

- [ ] Server Component 用 `getCurrentUser()`
- [ ] 数据查询无 `.in('country_id', ...)` 等过滤代码
- [ ] UI 中 admin-only 元素用 `{me.isAdmin && ...}`
- [ ] 本地切换 admin / sales 各登录一次手工验证

