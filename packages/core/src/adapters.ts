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
 * Phase-1: detection + passthrough hooks; deeper hooks land later.
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

function readTextIfExists(path: string): string | undefined {
  try {
    if (!exists(path)) return undefined;
    return readFileSync(path, "utf8").trim() || undefined;
  } catch {
    return undefined;
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

export class OpenCodeAdapter implements AgentAdapter {
  readonly id = "opencode";
  readonly kind = "opencode" as const;

  detect(): AgentDescriptor {
    const bins = [
      "/usr/bin/ai.opencode",
      "/opt/OpenCode/ai.opencode",
      join(homedir(), ".local/bin/opencode"),
      "/usr/local/bin/opencode",
      "/opt/OpenCode/resources/opencode-cli",
    ];
    const dirs = [
      join(homedir(), ".config/opencode"),
      join(homedir(), ".local/share/opencode"),
      join(homedir(), ".config/ai.opencode.desktop"),
      "/opt/OpenCode",
    ];
    const foundBin = bins.find(exists);
    const foundDir = dirs.find(exists);
    const version =
      readTextIfExists("/opt/OpenCode/resources/opencode-cli.version") ??
      readTextIfExists(join(homedir(), ".local/share/opencode/version"));
    return {
      id: this.id,
      name: "OpenCode",
      kind: "opencode",
      detected: Boolean(foundBin || foundDir),
      version,
      path: foundBin ?? foundDir,
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
  return [
    new DshAdapter(),
    new OpenCodeAdapter(),
    new OpenClawAdapter(),
    new HermesAdapter(),
  ];
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
