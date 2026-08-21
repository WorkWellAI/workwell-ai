import { PostureMonitor } from "@/components/PostureMonitor";

export default function Home() {
  return (
    <main className="shell">
      <header className="hero">
        <div className="brand">
          <div className="mark">W</div>
          <div>
            <h1>WorkWell AI</h1>
            <p>AI Workplace Ergonomics · dáng ngồi &amp; mệt mỏi</p>
          </div>
        </div>
        <p className="privacy">
          🔒 Pose &amp; face chạy trên trình duyệt. Không gửi video lên server, không chẩn đoán y khoa.
        </p>
      </header>

      <PostureMonitor />

      <p className="footnote">
        Webcam laptop chủ yếu thấy đầu–vai nên “lưng thẳng” chỉ ước lượng khi hông còn trong khung hình.
        Cảnh báo mệt (mắt nhắm ~2 giây, ngáp ~1 giây) dùng Face Mesh trên máy — không phải chẩn đoán y khoa.
        Hãy hiệu chỉnh khi ngồi đúng tư thế, mắt mở.
      </p>
    </main>
  );
}
