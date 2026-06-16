import { execFile, execFileSync, spawnSync } from "child_process";
import { createRequire } from "module";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const requireFromCwd = createRequire(join(process.cwd(), "package.json"));

function convexBinPath(): string {
  const packageJsonPath = requireFromCwd.resolve("convex/package.json");
  return join(dirname(packageJsonPath), "bin", "main.js");
}

function shellCommand(command: string): { command: string; args: string[] } {
  return process.platform === "win32"
    ? { command: "cmd.exe", args: ["/d", "/s", "/c", command] }
    : { command: "sh", args: ["-lc", command] };
}

export function runConvex(args: string[]): string {
  return execFileSync(process.execPath, [convexBinPath(), ...args], {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

export function runConvexAsync(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [convexBinPath(), ...args],
      { encoding: "utf-8" },
      (error, stdout, stderr) => {
        if (error) {
          console.error("Convex run failed:", stderr || stdout);
          reject(error);
          return;
        }
        resolve(stdout.trim());
      },
    );
  });
}

export function spawnConvex(args: string[]): number | null {
  return spawnSync(process.execPath, [convexBinPath(), ...args], {
    stdio: "inherit",
  }).status;
}

export function spawnNpmRun(
  script: string,
  env: NodeJS.ProcessEnv = process.env,
): number | null {
  const command = shellCommand(`npm run ${script}`);
  return spawnSync(command.command, command.args, {
    env,
    stdio: "inherit",
  }).status;
}

export function spawnStaticHostingCli(args: string[]): number | null {
  const cliPath = resolve(dirname(fileURLToPath(import.meta.url)), "index.js");
  return spawnSync(process.execPath, [cliPath, ...args], {
    stdio: "inherit",
  }).status;
}
