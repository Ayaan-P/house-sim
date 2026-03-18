import './globals.css'
import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'House vs Rent Simulator',
  description: 'Monte Carlo simulation for buy vs rent decisions',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-[#0a0a0a] text-white min-h-screen">
        {children}
      </body>
    </html>
  )
}
