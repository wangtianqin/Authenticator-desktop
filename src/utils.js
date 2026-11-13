export function cn(...values) {
  return values.filter(Boolean).join(" ");
}

export function formatCode(code, digits) {
  if (!code) return "";
  if (code === "------") return code;
  if (/[A-Z]/.test(code)) return code;
  const clean = String(code).replace(/\s/g, "");
  const size = Number(digits) || clean.length;
  if (clean.length === 6) return `${clean.slice(0, 3)} ${clean.slice(3)}`;
  if (clean.length === 7) return `${clean.slice(0, 4)} ${clean.slice(4)}`;
  if (clean.length === 8) return `${clean.slice(0, 4)} ${clean.slice(4)}`;
  if (clean.length > 8) {
    const middle = Math.ceil(clean.length / 2);
    return `${clean.slice(0, middle)} ${clean.slice(middle)}`;
  }
  if (size === 5) return clean;
  return clean;
}

export function formatMask(digits, type) {
  const count = type === "steam" ? 5 : Number(digits) || 6;
  const groups = count === 6 ? "••• •••" : count === 8 ? "•••• ••••" : "•".repeat(count);
  return groups;
}

export function accountTitle(account) {
  if (!account) return "";
  return account.issuer || account.account || "未命名验证码";
}

export function accountSubtitle(account) {
  if (!account) return "";
  if (account.issuer && account.account) return account.account;
  if (!account.issuer && account.account) return "未设置发行方";
  return "未命名账户";
}

export function typeLabel(type) {
  return { totp: "TOTP", hotp: "HOTP", steam: "Steam" }[type] || "TOTP";
}

export function typeDescription(type) {
  return {
    totp: "基于时间，每 30 秒更新",
    hotp: "基于计数器，每次手动更新",
    steam: "Steam Guard 五码",
  }[type] || "";
}

export function searchableText(account, groups) {
  const group = groups.find((item) => item.id === account.groupId);
  return [account.issuer, account.account, account.notes, group?.name, typeLabel(account.type)]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("zh-CN");
}

export function initials(account) {
  const source = (account?.issuer || account?.account || "?").trim();
  if (!source) return "?";
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length > 1 && /^[\x20-\x7E]+$/.test(source)) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  const chars = Array.from(source);
  return chars.slice(0, 2).join("").toUpperCase();
}

const AVATAR_GRADIENTS = [
  ["#0f9f8f", "#0b6f65"],
  ["#6366f1", "#4338ca"],
  ["#f59e0b", "#b45309"],
  ["#ec4899", "#be185d"],
  ["#0ea5e9", "#0369a1"],
  ["#84cc16", "#4d7c0f"],
  ["#f97316", "#c2410c"],
  ["#8b5cf6", "#6d28d9"],
  ["#14b8a6", "#0f766e"],
  ["#ef4444", "#b91c1c"],
];

function hashText(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash);
}

export function avatarGradient(account) {
  const seed = `${account?.issuer || ""}|${account?.account || ""}`;
  const pair = AVATAR_GRADIENTS[hashText(seed) % AVATAR_GRADIENTS.length];
  return `linear-gradient(145deg, ${pair[0]}, ${pair[1]})`;
}

export function formatDateTime(value) {
  if (!value) return "尚未备份";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatDate(value) {
  if (!value) return "未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

export function relativeLockTime(minutes) {
  const value = Number(minutes);
  if (!value) return "关闭自动锁定";
  if (value < 60) return `${value} 分钟无操作后锁定`;
  if (value === 60) return "1 小时无操作后锁定";
  return `${Math.round(value / 60)} 小时无操作后锁定`;
}

export function passwordScore(password) {
  const value = String(password || "");
  let score = 0;
  if (value.length >= 8) score += 1;
  if (value.length >= 12) score += 1;
  if (value.length >= 16) score += 1;
  if (/[a-z]/.test(value) && /[A-Z]/.test(value)) score += 1;
  if (/\d/.test(value)) score += 1;
  if (/[^A-Za-z0-9]/.test(value)) score += 1;
  return Math.min(4, Math.floor(score * 0.75));
}

export function passwordScoreLabel(score) {
  return ["太弱", "较弱", "一般", "良好", "很强"][score] || "太弱";
}

export function passwordScoreColor(score) {
  return ["#ef4444", "#f97316", "#f59e0b", "#14b8a6", "#0f9f8f"][score] || "#ef4444";
}

export function validatePassword(password) {
  if (!password) return "请输入主密码。";
  if (password.length < 8) return "主密码至少需要 8 个字符。";
  if (password.length > 256) return "主密码过长。";
  return "";
}

export function isTypingTarget(target) {
  if (!target) return false;
  const tag = target.tagName?.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    target.isContentEditable
  );
}

export function groupColorStyle(color) {
  return { "--group-color": color || "#14b8a6" };
}

export function sortAccounts(accounts) {
  return [...accounts].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return a.order - b.order;
  });
}

export function applyReorder(accounts, fromId, toId, position = "before") {
  if (!fromId || !toId || fromId === toId) return accounts;
  const list = [...accounts];
  const fromIndex = list.findIndex((item) => item.id === fromId);
  let toIndex = list.findIndex((item) => item.id === toId);
  if (fromIndex === -1 || toIndex === -1) return accounts;
  const [moved] = list.splice(fromIndex, 1);
  toIndex = list.findIndex((item) => item.id === toId);
  if (position === "after") toIndex += 1;
  list.splice(toIndex, 0, moved);
  return list;
}

export function isCodeError(code) {
  return !code || code.ok === false;
}

export async function copyWithToast(text, toast) {
  try {
    const result = await window.authenticator.copyText(text);
    if (result.clearSeconds > 0) {
      toast(`验证码已复制，${result.clearSeconds} 秒后自动清除`, "success");
    } else {
      toast("验证码已复制", "success");
    }
    return true;
  } catch (error) {
    toast(error.message || "复制失败", "error");
    return false;
  }
}

export function focusElement(element) {
  if (!element) return;
  requestAnimationFrame(() => {
    try {
      element.focus();
      if (typeof element.select === "function") element.select();
    } catch {
      // Ignore focus errors after unmount.
    }
  });
}

export function useMediaTheme() {
  return window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
}
