# Accessibility AI Controller

Điều khiển con trỏ OS bằng chóp mũi (nose tracking) và kích hoạt "Enter" bằng
nháy mắt bất đối xứng (asymmetric wink), chạy hoàn toàn cục bộ trên trình
duyệt (MediaPipe Tasks Vision), không gửi video qua mạng.

## Cấu trúc

- `prisma/schema.prisma` — Data model (User, UserConfig, AIModel, TelemetryLog).
- `backend/src/services/core.service.ts` — Express router CRUD cấu hình cá nhân hóa,
  bảo vệ bằng JWT (`Authorization: Bearer <token>`).
- `frontend/src/utils/OneEuroFilter.ts` — Bộ lọc 1€ khử rung tín hiệu con trỏ.
- `frontend/src/utils/WinkDetector.ts` — Tính EAR từng mắt, tự hiệu chỉnh
  ngưỡng động trong `earCalibrationSec` giây đầu, debounce theo `winkDebounceMs`.
- `frontend/src/components/FaceController.tsx` — Component React chạy
  FaceLandmarker, map tọa độ mũi -> màn hình, gửi lệnh qua WebSocket tới
  local bridge.
- `local-bridge/server.ts` — WebSocket server cục bộ (127.0.0.1:8787) dùng
  robotjs để di chuyển chuột / gõ phím thật trên OS. Chỉ chấp nhận kết nối
  từ localhost.

## Chạy thử nhanh

```bash
# 1. Local bridge (cần chạy trên máy có quyền điều khiển chuột/bàn phím)
cd local-bridge && npm install && npm start

# 2. Backend
cd backend && npm install
cp .env.example .env   # điền DATABASE_URL và JWT_SECRET thật
npx prisma migrate dev --name init
npm run dev

# 3. Frontend: import FaceController vào app React của bạn, trỏ
#    modelAssetPath tới file .task của FaceLandmarker (ví dụ tải từ
#    Google's model zoo hoặc AI OTA Service của bạn) và wasmBasePath
#    tới thư mục wasm của @mediapipe/tasks-vision.
```
