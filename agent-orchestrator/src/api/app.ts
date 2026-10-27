import { randomUUID } from "node:crypto";
import express, {
  type ErrorRequestHandler,
  type Express,
  type RequestHandler,
  type Response,
} from "express";
import { ZodError, z } from "zod";
import { type AuthContext, signToken, verifyToken } from "../auth/jwt.js";
import type { ChatService } from "../chat/service.js";
import type { Config } from "../config.js";
import {
  type ApiError,
  ChatRequestSchema,
  DemoLoginRequestSchema,
  type DemoLoginResponse,
  EscalationStatusSchema,
  NurseResolutionSchema,
  PATIENT_ID_PATTERN,
  type Role,
  RoleSchema,
} from "../contracts.js";
import { ApiHttpError, forbidden, notFound, unauthorized, validationError } from "../errors.js";
import type { Logger } from "../logger.js";

export interface AppDeps {
  config: Pick<Config, "jwtSecret" | "demoLoginEnabled" | "demoPatientIds">;
  chat: ChatService;
  logger: Logger;
}

const AuthLocalsSchema = z.object({
  subject: z.string(),
  role: RoleSchema,
  patientId: z.string().regex(PATIENT_ID_PATTERN).optional(),
});

const ThreadIdSchema = z.uuid();
const StatusQuerySchema = z.object({ status: EscalationStatusSchema.optional() });
const HttpErrorShapeSchema = z.object({ status: z.number(), type: z.string().optional() });

function authOf(res: Response): AuthContext {
  const parsed = AuthLocalsSchema.safeParse(res.locals.auth);
  if (!parsed.success) {
    throw unauthorized();
  }
  return parsed.data;
}

function patientIdOf(res: Response): string {
  const { patientId } = authOf(res);
  if (patientId === undefined) {
    throw forbidden();
  }
  return patientId;
}

function threadIdParam(value: unknown): string {
  const parsed = ThreadIdSchema.safeParse(value);
  if (!parsed.success) {
    throw notFound("Resource");
  }
  return parsed.data;
}

/** Messages are fixed text. They never repeat anything the caller sent. */
function toApiError(error: unknown): { status: number; body: ApiError } {
  if (error instanceof ApiHttpError) {
    return { status: error.status, body: { error: { code: error.code, message: error.message } } };
  }
  if (error instanceof ZodError) {
    const fields = [
      ...new Set(error.issues.map((issue) => issue.path.join(".")).filter((path) => path !== "")),
    ];
    const detail = fields.length > 0 ? `: ${fields.join(", ")}` : "";
    return {
      status: 400,
      body: { error: { code: "validation_error", message: `Invalid request${detail}.` } },
    };
  }
  const http = HttpErrorShapeSchema.safeParse(error);
  if (http.success && http.data.status >= 400 && http.data.status < 500) {
    return {
      status: 400,
      body: { error: { code: "validation_error", message: "The request body could not be read." } },
    };
  }
  return {
    status: 500,
    body: { error: { code: "internal", message: "Something went wrong on our side." } },
  };
}

export function createApp(deps: AppDeps): Express {
  const { config, chat, logger } = deps;
  const app = express();
  app.disable("x-powered-by");

  // One line per request: route template, status and timing. Never the body, query or headers.
  app.use((req, res, next) => {
    const requestId = randomUUID();
    const started = performance.now();
    res.setHeader("X-Request-Id", requestId);
    res.setHeader("Cache-Control", "no-store");
    res.on("finish", () => {
      logger.info(
        {
          event: "http_request",
          requestId,
          method: req.method,
          route: typeof req.route?.path === "string" ? req.route.path : "unmatched",
          status: res.statusCode,
          durationMs: Math.round(performance.now() - started),
        },
        "request",
      );
    });
    next();
  });

  app.use(express.json({ limit: "16kb" }));

  const authenticate: RequestHandler = async (req, res, next) => {
    const match = /^Bearer (.+)$/.exec(req.header("authorization") ?? "");
    const auth = match?.[1] === undefined ? null : await verifyToken(config.jwtSecret, match[1]);
    if (auth === null) {
      throw unauthorized();
    }
    res.locals.auth = auth;
    next();
  };

  const requireRole =
    (role: Role): RequestHandler =>
    (_req, res, next) => {
      if (authOf(res).role !== role) {
        throw forbidden();
      }
      next();
    };

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.post("/api/auth/demo-login", async (req, res) => {
    if (!config.demoLoginEnabled) {
      throw notFound("Resource");
    }
    const body = DemoLoginRequestSchema.parse(req.body);
    if (body.role === "patient" && !config.demoPatientIds.includes(body.patientId ?? "")) {
      throw validationError("Unknown demo patient.");
    }
    const auth: AuthContext =
      body.role === "patient" && body.patientId !== undefined
        ? { subject: `patient:${body.patientId}`, role: "patient", patientId: body.patientId }
        : { subject: "nurse:demo", role: "nurse" };
    const response: DemoLoginResponse = {
      token: await signToken(config.jwtSecret, auth),
      role: auth.role,
      ...(auth.patientId === undefined ? {} : { patientId: auth.patientId }),
    };
    res.json(response);
  });

  // --- patient

  app.post("/api/chat", authenticate, requireRole("patient"), async (req, res) => {
    const request = ChatRequestSchema.parse(req.body);
    res.json(await chat.sendMessage(patientIdOf(res), request));
  });

  app.get("/api/chat/:threadId", authenticate, requireRole("patient"), async (req, res) => {
    res.json(await chat.getThread(patientIdOf(res), threadIdParam(req.params.threadId)));
  });

  // --- nurse

  app.get("/api/nurse/escalations", authenticate, requireRole("nurse"), (req, res) => {
    const { status } = StatusQuerySchema.parse(req.query);
    res.json(chat.listEscalations(status));
  });

  app.get(
    "/api/nurse/escalations/:threadId",
    authenticate,
    requireRole("nurse"),
    async (req, res) => {
      res.json(await chat.getEscalation(threadIdParam(req.params.threadId)));
    },
  );

  app.post(
    "/api/nurse/escalations/:threadId/resolve",
    authenticate,
    requireRole("nurse"),
    async (req, res) => {
      const resolution = NurseResolutionSchema.parse(req.body);
      res.json(await chat.resolve(threadIdParam(req.params.threadId), resolution));
    },
  );

  app.use((_req, _res, next) => {
    next(notFound("Resource"));
  });

  const onError: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
    const { status, body } = toApiError(error);
    if (status >= 500) {
      // Name only: messages from models and tools could contain patient text.
      logger.error(
        { event: "request_failed", errorName: error instanceof Error ? error.name : "unknown" },
        "request failed",
      );
    }
    res.status(status).json(body);
  };
  app.use(onError);

  return app;
}
