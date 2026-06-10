# 系统全方位审计报告 — 2026-06-10

> 范围：Supabase security advisors + RLS 全覆盖盘点 + SECURITY DEFINER 函数审查 + 数据一致性体检 + auth 链路 + 前端暴露面
> 结论：RLS 主防线完整（17/17 表全开、policy 齐全、国家隔离实测通过），但发现 1 个数据正确性问题 + 1 个真实越权漏洞 + 若干加固项

---

## 🔴 P0 — 必须修

### 1. PSI 跨年周双重记账（数据正确性）
- `weekly_psi_v2` 里 2025-12-29 这一周存在 **23 行假标签数据**：同一批数被记成 "2025W53"（**2025 年根本没有第 53 周**）和 "2026W01" 各一次
- 唯一索引建在 `(country, ka, sku, iso_year, iso_week)` 上——标签本身错了，索引挡不住
- 影响：Tech Linku（原 LINKU 导入）该周所有指标被双计；周趋势图多出一个幽灵周 2025W53；DOS 的 4 周移动均在跨年处失真
- 其中 **3 行孪生值不完全一致**（sku 9/16: w53 多记 st=1；sku 45: stock 39 vs 37），需 Chris 裁决保留哪边（建议保留标签正确的 2026W01 行）
- **修复**：删 23 行假 W53 → 给 `(country_id, ka_id, sku_id, week_start)` 加唯一索引 → `iso_year/iso_week/week_label` 改为从 `week_start` 自动派生（generated column），从根上杜绝标签错

### 2. `get_historical_reference` 越权（安全）
- SECURITY DEFINER + **内部没有任何权限校验** + anon/authenticated 都能通过 PostgREST RPC 调用
- = **未登录的人**也能按任意 country_id 拉历史 PO/SO 聚合数据，完全绕过国家隔离
- 前端代码当前没有引用它（可能是早期遗留），但端点是活的
- **修复**：函数内加 `can_access_country(p_country_id)` 校验 + revoke anon execute

## 🟠 P1 — 应该修（加固）

### 3. 全部 SECURITY DEFINER RPC 对 anon 开放 execute
约 20 个 RPC（create/clone/submit/approve/publish_forecast_run、bulk_upsert_weekly_psi、mark_rep_left、assign_rep_country…）anon 都能调。逐一审查过：**内部都有 is_admin 校验**（除上面的 #2），实际拿不到数据，但属于多余暴露面。**修复**：批量 revoke anon。

### 4. anon 对全部表有默认 full grants
Supabase 默认行为，RLS 兜底（实测 anon 0 行），但 INSERT/UPDATE/DELETE/TRUNCATE 授权留着没意义。**修复**：revoke anon 的写权限（保守起见 SELECT 留给 RLS 管）。

### 5. 9 个函数 search_path mutable（advisor WARN）
`handle_new_user / log_ka_change 系 / guard_ka_data_target / resolve_ka_id / validate_ka_parent / prevent_*_delete / set_updated_at / set_shipment_effective_date` —— SECURITY DEFINER + 可变 search_path 是教科书式提权面。**修复**：统一 `set search_path = public`。

### 6. Auth 配置（需在 Supabase Dashboard 手动改，SQL 改不了）
- **Leaked password protection 关闭**（advisor WARN）→ Authentication → 开启 HaveIBeenPwned 检查
- **注册链路**：`handle_new_user` 按 email 抢绑 sales_rep（`ON CONFLICT (email) DO UPDATE user_id`）。务必确认 **email confirmation 已开启**，否则知道销售邮箱的人可以抢注并接管该 rep 的国家权限。更稳的做法：关闭公开注册，改 Dashboard 邀请制

## 🟡 P2 — 留意（不阻塞）

7. **PSI 负数 si 20 行**（Eurotel→iDream、LINKU 数据里 -80/-34/-82…）——确认是退货/冲销口径还是导入错误；如果是合法冲销，给导入 SOP 加注释
8. **4 个销售未注册**（user_id 全空）——上线前让他们用预留 email 注册，否则登录后看到空系统
9. **`weekly_psi` v1 旧表（4,255 行）**——RLS 已开、无人读取，建议改名 `weekly_psi_v1_archive` 防误用
10. **59 个 active SKU 缺 EAN**——master data 补全
11. **发货数据停在 2026-04-18**（Bigben/Komsa）——5 月数据待导入
12. **EU-FCST-2026-07 仍 0 填报**——流程跟进

## ✅ 验证过没有问题的

- 17/17 表 RLS 全开、policy 完整；国家隔离端到端实测通过（模拟销售只见本国数据）
- shipment / weekly_psi_v2 的 `country_id` 与 ka 的国家 **0 不一致**（合并 repoint 没留脏数据）
- 无 KA 的 46 行发货全部是 `internal_replenish`（合理，前端有排除开关）
- SE region='EU' ✓（forecast 页按 region 过滤，SE 能正常出现）
- view security_invoker 全部已修；audit trigger 列无关、删列后正常
- ka 层级防循环 trigger、导入守护 trigger、ka_alias 解析链实测全通过

---

## ✅ 修复执行记录（2026-06-10，Chris 裁决：保留 2026W01）

**Migration A `audit_fix_a_psi_year_boundary_dedup`**：
- 删 23 行假 2025W53 → 剩 1,991 行，零重复、零标签错（验证通过）
- `(country, ka, sku, week_start)` 唯一索引防复发
- 新 trigger `normalize_psi_iso_fields`：iso_year/iso_week/week_label 一律由 week_start 自动派生，导入给错也会被纠正（根治）

**Migration B `audit_fix_b_security_hardening` + `audit_fix_b2_revoke_public_execute`**：
- `get_historical_reference` 加 `can_access_country` 校验（实测无权限调用被拒 ✅）
- `handle_new_user` 加 @iniushop.com 域白名单（OAuth 的 hd 参数只是 UI 提示，这里才是强制；非公司域注册直接失败）
- 9 个函数 search_path 固定为 public
- 函数执行权从 PUBLIC 全量收回（注意：单 revoke anon 无效，anon 经 PUBLIC 继承）→ 显式授 authenticated/service_role → anon 仅保留 RLS 依赖的 is_admin/can_access_country（实测 anon 可执行函数恰好 2 个 ✅）
- anon 表写权限全收 + default privileges 同步收紧
- 冒烟：无权限登录态查 shipment/ka 得空集而非报错 ✅

**审计修正**：登录是 Google OAuth → 邮箱真实性由 Google 担保，原 #6 的"email confirmation 抢注"担忧不成立，已被域白名单取代。

**新发现（待办）**：`bulk_upsert_weekly_psi` 旧 RPC 写的是 **v1 旧表**且按精确名匹配 KA（不走 resolve_ka_id）——**今后导入禁用此 RPC**，直接写 weekly_psi_v2（守护 trigger + 唯一索引 + iso 归一已兜底）。后续可重写或 drop。

## ⏳ 剩余手动项（Supabase Dashboard，我没权限）

1. Authentication → 开启 Leaked password protection（虽然现在只有 OAuth，开着无害）
2. （可选）若想彻底关掉陌生 Google 账号的注册尝试：Authentication → Providers 限制，但域白名单 trigger 已在 DB 层兜底
