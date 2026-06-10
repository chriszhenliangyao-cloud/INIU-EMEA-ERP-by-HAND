# SKU 数据清洗对账清单 v1

> 2026-06-10 · 数据源：production DB 实查（59 个 SKU，全部 active，code/name 零精确重复）
> 对照 KA 清洗的经验：SKU 的问题不是"重复"，而是**粒度分裂 + 口径混乱**

---

## A. 🔴 核心结构问题：基础型号 与 颜色变体 两层并存

同一个型号同时存在 **base code**（型号级）和 **color variants**（颜色级）两套 SKU 行，数据随机挂在其中一层——这是未来对账永远对不上的根源（同 KA 清洗前 Eurotel/iDream 的结构问题）：

| 型号 | base 行 | 颜色变体行 | 数据挂在哪 | 矛盾 |
|---|---|---|---|---|
| MagPro Slim 10K Qi2.2 | **PM61** (id 51, active, 0 数据) | PM61-B/BU/O/W (npi) | **变体**（14 ship + 37 psi） | base active 但变体 npi，且 base 是空壳 |
| MagPro Neo 5K | **PX41** (id 53, active, 0 数据) | PX41-B/W (npi, 0 数据) | 都没有 | 同上 |
| MagPro 3-in-1 | **WM311** (id 35, 0 数据) | WM311-B (70 psi!) / WM311-W | **变体** | base 与变体 **category 还不一致**（见 B） |
| MagPro Slim 5K Qi2.2 | **PM51** (id 50, 0 数据) | 无变体行 | — | 报告说渠道选了橙/蓝——变体还没建 |
| MagPro Neo 10K | **PX51** (id 32, npi) | 无变体行 | **base**（3 ship + 1 psi） | 与 PM61 的挂法相反！ |
| MagPro Slim 5K/10K (Qi2) | 无 base 行 | P75-P1-x ×6 / P76-P1-x ×3 | 变体 | ✅ 这才是干净形态 |

**❓核心决策（定一条规则，全表执行）**：
- 提议：**有颜色变体的型号，交易数据一律挂变体行；base 行不允许存在**（空壳删除/停用）。型号级汇总不靠 base 行，靠新增 `model_code` 字段（P75 / PM61 / WM311…）聚合——这正是渠道报告和销售口头用的"业务短码"
- 这样 PSI 源文件不管报 "PM61 橙色" 还是 "PM61"，都能落到确定的行（后者经 alias 落到 model 默认色或报错人工拆分）

## B. 🟠 category / series / family 口径混乱

| 问题 | 明细 |
|---|---|
| 同型号跨 category | WM311 在 `Wireless charger`，它的变体 WM311-B/W 在 `Charger` |
| 同类产品跨 category | 无线充家族：WM211/WM311/TAL101 在 `Wireless charger`，WM301/WM311-B/WM321 在 `Charger` |
| 桌面充错挂 | TAL101 "Charging Station 130W" 挂在 `Wireless charger`（family 倒是对的 Desktop Charger）；TAL11 挂 `Charger` |
| series 缺失 | Bundle 1 / Bundle 2 无 series/family |

**❓决策**：category 收敛成什么集合？建议 5 类：`Power bank / Wall charger / Wireless charger / Desktop charger / Cable`（Bundle 归 Accessory 或拆掉，见 C）

## C-0. 🔍 命名统一全局审计（2026-06-10，Chris 要求）

**扫描范围**：sku 表 59 行 × code/name 全字段、shipment/weekly_psi 自由文本字段、前端 src/ 全部 ts/tsx、psi-dashboard.html 2,400 行。

**好消息（统一的代价很低）**：shipment / weekly_psi_v2 / forecast_cell 全部用 `sku_id` 外键，**不存名字副本**；前端和 PSI 看板的品名 100% 从 `sku.name` 实时渲染，零硬编码。→ **只要改 sku 表一处，全系统瞬间统一**。"magpro slim 5k-O / -orange" 这类写法只存在于**外部输入**（渠道 Excel/报告），归 alias 映射管，不需要也不可能"改"它们。

**凌乱清单（DB 内需统一的全部 4 类）**：

### ① Code 颜色后缀语义冲突 ⚠️ 最严重
| code | name | 后缀 -B 的含义 |
|---|---|---|
| C11-P1-B | Leopard Cable 100W - **Blue** | B = Blue |
| P75-P1-B / P76-P1-B / PM61-B / PX41-B / WM311-B | … - **Black** | B = Black |

同一个 `-B` 两种颜色——对账/解析的定时炸弹。**修复**：统一颜色码字典 `B=Black / W=White / O=Orange / BU=Blue / T=Titan / D=Desert Titan`，唯一需要改码的是 **C11-P1-B → C11-P1-BU**。

### ② Name 颜色后缀两种格式
| 现状 | 行 |
|---|---|
| `" - Black"`（带连字符，主流 18 行） | P75×6 / P76×3 / PM61×4 / PX41×2 / C11×2 |
| `" Black"`（无连字符，2 行） | WM311-B "MagPro 3-in-1 Black"、WM311-W "… White" |

**修复**：统一 `" - <颜色全称>"`，改 WM311 两行。

### ③ 容量 k/K 大小写混用（7 行）
"Pocket 10k / 20k / Pocket 10k 45W / Pocket 20k 45W / Pocket Pro 10k 45W / Pocket Pro 20k 45W / Pocket Pro 10k 45W Slim" 用小写 k；其余全表大写 K。**修复**：统一大写 K。

### ④ Title Case 不统一（3 行）
"Desktop charging station 300W" / "Wall charger 45W" / "Pocket Plus 10K watch" → "Desktop Charging Station 300W" / "Wall Charger 45W" / "Pocket Plus 10K Watch"。

### 统一后的命名规范（提案，写进导入 SOP）
```
code:  <MODEL>[-<代数>][-<颜色码>]     颜色码字典: B/W/O/BU/T/D
name:  <产品名> <容量大写K> [<功率>W] [Qi2.x] - <颜色全称TitleCase>
```

**全部改动 = 13 处 name + 1 处 code**，零外键影响（id 引用）、前端零改动自动生效。外部写法（-orange / 橙色 / 小写 magpro）建 `sku_alias` 收口。

### 顺带核实的自由文本残留（不阻塞）
- `shipment.notes` 20 行、`internal_customer_name` 46 行（内部补货名）、`source_file` 1 个 —— 都是溯源用途，不参与任何 join/聚合，不强制统一
- psi-dashboard.html 里的 "Orange" 是 KA 图表配色预设，与产品颜色无关

## C. 🟡 命名/编码规范问题

1. **容量大小写**："Pocket 20k" vs "Pocket Neo 20K" vs "Pocket Pro 10k 45W" —— 建议统一大写 K
2. **颜色后缀**：P75 系是 `" - Black"`（带连字符），WM311-B 是 `" Black"`（不带）—— 建议统一 `" - Black"`
3. **Bundle 1 / Bundle 2**：code 带空格、无 series/family、名字是组件清单 —— ❓是真实可售 SKU（渠道 bundle 装）还是临时记录？真实就规范编码（如 BDL01），临时就停用
4. **PowerPaw 10K (P41L-P1)** / **Rock Power (PA41/PA42)**：渠道报告通篇没出现 —— ❓还在卖吗？lifecycle 是否该调
5. lifecycle 矛盾：base active + 变体 npi（PM61/PX41）—— 粒度规则定了以后顺带归一

## D. 🟡 EAN 全缺（59/59）

KA 报告和渠道对账迟早要按 EAN 对（零售商系统全是 EAN 键）。**❓EAN 清单你手里有吗？**有的话给我一张表一次灌入；这也是未来 PSI/shipment 导入可以按 EAN 精确匹配的基础（比名字匹配可靠一个数量级）。

## E. 业务短码 ↔ DB code 映射（sku_alias，复制 KA 的成功模式）

渠道报告/源文件里的叫法 vs DB：

| 源文件可能写 | 应解析到 |
|---|---|
| P75 / p75 橙色 / Magpro slim 5k orange | P75-P1-O |
| PPT01 / PPT 01 / Pocket pro 10K | PPT01 |
| pm61 蓝 / Magpro slim 10K Qi2.2 blue | PM61-BU |
| 70w fold charger / WAL11 | WAL11 |
| 100w 数显线 / display cable 100w | CD11 |
| Magnetic cable 100w / 磁吸线 100w | C21-P1 |

**方案**（与 KA 完全同构，导入侧零新概念）：
1. `sku_alias (alias_norm → sku_id)` 表 + `resolve_sku_id(raw_name)` 函数（精确 code → 精确 name → alias → null 报人工）
2. 颜色解析增强：`resolve_sku_id('PM61', color := 'orange')` —— model_code + 颜色二段式解析
3. 守护 trigger：写入已停用 base 壳行 → RAISE（同 ka guard）

## 执行方案（待决策后一次跑完）

1. **Migration S1**：加 `model_code` 列 + 回填（P75-P1-B → P75…）+ base 壳行处理（删 0 数据的 PM61/PX41/WM311/PM51 base？❓）+ category/命名归一 + lifecycle 归一
2. **Migration S2**：`sku_alias` + `resolve_sku_id` + 守护 trigger + 种子别名（短码/中文叫法/全称变体）
3. **EAN 批量导入**（等你给表）
4. 交叉验证：型号级（model_code）汇总前后对比，shipment 330 行 / PSI 1,991 行总量不变
5. 同步 KA-CLEANUP.md 的导入 SOP：KA 用 resolve_ka_id、SKU 用 resolve_sku_id

---

## ✅ 执行记录：命名统一 + 导入映射层（2026-06-10）

**Chris 规则**：code 和 name 的颜色一律写全称（如 `P75-P1-Black`），多词颜色 code 内连写（`DesertTitan`）。

**Migration `sku_naming_unification`**：19 个缩写码 → 全称码（含根除 C11-P1-B 的 B=Blue/Black 歧义）+ 12 个 name 修正（WM311 连字符 ×2、k→K ×7、Title Case ×3）。终验：缩写码/小写 k/无连字符颜色 全部清零。

**Migration `sku_alias_and_resolver`**：
- `sku_alias` 表（37 条种子）：全部 19 个旧缩写码 + 渠道常见叫法（fold charger 70w / display cable 100w / pocket neo 10k / ppt 01 …）
- `resolve_sku_id(raw)`：code → name → 无连字符容错 → alias → **null（强制人工）**。实测：新码/旧码/大小写/渠道叫法/空格变体全部正确落位，未知名返回 null ✅
- 裸模型号（"P75"、"PM61"）**故意不收别名**——颜色歧义，必须人工拆分

**导入不出错的保证方式（三层）**：
1. **确定性层**：`resolve_sku_id` + `resolve_ka_id`——旧码、旧名、常见变体全部确定性落位
2. **解析预览层**：Claude 导入时先解析全文件 → 给 Chris 看「原始写法 → 落位 SKU/KA」对照表 + 未识别清单 → 确认后才写库
3. **拦截层**：解析不出 = null = 不入库；写废弃 KA/group 的守护 trigger 兜底；PSI iso 标签自动归一、week_start 唯一索引防重
> 结论：无法保证 100% 自动识别（渠道总会发明新写法），但保证 100% 不让错误数据入库——新写法第一次人工确认后即沉淀进 alias，第二次起自动。

## ✅ A 节已结案（2026-06-10，Chris 决策：不要壳行，不加 model_code）

规则定为最简形态：**SKU 表只存实际可出货的行**（有颜色的产品 = 颜色行，单色产品 = 单行）。型号级汇总需要时从 code 前缀派生（颜色全称化后 `PM61-Black` 去尾即型号），不预建字段。

- 已删 4 个零引用壳行：WM311 / PM51 / PM61 / PX41（55 个 SKU 剩余，audit log 留痕）
- `resolve_sku_id('PM61')` 现在返回 null → 裸型号导入强制人工拆色 ✅
- 新型号上市流程：直接建颜色行（如 PM51-Orange），永远不建裸型号行

## 待 Chris 拍板（剩 4 个）

1. **A 个案**：PX51 数据挂在无颜色单行上——它实际有颜色吗？有就建变体迁数据，没有就保持现状
2. **B**：category 收敛清单确认（提议 5 类：Power bank / Wall charger / Wireless charger / Desktop charger / Cable）
3. **C3/C4**：Bundle 1/2 和 PowerPaw/Rock Power 的处置
4. **D**：EAN 表什么时候能给
