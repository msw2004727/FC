"use strict";

const crypto = require("crypto");
const net = require("net");

// ASSUMPTION: 未附專案規則檔，本次以附件規格及修訂為實作依據。
const QA_UID_RE = /^U0{28}[0-9]{4}$/;
const QA_DISPLAY_NAME_PREFIX = "QA測試-";
// 2026-10-23 T-028 站長決定測試身分補到管理員以下；admin／super_admin 與其以上的自訂角色仍禁止，白名單必須明確列舉。
const QA_ALLOWED_ROLES = new Set(["user", "coach", "captain", "venue_owner"]);
const QA_PUBLIC_ERROR_MESSAGE = "無法進入測試模式";
const QA_CONFIG_COLLECTION = "qaTestMode";
const QA_CONFIG_DOC_ID = "config";
const QA_THROTTLE_COLLECTION = "qaTestAuthThrottle";
const QA_AGENT_ID_RE = /^[a-z0-9_-]{1,24}$/;
const QA_PERSONA_KEY_RE = /^[A-Za-z0-9_-]{1,32}$/;
// 2026-10-23 站長親口決定封閉測試期下限 6 碼（原 12；安全性靠節流與到期時間）。
const QA_PASSWORD_MIN_LENGTH = 6;
const QA_PASSWORD_MAX_LENGTH = 64;
const QA_INPUT_PASSWORD_MAX_LENGTH = 128;
const QA_CLIENT_IP_XFF_FROM_RIGHT = 1;
const QA_RESERVATION_TTL_MS = 30000;
const QA_DEFAULT_SESSION_CAP_HOURS = 12;
const QA_DEFAULT_MAX_FUTURE_HOURS = 168;
const QA_DEFAULT_THROTTLE = Object.freeze({
  perIp: Object.freeze({ maxFailures: 5, windowSec: 600, lockSec: 900 }),
  global: Object.freeze({ maxFailures: 100, windowSec: 600, lockSec: 300 }),
});
const QA_SECRET_EXPIRY_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?(Z|[+-](\d{2}):(\d{2}))$/;
const QA_THROTTLE_TTL_MS = 24 * 60 * 60 * 1000;

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function normalizeHours(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) &&
    value > 0 && value <= 720 ? value : fallback;
}

function normalizeXffFromRight(value) {
  return Number.isInteger(value) && value >= 1 && value <= 5
    ? value : QA_CLIENT_IP_XFF_FROM_RIGHT;
}

function hasPersonaInvariants(persona) {
  return isPlainObject(persona) &&
    typeof persona.uid === "string" && QA_UID_RE.test(persona.uid) &&
    typeof persona.displayName === "string" &&
    persona.displayName.startsWith(QA_DISPLAY_NAME_PREFIX) &&
    QA_ALLOWED_ROLES.has(persona.role);
}

function parseExpiry(expiry) {
  const match = QA_SECRET_EXPIRY_RE.exec(expiry);
  if (!match) return NaN;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] === undefined ? 0 : Number(match[6]);
  const offsetHour = match[9] === undefined ? 0 : Number(match[9]);
  const offsetMinute = match[10] === undefined ? 0 : Number(match[10]);
  const leapYear = year % 4 === 0 &&
    (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [
    31, leapYear ? 29 : 28, 31, 30, 31, 30,
    31, 31, 30, 31, 30, 31,
  ];

  // Date.parse 可能自動進位，必須先驗證原始日曆與時間。
  if (month < 1 || month > 12 ||
      day < 1 || day > monthDays[month - 1] ||
      hour > 23 || minute > 59 || second > 59 ||
      offsetHour > 23 || offsetMinute > 59) {
    return NaN;
  }
  return Date.parse(expiry);
}

// Secret 每筆為 agentId:password|到期時間[|persona1,persona2]。
function parseQaSecret(rawText, { nowMs, maxFutureHours } = {}) {
  if (typeof rawText !== "string" || !rawText.trim()) {
    return { entries: [], invalidCount: 0 };
  }

  const futureHours = normalizeHours(
    maxFutureHours, QA_DEFAULT_MAX_FUTURE_HOURS
  );
  const candidates = [];
  const passwordCounts = new Map();
  const seenAgents = new Set();
  let invalidCount = 0;

  for (const rawLine of rawText.split(/[;\r\n]/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const colonIndex = line.indexOf(":");
    const agentId = line.slice(0, colonIndex);
    const fields = line.slice(colonIndex + 1).split("|");
    if (colonIndex < 1 || !QA_AGENT_ID_RE.test(agentId) ||
        (fields.length !== 2 && fields.length !== 3)) {
      invalidCount += 1;
      continue;
    }

    const [password, expiry, personaList] = fields;
    const expiresAtMs = parseExpiry(expiry);
    const allowedPersonas = fields.length === 3
      ? [...new Set(personaList.split(","))] : null;

    if (password.length < QA_PASSWORD_MIN_LENGTH ||
        password.length > QA_PASSWORD_MAX_LENGTH ||
        !/^[\x21-\x7E]+$/.test(password) || /[|;]/.test(password) ||
        !Number.isFinite(nowMs) || !Number.isFinite(expiresAtMs) ||
        expiresAtMs - nowMs > futureHours * 3600000 ||
        (allowedPersonas !== null &&
          !allowedPersonas.every((key) => QA_PERSONA_KEY_RE.test(key)))) {
      invalidCount += 1;
      continue;
    }

    // 後出的重複代號仍參與密碼去重，避免掩蓋衝突。
    const duplicateAgent = seenAgents.has(agentId);
    seenAgents.add(agentId);
    passwordCounts.set(password, (passwordCounts.get(password) || 0) + 1);
    candidates.push({
      entry: { agentId, password, expiresAtMs, allowedPersonas },
      duplicateAgent,
    });
  }

  const entries = [];
  for (const { entry, duplicateAgent } of candidates) {
    if (duplicateAgent || passwordCounts.get(entry.password) !== 1) {
      invalidCount += 1;
    } else {
      entries.push(entry);
    }
  }
  return { entries, invalidCount };
}

function matchQaPassword(entries, inputPassword, cryptoModule = crypto) {
  if (entries.length === 0) return null;
  const inputHash = cryptoModule.createHash("sha256")
    .update(inputPassword, "utf8").digest();
  let matched = null;
  for (const entry of entries) {
    const entryHash = cryptoModule.createHash("sha256")
      .update(entry.password, "utf8").digest();
    if (cryptoModule.timingSafeEqual(inputHash, entryHash)) {
      matched = entry;
    }
  }
  return matched;
}

function normalizeThrottle(raw, defaults) {
  const value = isPlainObject(raw) ? raw : {};
  const integer = (key, maximum) =>
    Number.isInteger(value[key]) && value[key] >= 1 && value[key] <= maximum
      ? value[key] : defaults[key];
  return {
    maxFailures: integer("maxFailures", 1000),
    windowSec: integer("windowSec", 86400),
    lockSec: integer("lockSec", 86400),
  };
}

function normalizeQaConfig(raw) {
  const value = isPlainObject(raw) ? raw : {};
  const throttle = isPlainObject(value.throttle) ? value.throttle : {};
  // 合法 key 可能與原型名稱相同。
  const personas = Object.create(null);
  const teams = Object.create(null);

  if (isPlainObject(value.personas)) {
    for (const [key, persona] of Object.entries(value.personas)) {
      if (!QA_PERSONA_KEY_RE.test(key) || !hasPersonaInvariants(persona) ||
          typeof persona.teamKey !== "string" || !persona.teamKey.trim()) {
        continue;
      }
      personas[key] = {
        uid: persona.uid,
        displayName: persona.displayName,
        role: persona.role,
        teamKey: persona.teamKey,
        enabled: persona.enabled !== false,
      };
    }
  }

  if (isPlainObject(value.teams)) {
    for (const [key, team] of Object.entries(value.teams)) {
      if (!isPlainObject(team) || typeof team.teamId !== "string" ||
          !team.teamId.trim() || team.teamId.length > 120) {
        continue;
      }
      teams[key] = {
        teamId: team.teamId,
        name: typeof team.name === "string" ? team.name : "",
      };
    }
  }

  return {
    enabled: value.enabled === true,
    clientIpXffFromRight: normalizeXffFromRight(value.clientIpXffFromRight),
    sessionCapHours: normalizeHours(
      value.sessionCapHours, QA_DEFAULT_SESSION_CAP_HOURS
    ),
    maxFutureHours: normalizeHours(
      value.maxFutureHours, QA_DEFAULT_MAX_FUTURE_HOURS
    ),
    throttle: {
      perIp: normalizeThrottle(throttle.perIp, QA_DEFAULT_THROTTLE.perIp),
      global: normalizeThrottle(throttle.global, QA_DEFAULT_THROTTLE.global),
    },
    personas,
    teams,
  };
}

function normalizeIp(value) {
  if (typeof value !== "string") return "";
  const ip = value.trim();
  const version = net.isIP(ip);
  if (version === 4) return ip;
  if (version !== 6) return "";

  try {
    const canonical = new URL("http://[" + ip + "]/").hostname
      .replace(/^\[|\]$/g, "").toLowerCase();
    // 先統一 IPv6 表示，避免同一 mapped 位址分散到不同節流鍵。
    const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/
      .exec(canonical);
    if (mappedHex) {
      const high = parseInt(mappedHex[1], 16);
      const low = parseInt(mappedHex[2], 16);
      return [
        high >>> 8, high & 255, low >>> 8, low & 255,
      ].join(".");
    }
    const mappedDotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(canonical);
    if (mappedDotted && net.isIP(mappedDotted[1]) === 4) {
      return mappedDotted[1];
    }
    return canonical;
  } catch {
    return "";
  }
}

function resolveQaClientIp(
  rawRequest,
  { xffFromRight = QA_CLIENT_IP_XFF_FROM_RIGHT } = {}
) {
  // 信任最右第 N 段是部署條件假設，須部署後以已知來源 IP 驗證 ipHash。
  // 若實際代理鏈不同，調整設定文件 clientIpXffFromRight，無須重新部署。
  const distance = normalizeXffFromRight(xffFromRight);
  const header = rawRequest?.headers?.["x-forwarded-for"];
  if (typeof header === "string" && header.length <= 2048) {
    const parts = header.split(",");
    const index = parts.length - distance;
    const ip = index >= 0 ? normalizeIp(parts[index]) : "";
    if (ip) return ip;
  }
  return normalizeIp(rawRequest?.ip);
}

function hashQaIp(ip, cryptoModule = crypto) {
  if (!ip) return "";
  return cryptoModule.createHash("sha256").update(ip, "utf8")
    .digest("hex").slice(0, 16);
}

function resolveQaPersona({ config, agent, requestedPersona }) {
  const enabledKeys = Object.keys(config.personas)
    .filter((key) => config.personas[key].enabled !== false);
  const allowedKeys = agent.allowedPersonas === null
    ? enabledKeys
    : enabledKeys.filter((key) => agent.allowedPersonas.includes(key));
  let personaKey;

  if (typeof requestedPersona === "string") {
    if (!hasOwn(config.personas, requestedPersona) ||
        config.personas[requestedPersona].enabled === false) {
      return { ok: false, reasonCode: "qa_persona_unknown" };
    }
    if (!allowedKeys.includes(requestedPersona)) {
      return { ok: false, reasonCode: "qa_persona_not_allowed" };
    }
    personaKey = requestedPersona;
  } else {
    if (allowedKeys.length !== 1) {
      return { ok: false, reasonCode: "qa_persona_not_allowed" };
    }
    [personaKey] = allowedKeys;
  }

  const persona = config.personas[personaKey];
  if (!hasPersonaInvariants(persona)) {
    return { ok: false, reasonCode: "qa_persona_unknown" };
  }
  const team = hasOwn(config.teams, persona.teamKey)
    ? config.teams[persona.teamKey] : null;
  if (!team || typeof team.teamId !== "string" ||
      !team.teamId.trim() || team.teamId.length > 120) {
    return { ok: false, reasonCode: "qa_persona_unprovisioned" };
  }
  return { ok: true, personaKey, persona, teamId: team.teamId };
}

module.exports = {
  QA_UID_RE,
  QA_DISPLAY_NAME_PREFIX,
  QA_ALLOWED_ROLES,
  QA_PUBLIC_ERROR_MESSAGE,
  QA_CONFIG_COLLECTION,
  QA_CONFIG_DOC_ID,
  QA_THROTTLE_COLLECTION,
  QA_AGENT_ID_RE,
  QA_PERSONA_KEY_RE,
  QA_PASSWORD_MIN_LENGTH,
  QA_PASSWORD_MAX_LENGTH,
  QA_INPUT_PASSWORD_MAX_LENGTH,
  QA_CLIENT_IP_XFF_FROM_RIGHT,
  QA_RESERVATION_TTL_MS,
  QA_DEFAULT_SESSION_CAP_HOURS,
  QA_DEFAULT_MAX_FUTURE_HOURS,
  QA_DEFAULT_THROTTLE,
  QA_SECRET_EXPIRY_RE,
  QA_THROTTLE_TTL_MS,
  parseQaSecret,
  matchQaPassword,
  normalizeQaConfig,
  resolveQaClientIp,
  hashQaIp,
  resolveQaPersona,
};
