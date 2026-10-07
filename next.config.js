/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    // pdfjs-dist(Add PO 上传解析用)里有 Node 专用的可选依赖 canvas；浏览器端不需要，直接置空避免打包报错
    config.resolve.alias.canvas = false
    return config
  },
}
module.exports = nextConfig
