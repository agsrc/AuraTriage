import { jwtVerify, SignJWT } from "jose";
import { z } from "zod";
import { PATIENT_ID_PATTERN, type Role, RoleSchema } from "../contracts.js";

const ISSUER = "auratriage-demo";
const TOKEN_LIFETIME = "8h";

export interface AuthContext {
  subject: string;
  role: Role;
  /** Present for patients only. */
  patientId?: string;
}

const ClaimsSchema = z.object({
  sub: z.string().min(1),
  role: RoleSchema,
  patientId: z.string().regex(PATIENT_ID_PATTERN).optional(),
});

export async function signToken(secret: string, auth: AuthContext): Promise<string> {
  return new SignJWT({ role: auth.role, ...(auth.patientId ? { patientId: auth.patientId } : {}) })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(auth.subject)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(TOKEN_LIFETIME)
    .sign(new TextEncoder().encode(secret));
}

/** Returns the verified identity, or null for any invalid, expired or malformed token. */
export async function verifyToken(secret: string, token: string): Promise<AuthContext | null> {
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
      issuer: ISSUER,
      algorithms: ["HS256"],
    });
    const claims = ClaimsSchema.safeParse(payload);
    if (!claims.success) {
      return null;
    }
    const { sub, role, patientId } = claims.data;
    if (role === "patient" && patientId === undefined) {
      return null;
    }
    return { subject: sub, role, ...(patientId ? { patientId } : {}) };
  } catch {
    return null;
  }
}
