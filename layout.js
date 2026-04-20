import './globals.css'

export const metadata = {
  title: 'NV Construction',
  description: 'NV Construction Management Platform',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
