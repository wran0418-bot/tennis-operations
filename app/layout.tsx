import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "网球课时与工资统计",
  description: "网球俱乐部月卡课报名、每日课表和教练工资统计工具。",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
