import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { signToken, verifyToken } from "../src/auth/jwt.js";

const SECRET = "test-secret-with-enough-length";

describe("jwt", () => {
  it("round-trips a patient identity", async () => {
    const token = await signToken(SECRET, {
      subject: "patient:P-1001",
      role: "patient",
      patientId: "P-1001",
    });

    expect(await verifyToken(SECRET, token)).toEqual({
      subject: "patient:P-1001",
      role: "patient",
      patientId: "P-1001",
    });
  });

  it("round-trips a nurse identity", async () => {
    const token = await signToken(SECRET, { subject: "nurse:demo", role: "nurse" });

    expect(await verifyToken(SECRET, token)).toEqual({ subject: "nurse:demo", role: "nurse" });
  });

  it("rejects a token signed with another secret", async () => {
    const token = await signToken("another-secret-with-length", {
      subject: "nurse:demo",
      role: "nurse",
    });

    expect(await verifyToken(SECRET, token)).toBeNull();
  });

  it("rejects garbage and the none algorithm", async () => {
    expect(await verifyToken(SECRET, "not-a-token")).toBeNull();
    const unsigned = `${Buffer.from('{"alg":"none"}').toString("base64url")}.${Buffer.from(
      '{"sub":"x","role":"nurse","iss":"auratriage-demo"}',
    ).toString("base64url")}.`;
    expect(await verifyToken(SECRET, unsigned)).toBeNull();
  });

  it("rejects an expired token", async () => {
    const expired = await new SignJWT({ role: "nurse" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("nurse:demo")
      .setIssuer("auratriage-demo")
      .setIssuedAt(1)
      .setExpirationTime(2)
      .sign(new TextEncoder().encode(SECRET));

    expect(await verifyToken(SECRET, expired)).toBeNull();
  });

  it("rejects a patient token with no patient ID", async () => {
    const token = await new SignJWT({ role: "patient" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("patient:x")
      .setIssuer("auratriage-demo")
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(SECRET));

    expect(await verifyToken(SECRET, token)).toBeNull();
  });

  it("rejects the wrong issuer", async () => {
    const token = await new SignJWT({ role: "nurse" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("nurse:demo")
      .setIssuer("someone-else")
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(SECRET));

    expect(await verifyToken(SECRET, token)).toBeNull();
  });
});
