import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "WorkWell AI — Dáng ngồi, mệt mỏi & Coach",
  description:
    "Theo dõi tư thế và dấu hiệu mệt trên máy, Coach giải thích từ số liệu — không gửi video, không chẩn đoán y khoa.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="vi" className="h-full">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
