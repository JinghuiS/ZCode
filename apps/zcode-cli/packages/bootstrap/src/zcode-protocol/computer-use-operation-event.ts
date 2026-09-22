import { SessionEventType, type SessionEvent } from "@zcode/contracts";
import {
  isComputerUseOperationToolCall,
  readComputerUseTargetFromToolInput,
  type ZCodeComputerUseOperationEvent,
} from "@zcode/shared";

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function baseEvent(event: SessionEvent) {
  return {
    eventId: String(event.id),
    sequenceNumber: event.sequenceNumber,
    sessionId: String(event.sessionId),
    timestamp: event.timestamp.getTime(),
  };
}

export function mapComputerUseOperationEvent(
  event: SessionEvent,
): ZCodeComputerUseOperationEvent | undefined {
  const turnId = event.turnId ? String(event.turnId) : undefined;
  const payload = asRecord(event.payload);
  switch (event.type) {
    case SessionEventType.TurnStarted:
      return turnId ? { ...baseEvent(event), kind: "turn-started", turnId } : undefined;
    case SessionEventType.TurnComplete:
      return turnId ? { ...baseEvent(event), kind: "turn-completed", turnId } : undefined;
    case SessionEventType.TurnError:
      return turnId ? { ...baseEvent(event), kind: "turn-failed", turnId } : undefined;
    case SessionEventType.ToolCallScheduled: {
      const toolCallId = nonEmptyString(payload.toolCallId);
      const toolName = nonEmptyString(payload.toolName);
      if (!turnId || !toolCallId || !toolName) return undefined;
      const computerUse = isComputerUseOperationToolCall({ toolName, input: payload.input });
      const computerUseTarget = computerUse
        ? readComputerUseTargetFromToolInput(payload.input)
        : undefined;
      return {
        ...baseEvent(event),
        kind: "tool-scheduled",
        turnId,
        toolCallId,
        toolName,
        ...(computerUse ? { computerUse: true as const } : {}),
        ...(computerUseTarget ? { computerUseTarget } : {}),
      };
    }
    case SessionEventType.ToolCallStarted: {
      const toolCallId = nonEmptyString(payload.toolCallId);
      if (!toolCallId) return undefined;
      const toolName = nonEmptyString(payload.toolName);
      return {
        ...baseEvent(event),
        kind: "tool-started",
        ...(turnId ? { turnId } : {}),
        toolCallId,
        ...(toolName ? { toolName } : {}),
      };
    }
    case SessionEventType.SessionEnded:
      return { ...baseEvent(event), kind: "session-closed" };
    default:
      return undefined;
  }
}
