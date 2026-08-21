import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WorkWell AI — Cảnh báo dáng ngồi",
  description:
    "Theo dõi tư thế ngồi bằng camera trên máy, cảnh báo khi cúi đầu, vai lệch hoặc ngồi quá lâu.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi" className="h-full">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
