"use client";

import { useEffect, useRef, useState } from "react";

import { eventStreamUrl } from "./api";

export type StreamStatus = "connecting" | "live" | "reconnecting";

/** Mirrors the backend's broadcast payload (lib/audit.ts BoardChangeMessage). */
export interface BoardChangeEvent {
  id: string;
  action: string;
  entityType: string; // "task" | "column" | "board" | "member" | "comment"
  entityId: string | null;
  metadata: Record<string, unknown> | null;
  actorId?: string;
  createdAt: string;
}

interface StreamHandlers {
  /** Fired for every `change` event broadcast on the board's channel. */
  onEvent?(event: BoardChangeEvent): void;
  /** Fired when the board itself is deleted by another session. */
  onDeleted?(): void;
}

/**
 * Subscribes the current client to a board's live event stream (SSE). The
 * browser reconnects automatically after drops; status reflects the lifecycle
 * so the UI can show a Live / Connecting / Reconnecting indicator.
 */
export function useBoardStream(boardId: string | null, handlers: StreamHandlers): StreamStatus {
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const handlersRef = useRef(handlers);
  const closedRef = useRef(false);

  // Keep the latest callbacks without resubscribing on every render.
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    if (!boardId) return;
    closedRef.current = false;
    // Reset to connecting when the board changes (the open/error events below
    // run later, outside the effect body).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStatus("connecting");

    // withCredentials matters when the stream URL is cross-origin (a deployed
    // API); same-origin requests send cookies regardless.
    const source = new EventSource(eventStreamUrl(boardId), { withCredentials: true });

    source.onopen = () => {
      if (!closedRef.current) setStatus("live");
    };
    source.onerror = () => {
      // The browser auto-reconnects unless we closed the stream ourselves.
      if (!closedRef.current && source.readyState !== EventSource.CLOSED) {
        setStatus("reconnecting");
      }
    };
    source.addEventListener("change", (event) => {
      try {
        const change = JSON.parse((event as MessageEvent).data as string) as BoardChangeEvent;
        handlersRef.current.onEvent?.(change);
      } catch {
        // Ignore malformed frames rather than breaking the stream.
      }
    });
    source.addEventListener("deleted", () => {
      handlersRef.current.onDeleted?.();
    });

    return () => {
      closedRef.current = true;
      source.close();
    };
  }, [boardId]);

  return status;
}
