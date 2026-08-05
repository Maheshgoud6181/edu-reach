import { useEffect, useRef, useState } from "react";
import Vapi from "@vapi-ai/web";
import { X, Phone, CheckCircle, AlertCircle, Loader2, Mic, MicOff, Square, Volume2 } from "lucide-react";
import toast from "react-hot-toast";
import { useAuth } from "../context/AuthContext";
import { initiateCall } from "../services/vapi.service";
import { vapiFormContent } from "../data/content";

interface CallPopupProps {
  open: boolean;
  onClose: () => void;
}

type CallStatus = "form" | "calling" | "done" | "error";
type BrowserVoiceStatus = "idle" | "starting" | "connected" | "error";
type TranscriptRole = "assistant" | "user";
type TranscriptStatus = "partial" | "final";

interface TranscriptEntry {
  id: string;
  role: TranscriptRole;
  text: string;
  status: TranscriptStatus;
}

interface TranscriptSnapshot {
  text: string;
  transcriptType: TranscriptStatus;
}

const VAPI_PUBLIC_KEY = import.meta.env.VITE_VAPI_PUBLIC_KEY as string | undefined;
const VAPI_ASSISTANT_ID = import.meta.env.VITE_VAPI_ASSISTANT_ID as string | undefined;

export default function CallPopup({ open, onClose }: CallPopupProps) {
  const { user } = useAuth();
  const vapiRef = useRef<Vapi | null>(null);
  const timerRef = useRef<number | null>(null);
  const connectedAtRef = useRef<number | null>(null);
  const liveTranscriptIdsRef = useRef<Record<TranscriptRole, string | null>>({ assistant: null, user: null });
  const transcriptCountersRef = useRef<Record<TranscriptRole, number>>({ assistant: 0, user: 0 });
  const lastTranscriptSnapshotRef = useRef<Record<TranscriptRole, TranscriptSnapshot | null>>({ assistant: null, user: null });
  const [phone, setPhone] = useState("");
  const [course, setCourse] = useState("");
  const [topic, setTopic] = useState("");
  const [status, setStatus] = useState<CallStatus>("form");
  const [errorMessage, setErrorMessage] = useState("Something went wrong. Please try again.");
  const [browserStatus, setBrowserStatus] = useState<BrowserVoiceStatus>("idle");
  const [browserErrorMessage, setBrowserErrorMessage] = useState("Something went wrong. Please try again.");
  const [isAssistantSpeaking, setIsAssistantSpeaking] = useState(false);
  const [browserSeconds, setBrowserSeconds] = useState(0);
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
      }

      void vapiRef.current?.stop();
      vapiRef.current = null;
    };
  }, []);

  const stopBrowserTimer = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const resetBrowserSession = () => {
    stopBrowserTimer();
    connectedAtRef.current = null;
    liveTranscriptIdsRef.current = { assistant: null, user: null };
    transcriptCountersRef.current = { assistant: 0, user: 0 };
    lastTranscriptSnapshotRef.current = { assistant: null, user: null };
    setBrowserStatus("idle");
    setBrowserErrorMessage("Something went wrong. Please try again.");
    setIsAssistantSpeaking(false);
    setBrowserSeconds(0);
    setTranscript([]);
  };

  const startBrowserTimer = () => {
    stopBrowserTimer();
    connectedAtRef.current = Date.now();
    setBrowserSeconds(0);

    timerRef.current = window.setInterval(() => {
      if (!connectedAtRef.current) return;
      setBrowserSeconds(Math.floor((Date.now() - connectedAtRef.current) / 1000));
    }, 1000);
  };

  const formatDuration = (totalSeconds: number) => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  const nextTranscriptId = (role: TranscriptRole) => {
    transcriptCountersRef.current[role] += 1;
    return `${role}-${transcriptCountersRef.current[role]}`;
  };

  const applyTranscriptEvent = (message: {
    role?: string;
    transcript?: string;
    transcriptType?: string;
  }) => {
    const role = message.role;
    const transcript = message.transcript?.trim();
    const transcriptType = message.transcriptType;

    if ((role !== "assistant" && role !== "user") || !transcript || (transcriptType !== "partial" && transcriptType !== "final")) {
      return;
    }

    const typedRole = role as TranscriptRole;
    const typedTranscriptType = transcriptType as TranscriptStatus;
    const lastSnapshot = lastTranscriptSnapshotRef.current[typedRole];

    if (lastSnapshot?.text === transcript && lastSnapshot.transcriptType === typedTranscriptType) {
      return;
    }

    lastTranscriptSnapshotRef.current[typedRole] = {
      text: transcript,
      transcriptType: typedTranscriptType,
    };

    const activeTranscriptId = liveTranscriptIdsRef.current[typedRole];

    if (typedTranscriptType === "partial") {
      if (activeTranscriptId) {
        setTranscript((current) =>
          current.map((entry) => (entry.id === activeTranscriptId ? { ...entry, text: transcript } : entry)),
        );
        return;
      }

      const newTranscriptId = nextTranscriptId(typedRole);
      liveTranscriptIdsRef.current[typedRole] = newTranscriptId;
      setTranscript((current) => [
        ...current,
        {
          id: newTranscriptId,
          role: typedRole,
          text: transcript,
          status: "partial",
        },
      ]);
      return;
    }

    if (activeTranscriptId) {
      setTranscript((current) =>
        current.map((entry) =>
          entry.id === activeTranscriptId ? { ...entry, text: transcript, status: "final" } : entry,
        ),
      );
      liveTranscriptIdsRef.current[typedRole] = null;
      return;
    }

    setTranscript((current) => {
      const currentLastEntry = current[current.length - 1];

      if (currentLastEntry && currentLastEntry.role === typedRole && currentLastEntry.text === transcript && currentLastEntry.status === "final") {
        return current;
      }

      return [
        ...current,
        {
          id: nextTranscriptId(typedRole),
          role: typedRole,
          text: transcript,
          status: "final",
        },
      ];
    });
  };

  const ensureBrowserClient = () => {
    if (!VAPI_PUBLIC_KEY || !VAPI_ASSISTANT_ID) {
      throw new Error("Set VITE_VAPI_PUBLIC_KEY and VITE_VAPI_ASSISTANT_ID in the client environment.");
    }

    if (!vapiRef.current) {
      const vapi = new Vapi(VAPI_PUBLIC_KEY);

      vapi.on("call-start", () => {
        setBrowserStatus("connected");
        setIsAssistantSpeaking(false);
        startBrowserTimer();
      });

      vapi.on("call-end", () => {
        stopBrowserTimer();
        setBrowserStatus("idle");
        setIsAssistantSpeaking(false);
        setBrowserSeconds(0);
      });

      vapi.on("speech-start", () => {
        setIsAssistantSpeaking(true);
      });

      vapi.on("speech-end", () => {
        setIsAssistantSpeaking(false);
      });

      vapi.on("message", (message) => {
        if (message?.type !== "transcript") return;

        applyTranscriptEvent(message);
      });

      vapi.on("error", (error) => {
        const message = error instanceof Error ? error.message : "Browser voice failed. Please try again.";
        setBrowserErrorMessage(message);
        setBrowserStatus("error");
        setIsAssistantSpeaking(false);
        stopBrowserTimer();
        toast.error(message);
      });

      vapiRef.current = vapi;
    }

    return vapiRef.current;
  };

  const handleStartBrowserVoice = async () => {
    if (!course || !topic) {
      toast.error("Please choose a course and topic first.");
      return;
    }

    try {
      setBrowserErrorMessage("Something went wrong. Please try again.");
      setBrowserStatus("starting");

      const vapi = ensureBrowserClient();
      await vapi.start(VAPI_ASSISTANT_ID as string, {
        variableValues: {
          userName: user?.name || "Guest",
          userEmail: user?.email || "",
          course,
          topic,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Browser voice failed. Please try again.";
      setBrowserErrorMessage(message);
      setBrowserStatus("error");
      setIsAssistantSpeaking(false);
      stopBrowserTimer();
      toast.error(message);
    }
  };

  const handleStopBrowserVoice = async () => {
    try {
      await vapiRef.current?.stop();
    } finally {
      resetBrowserSession();
    }
  };

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    const digitsOnlyPhone = phone.replace(/\D/g, "");

    if (!phone || !course || !topic) {
      toast.error("Please fill in all fields");
      return;
    }

    if (digitsOnlyPhone.length < 10) {
      toast.error("Please enter a valid phone number.");
      return;
    }

    setStatus("calling");
    try {
      await initiateCall({ phone, course, topic });
      setStatus("done");
      toast.success("Call initiated!");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Something went wrong. Please try again.";
      setErrorMessage(message);
      setStatus("error");
      toast.error(message);
    }
  };

  const reset = () => {
    setStatus("form");
    setErrorMessage("Something went wrong. Please try again.");
    setPhone("");
    setCourse("");
    setTopic("");
  };

  const handleClose = () => {
    void vapiRef.current?.stop();
    resetBrowserSession();
    reset();
    onClose();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 px-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto relative">
        {/* Close */}
        <button onClick={handleClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 transition-colors duration-200 z-10">
          <X className="w-5 h-5" />
        </button>

        {/* Header */}
        <div className="bg-maroon rounded-t-2xl px-6 py-5">
          <h3 className="font-heading text-xl font-bold text-white">Talk to Our AI Counselor</h3>
          <p className="text-white/70 text-sm mt-1">Get personalized guidance on courses, admissions & more</p>
        </div>

        <div className="p-6">
          {status === "form" && (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Your Name</label>
                <input type="text" value={user?.name || ""} readOnly
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-lg bg-gray-50 text-gray-600 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number *</label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91-9876543210"
                    className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:border-maroon focus:ring-1 focus:ring-maroon text-sm transition-colors duration-200" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Interested Course *</label>
                <select value={course} onChange={(e) => setCourse(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:border-maroon focus:ring-1 focus:ring-maroon text-sm transition-colors duration-200">
                  <option value="">Select a course</option>
                  {vapiFormContent.courses.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">What do you want to know? *</label>
                <select value={topic} onChange={(e) => setTopic(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:border-maroon focus:ring-1 focus:ring-maroon text-sm transition-colors duration-200">
                  <option value="">Select a topic</option>
                  {vapiFormContent.topics.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <button
                  type="submit"
                  className="w-full bg-maroon text-white py-3 rounded-lg font-semibold hover:bg-maroon-dark transition-colors duration-200"
                >
                  Call Me Now
                </button>
                <button
                  type="button"
                  onClick={handleStartBrowserVoice}
                  className="w-full inline-flex items-center justify-center gap-2 border border-maroon/20 bg-maroon/5 text-maroon py-3 rounded-lg font-semibold hover:bg-maroon/10 transition-colors duration-200"
                >
                  <Mic className="w-4 h-4" />
                  Talk to AI (Browser)
                </button>
              </div>
            </form>
          )}

          {browserStatus === "starting" && (
            <div className="text-center py-10 space-y-3">
              <Loader2 className="w-10 h-10 text-maroon mx-auto animate-spin" />
              <h3 className="font-heading text-lg font-bold text-gray-900">Starting browser voice...</h3>
              <p className="text-gray-500 text-sm">Requesting microphone access and connecting Ava.</p>
            </div>
          )}

          {browserStatus === "connected" && (
            <div className="space-y-4 py-1">
              <div className="flex items-center justify-between gap-3 rounded-2xl border border-maroon/10 bg-maroon/5 px-4 py-3">
                <div className="flex items-center gap-3">
                  <div className={`flex h-11 w-11 items-center justify-center rounded-full ${isAssistantSpeaking ? "bg-maroon text-white" : "bg-white text-maroon"} shadow-sm`}>
                    {isAssistantSpeaking ? <Volume2 className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-gray-900">Browser voice active</p>
                    <p className="text-xs text-gray-500">{isAssistantSpeaking ? "Ava is speaking" : "Listening for your voice"}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs uppercase tracking-wide text-gray-400">Timer</p>
                  <p className="font-mono text-sm font-semibold text-gray-900">{formatDuration(browserSeconds)}</p>
                </div>
              </div>

              <div className="max-h-56 overflow-y-auto rounded-2xl border border-gray-100 bg-gray-50 p-4">
                {transcript.length === 0 ? (
                  <p className="text-sm text-gray-500">Your conversation will appear here.</p>
                ) : (
                  <div className="space-y-3">
                    {transcript.map((entry) => (
                      <div key={entry.id} className={entry.role === "user" ? "text-right" : "text-left"}>
                        <span className={`inline-block max-w-[85%] rounded-2xl px-3 py-2 text-sm ${entry.role === "user" ? "bg-maroon text-white" : "bg-white text-gray-800 shadow-sm"}`}>
                          {entry.text}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={handleStopBrowserVoice}
                className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-3 text-sm font-semibold text-white hover:bg-gray-800 transition-colors duration-200"
              >
                <Square className="h-4 w-4" />
                End Conversation
              </button>
            </div>
          )}

          {browserStatus === "error" && (
            <div className="text-center py-10 space-y-4">
              <AlertCircle className="w-10 h-10 text-red-500 mx-auto" />
              <h3 className="font-heading text-lg font-bold text-gray-900">Browser voice failed</h3>
              <p className="text-gray-500 text-sm">{browserErrorMessage}</p>
              <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
                <button
                  type="button"
                  onClick={handleStartBrowserVoice}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-maroon px-5 py-2 text-sm font-semibold text-white hover:bg-maroon-dark transition-colors duration-200"
                >
                  <Mic className="h-4 w-4" />
                  Try Browser Voice Again
                </button>
                <button
                  type="button"
                  onClick={resetBrowserSession}
                  className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 px-5 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors duration-200"
                >
                  <MicOff className="h-4 w-4" />
                  Back to Form
                </button>
              </div>
            </div>
          )}

          {status === "calling" && (
            <div className="text-center py-10">
              <Loader2 className="w-10 h-10 text-maroon mx-auto animate-spin mb-3" />
              <h3 className="font-heading text-lg font-bold text-gray-900 mb-1">Calling you now...</h3>
              <p className="text-gray-500 text-sm">Our AI counselor Ava is dialing {phone}</p>
            </div>
          )}

          {status === "done" && (
            <div className="text-center py-10">
              <CheckCircle className="w-10 h-10 text-green-500 mx-auto mb-3" />
              <h3 className="font-heading text-lg font-bold text-gray-900 mb-1">Call Initiated!</h3>
              <p className="text-gray-500 text-sm mb-4">You'll receive a call shortly on {phone}.</p>
              <button onClick={reset} className="text-maroon font-medium text-sm hover:underline">Request Another Call</button>
            </div>
          )}

          {status === "error" && (
            <div className="text-center py-10">
              <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-3" />
              <h3 className="font-heading text-lg font-bold text-gray-900 mb-1">Call Failed</h3>
              <p className="text-gray-500 text-sm mb-4">{errorMessage}</p>
              <button onClick={reset} className="bg-maroon text-white px-5 py-2 rounded-lg text-sm hover:bg-maroon-dark transition-colors duration-200">Try Again</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}