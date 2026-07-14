// 发货资料（送货单/箱单/箱唛）的按-KA 列配置。
// 生成器按 PO 的 ka_id 取此配置；抬头/地址/客户信息在 DB 表 ka_shipping_config。
// 列结构逐 KA 不同（从 ~/Desktop/欧洲订单交付汇总/发货资料模板 各 KA 模版逐一抽取）。

// 一行 SKU 的可填字段（Builder 传入；缺的列留空——输出是可编辑 Excel/Word，客户专属料号可手填）
export type DocLine = {
  po: string
  description: string          // sku.name
  ean: string                  // sku.ean
  model: string                // sku.code（我们的 SKU code 即型号）
  supplierSku: string          // 供应商 SKU（= sku.code）
  customerRef: string          // 客户专属料号（BBC/ICP Ref…，默认空，手填或 sku_alias）
  qtyOrdered: number
  qtySent: number
  unitsPerCarton: number | null
  cartonGrossKg: number | null
  palletNo: string
}

export type Field = 'po' | 'description' | 'ean' | 'model' | 'supplierSku' | 'customerRef' | 'qtyOrdered' | 'qtySent'
export type Col = { header: string; field: Field }

// 送货单 Delivery Note 的列（逐 KA）。key = ka_id。
const DN_DEFAULT: Col[] = [
  { header: 'PO#', field: 'po' },
  { header: 'Description of the products', field: 'description' },
  { header: 'EAN', field: 'ean' },
  { header: 'Model', field: 'model' },
  { header: 'Qty Ordered', field: 'qtyOrdered' },
  { header: 'Qty Sent', field: 'qtySent' },
]
export const DN_COLUMNS: Record<number, Col[]> = {
  29: DN_DEFAULT,                                            // Komsa
  20: DN_DEFAULT,                                            // LINKU (Tech Linku)
  28: [                                                      // Bigben
    { header: 'PO#', field: 'po' },
    { header: 'Description of the products', field: 'description' },
    { header: 'BBC Product References', field: 'customerRef' },
    { header: 'Supplier SKU', field: 'supplierSku' },
    { header: 'Qty Ordered', field: 'qtyOrdered' },
    { header: 'Qty Sent', field: 'qtySent' },
  ],
  37: [                                                      // ICP
    { header: 'PO#', field: 'po' },
    { header: 'Model', field: 'model' },
    { header: 'EAN', field: 'ean' },
    { header: 'ICP Ref.', field: 'customerRef' },
    { header: 'Description', field: 'description' },
    { header: 'Qty Ordered', field: 'qtyOrdered' },
    { header: 'Qty Sent', field: 'qtySent' },
  ],
  30: [                                                      // Esprinet
    { header: 'PO#', field: 'po' },
    { header: 'Description of the products', field: 'description' },
    { header: 'EAN', field: 'ean' },
    { header: 'Qty Ordered', field: 'qtyOrdered' },
    { header: 'Qty Sent', field: 'qtySent' },
  ],
  5: [                                                       // Gandalf
    { header: 'PO NO.', field: 'po' },
    { header: 'Product Description', field: 'description' },
    { header: 'Supplier SKU', field: 'supplierSku' },
    { header: 'Qty Ordered', field: 'qtyOrdered' },
    { header: 'Qty Sent', field: 'qtySent' },
  ],
  11: [                                                      // MEX (Terg)
    { header: 'PO # (ZZ)', field: 'po' },
    { header: 'Description of the products', field: 'description' },
    { header: 'Model #', field: 'model' },
    { header: 'EAN', field: 'ean' },
    { header: 'Qty Ordered', field: 'qtyOrdered' },
    { header: 'Qty Sent', field: 'qtySent' },
  ],
  33: [                                                      // X-KOM
    { header: 'Model', field: 'model' },
    { header: 'Product', field: 'description' },
    { header: 'Qty Ordered', field: 'qtyOrdered' },
    { header: 'Qty Sent', field: 'qtySent' },
  ],
}
export const dnColumns = (kaId: number): Col[] => DN_COLUMNS[kaId] ?? DN_DEFAULT

// 箱单 Packing List 列——各 KA 一致
export const PL_COLUMNS = [
  'PO#', 'Pallets#', 'SKU', 'Description of the products',
  'Qty per Carton', 'Gross Weight (KG) Per Carton', 'Number of Cartons',
  'Total Shipped Qty', 'Total Gross Weight (KG)',
] as const

export const fieldValue = (c: Col, l: DocLine): string | number => {
  switch (c.field) {
    case 'po': return l.po
    case 'description': return l.description
    case 'ean': return l.ean
    case 'model': return l.model
    case 'supplierSku': return l.supplierSku
    case 'customerRef': return l.customerRef
    case 'qtyOrdered': return l.qtyOrdered
    case 'qtySent': return l.qtySent
  }
}

// 箱数 = ⌈发货量 / 每箱装量⌉（无装量则按 1 箱）
export const cartonCount = (l: DocLine): number =>
  l.unitsPerCarton && l.unitsPerCarton > 0 ? Math.ceil(l.qtySent / l.unitsPerCarton) : 1

// 各 KA 的模版坐标（填真实模版用）。key = ka_id。
//   dir = templates/ 下子文件夹；dn.dataStartRow/单元格 = 送货单填充位置（列跟 DN_COLUMNS 从 B 起）；
//   carton.extra = 箱唛尾部字段（Box NO. 或 HS Code）。PL 各 KA 统一：日期 D3 / 数量 D4 / 数据第 8 行 / 列 B-H（I,J 为模版公式）。
export type KaTpl = {
  dir: string
  dn?: { dnCell: string; palletsCell: string; parcelsCell: string; dataStartRow: number }
  carton: { extra: 'boxNo' | 'hsCode' }
}
export const KA_TPL: Record<number, KaTpl> = {
  29: { dir: 'Komsa',    dn: { dnCell: 'D9',  palletsCell: 'D10', parcelsCell: 'D11', dataStartRow: 14 }, carton: { extra: 'boxNo' } },
  28: { dir: 'Bigben',   dn: { dnCell: 'D9',  palletsCell: 'D10', parcelsCell: 'D11', dataStartRow: 14 }, carton: { extra: 'hsCode' } },
  37: { dir: 'ICP',      dn: { dnCell: 'F7',  palletsCell: 'F8',  parcelsCell: 'F9',  dataStartRow: 12 }, carton: { extra: 'boxNo' } },
  20: { dir: 'LINKU',    dn: { dnCell: 'D10', palletsCell: 'D11', parcelsCell: 'D12', dataStartRow: 15 }, carton: { extra: 'boxNo' } },
  30: { dir: 'Esprinet', dn: { dnCell: 'D9',  palletsCell: 'D10', parcelsCell: 'D11', dataStartRow: 14 }, carton: { extra: 'boxNo' } },
  5:  { dir: 'Gandalf',  dn: { dnCell: 'D11', palletsCell: 'D12', parcelsCell: 'D13', dataStartRow: 16 }, carton: { extra: 'boxNo' } },
  11: { dir: 'MEX',      dn: { dnCell: 'D11', palletsCell: 'D12', parcelsCell: 'D13', dataStartRow: 16 }, carton: { extra: 'boxNo' } },
  33: { dir: 'X-KOM',    dn: { dnCell: 'C14', palletsCell: 'C15', parcelsCell: 'C16', dataStartRow: 19 }, carton: { extra: 'boxNo' } },
  3:  { dir: 'Coolblue', carton: { extra: 'boxNo' } },   // EDI，一般不出手工资料
}
