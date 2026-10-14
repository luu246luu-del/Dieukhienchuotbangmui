# 🖱️ Điều khiển chuột bằng mũi và cử chỉ khuôn mặt

Ứng dụng thử nghiệm **điều khiển con trỏ chuột máy tính bằng chuyển động mũi**, sử dụng webcam, MediaPipe và giao diện React. Dự án hướng tới các thao tác máy tính rảnh tay: di chuyển con trỏ bằng đầu/mũi, kích hoạt **Enter** bằng cử chỉ khuôn mặt và **click trái** bằng cử chỉ **giơ ngón cái**.

> **Trạng thái:** bản thử nghiệm/đang phát triển. README này được viết dựa trên mã nguồn trong gói `chuotbangmui.zip` (tháng 9/2026). Một số tệp README cũ trong gói mô tả tính năng khác với code hiện tại; phần bên dưới ưu tiên **hành vi thực tế trong `frontend/src` và `local-bridge/server.ts`**. Chưa xác nhận ứng dụng đã chạy trọn vẹn trên máy mới.

## ✨ Tính năng hiện có trong mã nguồn

| Đầu vào | Xử lý | Hành động |
| --- | --- | --- |
| Di chuyển đầu/mũi | MediaPipe **FaceLandmarker** lấy vị trí đầu mũi (landmark 1), ánh xạ lên màn hình | Gửi yêu cầu di chuyển con trỏ |
| Giơ ngón cái (`Thumb_Up`) liên tục ≥ 600 ms | MediaPipe **GestureRecognizer**; điểm tin cậy từ `0.55`, giãn cách click ≥ 1.200 ms | Gửi **click chuột trái** |
| Há miệng | So tỷ lệ độ mở miệng với ngưỡng `0.18`, giãn cách ≥ 1.500 ms | Gửi phím **Enter** |
| Nháy một mắt | `WinkDetector` phát hiện dựa trên tỷ lệ mở mắt EAR và tự hiệu chỉnh | Hiển thị/ghi nhận cử chỉ; **code hiện tại chưa gửi Enter/click từ nháy mắt trong luồng xử lý chính** |

- **One Euro Filter** giúp làm mượt tọa độ và hạn chế rung con trỏ.
- Có `deadZoneRadius`, độ nhạy (`mouseSensitivity`), đảo trục X/Y, thời gian hiệu chỉnh nháy mắt và thời gian chống kích hoạt liên tiếp (`debounce`).
- Webcam chạy trong trình duyệt. Frontend gửi **lệnh điều khiển dạng JSON** qua WebSocket đến tiến trình cục bộ; không có đường truyền video webcam tới bridge trong code được kiểm tra.
- Server bridge chỉ lắng nghe tại `127.0.0.1:8787` và từ chối các kết nối không thuộc máy cục bộ.
- Bridge **đã có handler nhận lệnh cuộn**, nhưng frontend trong gói **chưa có logic gửi cử chỉ cuộn**. Không nên coi cuộn bằng tay là tính năng đã hoàn thiện.

## 🧰 Công nghệ

- **Frontend:** React 19, TypeScript, Vite 8, CSS.
- **Computer vision:** `@mediapipe/tasks-vision` (FaceLandmarker và GestureRecognizer).
- **Làm mượt & nhận diện:** `OneEuroFilter.ts`, `WinkDetector.ts`.
- **Local bridge:** Node.js, TypeScript, `ws` (WebSocket), API điều khiển chuột/bàn phím ở hệ điều hành.
- **Thành phần tham khảo chưa tích hợp thành backend chạy được trong gói:** `Dchuotbangmui/core.service.ts`, `Dchuotbangmui/schema.prisma`.

## 📁 Cấu trúc dự án trong ZIP

```text
chuotbangmui/
├── frontend/
│   ├── index.html
│   ├── package.json
│   ├── package-lock.json
│   ├── public/
│   │   └── models/
│   │       ├── face_landmarker.task
│   │       └── gesture_recognizer.task
│   └── src/
│       ├── App.tsx
│       ├── App.css
│       ├── main.tsx
│       ├── components/
│       │   └── FaceController.tsx
│       └── utils/
│           ├── OneEuroFilter.ts
│           └── WinkDetector.ts
├── local-bridge/
│   ├── package.json
│   ├── package-lock.json
│   └── server.ts
├── backend/                 # Trống trong ZIP đã kiểm tra
├── Dchuotbangmui/          # Tài liệu/schema/service tham khảo
│   ├── README.md
│   ├── schema.prisma
│   └── core.service.ts
├── package.json
└── README.md                # File hướng dẫn cấp gốc (file này)
```

> `frontend/node_modules/` có trong gói ZIP gốc nhưng **không nên commit lên Git**. Có thể tái cài thư viện bằng `npm ci`.

## 💻 Yêu cầu

1. **Windows** với webcam hoạt động và quyền điều khiển chuột/bàn phím (bridge sử dụng thư viện native điều khiển OS).
2. **Node.js và npm** phiên bản tương thích với Vite 8 (xem `node -v` và yêu cầu engine từ tài liệu Vite; nên dùng Node.js LTS mới).
3. Trình duyệt hiện đại hỗ trợ webcam, WebAssembly và WebGL/MediaPipe.
4. VS Code (không bắt buộc nhưng tiện thao tác).
5. Quyền cho phép truy cập camera tại địa chỉ local (`localhost`).

## 🚀 Cài đặt frontend trên Windows

Giả sử bạn giải nén dự án tại `D:\chuotbangmui` và có file `D:\chuotbangmui\frontend\package.json`.

Mở **VS Code → Terminal → New Terminal**, chạy từng lệnh:

```powershell
cd D:\chuotbangmui\frontend
node --version
npm --version
npm ci
npm run dev
```

Sau đó mở URL mà Vite in trong Terminal (thường là **http://localhost:5173**). Cho phép trình duyệt sử dụng webcam.

> Các bước trên **khởi động giao diện và nhận diện**, nhưng muốn di chuyển **con trỏ thật của hệ điều hành** còn phải chạy và sửa tương thích local bridge bên dưới.

### Kiểm tra build

```powershell
cd D:\chuotbangmui\frontend
npm run build
```

Lệnh build biên dịch TypeScript rồi đóng gói bản web. Nếu báo lỗi TypeScript, cần sửa lỗi trước khi triển khai; `npm run dev` không thay thế bước kiểm tra build.

## 🔌 Local bridge: điều khiển chuột Windows

Frontend kết nối tới **`ws://127.0.0.1:8787`**. Mở **Terminal thứ hai**:

```powershell
cd D:\chuotbangmui\local-bridge
npm ci
npm start
```

**Quan trọng — cần xử lý lỗi phụ thuộc trước khi kỳ vọng bridge chạy:**

- `local-bridge/package.json` khai báo `@nut-tree-fork/nut-js` và `ws` nhưng **`server.ts` lại gọi `require("robotjs")` và `require("zod")`**. Hai gói này **không có trong dependencies được khai báo**.
- `package.json` đặt `"type": "module"`, nhưng `server.ts` lấy `require` qua `Function("return require")()`; trong ESM, `require` thường **không tồn tại**. Vì vậy, chỉ `npm ci && npm start` **chưa đủ để bảo đảm chạy**.
- Cần thống nhất thư viện điều khiển OS (ví dụ chuyển bridge sang API của `@nut-tree-fork/nut-js` hoặc khai báo và dùng đúng `robotjs`), bổ sung thư viện xác thực schema nếu dùng `zod`, và sửa cơ chế import theo ESM. Đây là **việc sửa code**, chưa được thực hiện trong bản README-only này.
- Không chạy bridge từ máy/nguồn mã không tin cậy vì tiến trình có quyền điều khiển chuột và bàn phím thực tế.

### Giao thức WebSocket (theo mã bridge)

```json
{"action":"move","x":500,"y":300}
```

```json
{"action":"click","button":"left"}
```

```json
{"action":"keypress","key":"enter"}
```

Bridge còn chấp nhận `{"action":"scroll","direction":"up","amount":60}` nhưng frontend hiện tại chưa gửi lệnh này từ cử chỉ bàn tay.

## 🎮 Cách sử dụng khi bridge đã hoạt động

1. Bật webcam, đặt mặt ở giữa khung hình và đủ ánh sáng.
2. Giữ đầu tương đối ổn định trong vài giây đầu để `WinkDetector` hiệu chỉnh.
3. Dịch chuyển đầu/mũi nhẹ nhàng để di chuyển con trỏ.
4. Giơ **ngón cái lên** và giữ tối thiểu khoảng **0,6 giây** để click trái.
5. **Há miệng** để gửi Enter (có thời gian chờ để tránh nhận lặp).
6. Nháy một mắt để quan sát trạng thái phát hiện; **không kỳ vọng tự động click/Enter bằng nháy mắt** trong code hiện tại.
7. Muốn dừng, dùng `Ctrl+C` trong Terminal chạy frontend và bridge; đóng tab trình duyệt để ngừng camera.

## ⚙️ Tinh chỉnh nhận diện

Cấu hình mặc định nằm tại **`frontend/src/App.tsx`**:

| Tên cấu hình | Mặc định | Vai trò |
| --- | ---: | --- |
| `mouseSensitivity` | `1` | Độ nhạy di chuyển con trỏ |
| `deadZoneRadius` | `0.02` | Vùng chết quanh tâm, giảm chuyển động nhỏ |
| `invertX` | `true` | Đảo chiều ngang |
| `invertY` | `false` | Đảo chiều dọc |
| `oneEuroMinCutoff` | `1` | Tham số bộ lọc 1€ |
| `oneEuroBeta` | `0.08` | Phản ứng của bộ lọc khi tốc độ thay đổi |
| `oneEuroDCutoff` | `1` | Cutoff cho đạo hàm |
| `earCalibrationSec` | `3` | Số giây hiệu chỉnh mắt |
| `earThresholdRatio` | `0.72` | Ngưỡng nhận diện nháy mắt tương đối |
| `winkDebounceMs` | `900` | Khoảng chống nhận liên tiếp |

Trong `FaceController.tsx`, một số hằng số khác gồm `ACTIVE_REGION = { widthFrac: 0.5, heightFrac: 0.4 }`, `MOUTH_OPEN_RATIO = 0.18`, `MOUTH_TRIGGER_COOLDOWN_MS = 1500`.

## 🧯 Khắc phục sự cố

| Triệu chứng | Kiểm tra / hướng giải quyết |
| --- | --- |
| `npm` / `node` không nhận lệnh | Cài Node.js, mở lại VS Code và kiểm tra `node -v` |
| Trang web không xin quyền camera | Dùng `http://localhost:...`, cho phép camera trong trình duyệt và đóng ứng dụng đang chiếm webcam |
| `BRIDGE_DISCONNECTED` | Chạy local bridge ở Terminal khác và kiểm tra cổng `8787`; lưu ý lỗi phụ thuộc của bridge nêu trên |
| `Cannot find module 'robotjs'` hoặc `'zod'` | `server.ts` đang gọi các module không được khai báo trong `local-bridge/package.json` |
| `require is not defined` | Mã bridge đang trộn ESM và `require`; cần sửa imports và thư viện OS |
| Camera có hình nhưng chuột thật không di chuyển | Kiểm tra WebSocket và log bridge, cũng như quyền điều khiển hệ điều hành |
| Con trỏ rung | Tăng làm mượt/bớt độ nhạy; cải thiện ánh sáng và độ ổn định webcam |
| Model AI không tải | Kiểm tra hai tệp `.task` trong `frontend/public/models/` và mạng tải WASM từ CDN |
| Click không hoạt động | Code hiện tại click bằng **Thumb_Up**, không phải nháy mắt; giữ cử chỉ ít nhất 600 ms |
| Cuộn không hoạt động | Frontend hiện chưa gửi lệnh cuộn tương ứng dù bridge có handler |

## 🔒 Quyền riêng tư và an toàn

- Dữ liệu camera được xử lý trong trình duyệt bằng MediaPipe theo luồng code hiện tại; bridge chỉ nhận lệnh thao tác, không nhận khung hình video.
- Giao diện tải MediaPipe WASM từ CDN theo cấu hình `App.tsx`, vì vậy không phải toàn bộ tài nguyên đều offline ngay từ đầu.
- Bridge bị giới hạn kết nối ở `127.0.0.1`, nhưng **vẫn có quyền điều khiển OS**. Chỉ chạy khi cần, không mở cổng bridge ra mạng công cộng.

## 📌 Các phần còn cần hoàn thiện

- Đồng bộ `local-bridge/server.ts` với package dependencies và ESM để bridge thực sự khởi động được.
- Quyết định thống nhất hành vi nháy mắt: tài liệu cũ ghi click/Enter nhưng code chính mới ghi nhận sự kiện nháy mắt.
- Nếu muốn cuộn bằng tay, cần triển khai nhận diện và phát lệnh `scroll` từ frontend.
- Thư mục `backend/` trong bản ZIP hiện trống; các tệp Prisma/service trong `Dchuotbangmui/` chưa tạo thành backend độc lập hoàn chỉnh.
- Kiểm thử build và hoạt động end-to-end trên máy Windows mục tiêu.

## 🔗 Repository

[luu246luu-del/Dieukhienchuotbangmui](https://github.com/luu246luu-del/Dieukhienchuotbangmui)

---

**README được bổ sung riêng, không thay đổi các tệp mã nguồn của dự án.**
