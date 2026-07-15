// v2
import './globals.css'
import DevRoleSwitcher from './components/DevRoleSwitcher'
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
      <body style={{ backgroundColor: '#0a0a0a', fontFamily: "'Inter', system-ui, sans-serif", color: '#f1f1f1', margin: 0 }}>
        {children}
        <DevRoleSwitcher />
      </body>
    </html>
  )
} 
