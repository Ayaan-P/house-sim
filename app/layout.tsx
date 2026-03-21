import './globals.css'
import { Metadata, Viewport } from 'next'
import { AuthProvider } from '@/components/AuthProvider'
import { InstallPrompt } from '@/components/InstallPrompt'

export const metadata: Metadata = {
  title: 'HouseSim - Buy vs Rent Simulator',
  description: 'Monte Carlo simulation for buy vs rent decisions',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'HouseSim',
  },
  icons: {
    icon: '/icon.svg',
    apple: '/icon.svg',
  },
}

export const viewport: Viewport = {
  themeColor: '#3B82F6',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
      </head>
      <body className="bg-[#0a0a0a] text-white min-h-screen">
        <AuthProvider>
          {children}
          <InstallPrompt />
        </AuthProvider>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', () => {
                  navigator.serviceWorker.register('/sw.js')
                    .catch((err) => console.log('SW registration failed:', err))
                })
              }
            `,
          }}
        />
      </body>
    </html>
  )
}
