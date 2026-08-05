import type { Request, Response, NextFunction } from "express";

const errorHandler = (err: Error, _req: Request, res: Response, _next: NextFunction): void => {
  console.error("Unhandled error:", err.message);
  console.error(err.stack);
  res.status(500).json({
    success: false,
    message: err.message || "Internal server error.",
    error: err.message || "Internal server error.",
  });
};

export default errorHandler;