#!/usr/bin/env node

const os = require("os");
const { createServer } = require("../lib/server");

const args = process.argv.slice(2);
let port = 3456;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "-p" || args[i] === "--port") {
    port = parseInt(args[i + 1], 10);
    if (isNaN(port)) {
      console.error("Invalid port number");
      process.exit(1);
    }
    i++;
  } else if (args[i] === "-h" || args[i] === "--help") {
    console.log("Usage: claude-relay [-p|--port <port>]");
    console.log("");
    console.log("Options:");
    console.log("  -p, --port <port>  Port to listen on (default: 3456)");
    process.exit(0);
  }
}

const cwd = process.cwd();

function getLocalIP() {
  const interfaces = os.networkInterfaces();

  // Prefer Tailscale IP
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (/^(tailscale|utun)/.test(name)) {
      for (const addr of addrs) {
        if (addr.family === "IPv4" && !addr.internal && addr.address.startsWith("100.")) {
          return addr.address;
        }
      }
    }
  }

  // Check all interfaces for Tailscale CGNAT range (100.64.0.0/10)
  for (const addrs of Object.values(interfaces)) {
    for (const addr of addrs) {
      if (addr.family === "IPv4" && !addr.internal && addr.address.startsWith("100.")) {
        return addr.address;
      }
    }
  }

  // Fall back to LAN IP
  for (const addrs of Object.values(interfaces)) {
    for (const addr of addrs) {
      if (addr.family === "IPv4" && !addr.internal) {
        return addr.address;
      }
    }
  }

  return "localhost";
}

const server = createServer(cwd);

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`\n  Port ${port} is already in use.`);
    console.error(`  Run with a different port: claude-relay -p <port>`);
    console.error(`  Or kill the existing process: lsof -ti :${port} | xargs kill\n`);
  } else {
    console.error(`\n  Server error: ${err.message}\n`);
  }
  process.exit(1);
});

server.listen(port, () => {
  const ip = getLocalIP();
  const project = require("path").basename(cwd);
  console.log("");
  console.log(`  Claude Relay running at http://${ip}:${port}`);
  console.log(`  Project: ${project}`);
  console.log(`  Directory: ${cwd}`);
  console.log("");
  console.log("  Open the URL on your phone to start chatting.");
  console.log("");
});
