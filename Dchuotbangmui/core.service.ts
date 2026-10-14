// backend/src/services/core.service.ts
// Core Logic Service — CRUD for per-user personalization config
// (mouse sensitivity, dead zone, 1€ filter tuning, EAR/wink parameters)

import express, { Router, Request, Response, NextFunction } from "express";
import { PrismaClient, Prisma } from "@prisma/client";
import jwt from "jsonwebtoken";
import { z, ZodError } from "zod";

const prisma = new PrismaClient();
const router: Router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required for core.service");
}

interface AuthenticatedRequest extends Request {
  userId?: string;
}

function authenticate(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ error: "MISSING_TOKEN" });
    return;
  }
  const token = header.slice("Bearer ".length);
  try {
    const payload = jwt.verify(token, JWT_SECRET as string) as { sub: string };
    req.userId = payload.sub;
    next();
  } catch {
    res.status(401).json({ error: "INVALID_TOKEN" });
  }
}

const configUpsertSchema = z.object({
  mouseSensitivity: z.number().min(0.1).max(10).optional(),
  deadZoneRadius: z.number().min(0).max(0.5).optional(),
  invertX: z.boolean().optional(),
  invertY: z.boolean().optional(),
  oneEuroMinCutoff: z.number().min(0.01).max(10).optional(),
  oneEuroBeta: z.number().min(0).max(5).optional(),
  oneEuroDCutoff: z.number().min(0.01).max(10).optional(),
  earCalibrationSec: z.number().int().min(1).max(10).optional(),
  earThresholdRatio: z.number().min(0.3).max(0.95).optional(),
  winkDebounceMs: z.number().int().min(50).max(2000).optional(),
  activeModelId: z.string().cuid().nullable().optional(),
});

const DEFAULT_CONFIG = {
  mouseSensitivity: 1.0,
  deadZoneRadius: 0.02,
  invertX: false,
  invertY: false,
  oneEuroMinCutoff: 1.0,
  oneEuroBeta: 0.007,
  oneEuroDCutoff: 1.0,
  earCalibrationSec: 3,
  earThresholdRatio: 0.75,
  winkDebounceMs: 300,
};

// GET /api/config — fetch current user's config, creating defaults if absent
router.get("/config", authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId as string;
    const config = await prisma.userConfig.upsert({
      where: { userId },
      update: {},
      create: { userId, ...DEFAULT_CONFIG },
      include: { activeModel: true },
    });
    res.status(200).json({ data: config });
  } catch (err) {
    console.error("[core.service] GET /config failed", err);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

// PATCH /api/config — partial update of personalization parameters
router.patch("/config", authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId as string;
    const parsed = configUpsertSchema.parse(req.body);

    if (parsed.activeModelId) {
      const model = await prisma.aIModel.findUnique({ where: { id: parsed.activeModelId } });
      if (!model || model.status !== "ACTIVE") {
        res.status(400).json({ error: "MODEL_NOT_AVAILABLE" });
        return;
      }
    }

    const updated = await prisma.userConfig.upsert({
      where: { userId },
      update: parsed,
      create: { userId, ...DEFAULT_CONFIG, ...parsed },
      include: { activeModel: true },
    });

    res.status(200).json({ data: updated });
  } catch (err) {
    if (err instanceof ZodError) {
      res.status(422).json({ error: "VALIDATION_ERROR", details: err.flatten() });
      return;
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      res.status(409).json({ error: "DB_CONFLICT", code: err.code });
      return;
    }
    console.error("[core.service] PATCH /config failed", err);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

// POST /api/config/reset — restore defaults
router.post("/config/reset", authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId as string;
    const reset = await prisma.userConfig.upsert({
      where: { userId },
      update: { ...DEFAULT_CONFIG, activeModelId: null },
      create: { userId, ...DEFAULT_CONFIG },
      include: { activeModel: true },
    });
    res.status(200).json({ data: reset });
  } catch (err) {
    console.error("[core.service] POST /config/reset failed", err);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

// DELETE /api/config — remove personalization record (falls back to defaults on next GET)
router.delete("/config", authenticate, async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.userId as string;
    await prisma.userConfig.deleteMany({ where: { userId } });
    res.status(204).send();
  } catch (err) {
    console.error("[core.service] DELETE /config failed", err);
    res.status(500).json({ error: "INTERNAL_ERROR" });
  }
});

export default router;
