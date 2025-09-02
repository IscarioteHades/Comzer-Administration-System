// lokiForwarder.debug.js
// Debug-enhanced (safe) version of lokiForwarder for Koyeb.
// Usage: replace your existing lokiForwarder.js with this during debugging.
// Requires: npm i axios pako

import axios from "axios";
import pako from "pako";

const DEFAULTS = {
  LOKI_URL: process.env.LOKI_PUSH_URL || "https://logs-prod-030.grafana.net/loki/api/v1/push",
  LOKI_USER: process.env.LOKI_USER || "1320980",
  LOKI_TOKEN: process.env.GRAFANA_API_TOKEN || "",
  BATCH_SIZE: parseInt(process.env.LOKI_BATCH_SIZE || "100", 10),
  FLUSH_INTERVAL_MS: parseInt(process.env.LOKI_FLUSH_INTERVAL_MS || "5000", 10),
  MAX_RETRIES: parseInt(process.env.LOKI_MAX_RETRIES || "5", 10),
  RETRY_BASE_MS: parseInt(process.env.LOKI_RETRY_BASE_MS || "500", 10),
  USE_GZIP: (process.env.LOKI_USE_GZIP || "true") === "true",
  KOYEB_SERVICE_LABEL: process.env.KOYEB_SERVICE_LABEL || undefined,
};

// Save original write funcs (used to avoid recursive logging)
const ORIGINAL_STDOUT_WRITE = process.stdout.write.bind(process.stdout);
const ORIGINAL_STDERR_WRITE = process.stderr.write.bind(process.stderr);

// internalLog MUST NOT use console.error or other wrapped APIs to avoid recursion.
function internalLog(...args) {
  try {
    const parts = args.map((a) => {
      if (typeof a === "string") return a;
      try { return JSON.stringify(a); } catch { return String(a); }
    });
    const msg = "[loki-debug] " + parts.join(" ") + "\n";
    // Write directly to original stderr (bypass wrappers)
    ORIGINAL_STDERR_WRITE(msg);
  } catch (e) {
    // If even this fails, do nothing to avoid loops
  }
}

function nowNs() {
  const ms = BigInt(Date.now());
  const hr = process.hrtime.bigint() % 1000000n;
  return (ms * 1000000n + hr).toString();
}

class LokiClient {
  constructor(opts = {}) {
    this.url = opts.url || DEFAULTS.LOKI_URL;
    this.user = opts.user || DEFAULTS.LOKI_USER;
    this.token = opts.token || DEFAULTS.LOKI_TOKEN;
    this.batchSize = opts.batchSize || DEFAULTS.BATCH_SIZE;
    this.flushInterval = opts.flushInterval || DEFAULTS.FLUSH_INTERVAL_MS;
    this.maxRetries = opts.maxRetries || DEFAULTS.MAX_RETRIES;
    this.retryBase = opts.retryBase || DEFAULTS.RETRY_BASE_MS;
    this.useGzip = opts.useGzip !== undefined ? opts.useGzip : DEFAULTS.USE_GZIP;
    this.debug = opts.debug || false;

    this.queue = [];
    this.timer = null;
    this.stopped = true;
    
    this.axios = axios.create(
      timeout: 15000,
      headers: {
      "User-Agent": "koyeb-loki-forwarder",
        "Authorization": `Bearer ${this.token}`, 
    },
  });



    if (this.debug) internalLog("LokiClient constructed", { url: this.url, user: this.user, batchSize: this.batchSize });
  }

  start() {
    if (!this.stopped) return;
    if (!this.token) {
      internalLog("[loki] GRAFANA_API_TOKEN not set. forwarding disabled.");
      return;
    }
    this.stopped = false;
    this.timer = setInterval(() => this.flushIfNeeded(), this.flushInterval);
    internalLog("[loki] sender started.", "url=", this.url, "batchSize=", this.batchSize, "flushInterval=", this.flushInterval);
  }

  stop() {
    if (this.stopped) return;
    clearInterval(this.timer);
    this.timer = null;
    this.stopped = true;
    return this.flushNow().catch((e) => {
      internalLog("[loki] final flush failed:", e && e.message ? e.message : e);
    });
  }

  enqueueMessage(message, labels = {}) {
    const MAX_QUEUE = 10000; // safety cap
    if (this.queue.length >= MAX_QUEUE) {
      internalLog('[loki] queue full - dropping message');
      return;
    }
    this.queue.push({ labels, msg: message });
    if (this.debug) internalLog("[loki] enqueued:", message, "labels=", labels, "queueLen=", this.queue.length);
    if (this.queue.length >= this.batchSize) {
      // schedule flush but avoid unbounded recursion: use nextTick to decouple
      process.nextTick(() => {
        this.flushNow().catch((e) => internalLog("[loki] flush error:", e && e.message ? e.message : e));
      });
    }
  }

  groupStreams(items) {
    const map = new Map();
    for (const it of items) {
      const labelsObj = Object.assign({}, it.labels);
      if (DEFAULTS.KOYEB_SERVICE_LABEL) labelsObj.koyeb_service = DEFAULTS.KOYEB_SERVICE_LABEL;
      const key = Object.keys(labelsObj)
        .sort()
        .map((k) => `${k}=${labelsObj[k]}`)
        .join("|");
      if (!map.has(key)) map.set(key, { stream: labelsObj, values: [] });
      map.get(key).values.push([nowNs(), it.msg]);
    }
    return Array.from(map.values());
  }

  async flushIfNeeded() {
    if (this.queue.length === 0) return;
    await this.flushNow();
  }

  async flushNow() {
    if (this.queue.length === 0) return;
    const items = this.queue.splice(0, this.batchSize);
    const streams = this.groupStreams(items);
    const payload = { streams };

    try {
      if (this.debug) internalLog("[loki] flushNow payload:", JSON.stringify(payload));
    } catch (e) {
      // ignore
    }

    let body = Buffer.from(JSON.stringify(payload), "utf8");
    const headers = { "Content-Type": "application/json" };
    if (this.useGzip) {
      try {
        body = Buffer.from(pako.gzip(body));
        headers["Content-Encoding"] = "gzip";
      } catch (e) {
        internalLog("[loki] gzip failed, sending uncompressed:", e && e.message ? e.message : e);
      }
    }

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        if (this.debug) internalLog(`[loki] POST attempt ${attempt} url=${this.url} bytes=${body.length}`);
        const res = await this.axios.post(this.url, body, { headers });
        if (this.debug) internalLog("[loki] POST response:", res.status, res.statusText);
        if (res.status >= 200 && res.status < 300) {
          if (this.debug) internalLog("[loki] push succeeded");
          return;
        } else {
          const errText = `status ${res.status} ${res.statusText}`;
          internalLog("[loki] push non-2xx:", errText);
          if (attempt === this.maxRetries) {
            internalLog("[loki] push failed (final):", errText);
            return;
          }
          await this._sleep(this._backoffMs(attempt));
        }
      } catch (err) {
        const errMsg = err.response
          ? `${err.response.status} ${JSON.stringify(err.response.data || err.response.statusText)}`
          : err.message || err;
        internalLog("[loki] POST exception:", errMsg);
        if (attempt === this.maxRetries) {
          internalLog("[loki] push failed (final):", errMsg);
          return;
        }
        await this._sleep(this._backoffMs(attempt));
      }
    }
  }

  _backoffMs(attempt) {
    const base = this.retryBase;
    const exp = Math.pow(2, attempt);
    const jitter = Math.floor(Math.random() * 100);
    return Math.round(base * exp + jitter);
  }

  _sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

export function startForwarding(opts = {}) {
  if (opts.debug) DEFAULTS.DEBUG = true;

  if (!DEFAULTS.LOKI_TOKEN) {
    internalLog("[loki] WARNING: GRAFANA_API_TOKEN is not set - forwarding disabled");
    return { started: false };
  }

  const loki = new LokiClient(opts);
  loki.start();

  let stdoutBuf = "";
  let stderrBuf = "";

  // Helper: ignore internal debug lines to avoid enqueueing our own debug messages
  function isInternalDebugLine(line) {
    return typeof line === "string" && line.indexOf("[loki-debug]") === 0;
  }

  function wrapStdoutWrite(chunk, encoding, cb) {
    try {
      const s = typeof chunk === "string" ? chunk : chunk.toString(encoding || "utf8");
      stdoutBuf += s;
      let idx;
      while ((idx = stdoutBuf.indexOf("\n")) !== -1) {
        const line = stdoutBuf.slice(0, idx);
        stdoutBuf = stdoutBuf.slice(idx + 1);
        if (line.length > 0) {
          if (!isInternalDebugLine(line)) {
            loki.enqueueMessage(line, { stream: "stdout", level: "info" });
          } else {
            // write internal debug directly to original stderr (do not enqueue)
            ORIGINAL_STDERR_WRITE(line + "\n");
          }
        }
      }
    } catch (e) {
      /* swallow */
    }
    return ORIGINAL_STDOUT_WRITE(chunk, encoding, cb);
  }

  function wrapStderrWrite(chunk, encoding, cb) {
    try {
      const s = typeof chunk === "string" ? chunk : chunk.toString(encoding || "utf8");
      stderrBuf += s;
      let idx;
      while ((idx = stderrBuf.indexOf("\n")) !== -1) {
        const line = stderrBuf.slice(0, idx);
        stderrBuf = stderrBuf.slice(idx + 1);
        if (line.length > 0) {
          if (!isInternalDebugLine(line)) {
            loki.enqueueMessage(line, { stream: "stderr", level: "error" });
          } else {
            ORIGINAL_STDERR_WRITE(line + "\n");
          }
        }
      }
    } catch (e) {
      /* swallow */
    }
    return ORIGINAL_STDERR_WRITE(chunk, encoding, cb);
  }

  process.stdout.write = wrapStdoutWrite;
  process.stderr.write = wrapStderrWrite;

  process.on("uncaughtException", (err) => {
    try {
      const msg = `uncaughtException: ${err && err.stack ? err.stack : String(err)}`;
      // ensure not to enqueue our own internal lines
      if (!isInternalDebugLine(msg)) loki.enqueueMessage(msg, { stream: "stderr", level: "fatal" });
    } catch (_) {}
    loki
      .stop()
      .then(() => {
        internalLog("[loki] flushed after uncaughtException, exiting");
        process.exit(1);
      })
      .catch(() => process.exit(1));
  });

  process.on("unhandledRejection", (reason) => {
    try {
      const msg = `unhandledRejection: ${reason && reason.stack ? reason.stack : String(reason)}`;
      if (!isInternalDebugLine(msg)) loki.enqueueMessage(msg, { stream: "stderr", level: "error" });
    } catch (_) {}
  });

  const startedFlag = !loki.stopped;
  return {
    started: startedFlag,
    stop: async () => {
      process.stdout.write = ORIGINAL_STDOUT_WRITE;
      process.stderr.write = ORIGINAL_STDERR_WRITE;
      await loki.stop();
    },
  };
}
