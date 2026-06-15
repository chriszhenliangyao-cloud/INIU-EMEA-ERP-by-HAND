// 个人「称号 / flair」集中配置 —— 按邮箱匹配，多处复用。
//
// 同事要求：Jiwen Wang 在系统里以「👑 Majesty」显示。
// - 侧栏登录信息的身份标签：用 roleLabelFor() 把 admin → 👑 Majesty
// - 她名字本身的皇冠：直接写进 sales_rep.display_name（"Jiwen Wang 👑"），
//   这样任何渲染她 display_name 的地方（侧栏 / 预测 / 审计日志 / 各 view）都自动带皇冠
// - 销售管理表里的彩色徽章：见 sales-rep-management-view.tsx 的 FUN_BADGES

// 身份标签覆盖：只影响「登录信息」那行的称号，不动 admin/sales 的实际权限。
const ROLE_TITLE_OVERRIDES: Record<string, string> = {
  'jiwen.wang@iniushop.com': '👑 Majesty',
}

/** 侧栏登录信息显示的身份标签。命中 override 用称号，否则按 admin/sales 默认。 */
export function roleLabelFor(email: string | null | undefined, isAdmin: boolean): string {
  const title = email ? ROLE_TITLE_OVERRIDES[email.toLowerCase()] : undefined
  if (title) return title
  return isAdmin ? '🌍 Admin (HQ)' : '🧑‍💼 Sales'
}
