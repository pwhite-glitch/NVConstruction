import './globals.css'
export const metadata = { title: 'NV Construction' }
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ backgroundColor: '#f4f5f6', fontFamily: 'system-ui, sans-serif' }}>{children}</body>
    </html>
  )
}
