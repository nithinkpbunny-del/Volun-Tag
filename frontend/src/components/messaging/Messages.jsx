import React, { useState, useEffect, useRef, useCallback } from "react";
import "./Messages.css";

const API_BASE = "http://127.0.0.1:8000";

const BLOCKED_EXTENSIONS = [
  "exe", "bat", "cmd", "com", "msi", "scr", "sh",
  "app", "apk", "jar", "dmg", "pkg", "vbs", "ps1"
];

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

// ─── Utility Helpers ────────────────────────────────────────────────
function formatFileSize(bytes) {
  if (!bytes || bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatLocalTime(isoStr) {
  if (!isoStr) return "";
  try {
    const d = new Date(isoStr);
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

function isSameDay(d1, d2) {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

function formatDateSeparator(isoStr) {
  if (!isoStr) return "";
  try {
    const d = new Date(isoStr);
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);

    if (isSameDay(d, now)) return "Today";
    if (isSameDay(d, yesterday)) return "Yesterday";

    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined,
    });
  } catch {
    return "";
  }
}

function formatConvoTime(isoStr) {
  if (!isoStr) return "";
  try {
    const d = new Date(isoStr);
    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);

    if (isSameDay(d, now)) {
      return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }
    if (isSameDay(d, yesterday)) {
      return "Yesterday";
    }
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: d.getFullYear() !== now.getFullYear() ? "2-digit" : undefined,
    });
  } catch {
    return "";
  }
}

function getAvatarInitial(name, email) {
  const str = (name || email || "?").trim();
  return str.charAt(0).toUpperCase() || "?";
}

function getAvatarColor(nameOrEmail) {
  const str = (nameOrEmail || "").trim();
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = [
    { bg: "#e8f0ee", text: "#4a7c6f" }, // sage
    { bg: "#f5ede7", text: "#c4714a" }, // clay
    { bg: "#e6f0fa", text: "#3b7bb8" }, // blue
    { bg: "#f3e8f7", text: "#874da0" }, // purple
    { bg: "#fdf3e7", text: "#b37424" }, // amber
    { bg: "#e8f5e9", text: "#388e3c" }, // green
  ];
  const index = Math.abs(hash) % colors.length;
  return colors[index];
}

// ─── Inline SVG Icons ───────────────────────────────────────────────
function SingleTickIcon() {
  return (
    <svg className="msg-tick-icon" viewBox="0 0 16 15" width="14" height="13" fill="none" aria-label="Sent">
      <path d="M13.5 3.5L6.5 11.5L2.5 7.5" stroke="#8e9b97" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DoubleBlueTickIcon() {
  return (
    <svg className="msg-tick-icon msg-tick-read" viewBox="0 0 20 15" width="17" height="13" fill="none" aria-label="Read">
      <path d="M12.5 3.5L5.5 11.5L1.5 7.5" stroke="#34b7f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17.5 3.5L10.5 11.5L8.5 9.5" stroke="#34b7f1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function PaperclipIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function PhotoIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="8.5" cy="8.5" r="1.5" />
      <polyline points="21 15 16 10 5 21" />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="16" y1="13" x2="8" y2="13" />
      <line x1="16" y1="17" x2="8" y2="17" />
      <polyline points="10 9 9 9 8 9" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  );
}

function BackArrowIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

// ─── Main Messages Component ────────────────────────────────────────
export default function Messages({
  email,
  role = "volunteer",
  showToast,
  startWith,
  onUnreadChange,
}) {
  const [conversations, setConversations] = useState([]);
  const [loadingConvos, setLoadingConvos] = useState(true);
  const [activeConvo, setActiveConvo] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loadingThread, setLoadingThread] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [inputText, setInputText] = useState("");
  const [pendingFile, setPendingFile] = useState(null); // { file, type, previewUrl }
  const [isSending, setIsSending] = useState(false);
  const [attachMenuOpen, setAttachMenuOpen] = useState(false);

  // References for safety & live updates
  const isMountedRef = useRef(true);
  const isFetchingConvosRef = useRef(false);
  const isFetchingThreadRef = useRef(false);
  const activeConvoRef = useRef(activeConvo);
  activeConvoRef.current = activeConvo;

  const messagesContainerRef = useRef(null);
  const isNearBottomRef = useRef(true);
  const photoInputRef = useRef(null);
  const docInputRef = useRef(null);
  const textareaRef = useRef(null);
  const attachMenuRef = useRef(null);

  // Keep onUnreadChange in a ref to avoid effect recreation
  const onUnreadChangeRef = useRef(onUnreadChange);
  useEffect(() => {
    onUnreadChangeRef.current = onUnreadChange;
  }, [onUnreadChange]);

  // Toast wrapper to extract backend "detail"
  const notifyError = useCallback(
    async (res, fallbackMsg = "Operation failed") => {
      let detailMsg = fallbackMsg;
      try {
        const data = await res.json();
        if (data && data.detail) {
          if (typeof data.detail === "string") {
            detailMsg = data.detail;
          } else if (Array.isArray(data.detail) && data.detail[0]?.msg) {
            detailMsg = data.detail[0].msg;
          }
        }
      } catch {
        detailMsg = `${fallbackMsg} (${res.status})`;
      }
      if (showToast) {
        showToast(detailMsg, "error");
      }
      return detailMsg;
    },
    [showToast]
  );

  // ─── Mark Thread Messages As Read ────────────────────────────────
  const markMessagesAsRead = useCallback(
    async (otherEmail) => {
      if (!email || !otherEmail) return;
      try {
        await fetch(`${API_BASE}/messages/read`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reader_email: email.trim().lower ? email.trim().toLowerCase() : email.trim(),
            other_email: otherEmail.trim().toLowerCase(),
          }),
        });
      } catch (err) {
        console.error("Failed to mark messages as read:", err);
      }
    },
    [email]
  );

  // ─── Fetch Conversations ─────────────────────────────────────────
  const fetchConversations = useCallback(
    async (isBackground = false) => {
      if (!email || isFetchingConvosRef.current) return;
      isFetchingConvosRef.current = true;
      if (!isBackground) setLoadingConvos(true);

      try {
        const res = await fetch(
          `${API_BASE}/conversations/${encodeURIComponent(email.trim().toLowerCase())}`
        );
        if (!res.ok) {
          if (!isBackground) await notifyError(res, "Failed to load conversations");
          return;
        }

        const data = await res.json();
        if (!isMountedRef.current) return;

        setConversations(data || []);

        // Total unread calculation
        const totalUnread = (data || []).reduce(
          (sum, c) => sum + (c.unread_count || 0),
          0
        );
        if (onUnreadChangeRef.current) {
          onUnreadChangeRef.current(totalUnread);
        }
      } catch (err) {
        if (!isBackground && showToast) {
          showToast("Network error while loading conversations", "error");
        }
      } finally {
        isFetchingConvosRef.current = false;
        if (!isBackground && isMountedRef.current) {
          setLoadingConvos(false);
        }
      }
    },
    [email, notifyError, showToast]
  );

  // ─── Fetch Thread Messages ───────────────────────────────────────
  const fetchThread = useCallback(
    async (otherEmail, isBackground = false) => {
      if (!email || !otherEmail || isFetchingThreadRef.current) return;
      isFetchingThreadRef.current = true;
      if (!isBackground) setLoadingThread(true);

      try {
        const res = await fetch(
          `${API_BASE}/messages/${encodeURIComponent(
            email.trim().toLowerCase()
          )}/with/${encodeURIComponent(otherEmail.trim().toLowerCase())}`
        );

        if (!res.ok) {
          if (!isBackground) await notifyError(res, "Failed to load messages");
          return;
        }

        const data = await res.json();
        if (!isMountedRef.current) return;

        const newMessages = data || [];
        setMessages(newMessages);

        // Mark read if document is visible and there are unread incoming messages
        if (document.visibilityState === "visible") {
          const hasUnread = newMessages.some(
            (m) => !m.is_mine && m.read_at === null
          );
          if (hasUnread) {
            markMessagesAsRead(otherEmail);
          }
        }
      } catch (err) {
        if (!isBackground && showToast) {
          showToast("Network error while loading message thread", "error");
        }
      } finally {
        isFetchingThreadRef.current = false;
        if (!isBackground && isMountedRef.current) {
          setLoadingThread(false);
        }
      }
    },
    [email, markMessagesAsRead, notifyError, showToast]
  );

  // ─── Scroll Management ───────────────────────────────────────────
  const scrollToBottom = useCallback((smooth = false) => {
    if (!messagesContainerRef.current) return;
    const elem = messagesContainerRef.current;
    if (smooth) {
      elem.scrollTo({ top: elem.scrollHeight, behavior: "smooth" });
    } else {
      elem.scrollTop = elem.scrollHeight;
    }
  }, []);

  const handleScroll = () => {
    if (!messagesContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
    isNearBottomRef.current = scrollHeight - scrollTop - clientHeight < 120;
  };

  // Scroll to bottom when opening thread
  useEffect(() => {
    if (activeConvo && !loadingThread) {
      scrollToBottom(false);
    }
  }, [activeConvo, loadingThread, scrollToBottom]);

  // Scroll to bottom when new messages arrive if near bottom
  useEffect(() => {
    if (isNearBottomRef.current) {
      scrollToBottom(true);
    }
  }, [messages, scrollToBottom]);

  // ─── Mount & Periodic Polling Setup ──────────────────────────────
  useEffect(() => {
    isMountedRef.current = true;
    fetchConversations(false);

    // Poll conversations every 4 seconds
    const convoInterval = setInterval(() => {
      if (document.visibilityState === "visible") {
        fetchConversations(true);
      }
    }, 4000);

    // Poll open thread every 3 seconds
    const threadInterval = setInterval(() => {
      const cur = activeConvoRef.current;
      if (cur && cur.other_email && !cur.isVirtual && document.visibilityState === "visible") {
        fetchThread(cur.other_email, true);
      }
    }, 3000);

    return () => {
      isMountedRef.current = false;
      clearInterval(convoInterval);
      clearInterval(threadInterval);
    };
  }, [fetchConversations, fetchThread]);

  // ─── Handle startWith Prop ───────────────────────────────────────
  useEffect(() => {
    if (!startWith || !startWith.email || role !== "volunteer") return;

    const targetEmail = startWith.email.trim().toLowerCase();
    const existing = conversations.find(
      (c) => c.other_email.toLowerCase() === targetEmail
    );

    if (existing) {
      setActiveConvo(existing);
      fetchThread(existing.other_email, false);
    } else {
      // Start a virtual conversation with no messages yet
      const virtualConvo = {
        other_email: targetEmail,
        other_name: startWith.name || startWith.email,
        other_role: "ngo",
        isVirtual: true,
      };
      setActiveConvo(virtualConvo);
      setMessages([]);
    }
  }, [startWith, role, conversations, fetchThread]);

  // ─── Select a Conversation ───────────────────────────────────────
  const handleSelectConvo = (convo) => {
    setActiveConvo(convo);
    setPendingFile(null);
    setAttachMenuOpen(false);
    fetchThread(convo.other_email, false);

    // Clear unread count locally for instant responsiveness
    if (convo.unread_count > 0) {
      setConversations((prev) =>
        prev.map((c) =>
          c.other_email === convo.other_email ? { ...c, unread_count: 0 } : c
        )
      );
      markMessagesAsRead(convo.other_email);
    }
  };

  // Close attach menu when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (
        attachMenuRef.current &&
        !attachMenuRef.current.contains(e.target) &&
        !e.target.closest(".msg-attach-btn")
      ) {
        setAttachMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // ─── Client File Validation & Attach ─────────────────────────────
  const handleFileChosen = (e, forcedType = null) => {
    setAttachMenuOpen(false);
    const file = e.target.files?.[0];
    if (!file) return;

    // Reset input value so same file can be selected again
    e.target.value = "";

    const ext = file.name.split(".").pop().toLowerCase();
    if (BLOCKED_EXTENSIONS.includes(ext)) {
      if (showToast) {
        showToast(
          `Files with extension .${ext} are blocked for security reasons`,
          "error"
        );
      }
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      if (showToast) {
        showToast("File size cannot exceed the 10 MB limit", "error");
      }
      return;
    }

    if (file.size === 0) {
      if (showToast) {
        showToast("Empty files cannot be uploaded", "error");
      }
      return;
    }

    const isImage =
      forcedType === "image" ||
      file.type.startsWith("image/") ||
      ["jpg", "jpeg", "png", "gif", "webp"].includes(ext);

    let previewUrl = null;
    if (isImage) {
      previewUrl = URL.createObjectURL(file);
    }

    setPendingFile({
      file,
      isImage,
      previewUrl,
      name: file.name,
      size: file.size,
    });

    if (textareaRef.current) {
      textareaRef.current.focus();
    }
  };

  const removePendingFile = () => {
    if (pendingFile?.previewUrl) {
      URL.revokeObjectURL(pendingFile.previewUrl);
    }
    setPendingFile(null);
  };

  // ─── Geolocation Sharing ─────────────────────────────────────────
  const handleShareLocation = () => {
    setAttachMenuOpen(false);
    if (!activeConvo) return;

    if (!navigator.geolocation) {
      if (showToast) {
        showToast("Geolocation is not supported by your browser", "error");
      }
      return;
    }

    const confirmed = window.confirm(
      `Share your current location with ${activeConvo.other_name}?`
    );
    if (!confirmed) return;

    setIsSending(true);

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords;
          const res = await fetch(`${API_BASE}/messages/location`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sender_email: email.trim().toLowerCase(),
              recipient_email: activeConvo.other_email.trim().toLowerCase(),
              latitude,
              longitude,
            }),
          });

          if (!res.ok) {
            await notifyError(res, "Failed to share location");
            return;
          }

          const savedMsg = await res.json();
          setMessages((prev) => [...prev, savedMsg]);
          scrollToBottom(true);
          fetchConversations(true);

          if (activeConvo.isVirtual) {
            setActiveConvo((prev) => ({ ...prev, isVirtual: false }));
          }
        } catch {
          if (showToast) {
            showToast("Network error while sharing location", "error");
          }
        } finally {
          setIsSending(false);
        }
      },
      (err) => {
        setIsSending(false);
        let msg = "Could not retrieve your location";
        if (err.code === 1) {
          msg = "Location permission denied. Please allow location access to share.";
        } else if (err.code === 2) {
          msg = "Location information is currently unavailable.";
        } else if (err.code === 3) {
          msg = "Location request timed out. Please try again.";
        }
        if (showToast) showToast(msg, "error");
      },
      { enableHighAccuracy: true, timeout: 12000 }
    );
  };

  // ─── Sending Message (Text or File) ──────────────────────────────
  const handleSend = async (e) => {
    if (e) e.preventDefault();
    if (!activeConvo || isSending) return;

    const trimmed = inputText.trim();

    // Reject if no text and no file
    if (!trimmed && !pendingFile) return;

    if (trimmed.length > 2000) {
      if (showToast) showToast("Message exceeds 2000 character limit", "error");
      return;
    }

    setIsSending(true);

    try {
      if (pendingFile) {
        // Send file with optional caption
        const formData = new FormData();
        formData.append("sender_email", email.trim().toLowerCase());
        formData.append("recipient_email", activeConvo.other_email.trim().toLowerCase());
        formData.append("file", pendingFile.file);
        if (trimmed) {
          formData.append("caption", trimmed);
        }

        const res = await fetch(`${API_BASE}/messages/file`, {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          await notifyError(res, "Failed to send attachment");
          return;
        }

        const savedMsg = await res.json();
        setMessages((prev) => [...prev, savedMsg]);
        setInputText("");
        removePendingFile();
        scrollToBottom(true);
        fetchConversations(true);

        if (activeConvo.isVirtual) {
          setActiveConvo((prev) => ({ ...prev, isVirtual: false }));
        }
      } else {
        // Send regular text message
        const res = await fetch(`${API_BASE}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sender_email: email.trim().toLowerCase(),
            recipient_email: activeConvo.other_email.trim().toLowerCase(),
            body: trimmed,
          }),
        });

        if (!res.ok) {
          await notifyError(res, "Failed to send message");
          return;
        }

        const savedMsg = await res.json();
        setMessages((prev) => [...prev, savedMsg]);
        setInputText("");
        scrollToBottom(true);
        fetchConversations(true);

        if (activeConvo.isVirtual) {
          setActiveConvo((prev) => ({ ...prev, isVirtual: false }));
        }
      }
    } catch {
      if (showToast) showToast("Network error while sending message", "error");
    } finally {
      setIsSending(false);
    }
  };

  // Keyboard shortcut: Enter to send, Shift+Enter for newline
  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Filter conversations by search box
  const filteredConvos = conversations.filter((c) =>
    (c.other_name || "").toLowerCase().includes(searchQuery.trim().toLowerCase())
  );

  // Group messages by date
  const renderMessageGroups = () => {
    if (!messages || messages.length === 0) {
      return (
        <div className="msg-thread-empty">
          <p className="msg-thread-empty-title">No messages yet</p>
          <p className="msg-thread-empty-sub">
            Say hello to start the conversation!
          </p>
        </div>
      );
    }

    const items = [];
    let lastDateStr = null;

    messages.forEach((msg, idx) => {
      const msgDateStr = formatDateSeparator(msg.created_at);
      if (msgDateStr && msgDateStr !== lastDateStr) {
        lastDateStr = msgDateStr;
        items.push(
          <div key={`sep-${msgDateStr}-${idx}`} className="msg-date-separator">
            <span>{msgDateStr}</span>
          </div>
        );
      }

      const isMine = msg.is_mine;
      const fileUrlWithAuth = msg.file_url
        ? `${API_BASE}${msg.file_url}?email=${encodeURIComponent(email.trim().toLowerCase())}`
        : null;

      items.push(
        <div
          key={msg.id || `msg-${idx}`}
          className={`msg-bubble-row ${isMine ? "msg-row-mine" : "msg-row-theirs"}`}
        >
          <div className={`msg-bubble ${isMine ? "msg-bubble-mine" : "msg-bubble-theirs"}`}>
            {/* 1. Image message */}
            {msg.message_type === "image" && fileUrlWithAuth && (
              <div className="msg-attachment-image-box">
                <a
                  href={fileUrlWithAuth}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="msg-image-link"
                >
                  <img
                    src={fileUrlWithAuth}
                    alt={msg.file_name || "Shared photo"}
                    className="msg-image-thumbnail"
                    loading="lazy"
                  />
                </a>
              </div>
            )}

            {/* 2. Document message */}
            {msg.message_type === "document" && fileUrlWithAuth && (
              <div className="msg-doc-card">
                <div className="msg-doc-icon-box">
                  <DocIcon />
                </div>
                <div className="msg-doc-details">
                  <span className="msg-doc-name" title={msg.file_name}>
                    {msg.file_name || "Attachment"}
                  </span>
                  <span className="msg-doc-meta">
                    {formatFileSize(msg.file_size)}
                  </span>
                </div>
                <a
                  href={fileUrlWithAuth}
                  download={msg.file_name || "file"}
                  className="msg-doc-download-btn"
                  title="Download file"
                >
                  <DownloadIcon />
                  <span>Download</span>
                </a>
              </div>
            )}

            {/* 3. Location message */}
            {msg.message_type === "location" && (
              <div className="msg-location-card">
                <div className="msg-location-header">
                  <span className="msg-location-pin">
                    <PinIcon />
                  </span>
                  <span className="msg-location-title">Shared location</span>
                </div>
                <div className="msg-location-coords">
                  {msg.latitude?.toFixed(5)}, {msg.longitude?.toFixed(5)}
                </div>
                <a
                  href={`https://www.google.com/maps?q=${msg.latitude},${msg.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="msg-location-link"
                >
                  Open in Google Maps &rarr;
                </a>
              </div>
            )}

            {/* Text or caption */}
            {msg.body && (
              <div className="msg-bubble-text">{msg.body}</div>
            )}

            {/* Timestamp & tick indicators */}
            <div className="msg-meta-row">
              <span className="msg-time">{formatLocalTime(msg.created_at)}</span>
              {isMine && (
                <span className="msg-tick-wrap">
                  {msg.read_at ? <DoubleBlueTickIcon /> : <SingleTickIcon />}
                </span>
              )}
            </div>
          </div>
        </div>
      );
    });

    return items;
  };

  return (
    <div className={`msg-shell ${activeConvo ? "msg-viewing-thread" : "msg-viewing-list"}`}>
      {/* ─── Hidden File Inputs ────────────────────────────────────── */}
      <input
        type="file"
        ref={photoInputRef}
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => handleFileChosen(e, "image")}
      />
      <input
        type="file"
        ref={docInputRef}
        accept="*/*"
        style={{ display: "none" }}
        onChange={(e) => handleFileChosen(e, null)}
      />

      {/* ─── Left Pane: Conversation List ──────────────────────────── */}
      <aside className="msg-sidebar">
        <div className="msg-sidebar-header">
          <div className="msg-sidebar-title-row">
            <h2 className="msg-sidebar-title">Chats</h2>
          </div>
          <div className="msg-search-wrap">
            <span className="msg-search-icon">
              <SearchIcon />
            </span>
            <input
              type="text"
              placeholder="Search conversations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="msg-search-input"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="msg-search-clear-btn"
                aria-label="Clear search"
              >
                &times;
              </button>
            )}
          </div>
        </div>

        <div className="msg-convo-list">
          {loadingConvos ? (
            <div className="msg-loading-wrap">
              <div className="msg-spinner" />
              <span>Loading chats...</span>
            </div>
          ) : filteredConvos.length === 0 ? (
            <div className="msg-sidebar-empty">
              {searchQuery ? (
                <p>No conversations match &ldquo;{searchQuery}&rdquo;</p>
              ) : role === "volunteer" ? (
                <p>Use Connect on an NGO to start a conversation</p>
              ) : (
                <p>Conversations appear here when a volunteer messages you</p>
              )}
            </div>
          ) : (
            filteredConvos.map((convo) => {
              const isSelected =
                activeConvo && activeConvo.other_email === convo.other_email;
              const avatarColor = getAvatarColor(convo.other_name || convo.other_email);

              return (
                <div
                  key={convo.other_email}
                  className={`msg-convo-item ${isSelected ? "msg-active-convo" : ""}`}
                  onClick={() => handleSelectConvo(convo)}
                >
                  <div
                    className="msg-avatar"
                    style={{
                      backgroundColor: avatarColor.bg,
                      color: avatarColor.text,
                    }}
                  >
                    {getAvatarInitial(convo.other_name, convo.other_email)}
                  </div>
                  <div className="msg-convo-info">
                    <div className="msg-convo-top">
                      <span className="msg-convo-name" title={convo.other_name}>
                        {convo.other_name}
                      </span>
                      <span className="msg-convo-date">
                        {formatConvoTime(convo.last_message_time)}
                      </span>
                    </div>
                    <div className="msg-convo-bottom">
                      <span className="msg-convo-preview">
                        {convo.last_message_from_me && (
                          <span className="msg-preview-prefix">You:&nbsp;</span>
                        )}
                        {convo.last_message_preview || "No message preview"}
                      </span>
                      {convo.unread_count > 0 && (
                        <span className="msg-unread-badge">
                          {convo.unread_count}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* ─── Right Pane: Message Thread & Composer ─────────────────── */}
      <main className="msg-chat-pane">
        {activeConvo ? (
          <>
            {/* Header */}
            <div className="msg-thread-header">
              <button
                type="button"
                className="msg-back-btn"
                onClick={() => setActiveConvo(null)}
                aria-label="Back to conversations"
              >
                <BackArrowIcon />
              </button>

              <div
                className="msg-avatar msg-header-avatar"
                style={{
                  backgroundColor: getAvatarColor(
                    activeConvo.other_name || activeConvo.other_email
                  ).bg,
                  color: getAvatarColor(
                    activeConvo.other_name || activeConvo.other_email
                  ).text,
                }}
              >
                {getAvatarInitial(activeConvo.other_name, activeConvo.other_email)}
              </div>

              <div className="msg-header-info">
                <h3 className="msg-header-name">{activeConvo.other_name}</h3>
                <span className="msg-header-sub">
                  {activeConvo.other_role === "ngo" ? "Non-Profit Organization" : "Volunteer"}
                </span>
              </div>
            </div>

            {/* Messages Area */}
            <div
              className="msg-messages-container"
              ref={messagesContainerRef}
              onScroll={handleScroll}
            >
              {loadingThread ? (
                <div className="msg-loading-wrap">
                  <div className="msg-spinner" />
                  <span>Loading messages...</span>
                </div>
              ) : (
                renderMessageGroups()
              )}
            </div>

            {/* Pending Attachment Preview (before send) */}
            {pendingFile && (
              <div className="msg-pending-box">
                {pendingFile.isImage ? (
                  <img
                    src={pendingFile.previewUrl}
                    alt="Selected preview"
                    className="msg-pending-thumb"
                  />
                ) : (
                  <div className="msg-pending-doc-icon">
                    <DocIcon />
                  </div>
                )}
                <div className="msg-pending-info">
                  <span className="msg-pending-name">{pendingFile.name}</span>
                  <span className="msg-pending-size">
                    {formatFileSize(pendingFile.size)}
                  </span>
                </div>
                <button
                  type="button"
                  className="msg-pending-remove-btn"
                  onClick={removePendingFile}
                  title="Remove attachment"
                  aria-label="Remove attachment"
                >
                  &times;
                </button>
              </div>
            )}

            {/* Sending state bar */}
            {isSending && (
              <div className="msg-sending-bar">
                <div className="msg-mini-spinner" />
                <span>Sending...</span>
              </div>
            )}

            {/* Composer */}
            <form className="msg-composer" onSubmit={handleSend}>
              {/* Attach button & menu */}
              <div className="msg-attach-wrap" ref={attachMenuRef}>
                <button
                  type="button"
                  className={`msg-attach-btn ${attachMenuOpen ? "active" : ""}`}
                  onClick={() => setAttachMenuOpen((prev) => !prev)}
                  title="Attach"
                  aria-label="Attach menu"
                  disabled={isSending}
                >
                  <PaperclipIcon />
                </button>

                {attachMenuOpen && (
                  <div className="msg-attach-menu">
                    <button
                      type="button"
                      className="msg-attach-option"
                      onClick={() => photoInputRef.current?.click()}
                    >
                      <span className="msg-attach-icon msg-icon-photo">
                        <PhotoIcon />
                      </span>
                      <span>Photo</span>
                    </button>

                    <button
                      type="button"
                      className="msg-attach-option"
                      onClick={() => docInputRef.current?.click()}
                    >
                      <span className="msg-attach-icon msg-icon-doc">
                        <DocIcon />
                      </span>
                      <span>Document</span>
                    </button>

                    <button
                      type="button"
                      className="msg-attach-option"
                      onClick={handleShareLocation}
                    >
                      <span className="msg-attach-icon msg-icon-pin">
                        <PinIcon />
                      </span>
                      <span>Location</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Text Input */}
              <textarea
                ref={textareaRef}
                className="msg-input"
                rows="1"
                placeholder={
                  pendingFile
                    ? "Add a caption (optional)..."
                    : "Type a message..."
                }
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={handleKeyDown}
                maxLength={2000}
                disabled={isSending}
              />

              {/* Send Button */}
              <button
                type="submit"
                className="msg-send-btn"
                disabled={
                  isSending ||
                  (!inputText.trim() && !pendingFile)
                }
                title="Send message"
                aria-label="Send message"
              >
                <SendIcon />
              </button>
            </form>
          </>
        ) : (
          <div className="msg-no-chat-selected">
            <div className="msg-no-chat-illustration">
              <svg viewBox="0 0 48 48" width="56" height="56" fill="none" stroke="var(--sage)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M42 24c0 9.94-8.06 18-18 18a17.9 17.9 0 0 1-8.2-1.98L4 42l1.98-11.8A17.9 17.9 0 0 1 4 24C4 14.06 12.06 6 22 6s18 8.06 18 18z" />
                <path d="M16 22h.01M24 22h.01M32 22h.01" strokeWidth="4" />
              </svg>
            </div>
            <h3 className="msg-no-chat-title">VolunTag Messages</h3>
            <p className="msg-no-chat-text">
              Select a conversation from the list to view messages, share files,
              and coordinate volunteer activities.
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
