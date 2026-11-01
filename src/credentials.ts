import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const resolveCredential = async (value: string): Promise<string> => {
  if (!value.startsWith("op://")) return value;

  try {
    const { stdout } = await execFileAsync("op", ["read", "--no-newline", value], { timeout: 90_000 });
    if (!stdout) throw new Error("empty credential");
    return stdout;
  } catch {
    // op errors can echo vault and item details; keep them out of tool results
    throw new Error("Could not read Spaceship credentials from 1Password. Unlock 1Password and retry.");
  }
};
