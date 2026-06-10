# KA 数据清洗对账清单 v2

> 2026-06-10 · 数据源：production DB 实查 + 《EMEA KA Progress 2026-05-26》报告交叉比对
> ✅ = 报告已证实，待 Chris 终审 · ❓ = 仍需 Chris 决策

---

## A. 合并组（重复 KA，repoint 数据后停用/删除废弃方）

### A1 ✅ ES：Tech Linku ← LINKU
| | id 20 Tech Linku | id 36 LINKU |
|---|---|---|
| 数据 | 22 行发货 / 5,278 件 | 802 行 PSI（si 5,501 / st 1,542） |
| 现状 | null / active | distributor / inactive |

报告证实：Tech Linku 是 ES 现役小型分销商（2025-08 签约，覆盖采购集团/PCC/TPH）。发货 5,278 vs PSI si 5,501 吻合。
**建议**：保留 id 20 "Tech Linku"，PSI 802 行 repoint → 20；最终 distributor + active；id 36 停用。

### A2 ✅ ES：ICP ← Others (ICP) + ICP Orange
| | id 21 Others (ICP) | id 37 ICP Orange |
|---|---|---|
| 数据 | 3 行发货 / 7,600 件 | 1 行 PSI（si 2,000） |
| 现状 | null / active | distributor / active |

报告证实：ICP = Orange 西班牙子网指定经销商（PPT01 等走 ICP 入库 + dropshipping，合同补签中）。
**建议**：保留 id 37，改名 "ICP"，发货 3 行 repoint → 37；distributor + active；id 21 停用。
（id 17 ORANGE 保留为 retailer：SO/动销记在 Orange 渠道，PO 走 ICP——两条都该存在）

### A3 ✅ PL：x-kom ← XKOM
| | id 10 XKOM | id 33 x-kom |
|---|---|---|
| 数据 | 11 行发货 / 1,798 件（2025-01） | 105 行 PSI（2026-01~04） |
| 现状 | null / active | retailer / inactive |

报告证实：X-kom 在售（线上全产品线 listing，26 年非重点但未退出）。
**建议**：保留一个（建议 id 33 名字规范 "x-kom"），发货 repoint；retailer + active。❓保留哪个 id？

### A4 ✅ PL：Komputronik ← KTR
| | id 13 KTR | id 32 Komputronik |
|---|---|---|
| 数据 | 0 | 93 行 PSI（到 2026-05-25，最新） |
| 现状 | null / active | retailer / inactive |

报告证实：KTR.COM 就是 Komputronik 官网 = 同一家。在售（线上全线 + 31 家门店 Leopard 系列）。
**建议**：保留 id 32 "Komputronik"，retailer + active；id 13 零数据，硬删。

### A5 ❓ PL：iDream ↔ Eurotel
| | id 12 iDream | id 34 Eurotel |
|---|---|---|
| 数据 | 0 | 120 行 PSI（si 1,092 / so 689，到 2026-05-04） |
| 现状 | null / active | retailer / inactive |

报告：iDream 隶属 Eurotel 集团（集团还运营 MiMarkt、T-Mobile/Play 加盟门店）。iDream 25 年营收 1.7 万美金，合作顺畅。
**❓决策**：Eurotel 名下的 PSI 是不是就是 iDream 门店的数据？是 → 合并（保留哪个名字？）；否（集团其他业务）→ 两条都留，分别定型。

---

## B. 不是重复，但要修正（报告证实）

| id | 名称 | 修正 | 依据 |
|---|---|---|---|
| 28 | Bigben (FR) | **is_active → true** | FR 现役唯一 FD，26 年战略合作深化中，4 月仍在发货 |
| 2 | Btel (FR) | = **BYT 布依格电信**，ka_type → retailer | 不是 Bigben 重复！部分 independent 门店已开卖。❓建议改名 "BYT" 避免再混淆 |
| 7 | SFR (FR) | **is_active → true**？ | 报告：动销平稳、26 年营收 €89k、P75 新单已获取 ❓ |
| 35 | Euro (PL) | **is_active → true** + retailer ✓ | 25-10 线上开售，W23 投标会议已约 |
| 5 | Gandalf | ka_type → distributor；**国家错挂 FR**，实为北欧（瑞典，Elko 集团） | ❓国家怎么处理：a) 启用 SE 挂过去 b) 暂留 FR 后续再迁 |

---

## C. 纯补 ka_type（报告佐证，无重复）

| id | 名称 | 国家 | 定 | 依据 |
|---|---|---|---|---|
| 16 | CARREFOUR | ES | retailer | 报告：ES 商超，暂不推进阶段 |
| 19 | ECI | ES | retailer | El Corte Inglés，26 年必胜渠道 |
| 14 | MMK | ES | retailer | MediaMarkt ES，26 年必胜渠道 |
| 15 | Worten PT | ES | retailer | 借 ES 子网切葡萄牙 |
| 18 | VDF | ES | retailer | Vodafone Spain，6/9 那周线下会议 |
| 8 | LECLERC | FR | retailer | 25Q4 区域入围已开卖 |
| 9 | Others | FR | retailer | 聚合桶（Monoprix/BV/C4Y/Google 绑促等小渠道）❓确认 |
| 3 | CoolBlue | NL | retailer | 已开卖（暂只德国 4 店） |

---

## D. 数据异味（不阻塞，记录在案）

1. esprinet 24 行发货全是 2026-02-10 同一天 —— 疑为一次性导入，确认日期真实性
2. 发货数据整体停在 4 月中（Bigben/Komsa 2026-04-18），5 月发货未导
3. MEX 发货 12,073 vs PSI si 仅 794 —— PSI 从 2026-01 才起，历史断层
4. ES 多个 active retailer 零数据（CARREFOUR/ECI/MMK/ORANGE/VDF/Worten PT）—— 与报告吻合：多数还在投标/意向期，属正常占位
5. 报告里有、DB 里没有的 KA（待后续按需补录）：FR: Fnac/Darty 应并为集团? Auchan、Monoprix、Electro depot、LDLC…；PL: T-Mobile、Play、AB、Ispot、MMK PL；ES: TPH、PCC、Telefonica；其他欧洲/中东: Game-Frasers、West tech、Capi、Jumbo 等
6. 5 个 view 缺 `security_invoker=true`（UNRESTRICTED）：forecast_run_summary / rolling_si_so_avg / rolling_so_by_ka_sku / shipment_po_3mo_avg / weekly_psi_long_compat —— 本次 migration 顺手修
7. `rolling_si_so_avg` 疑为 SI 时代遗留 view，确认前端无引用后 drop
8. `weekly_psi`（v1 旧表，4,255 行）—— 确认无人读取后归档，不参与 repoint

---

## ✅ 执行记录（2026-06-10 全部完成）

**Migration 1 `ka_cleanup_merge_types_active`**：
- 合并 ×4：LINKU→Tech Linku(20) / Others (ICP)→ICP(37) / XKOM→x-kom(33) / Eurotel PSI→iDream(12)
- Eurotel(34) 转 `ka_type='group'` 集团节点（Komsa→Eurotel→iDream，T-Mobile 待建）
- 改名：Btel→BYT、ICP Orange→ICP、esprinet→Esprinet、komsa→Komsa
- active 修正：Bigben/SFR/Euro/Komputronik → true；4 个废弃分身 → false（带【已合并】notes）
- 补 ka_type ×8 + Others(9) 写兜底桶 notes
- Gandalf 迁 SE（国家启用 + 24 行发货 country 同步 + Victor 加 SE 权限）
- 5 个 view 加 `security_invoker=true`（修 UNRESTRICTED 漏洞）
- **交叉验证通过**：全局 ship 330 行/148,488 件、PSI 2,014 行、si/so/st/stock 四指标总和与清洗前逐项一致，零丢失

**Migration 2 `ka_hierarchy_parent_ka_id`**：
- `ka.parent_ka_id` 外键 + `ka_type` check (distributor/retailer/group) + 索引
- `validate_ka_parent` trigger：同国家 / parent 须 FD|group / 防循环 / 最深 3 层
- 层级回填完成（递归查询验证：FR 1+7、PL 1→1→1+4、ES 3 FD、NL/SE 直供）
- 旧字段 `parent_distributor` / `downstream` / `tier` 标 DEPRECATED **暂未 drop**

**前端（待 push 部署）**：
- 新增 `/admin/ka` — KA Channel Map（admin only，侧栏入口 🗺️）：国家→FD→group→retailer 箭头树、类型徽章、active 状态、数据量、notes tooltip、行内编辑
- forecast/manage-channels/psi-api 全部迁移到 `parent_ka_id`（parent 改下拉选择）
- forecast 表格排除 group 节点（Eurotel 不出现在填报行）
- `npx tsc --noEmit` 0 错误

## ⏭️ 待办（部署后）

1. **Chris push + Vercel 部署完成后**，执行 Migration 3：drop `parent_distributor` / `downstream` / `tier` 三列 + drop `rolling_si_so_avg` 旧 view（已确认前端零引用）。**部署前不能删**——线上旧代码还在 select 这些列
2. T-Mobile PL 合作启动时：在 /admin/ka 新建 KA，parent 选 Eurotel
3. TPH / PCC / Buying Group（ES）按需建 KA，parent 选 Tech Linku
4. 5 月发货数据补导 + esprinet 发货日期核实（D 节异味清单）
