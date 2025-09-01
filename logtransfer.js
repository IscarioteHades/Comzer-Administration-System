// lokiForwarder.js
// Koyeb の stdout/stderr をキャプチャして Grafana Loki に転送するモジュール
// 必要: npm i axios pako

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

// 元の書き込み関数を保存（ループ防止用）
const ORIGINAL_STDOUT_WRITE = process.stdout.write.bind(process.stdout);
const ORIGINAL_STDERR_WRITE = process.stderr.write.bind(process.stderr);

function internalLog(...args) {
  try {
    const msg = args.join(" ") + "\n";
    ORIGINAL_STDERR_WRITE(msg);
  } catch (e) {
    /* ignore */
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

    this.queue = [];
    this.timer = null;
    this.stopped = true;

    this.axios = axios.create({
      timeout: 15000,
      auth: { username: this.user, password: this.token },
      headers: { "User-Agent": "koyeb-loki-forwarder" },
    });
  }

  start() {
    if (!this.stopped) return;
    if (!this.token) {
      internalLog("[loki] GRAFANA_API_TOKEN not set. forwarding disabled.");
      return;
    }
    this.stopped = false;
    this.timer = setInterval(() => this.flushIfNeeded(), this.flushInterval);
    internalLog("[loki] sender started. url=", this.url);
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
    this.queue.push({ labels, msg: message });
    if (this.queue.length >= this.batchSize) {
      this.flushNow().catch((e) => internalLog("[loki] flush error:", e && e.message ? e.message : e));
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
        const res = await this.axios.post(this.url, body, { headers });
        if (res.status >= 200 && res.status < 300) {
          return;
        } else {
          const errText = `status ${res.status} ${res.statusText}`;
          if (attempt === this.maxRetries) {
            internalLog("[loki] push failed (final):", errText);
            return;
          }
          await this._sleep(this._backoffMs(attempt));
        }
      } catch (err) {
        const errMsg = err.response
          ? `${err.response.status} ${err.response.statusText}`
          : err.message || err;
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
  if (!DEFAULTS.LOKI_TOKEN) {
    internalLog("[loki] WARNING: GRAFANA_API_TOKEN is not set - forwarding disabled");
    return { started: false };
  }

  const loki = new LokiClient(opts);
  loki.start();

  let stdoutBuf = "";
  let stderrBuf = "";

  function wrapStdoutWrite(chunk, encoding, cb) {
    try {
      const s = typeof chunk === "string" ? chunk : chunk.toString(encoding || "utf8");
      stdoutBuf += s;
      let idx;
      while ((idx = stdoutBuf.indexOf("\n")) !== -1) {
        const line = stdoutBuf.slice(0, idx);
        stdoutBuf = stdoutBuf.slice(idx + 1);
        if (line.length > 0) loki.enqueueMessage(line, { stream: "stdout", level: "info" });
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
        if (line.length > 0) loki.enqueueMessage(line, { stream: "stderr", level: "error" });
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
      loki.enqueueMessage(msg, { stream: "stderr", level: "fatal" });
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
      const msg = `unhandledRejection: ${
        reason && reason.stack ? reason.stack : String(reason)
      }`;
      loki.enqueueMessage(msg, { stream: "stderr", level: "error" });
    } catch (_) {}
  });

  return {
    started: true,
    stop: async () => {
      process.stdout.write = ORIGINAL_STDOUT_WRITE;
      process.stderr.write = ORIGINAL_STDERR_WRITE;
      await loki.stop();
    },
  };
}
