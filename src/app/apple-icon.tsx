import { ImageResponse } from 'next/og'

// iOS 主屏图标（180x180 PNG）—— INIU 品牌色
export const size = { width: 180, height: 180 }
export const contentType = 'image/png'

export default function AppleIcon() {
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
          border: '8px solid #22d3ee',
          borderRadius: 36,
          color: '#22d3ee',
          fontSize: 56,
          fontWeight: 900,
          fontFamily: 'sans-serif',
          letterSpacing: 4,
        }}
      >
        INIU
      </div>
    ),
    size
  )
}
