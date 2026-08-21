import { PostureMonitor } from "@/components/PostureMonitor";

export default function Home() {
  return (
    <main className="shell">
      <header className="hero">
        <div className="brand">
          <div className="mark">W</div>
          <div>
            <h1>WorkWell AI</h1>
            <p>AI Workplace Ergonomics · cảnh báo dáng ngồi</p>
          </div>
        </div>
        <p className="privacy">
          🔒 Pose chạy trên trình duyệt. Không gửi video lên server, không chẩn đoán y khoa.
        </p>
      </header>

      <PostureMonitor />

      <p className="footnote">
        Webcam laptop chủ yếu thấy đầu–vai nên “lưng thẳng” chỉ ước lượng khi hông còn trong khung hình.
        Hãy hiệu chỉnh khi ngồi đúng tư thế trước khi làm việc.
      </p>
    </main>
  );
}
