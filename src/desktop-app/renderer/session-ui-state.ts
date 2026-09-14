import type { AgentPhase, AgentUiEvent } from "../../cli/run-agent.js";
import { shouldRenderAsReasoning } from "../../agent/sanitize-output.js";
import { isPlanApprovalInterrupt } from "../../agent/interrupt-utils.js";
import type { CanvasTab } from "./ActivityCanvas.js";

export type DesktopAgentEvent = AgentUiEvent & { threadId?: string };

export type ChatItem =
  | { id: string; kind: "user"; text: string; at: string }
  | { id: string; kind: "assistant"; text: string; at: string }
  | { id: string; kind: "system"; text: string; at: string }
  | { id: string; kind: "reasoning"; text: string; at: string; label?: string }
  | { id: string; kind: "trace"; event: AgentUiEvent; at: string };

export type ActivityRow = { id: string; event: AgentUiEvent; at: string };

export type SessionUiSnap = {
  items: ChatItem[];
  activity: ActivityRow[];
  draftAnswer: string;
  phase: AgentPhase;
  planApprovalPending: boolean;
  canvasTabs: CanvasTab[];
  activeCanvasId: string | null;
  railLayer: "trace" | "canvas";
  pendingTools: Array<{ name: string; input: unknown }>;
  pendingDeliverables: string[];
  loading: boolean;
};

export function emptySessionSnap(
  welcome?: string,
): SessionUiSnap {
  return {
    items: welcome
      ? [
          {
            id: "welcome",
            kind: "assistant",
            text: welcome,
            at: new Date().toLocaleTimeString(),
          },
        ]
      : [],
    activity: [],
    draftAnswer: "",
    phase: "boot",
    planApprovalPending: false,
    canvasTabs: [],
    activeCanvasId: null,
    railLayer: "trace",
    pendingTools: [],
    pendingDeliverables: [],
    loading: false,
  };
}

/** Apply one agent event to a session snapshot (for live or background cache). */
export function reduceSessionEvent(
  snap: SessionUiSnap,
  event: AgentUiEvent,
  opts: { id: string; at: string },
): SessionUiSnap {
  const { id, at } = opts;
  let next: SessionUiSnap = {
    ...snap,
    items: snap.items,
    activity: snap.activity,
    pendingTools: [...snap.pendingTools],
    pendingDeliverables: [...snap.pendingDeliverables],
    canvasTabs: snap.canvasTabs,
  };

  if (event.type === "status") {
    next = { ...next, phase: event.phase };
    if (
      event.phase === "waiting_approval" &&
      /plan approval/i.test(event.detail)
    ) {
      next = {
        ...next,
        planApprovalPending: true,
        railLayer: "canvas",
      };
    }
    if (event.phase === "done" || event.phase === "error") {
      next = { ...next, planApprovalPending: false, loading: false };
    }
    if (event.detail === "turn started") {
      next = { ...next, loading: true, phase: "thinking" };
    }
  }

  if (event.type === "interrupt" && isPlanApprovalInterrupt(event.payload)) {
    next = {
      ...next,
      planApprovalPending: true,
      railLayer: "canvas",
    };
  }

  if (event.type === "token") {
    next = { ...next, draftAnswer: next.draftAnswer + event.text };
  }

  if (event.type === "done") {
    const finalText = (event.text || next.draftAnswer).trim();
    const items = [...next.items];
    if (finalText && shouldRenderAsReasoning(finalText)) {
      items.push({
        id,
        kind: "reasoning",
        text: finalText,
        at,
        label: "Model notice",
      });
    } else {
      items.push({
        id,
        kind: "assistant",
        text: finalText || "(empty response)",
        at,
      });
    }
    next = {
      ...next,
      items,
      draftAnswer: "",
      phase: "done",
      loading: false,
    };
  }

  if (event.type === "warning" && /retrying/i.test(event.message)) {
    next = { ...next, draftAnswer: "" };
  }

  if (event.type === "error") {
    next = {
      ...next,
      items: [...next.items, { id, kind: "system", text: event.message, at }],
      phase: "error",
      loading: false,
    };
  }

  if (event.type !== "token") {
    const activity = [...next.activity, { id, event, at }];
    next = {
      ...next,
      activity: activity.length > 200 ? activity.slice(-200) : activity,
    };
  }

  if (event.type === "tool_start") {
    next.pendingTools.push({ name: event.name, input: event.input });
  }

  if (event.type === "tool_end") {
    const pending = next.pendingTools;
    let input: unknown = {};
    for (let i = pending.length - 1; i >= 0; i -= 1) {
      if (pending[i]!.name === event.name) {
        input = pending[i]!.input;
        pending.splice(i, 1);
        break;
      }
    }
    const synthetic: AgentUiEvent = {
      type: "tool_start",
      name: event.name,
      input,
    };
    next = {
      ...next,
      pendingTools: pending,
      items: [
        ...next.items,
        { id: `t-${id}`, kind: "trace", event: synthetic, at },
      ],
    };
  }

  return next;
}
