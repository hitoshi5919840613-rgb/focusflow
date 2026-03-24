import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

const themeScript = `
  (() => {
    try {
      const savedTheme = window.localStorage.getItem("focusflow-theme");
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const theme = savedTheme === "dark" || savedTheme === "light"
        ? savedTheme
        : prefersDark
          ? "dark"
          : "light";
      document.documentElement.classList.toggle("dark", theme === "dark");
    } catch (error) {
      console.error("theme bootstrap failed", error);
    }
  })();
`;

export const metadata: Metadata = {
  title: {
    default: "FocusFlow",
    template: "%s | FocusFlow"
  },
  description: "ADHD特性に寄り添う、完全クライアントサイドのタスク&ルーティン管理アプリ。",
  applicationName: "FocusFlow",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "FocusFlow"
  },
  formatDetection: {
    telephone: false
  },
  icons: {
    icon: "/icon-192.svg",
    apple: "/icon-192.svg"
  }
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F8FAFC" },
    { media: "(prefers-color-scheme: dark)", color: "#0F172A" }
  ]
};

export default function RootLayout({
  children
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {children}
      </body>
    </html>
  );
}
