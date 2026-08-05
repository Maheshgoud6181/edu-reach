

import type { Request, Response, NextFunction } from "express";
import User from "../models/user.model.ts";
import { initiateOutboundCall } from  "../services/vapi.servise.ts";

// POST /api/vapi/call
export const startCall = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    console.log("[vapi] Incoming request:", req.method, req.originalUrl);
    console.log("[vapi] Request body:", req.body);

    const { phoneNumber, preferredCourse } = req.body;

    const currentUser = req.user;

    if (!currentUser?.userId || !currentUser.email) {
      console.warn("[vapi] Missing authenticated user information", currentUser);
      res.status(401).json({ success: false, message: "Not authenticated.", error: "Missing authenticated user information." });
      return;
    }

    if (!phoneNumber || phoneNumber.trim().length < 10) {
      res.status(400).json({ success: false, message: "Valid phone number is required.", error: "Phone number must contain at least 10 digits." });
      return;
    }

    if (!preferredCourse || !preferredCourse.trim()) {
      res.status(400).json({ success: false, message: "Preferred course is required.", error: "preferredCourse cannot be empty." });
      return;
    }

    const user = await User.findById(currentUser.userId).select("name email");
    console.log("[vapi] Loaded user from database:", { id: user?._id, name: user?.name, email: user?.email });

    if (!user) {
      res.status(404).json({ success: false, message: "User not found." });
      return;
    }

    console.log("[vapi] Calling Vapi service with user and request data");
    const result = await initiateOutboundCall({
      phoneNumber: phoneNumber.trim(),
      userName: user.name,
      userEmail: currentUser.email,
      preferredCourse: preferredCourse.trim(),
    });

    console.log("[vapi] Vapi service response:", result);

    res.status(200).json({
      success: true,
      message: "Call initiated. You will receive a call shortly.",
      data: { callId: result.id, status: result.status },
    });
  } catch (error) {
    console.error("[vapi] Error while initiating call:", error);
    if (error instanceof Error) {
      res.status(500).json({ success: false, message: "Failed to initiate call.", error: error.message });
      return;
    }
    next(error);
  }
};