# claude-relay

Run `npx claude-relay` in any directory. Access Claude Code on that directory from any device.

![claude-relay demo](screenshot.gif)

```
$ cd ~/my-project
$ npx claude-relay

  Claude Relay running at http://100.64.1.5:3456
  Project: my-project
  Directory: /Users/you/my-project

  Open the URL on your phone to start chatting.
```

## Why?

Yes, you can use Claude Code from the Claude app — but it requires a GitHub repo, runs in a sandboxed VM, and comes with limitations. No local tools, no custom skills, no access to your actual dev environment.

**claude-relay** gives you the real thing. One command in any directory — even `~` — and you get full Claude Code on **your machine**, from any device. Your files, your tools, your skills, your environment. No GitHub required, no sandbox.

## How it works

claude-relay spawns `claude` CLI processes and bridges them to a web UI over WebSocket. Your browser talks to the relay, the relay talks to Claude Code. Sessions persist across reconnects.

```
Browser (any device)  <-->  claude-relay (your machine)  <-->  claude CLI
        WebSocket                HTTP + WS                    stdin/stdout
```

## Features

- **One command** — `npx claude-relay` and you're live
- **Mobile-first UI** — designed for phones and tablets, works everywhere
- **Multi-session** — run multiple Claude Code sessions, switch between them
- **Streaming** — real-time token streaming, tool execution, thinking blocks
- **Session persistence** — sessions survive server restarts and reconnects
- **Tailscale-aware** — prefers Tailscale IP for secure remote access
- **Slash commands** — full slash command support with autocomplete
- **Zero config** — no API keys, no setup. Uses your local `claude` installation

## Requirements

- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and authenticated
- Node.js 18+

## Install

```bash
# Run directly (no install needed)
npx claude-relay

# Or install globally
npm install -g claude-relay
claude-relay
```

## Usage

```bash
# Start in current directory
npx claude-relay

# Custom port
npx claude-relay -p 8080
```

Then open the URL on any device connected to the same network.

### Remote access with Tailscale

claude-relay automatically detects [Tailscale](https://tailscale.com) and uses your Tailscale IP. Install Tailscale on your machine and phone, and you can access Claude Code from anywhere — coffee shop, commute, couch.

## Limitations

- Permission prompts (tool approval) are not yet relayed to the browser
- File attachments from the browser are not yet supported
- Session persistence is unstable

These are planned for future releases. Contributions welcome.

## Security

**claude-relay has no built-in authentication or encryption.** Anyone with access to the URL gets full Claude Code access to your machine — reading, writing, and executing files with your user permissions.

We strongly recommend using a private network layer such as [Tailscale](https://tailscale.com), WireGuard, or a VPN. claude-relay automatically detects Tailscale and prefers its IP for this reason.

If you choose to expose it beyond your private network, that's your call. **Entirely at your own risk.** The authors assume no responsibility for any damage, data loss, or security incidents.

## License

MIT
