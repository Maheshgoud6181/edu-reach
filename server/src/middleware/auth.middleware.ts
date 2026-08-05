import type { Request, Response, NextFunction } from "express";
import { verifyToken } from "../utils/jwt.util.ts";
import type { JWTPayload } from "../utils/jwt.util.ts";

declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload;
    }
  }
}

const authMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  try {
    console.log("[auth] Incoming request:", req.method, req.originalUrl);
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.warn("[auth] Missing or invalid Authorization header");
      res.status(401).json({ success: false, message: "Access denied. No token provided." });
      return;
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
      res.status(401).json({ success: false, message: "Access denied. Token is empty." });
      return;
    }

    const decoded = verifyToken(token);
    console.log("[auth] Authenticated user:", { userId: decoded.userId, email: decoded.email });
    req.user = decoded;
    next();
  } catch (error) {
    console.error("[auth] Authentication failed:", error);
    if (error instanceof Error) {
      if (error.name === "TokenExpiredError") {
        res.status(401).json({ success: false, message: "Token has expired. Please log in again." });
        return;
      }
      if (error.name === "JsonWebTokenError") {
        res.status(401).json({ success: false, message: "Invalid token. Please log in again." });
        return;
      }
    }
    res.status(500).json({ success: false, message: "Authentication failed.", error: error instanceof Error ? error.message : "Authentication failed." });
  }
};

export default authMiddleware;