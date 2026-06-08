# INIU EMEA ERP

欧洲市场销售管理系统 — 基于 Next.js 14 + Supabase

## 本地启动

```bash
# 1) 安装依赖
npm install

# 2) 配置环境变量（.env.local 已含真实 Anon Key）
cp .env.example .env.local  # 如果 .env.local 不存在再做这一步

# 3) 启动 dev server
npm run dev

# 4) 打开 http://localhost:3000
```

## 技术栈

- **前端**: Next.js 14 App Router · TypeScript · Tailwind CSS
- **后端**: Supabase (PostgreSQL + Auth + RLS + Realtime)
- **认证**: Google SSO（限定 @iniushop.com 域名）

## 页面规划

| 路由 | 功能 | 状态 |
|---|---|---|
| `/auth/login` | Google SSO 登录 | ✅ |
| `/shipments` | 发货记录（HTML 1）| ✅ |
| `/forecast` | 需求预测（HTML 2）| ⏳ |
| `/summary` | EU TTL 汇总（HTML 3）| ⏳ |
| `/admin` | 主数据管理 | ⏳ |

## 权限模型

- **admin**（HQ 全员）：所有数据
- **sales**（外籍销售）：仅自己国家的数据（RLS 自动过滤）

数据库层 RLS 已配置，前端不需要写权限判断。

## 项目结构

```
src/
├── app/
│   ├── auth/              # 登录 + OAuth 回调
│   └── (dashboard)/       # 主应用（带侧边栏）
│       ├── layout.tsx
│       └── shipments/
├── lib/
│   ├── supabase/         # Client / Server / Middleware
│   └── utils.ts
├── components/
│   ├── ui/               # 基础 UI 组件
│   └── logout-button.tsx
└── middleware.ts         # Auth session 自动 refresh
```

## Supabase 项目

- ID: `nnoyrfbnyxfnooapbqni`
- Region: EU Central
- URL: https://nnoyrfbnyxfnooapbqni.supabase.co
