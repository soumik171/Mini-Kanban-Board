import type { Response } from 'express';

// In-memory pub/sub hub for the board realtime stream. Subscribers are
// Server-Sent Events connections (one per open browser tab), keyed by board.
// When any board mutation lands, recordAudit (the choke point every mutation
// passes through) publishes to the board's channel and every subscriber's
// client re-syncs that board.
//
// The hub is deliberately process-local: with a single backend instance each
// board channel is authoritative. (A multi-instance deployment would swap
// this for a Redis pub/sub channel per board.)

interface Subscriber {
  res: Response;
}

const boardChannels = new Map<string, Set<Subscriber>>();

function sseFrame(eventName: string, payload: unknown): string {
  return `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
}

/** Registers `res` for live events on `boardId`; returns an unsubscribe fn. */
export function subscribeToBoard(boardId: string, res: Response): () => void {
  let channel = boardChannels.get(boardId);
  if (!channel) {
    channel = new Set();
    boardChannels.set(boardId, channel);
  }
  const subscriber: Subscriber = { res };
  channel.add(subscriber);

  // A socket that dies mid-write can emit an error on the response; silence
  // it so a dead client can never take down a broadcast.
  res.on('error', () => {
    channel?.delete(subscriber);
  });

  return () => {
    channel?.delete(subscriber);
    if (channel && channel.size === 0) {
      boardChannels.delete(boardId);
    }
  };
}

/** Writes a named SSE event to every live subscriber of `boardId`. */
export function publishToBoard(boardId: string, eventName: string, payload: unknown): void {
  const channel = boardChannels.get(boardId);
  if (!channel) return;

  const frame = sseFrame(eventName, payload);
  for (const subscriber of [...channel]) {
    if (subscriber.res.writableEnded || subscriber.res.destroyed) {
      channel.delete(subscriber);
      continue;
    }
    subscriber.res.write(frame);
  }
  if (channel.size === 0) {
    boardChannels.delete(boardId);
  }
}

/** Ends every subscriber's stream for a board (used when the board is gone). */
export function dropBoardSubscribers(boardId: string): void {
  const channel = boardChannels.get(boardId);
  if (!channel) return;
  for (const subscriber of channel) {
    subscriber.res.end();
  }
  boardChannels.delete(boardId);
}
