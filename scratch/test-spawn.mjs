import { spawn } from "child_process";

const prompt = `Hello!
This is a test prompt with multiple lines and "quotes".
Can you answer in 5 words?`;

const args = [
  "--print", prompt,
  "--output-format", "stream-json",
  "--dangerously-skip-permissions",
];

console.log("Spawning agy...");
const proc = spawn("agy", args, { stdio: ["pipe", "pipe", "pipe"] });

proc.stdout.on("data", (d) => {
  const str = d.toString();
  for (const line of str.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const json = JSON.parse(line);
      if (json.event === "step_update" && json.step_update?.text_delta) {
        process.stdout.write(json.step_update.text_delta);
      }
      if (json.event === "result") {
        console.log("\n[DONE]", json.result?.status);
      }
    } catch {
      // ignore
    }
  }
});

proc.stderr.on("data", (d) => {
  console.error("[STDERR]", d.toString());
});

proc.on("close", (code) => {
  console.log("\nProcess exited with code:", code);
});
