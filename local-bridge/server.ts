// local-bridge/server.ts
// Ultra-light local OS bridge. Binds a WebSocket server on 127.0.0.1 only
// (never exposed to the network) and translates JSON intents coming from
// the browser's FaceController into real OS cursor moves / key presses
// via robotjs.
//
// Run with: ts-node local-bridge/server.ts
// (or compile with tsc and run the emitted JS with plain node)

import { WebSocketServer, WebSocket, RawData } from "ws";

const loadModule = <T = any>(id: string): T => (Function("return require")() as (moduleId: string) => T)(id);

const robot = loadModule<any>("robotjs");
const { z } = loadModule<{ z: any }>("zod");

const HOST = "127.0.0.1";
const PORT = 8787;
const MAX_MOVES_PER_SECOND = 120;
const MAX_SCROLLS_PER_SECOND = 15;
const MIN_CLICK_INTERVAL_MS = 120;

const moveSchema = z.object({
  action: z.literal("move"),
  x: z.number().int().min(0),
  y: z.number().int().min(0),
});

const keypressSchema = z.object({
  action: z.literal("keypress"),
  key: z.literal("enter"),
});

// Fired on an asymmetric wink — a real OS-level left mouse click at the
// cursor's current position (so it "clicks whatever it's hovering over",
// just like a physical left click would).
const clickSchema = z.object({
  action: z.literal("click"),
  button: z.literal("left"),
});

// Fired by a palm-up swipe gesture. `amount` is in robotjs scroll "ticks";
// the frontend already debounces/paces these, so each message here is one
// discrete scroll step.
const scrollSchema = z.object({
  action: z.literal("scroll"),
  direction: z.enum(["up", "down"]),
  amount: z.number().int().min(1).max(300).default(60),
});

const messageSchema = z.union([moveSchema, keypressSchema, clickSchema, scrollSchema]);

type InboundMessage = z.infer<typeof messageSchema>;

interface ClientState {
  lastMoveTimestamp: number;
  moveCountInWindow: number;
  windowStart: number;
  scrollCountInWindow: number;
  scrollWindowStart: number;
  lastClickTimestamp: number;
}

const screenSize = robot.getScreenSize();
robot.setMouseDelay(0);
robot.setKeyboardDelay(0);

function clampToScreen(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.min(Math.max(x, 0), screenSize.width - 1),
    y: Math.min(Math.max(y, 0), screenSize.height - 1),
  };
}

function isRateLimited(state: ClientState, now: number): boolean {
  const windowMs = 1000;
  if (now - state.windowStart >= windowMs) {
    state.windowStart = now;
    state.moveCountInWindow = 0;
  }
  state.moveCountInWindow += 1;
  return state.moveCountInWindow > MAX_MOVES_PER_SECOND;
}

function isScrollRateLimited(state: ClientState, now: number): boolean {
  const windowMs = 1000;
  if (now - state.scrollWindowStart >= windowMs) {
    state.scrollWindowStart = now;
    state.scrollCountInWindow = 0;
  }
  state.scrollCountInWindow += 1;
  return state.scrollCountInWindow > MAX_SCROLLS_PER_SECOND;
}

function handleMove(msg: Extract<InboundMessage, { action: "move" }>): void {
  const { x, y } = clampToScreen(msg.x, msg.y);
  robot.moveMouse(x, y);
}

function handleKeypress(msg: Extract<InboundMessage, { action: "keypress" }>): void {
  if (msg.key === "enter") {
    robot.keyTap("enter");
  }
}

function handleClick(msg: Extract<InboundMessage, { action: "click" }>): void {
  robot.mouseClick(msg.button);
}

function handleScroll(msg: Extract<InboundMessage, { action: "scroll" }>): void {
  // robotjs scrolls by (x, y) pixels; sign conventions vary a bit by OS, so
  // if "up"/"down" feel swapped on your machine, just flip the ternary below.
  const dy = msg.direction === "up" ? -msg.amount : msg.amount;
  robot.scrollMouse(0, dy);
}

function parseMessage(raw: RawData): InboundMessage | null {
  let json: unknown;
  try {
    json = JSON.parse(raw.toString());
  } catch {
    return null;
  }
  const parsed = messageSchema.safeParse(json);
  return parsed.success ? parsed.data : null;
}

function main(): void {
  const wss = new WebSocketServer({ host: HOST, port: PORT });

  console.log(`[local-bridge] listening on ws://${HOST}:${PORT}`);
  console.log(`[local-bridge] detected screen size: ${screenSize.width}x${screenSize.height}`);

  wss.on("connection", (socket: WebSocket, request) => {
    const remote = request.socket.remoteAddress ?? "unknown";
    if (remote !== "127.0.0.1" && remote !== "::1" && remote !== "::ffff:127.0.0.1") {
      console.warn(`[local-bridge] rejected non-local connection from ${remote}`);
      socket.close(1008, "LOCAL_ONLY");
      return;
    }

    console.log("[local-bridge] client connected");

    const state: ClientState = {
      lastMoveTimestamp: 0,
      moveCountInWindow: 0,
      windowStart: Date.now(),
      scrollCountInWindow: 0,
      scrollWindowStart: Date.now(),
      lastClickTimestamp: 0,
    };

    socket.on("message", (raw: RawData) => {
      const message = parseMessage(raw);
      if (!message) {
        socket.send(JSON.stringify({ error: "INVALID_MESSAGE" }));
        return;
      }

      const now = Date.now();

      try {
        if (message.action === "move") {
          if (isRateLimited(state, now)) {
            return;
          }
          state.lastMoveTimestamp = now;
          handleMove(message);
        } else if (message.action === "keypress") {
          handleKeypress(message);
        } else if (message.action === "click") {
          if (now - state.lastClickTimestamp < MIN_CLICK_INTERVAL_MS) {
            return;
          }
          state.lastClickTimestamp = now;
          handleClick(message);
        } else if (message.action === "scroll") {
          if (isScrollRateLimited(state, now)) {
            return;
          }
          handleScroll(message);
        }
      } catch (err) {
        console.error("[local-bridge] robotjs call failed", err);
        socket.send(JSON.stringify({ error: "OS_ACTION_FAILED" }));
      }
    });

    socket.on("close", () => {
      console.log("[local-bridge] client disconnected");
    });

    socket.on("error", (err) => {
      console.error("[local-bridge] socket error", err);
    });

    socket.send(
      JSON.stringify({
        type: "hello",
        screen: screenSize,
        maxMovesPerSecond: MAX_MOVES_PER_SECOND,
      })
    );
  });

  wss.on("error", (err) => {
    console.error("[local-bridge] server error", err);
  });

  process.on("SIGINT", () => {
    console.log("\n[local-bridge] shutting down");
    wss.close(() => process.exit(0));
  });
}

main();
