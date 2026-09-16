export type LocalGatewayPhase = "starting" | "ready" | "error" | "stopped";

export type LocalGatewayStatus = {
  mode: "local";
  phase: LocalGatewayPhase;
  label: string;
  connected: boolean;
  inferenceReady: boolean;
  error: string | null;
  profileId: string | null;
  profileHome: string | null;
  workspaceRoot: string | null;
  recentActivity: Array<{
    level: "INFO" | "WARNING" | "ERROR";
    source: string;
    message: string;
    at: string;
  }>;
};

const MAX_ACTIVITY = 40;

export class LocalGatewayController {
  private phase: LocalGatewayPhase = "stopped";
  private error: string | null = null;
  private profileId: string | null = null;
  private profileHome: string | null = null;
  private workspaceRoot: string | null = null;
  private activity: LocalGatewayStatus["recentActivity"] = [];

  markStarting(meta: {
    profileId: string;
    profileHome: string;
    workspaceRoot: string;
  }): void {
    this.phase = "starting";
    this.error = null;
    this.profileId = meta.profileId;
    this.profileHome = meta.profileHome;
    this.workspaceRoot = meta.workspaceRoot;
    this.push("INFO", "local_gateway", `starting profile=${meta.profileId}`);
  }

  markReady(): void {
    this.phase = "ready";
    this.error = null;
    this.push("INFO", "local_gateway", "Gateway ready");
  }

  markError(message: string): void {
    this.phase = "error";
    this.error = message;
    this.push("ERROR", "local_gateway", message);
  }

  markStopped(): void {
    this.phase = "stopped";
    this.push("INFO", "local_gateway", "stopped");
  }

  push(
    level: "INFO" | "WARNING" | "ERROR",
    source: string,
    message: string,
  ): void {
    this.activity = [
      {
        level,
        source,
        message,
        at: new Date().toISOString(),
      },
      ...this.activity,
    ].slice(0, MAX_ACTIVITY);
  }

  getStatus(): LocalGatewayStatus {
    const ready = this.phase === "ready";
    return {
      mode: "local",
      phase: this.phase,
      label:
        this.phase === "ready"
          ? "Gateway ready"
          : this.phase === "starting"
            ? "Gateway starting…"
            : this.phase === "error"
              ? "Gateway error"
              : "Gateway stopped",
      connected: ready || this.phase === "starting",
      inferenceReady: ready,
      error: this.error,
      profileId: this.profileId,
      profileHome: this.profileHome,
      workspaceRoot: this.workspaceRoot,
      recentActivity: this.activity,
    };
  }

  test(): { ok: boolean; detail: string } {
    if (this.phase === "ready") {
      return { ok: true, detail: "Local gateway responding (in-process agent)." };
    }
    if (this.phase === "starting") {
      return { ok: false, detail: "Gateway still starting." };
    }
    if (this.phase === "error") {
      return { ok: false, detail: this.error ?? "Gateway error" };
    }
    return { ok: false, detail: "Gateway not running." };
  }
}
