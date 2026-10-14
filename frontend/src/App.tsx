import { useState } from "react";
import FaceController, {
  type ConnectionStatus,
  type FaceControllerConfig,
} from "./components/FaceController";
import "./App.css";

const defaultConfig: FaceControllerConfig = {
  mouseSensitivity: 1,
  deadZoneRadius: 0.02,
  invertX: true,
  invertY: false,
  oneEuroMinCutoff: 1,
  oneEuroBeta: 0.08,
  oneEuroDCutoff: 1,
  earCalibrationSec: 3,
  earThresholdRatio: 0.72,
  winkDebounceMs: 900,
};

function App() {
  const [status, setStatus] =
    useState<ConnectionStatus>("INITIALIZING");

  return (
    <main className="app">
      <section className="panel">
        <h1>Điều khiển chuột bằng khuôn mặt</h1>

        <p className="description">
          Di chuyển đầu để điều khiển con trỏ.
          Nháy một mắt để kích hoạt phím Enter.
        </p>

        <FaceController
          config={defaultConfig}
          modelAssetPath="/models/face_landmarker.task"
          wasmBasePath="https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
          onStatusChange={setStatus}
          onWink={(event) => {
            console.log("Phát hiện nháy mắt:", event);
          }}
        />

        <p className="status">
          Trạng thái: <strong>{status}</strong>
        </p>
      </section>
    </main>
  );
}

export default App;