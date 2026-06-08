import { ImageResponse } from 'next/og'

// 浏览器 tab favicon（32x32 PNG）—— INIU 品牌色
export const size = { width: 32, height: 32 }
export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          background: 'white',
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: '2px solid #22d3ee',  // cyan-400 —— INIU 品牌青色
          borderRadius: 7,
          color: '#22d3ee',
          fontSize: 11,
          fontWeight: 900,
          fontFamily: 'sans-serif',
          letterSpacing: 0.5,
        }}
      >
        INIU
      </div>
    ),
    size
  )
}
