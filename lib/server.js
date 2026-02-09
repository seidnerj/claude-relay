const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { WebSocketServer } = require("ws");

const clientHtmlPath = path.join(__dirname, "client.html");

function createServer(cwd) {
  const project = path.basename(cwd);

  // --- Multi-session state ---
  let nextLocalId = 1;
  let sessions = new Map();     // localId -> session object
  let activeSessionId = null;   // currently active local ID
  let slashCommands = null;     // shared across sessions
  let activeWs = null;

  function send(obj) {
    if (activeWs && activeWs.readyState === 1) {
      activeWs.send(JSON.stringify(obj));
    }
  }

  // Send a message and record it in session history for replay on reconnect
  function sendAndRecord(session, obj) {
    session.history.push(obj);
    if (session.localId === activeSessionId) {
      send(obj);
    }
  }

  function getActiveSession() {
    return sessions.get(activeSessionId) || null;
  }

  function broadcastSessionList() {
    send({
      type: "session_list",
      sessions: [...sessions.values()].map(function(s) {
        return {
          id: s.localId,
          title: s.title || "New Session",
          active: s.localId === activeSessionId,
          isProcessing: s.isProcessing,
        };
      }),
    });
  }

  function createSession() {
    var localId = nextLocalId++;
    var session = {
      localId: localId,
      proc: null,
      cliSessionId: null,
      buffer: "",
      blocks: {},
      sentToolResults: {},
      isProcessing: false,
      title: "",
      createdAt: Date.now(),
      history: [],
    };
    sessions.set(localId, session);
    spawnProcess(session);
    switchSession(localId);
    return session;
  }

  function replayHistory(session) {
    for (var i = 0; i < session.history.length; i++) {
      send(session.history[i]);
    }
  }

  function switchSession(localId) {
    var session = sessions.get(localId);
    if (!session) return;

    activeSessionId = localId;
    send({ type: "session_switched", id: localId });
    broadcastSessionList();
    replayHistory(session);

    if (session.isProcessing) {
      send({ type: "status", status: "processing" });
    }
  }

  function processLine(session, line) {
    if (!line.trim()) return;

    var parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }

    if (parsed.session_id) {
      session.cliSessionId = parsed.session_id;
    }

    // Cache slash_commands from CLI init message
    if (parsed.type === "system" && parsed.subtype === "init" && parsed.slash_commands) {
      slashCommands = parsed.slash_commands;
      send({ type: "slash_commands", commands: slashCommands });
    }

    if (parsed.type === "stream_event" && parsed.event) {
      var evt = parsed.event;

      if (evt.type === "content_block_start") {
        var block = evt.content_block;
        var idx = evt.index;

        if (block.type === "tool_use") {
          session.blocks[idx] = { type: "tool_use", id: block.id, name: block.name, inputJson: "" };
          sendAndRecord(session, { type: "tool_start", id: block.id, name: block.name });
        } else if (block.type === "thinking") {
          session.blocks[idx] = { type: "thinking", thinkingText: "" };
          sendAndRecord(session, { type: "thinking_start" });
        } else if (block.type === "text") {
          session.blocks[idx] = { type: "text" };
        }
      }

      if (evt.type === "content_block_delta" && evt.delta) {
        var idx = evt.index;

        if (evt.delta.type === "text_delta" && typeof evt.delta.text === "string") {
          sendAndRecord(session, { type: "delta", text: evt.delta.text });
        } else if (evt.delta.type === "input_json_delta" && session.blocks[idx]) {
          session.blocks[idx].inputJson += evt.delta.partial_json;
        } else if (evt.delta.type === "thinking_delta" && session.blocks[idx]) {
          session.blocks[idx].thinkingText += evt.delta.thinking;
          sendAndRecord(session, { type: "thinking_delta", text: evt.delta.thinking });
        }
      }

      if (evt.type === "content_block_stop") {
        var idx = evt.index;
        var block = session.blocks[idx];

        if (block && block.type === "tool_use") {
          var input = {};
          try { input = JSON.parse(block.inputJson); } catch {}
          sendAndRecord(session, { type: "tool_executing", id: block.id, name: block.name, input: input });
        } else if (block && block.type === "thinking") {
          sendAndRecord(session, { type: "thinking_stop" });
        }

        delete session.blocks[idx];
      }

    } else if ((parsed.type === "assistant" || parsed.type === "user") && parsed.message && parsed.message.content) {
      var content = parsed.message.content;
      for (var i = 0; i < content.length; i++) {
        var block = content[i];
        if (block.type === "tool_result" && !session.sentToolResults[block.tool_use_id]) {
          var resultText = "";
          if (typeof block.content === "string") {
            resultText = block.content;
          } else if (Array.isArray(block.content)) {
            resultText = block.content
              .filter(function(c) { return c.type === "text"; })
              .map(function(c) { return c.text; })
              .join("\n");
          }
          session.sentToolResults[block.tool_use_id] = true;
          sendAndRecord(session, {
            type: "tool_result",
            id: block.tool_use_id,
            content: resultText,
            is_error: block.is_error || false,
          });
        }
      }

    } else if (parsed.type === "result") {
      session.blocks = {};
      session.sentToolResults = {};
      session.isProcessing = false;
      sendAndRecord(session, {
        type: "result",
        cost: parsed.total_cost_usd,
        duration: parsed.duration_ms,
        sessionId: parsed.session_id,
      });
      sendAndRecord(session, { type: "done", code: 0 });
      broadcastSessionList();
    }
  }

  function spawnProcess(session) {
    var args = [
      "-p",
      "--verbose",
      "--output-format", "stream-json",
      "--input-format", "stream-json",
      "--include-partial-messages",
    ];

    if (session.cliSessionId) {
      args.push("--resume", session.cliSessionId);
    }

    session.buffer = "";
    session.blocks = {};
    session.sentToolResults = {};

    session.proc = spawn("claude", args, {
      cwd: cwd,
      env: Object.assign({}, process.env),
      stdio: ["pipe", "pipe", "pipe"],
    });

    session.proc.stdout.on("data", function(chunk) {
      session.buffer += chunk.toString();
      var lines = session.buffer.split("\n");
      session.buffer = lines.pop();

      for (var i = 0; i < lines.length; i++) {
        processLine(session, lines[i]);
      }
    });

    session.proc.stderr.on("data", function(chunk) {
      var errText = chunk.toString();
      if (errText.includes("Error") || errText.includes("error")) {
        if (session.localId === activeSessionId) {
          send({ type: "stderr", text: errText });
        }
      }
    });

    session.proc.on("close", function(code) {
      if (session.buffer.trim()) {
        processLine(session, session.buffer);
        session.buffer = "";
      }

      session.proc = null;
      session.blocks = {};

      if (session.isProcessing) {
        session.isProcessing = false;
        sendAndRecord(session, { type: "error", text: "Claude process exited unexpectedly (code " + code + ")" });
        sendAndRecord(session, { type: "done", code: code || 1 });
        broadcastSessionList();
      }
    });

    session.proc.on("error", function(err) {
      session.proc = null;
      session.isProcessing = false;
      sendAndRecord(session, { type: "error", text: "Failed to spawn claude: " + err.message });
      sendAndRecord(session, { type: "done", code: 1 });
      broadcastSessionList();
    });
  }

  function writeMessage(session, text) {
    var msg = {
      type: "user",
      session_id: "",
      parent_tool_use_id: null,
      message: {
        role: "user",
        content: [{ type: "text", text: text }],
      },
    };
    session.proc.stdin.write(JSON.stringify(msg) + "\n");
  }

  // --- Spawn initial session on server start ---
  createSession();

  // --- HTTP server ---
  var server = http.createServer(function(req, res) {
    if (req.method === "GET" && (req.url === "/" || req.url === "/index.html")) {
      var html = fs.readFileSync(clientHtmlPath, "utf-8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    if (req.method === "GET" && req.url === "/info") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ cwd: cwd, project: project }));
      return;
    }

    res.writeHead(404);
    res.end("Not found");
  });

  // --- WebSocket ---
  var wss = new WebSocketServer({ server: server });

  wss.on("connection", function(ws) {
    activeWs = ws;

    // Send cached state
    send({ type: "info", cwd: cwd, project: project });
    if (slashCommands) {
      send({ type: "slash_commands", commands: slashCommands });
    }
    broadcastSessionList();

    // Restore active session
    var active = getActiveSession();
    if (active) {
      send({ type: "session_switched", id: active.localId });
      replayHistory(active);
      if (active.isProcessing) {
        send({ type: "status", status: "processing" });
      }
    }

    ws.on("message", function(raw) {
      var msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      if (msg.type === "new_session") {
        createSession();
        return;
      }

      if (msg.type === "switch_session") {
        if (msg.id && sessions.has(msg.id)) {
          switchSession(msg.id);
        }
        return;
      }

      if (msg.type !== "message" || !msg.text) return;

      var session = getActiveSession();
      if (!session) return;

      if (session.isProcessing) {
        send({ type: "error", text: "Still processing previous message. Please wait." });
        return;
      }

      session.isProcessing = true;
      session.sentToolResults = {};

      // Record user message in history for replay
      session.history.push({ type: "user_message", text: msg.text });
      send({ type: "status", status: "processing" });

      // Set title from first user message
      if (!session.title) {
        session.title = msg.text.substring(0, 50);
        broadcastSessionList();
      }

      // Respawn if process died
      if (!session.proc) {
        spawnProcess(session);
      }

      writeMessage(session, msg.text);
      broadcastSessionList();
    });

    ws.on("close", function() {
      if (activeWs === ws) activeWs = null;
      // Don't kill procs — they persist across reconnects
    });
  });

  return server;
}

module.exports = { createServer };
