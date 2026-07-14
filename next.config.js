/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 把发货资料模版（.xlsx/.docx）打进 /api/shipping-docs 的 serverless 产物，运行时 fs 可读
  outputFileTracingIncludes: {
    '/api/shipping-docs': ['./src/lib/shipping-docs/templates/**/*'],
  },
}
module.exports = nextConfig
