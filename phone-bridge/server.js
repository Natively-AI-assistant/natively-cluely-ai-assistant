const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const WebSocket = require("ws");
const Database = require("better-sqlite3");

const PORT = Number(process.env.PORT || 3000);
const POLL_MS = Number(process.env.POLL_MS || 800);
const TABLE_ORDER = ["messages", "conversation_history", "sessions"];
const ASSISTANT_ROLES = new Set(["assistant", "ai"]);
const ROLE_COLUMNS = ["role", "sender", "author", "source", "type"];
const CONTENT_COLUMNS = ["content", "text", "message", "response", "body", "transcript"];
const TIME_COLUMNS = ["created_at", "updated_at", "timestamp", "time", "date"];

let db;
let schemaPrinted = false;
let warnedMissingDb = false;
const lastSeenByTable = new Map();

function candidateDbPaths() {
  const candidates = [];

  if (process.env.DB_PATH) {
    candidates.push(process.env.DB_PATH);
  }

  if (process.env.APPDATA) {
    candidates.push(
      path.join(process.env.APPDATA, "natively", "natively.db"),
      path.join(process.env.APPDATA, "Natively", "natively.db")
    );
  }

  if (process.env.LOCALAPPDATA) {
    candidates.push(path.join(process.env.LOCALAPPDATA, "natively", "natively.db"));
  }

  return [...new Set(candidates)];
}

function resolveDbPath() {
  return candidateDbPaths().find((candidate) => fs.existsSync(candidate));
}

function connectDb() {
  const dbPath = resolveDbPath();

  if (!dbPath) {
    if (!warnedMissingDb) {
      warnedMissingDb = true;
      console.warn("Natively SQLite DB not found yet.");
      console.warn("Checked:");
      for (const candidate of candidateDbPaths()) {
        console.warn(`  - ${candidate}`);
      }
      console.warn("Set DB_PATH to the full database path if it lives somewhere else.");
    }
    return null;
  }

  if (db && db.name === dbPath) {
    return db;
  }

  if (db) {
    db.close();
  }

  db = new Database(dbPath, {
    fileMustExist: true,
    readonly: true,
    timeout: 100
  });
  db.pragma("query_only = ON");
  db.name = dbPath;

  console.log(`Connected to SQLite DB: ${dbPath}`);
  printSchema(db);
  primeLastSeen(db);
  return db;
}

function quoteIdent(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

function printSchema(database) {
  if (schemaPrinted) {
    return;
  }

  schemaPrinted = true;
  console.log("SQLite schema:");

  const tables = database
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all();

  if (!tables.length) {
    console.log("  No user tables found.");
    return;
  }

  for (const table of tables) {
    const columns = database.prepare(`PRAGMA table_info(${quoteIdent(table.name)})`).all();
    const columnList = columns.map((column) => `${column.name}:${column.type || "unknown"}`).join(", ");
    console.log(`  ${table.name}: ${columnList}`);
  }
}

function primeLastSeen(database) {
  for (const tableName of TABLE_ORDER) {
    const columns = getColumns(database, tableName);
    if (!columns.length || lastSeenByTable.has(tableName)) {
      continue;
    }

    const row = database.prepare(`SELECT MAX(rowid) AS lastId FROM ${quoteIdent(tableName)}`).get();
    lastSeenByTable.set(tableName, Number(row?.lastId || 0));
  }
}

function getColumns(database, tableName) {
  try {
    return database.prepare(`PRAGMA table_info(${quoteIdent(tableName)})`).all();
  } catch (error) {
    return [];
  }
}

function findColumn(columns, candidates) {
  const lowerToName = new Map(columns.map((column) => [String(column.name).toLowerCase(), column.name]));
  return candidates.map((candidate) => lowerToName.get(candidate)).find(Boolean);
}

function normalizeRole(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function extractMessage(row, roleColumn, contentColumn, timeColumn, tableName) {
  const rawContent = row[contentColumn];
  const content = typeof rawContent === "string" ? rawContent.trim() : String(rawContent || "").trim();

  if (!content) {
    return null;
  }

  return {
    id: `${tableName}:${row.__rowid}`,
    table: tableName,
    rowid: row.__rowid,
    role: roleColumn ? row[roleColumn] : "assistant",
    content,
    createdAt: timeColumn && row[timeColumn] ? row[timeColumn] : new Date().toISOString()
  };
}

function readNewMessages(database) {
  const messages = [];

  for (const tableName of TABLE_ORDER) {
    const columns = getColumns(database, tableName);
    if (!columns.length) {
      continue;
    }

    const roleColumn = findColumn(columns, ROLE_COLUMNS);
    const contentColumn = findColumn(columns, CONTENT_COLUMNS);
    const timeColumn = findColumn(columns, TIME_COLUMNS);

    if (!contentColumn) {
      continue;
    }

    const lastSeen = lastSeenByTable.get(tableName) || 0;
    const rows = database
      .prepare(`SELECT rowid AS __rowid, * FROM ${quoteIdent(tableName)} WHERE rowid > ? ORDER BY rowid ASC LIMIT 100`)
      .all(lastSeen);

    for (const row of rows) {
      lastSeenByTable.set(tableName, Math.max(lastSeenByTable.get(tableName) || 0, Number(row.__rowid)));

      if (roleColumn && !ASSISTANT_ROLES.has(normalizeRole(row[roleColumn]))) {
        continue;
      }

      const message = extractMessage(row, roleColumn, contentColumn, timeColumn, tableName);
      if (message) {
        messages.push(message);
      }
    }
  }

  return messages;
}

function isLockError(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || "").toLowerCase();
  return code.includes("BUSY") || code.includes("LOCKED") || message.includes("database is locked");
}

function getLocalNetworkUrls() {
  const urls = [];
  const interfaces = os.networkInterfaces();

  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses || []) {
      if (address.family === "IPv4" && !address.internal) {
        urls.push(`http://${address.address}:${PORT}`);
      }
    }
  }

  return urls;
}

function broadcast(payload) {
  const message = JSON.stringify(payload);

  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

const server = http.createServer((req, res) => {
  if (req.url === "/" || req.url === "/phone.html") {
    const htmlPath = path.join(__dirname, "phone.html");
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    fs.createReadStream(htmlPath).pipe(res);
    return;
  }

  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, clients: wss.clients.size, db: db?.name || null }));
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

const wss = new WebSocket.Server({ server });

wss.on("connection", (socket, req) => {
  console.log(`Phone connected: ${req.socket.remoteAddress}`);
  socket.send(JSON.stringify({ type: "status", connected: true, db: db?.name || null }));
});

setInterval(() => {
  try {
    const database = connectDb();
    if (!database) {
      return;
    }

    for (const message of readNewMessages(database)) {
      broadcast({ type: "message", message });
    }
  } catch (error) {
    if (isLockError(error)) {
      console.warn("SQLite DB is locked; will retry on next poll.");
      return;
    }

    console.error("Polling error:", error.message);
  }
}, POLL_MS);

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Phone Mirror Mode bridge running at http://localhost:${PORT}`);
  const urls = getLocalNetworkUrls();

  if (urls.length) {
    for (const url of urls) {
      console.log(`Open on your phone: ${url}`);
    }
  } else {
    console.log(`Open on your phone: http://<your-computer-ip>:${PORT}`);
  }
});

process.on("SIGINT", () => {
  if (db) {
    db.close();
  }
  server.close(() => process.exit(0));
});
