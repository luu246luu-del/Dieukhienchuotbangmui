# Accessibility AI Controller

Điều khiển con trỏ OS bằng chóp mũi (nose tracking), **click chuột trái thật**
bằng nháy mắt bất đối xứng (asymmetric wink), và **cuộn trang** bằng cách
ngửa lòng bàn tay về phía camera rồi vuốt lên/xuống. Chạy hoàn toàn cục bộ
trên trình duyệt (MediaPipe Tasks Vision), không gửi video qua mạng.

## Cấu trúc

- `prisma/schema.prisma` — Data model (User, UserConfig, AIModel, TelemetryLog).
- `backend/src/services/core.service.ts` — Express router CRUD cấu hình cá nhân hóa,
  bảo vệ bằng JWT (`Authorization: Bearer <token>`).
- `frontend/src/utils/OneEuroFilter.ts` — Bộ lọc 1€ khử rung tín hiệu con trỏ.
- `frontend/src/utils/WinkDetector.ts` — Tính EAR từng mắt, tự hiệu chỉnh
  ngưỡng động trong `earCalibrationSec` giây đầu, debounce theo `winkDebounceMs`.
- `frontend/src/utils/HandGestureDetector.ts` — Nhận diện lòng bàn tay mở,
  ngửa về phía camera, rồi phát hiện vuốt lên/xuống để cuộn trang.
- `frontend/src/components/FaceController.tsx` — Component React chạy
  FaceLandmarker (mũi + mắt) và HandLandmarker (bàn tay), gửi lệnh qua
  WebSocket tới local bridge.
- `local-bridge/server.ts` — WebSocket server cục bộ (127.0.0.1:8787) dùng
  robotjs để di chuyển chuột / click chuột trái / cuộn / gõ phím thật trên
  OS. Chỉ chấp nhận kết nối từ localhost.

## Cử chỉ điều khiển

| Cử chỉ | Hành động | Cấu hình liên quan |
| --- | --- | --- |
| Di chuyển mũi | Di chuyển con trỏ | `mouseSensitivity`, `deadZoneRadius`, bộ lọc 1€ |
| Nháy 1 mắt (bất đối xứng) | Click chuột trái tại vị trí con trỏ hiện tại | `winkAction: "click"` (mặc định), `earThresholdRatio`, `winkDebounceMs` |
| Ngửa lòng bàn tay + vuốt lên | Cuộn trang lên | `scrollEnabled`, `scrollSwipeThreshold`, `scrollMinVelocity` |
| Ngửa lòng bàn tay + vuốt xuống | Cuộn trang xuống | như trên |

Muốn quay lại hành vi cũ (wink = phím Enter thay vì click), đặt
`winkAction: "enter"` trong config.

Nhận diện "lòng bàn tay ngửa về phía camera" là một heuristic hình học đơn
giản (không phải model AI riêng), có thể cần bật `invertPalmDetection: true`
nếu góc camera/tay thuận của bạn khiến nó nhận ngược (kích hoạt khi thấy mu
bàn tay thay vì lòng bàn tay).

Tính năng cuộn cần thêm 1 model `.task` của MediaPipe **HandLandmarker**
(khác với model FaceLandmarker), trỏ qua prop `handModelAssetPath` của
`FaceController`. Nếu không truyền prop này, cuộn sẽ tự động bị bỏ qua dù
`scrollEnabled` là `true`.

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
