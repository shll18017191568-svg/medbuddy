import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MedBuddy · 医生智能工作台",
  description: "面向医生的 AI 数字人 + Agent 任务执行一站式工作台",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">{children}</body>
    </html>
  );
}
