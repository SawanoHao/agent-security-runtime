import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { OpenShellStatus } from "./types.js";

const execFileAsync = promisify(execFile);

async function run(
  cmd: string,
  args: string[],
  timeoutMs = 4000,
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
    });
    return { ok: true, stdout: stdout.toString(), stderr: stderr.toString() };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      stdout: e.stdout?.toString() ?? "",
      stderr: e.stderr?.toString() ?? e.message ?? String(err),
    };
  }
}

export async function probeOpenShell(): Promise<OpenShellStatus> {
  const which = await run("bash", ["-lc", "command -v openshell"]);
  if (!which.ok || !which.stdout.trim()) {
    return {
      installed: false,
      gatewayConnected: false,
      sandboxes: [],
      error: "openshell CLI not found on PATH",
    };
  }

  const ver = await run("openshell", ["--version"]);
  const version = ver.stdout.trim() || ver.stderr.trim() || undefined;

  const status = await run("openshell", ["status"]);
  const connected =
    status.ok &&
    /Status:\s*Connected/i.test(status.stdout + status.stderr);

  const list = await run("openshell", ["sandbox", "list"]);
  const sandboxes: { name: string; phase: string }[] = [];
  if (list.ok) {
    const lines = list.stdout.split("\n").slice(1);
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 2 && parts[0] && parts[0] !== "NAME") {
        sandboxes.push({
          name: parts[0],
          phase: parts[parts.length - 1] ?? "Unknown",
        });
      }
    }
  }

  return {
    installed: true,
    gatewayConnected: connected,
    version: version?.replace(/^openshell\s+/i, ""),
    sandboxes,
    error: connected ? undefined : status.stderr || "gateway not connected",
  };
}
