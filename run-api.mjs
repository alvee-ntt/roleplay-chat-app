import { spawn } from "child_process";

// Supervisor for the API proxy. If server.js exits for any reason — a crash, or
// something in the environment killing the process — we just start it again.
// Keeps the backend up while you work without babysitting the terminal.
function start() {
  const child = spawn(process.execPath, ["server.js"], { stdio: "inherit" });
  child.on("exit", (code, signal) => {
    console.log(`[api] server exited (code=${code}, signal=${signal}); restarting in 1s…`);
    setTimeout(start, 1000);
  });
  child.on("error", (err) => {
    console.error("[api] failed to spawn server:", err.message);
    setTimeout(start, 1000);
  });
}

start();
