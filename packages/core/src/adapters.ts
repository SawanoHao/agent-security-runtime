import { accessSync, constants, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentDescriptor } from "./types.js";
import type {
  PolicyDecision,
  PromptEvent,
  ToolCallEvent,
} from "./types.js";

/**
 * Every supported Agent implements the same hook surface.
 * Phase-1: DSH detection + passthrough hooks; OpenClaw/Hermes stubs.
 */
export interface AgentAdapter {
  readonly id: string;
  readonly kind: AgentDescriptor["kind"];
  detect(): AgentDescriptor;
  beforePrompt?(event: PromptEvent): Promise<PolicyDecision | void> | PolicyDecision | void;
  beforeToolCall?(
    event: ToolCallEvent,
  ): Promise<PolicyDecision | void> | PolicyDecision | void;
}

function exists(path: string): boolean {
  try {
    accessSync(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export class DshAdapter implements AgentAdapter {
  readonly id = "dsh";
  readonly kind = "dsh" as const;

  detect(): AgentDescriptor {
    const homeBin = join(homedir(), ".local/node/bin/dsh");
    const paths = [homeBin, "/usr/local/bin/dsh"];
    const found = paths.find(exists);
    let version: string | undefined;
    if (found) {
      // version file may not exist; leave undefined if unknown
      version = undefined;
    }
    const profileDir = join(homedir(), ".dsh/profiles");
    const detected = Boolean(found) || exists(profileDir);
    return {
      id: this.id,
      name: "DeepSeek Harness",
      kind: "dsh",
      detected,
      version,
      path: found ?? (exists(profileDir) ? profileDir : undefined),
    };
  }
}

export class OpenClawAdapter implements AgentAdapter {
  readonly id = "openclaw";
  readonly kind = "openclaw" as const;

  detect(): AgentDescriptor {
    const candidates = [
      join(homedir(), ".openclaw"),
      join(homedir(), ".local/bin/openclaw"),
      "/usr/local/bin/openclaw",
    ];
    const path = candidates.find(exists);
    return {
      id: this.id,
      name: "OpenClaw",
      kind: "openclaw",
      detected: Boolean(path),
      path,
    };
  }
}

export class HermesAdapter implements AgentAdapter {
  readonly id = "hermes";
  readonly kind = "hermes" as const;

  detect(): AgentDescriptor {
    const candidates = [
      join(homedir(), ".hermes"),
      join(homedir(), ".local/bin/hermes"),
      "/usr/local/bin/hermes",
    ];
    const path = candidates.find(exists);
    return {
      id: this.id,
      name: "Hermes",
      kind: "hermes",
      detected: Boolean(path),
      path,
    };
  }
}

export function defaultAdapters(): AgentAdapter[] {
  return [new DshAdapter(), new OpenClawAdapter(), new HermesAdapter()];
}

export function detectAgents(adapters: AgentAdapter[] = defaultAdapters()): AgentDescriptor[] {
  return adapters.map((a) => a.detect());
}

/** Best-effort read of package version near a binary path. */
export function tryReadNearbyVersion(binPath: string): string | undefined {
  try {
    const pkg = join(binPath, "..", "..", "lib", "node_modules", "@deepseek-ai", "dsh", "package.json");
    if (exists(pkg)) {
      const j = JSON.parse(readFileSync(pkg, "utf8")) as { version?: string };
      return j.version;
    }
  } catch {
    /* ignore */
  }
  return undefined;
}
