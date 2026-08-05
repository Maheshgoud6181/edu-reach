import axios from "axios";
import API from "./api";

// Backend expects: { phoneNumber, preferredCourse }
// Route is protected: POST /api/vapi/call (requires auth token - handled by api.ts interceptor)
export const initiateCall = async (data: { phone: string; course: string; topic: string }) => {
  try {
    const res = await API.post("/vapi/call", {
      phoneNumber: data.phone,
      preferredCourse: `${data.course} - ${data.topic}`,
    });
    return res.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      throw new Error(error.response?.data?.message || error.response?.data?.error || error.message || "Failed to initiate call.");
    }

    throw new Error(error instanceof Error ? error.message : "Failed to initiate call.");
  }
};