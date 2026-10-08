// v2
import './globals.css'
import DevRoleSwitcher from './components/DevRoleSwitcher'
import PreviewBanner from './components/PreviewBanner'
export const metadata = {
  title: 'NV Construction',
  icons: {
    icon: '/logo.png',
    apple: '/logo.png',
  },
}
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ backgroundColor: '#f4f6f8', fontFamily: "'Inter', system-ui, sans-serif", color: '#111827', margin: 0 }}>
        <PreviewBanner />
        {children}
        <DevRoleSwitcher />
      </body>
    </html>
  )
}
