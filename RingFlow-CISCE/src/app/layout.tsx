import type { Metadata } from "next";
import { Inter, JetBrains_Mono, Plus_Jakarta_Sans, Bebas_Neue, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { ConditionalFooter } from "@/components/conditional-footer";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
});

const jetBrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

// Self-hosted via next/font (no external CDN request at render time)
const bebasNeue = Bebas_Neue({
  variable: "--font-bebas-neue",
  subsets: ["latin"],
  weight: ["400"],
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["500", "600"],
  display: "swap",
});

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: "RingFlow | Real-Time Tournament Floor Management",
  description: "Live tournament rings, match queues, dynamic bracket flow, and spectator dashboard.",
  icons: {
    icon: [
      { url: "/icon.png", type: "image/png" },
    ],
    shortcut: "/icon.png",
    apple: "/icon.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${plusJakartaSans.variable} ${jetBrainsMono.variable} ${bebasNeue.variable} ${ibmPlexMono.variable} h-full antialiased`}
    >
      <head>
        <link rel="icon" href="/icon.png" type="image/png" sizes="any" />
        <link rel="apple-touch-icon" href="/icon.png" />
        {/* Preconnect only — Material Symbols can't be self-hosted via next/font */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* Material Symbols only — all other fonts are self-hosted via next/font above */}
        <link
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full flex flex-col">

        <div className="flex-1 flex flex-col min-h-0 w-full">
          {children}
        </div>
        <ConditionalFooter />
      </body>
    </html>
  );
}
