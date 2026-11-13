import React, { useState } from "react";
import { Icon } from "../icons.jsx";
import { AccountAvatar, AccountIdentity, IconButton } from "./UI.jsx";
import {
  accountTitle,
  cn,
  formatCode,
  formatMask,
  typeLabel,
} from "../utils.js";

function CountdownRing({ remaining, period, progress }) {
  const radius = 15.5;
  const circumference = 2 * Math.PI * radius;
  const safeProgress = Number.isFinite(progress) ? progress : 1;
  const offset = circumference * (1 - Math.max(0, Math.min(1, safeProgress)));
  return (
    <span className={cn("countdown-ring", remaining <= 5 && "is-expiring")} title={`${remaining} 秒后刷新`}>
      <svg viewBox="0 0 40 40" aria-hidden="true">
        <circle className="ring-track" cx="20" cy="20" r={radius} />
        <circle
          className="ring-progress"
          cx="20"
          cy="20"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <span className="ring-label">{remaining ?? period}</span>
    </span>
  );
}

export default function AccountCard({
  account,
  codeInfo,
  group,
  hidden,
  sorting,
  dragging,
  dragPosition,
  onCopy,
  onEdit,
  onPin,
  onIncrement,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
}) {
  const [incrementing, setIncrementing] = useState(false);
  const code = codeInfo?.ok ? codeInfo.code : null;
  const hasError = codeInfo && codeInfo.ok === false;
  const period = codeInfo?.period || account.period;
  const remaining = codeInfo?.remaining;
  const type = account.type;
  const isHotp = type === "hotp";
  const displayCode = hasError
    ? "无法生成"
    : code
      ? hidden
        ? formatMask(account.digits, account.type)
        : formatCode(code, account.digits)
      : "••• •••";

  function copy() {
    if (sorting) return;
    onCopy?.(account, codeInfo);
  }

  async function increment(event) {
    event.stopPropagation();
    if (incrementing || sorting) return;
    setIncrementing(true);
    try {
      await onIncrement?.(account);
    } finally {
      setIncrementing(false);
    }
  }

  return (
    <article
      className={cn(
        "account-card",
        account.pinned && "is-pinned",
        hidden && "is-hidden",
        hasError && "has-error",
        sorting && "is-sorting",
        dragging && "is-dragging",
        dragPosition && `drop-${dragPosition}`
      )}
      onClick={copy}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          copy();
        }
      }}
      tabIndex={sorting ? -1 : 0}
      role={sorting ? undefined : "button"}
      aria-label={`${accountTitle(account)} 的验证码，${hidden ? "已隐藏" : code || "加载中"}。点击复制`}
      draggable={sorting}
      onDragStart={(event) => {
        if (!sorting) return;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", account.id);
        onDragStart?.(event, account);
      }}
      onDragOver={(event) => {
        if (!sorting) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const rect = event.currentTarget.getBoundingClientRect();
        const position = event.clientY < rect.top + rect.height / 2 ? "before" : "after";
        onDragOver?.(event, account, position);
      }}
      onDragLeave={(event) => {
        if (!sorting) return;
        if (!event.currentTarget.contains(event.relatedTarget)) {
          onDragLeave?.(event, account);
        }
      }}
      onDrop={(event) => {
        if (!sorting) return;
        event.preventDefault();
        onDrop?.(event, account);
      }}
      onDragEnd={(event) => onDragEnd?.(event, account)}
    >
      {sorting ? (
        <span className="drag-handle" aria-hidden="true">
          <Icon name="grip" size={18} />
        </span>
      ) : null}

      <div className="card-top">
        <AccountAvatar account={account} size={40} />
        <AccountIdentity account={account} />
        {!sorting ? (
          <div className="card-actions" onClick={(event) => event.stopPropagation()}>
            <IconButton
              icon="pin"
              label={account.pinned ? "取消固定" : "固定到顶部"}
              size="sm"
              active={account.pinned}
              className={cn("card-action", account.pinned && "is-pinned")}
              onClick={() => onPin?.(account)}
            />
            <IconButton
              icon="edit"
              label="编辑验证码"
              size="sm"
              className="card-action"
              onClick={() => onEdit?.(account)}
            />
          </div>
        ) : null}
      </div>

      <div className="card-code-row">
        <span
          key={hidden ? "hidden" : code || "loading"}
          className={cn(
            "code-value",
            hidden && "is-masked",
            hasError && "is-error",
            codeInfo?.remaining !== null && codeInfo?.remaining <= 5 && !hidden && "is-expiring"
          )}
        >
          {displayCode}
        </span>
        {!sorting ? (
          <span className="copy-hint" aria-hidden="true">
            <Icon name={hidden ? "eyeOff" : "copy"} size={13} />
            {hidden ? "验证码已隐藏" : "点击复制"}
          </span>
        ) : null}
      </div>

      <div className="card-bottom">
        <div className="card-timer">
          {isHotp ? (
            <span className="hotp-mark">
              <Icon name="refresh" size={12} />
              HOTP
            </span>
          ) : (
            <CountdownRing remaining={remaining} period={period} progress={codeInfo?.progress} />
          )}
          <div className="timer-copy">
            <span className="timer-main">
              {hasError
                ? "密钥无效"
                : isHotp
                  ? `计数器 ${account.counter ?? codeInfo?.counter ?? 0}`
                  : hidden
                    ? "验证码已隐藏"
                    : `${remaining ?? period} 秒后刷新`}
            </span>
            <span className="timer-sub">
              {group ? group.name : `${typeLabel(type)} · ${account.algorithm.replace("SHA", "SHA-")}`}
            </span>
          </div>
        </div>

        <div className="card-meta" onClick={(event) => event.stopPropagation()}>
          {isHotp && !sorting ? (
            <button
              type="button"
              className={cn("hotp-button", incrementing && "is-busy")}
              onClick={increment}
              disabled={incrementing}
              title="生成下一个 HOTP 验证码并递增计数器"
            >
              <Icon name="refresh" size={13} />
              {incrementing ? "更新中" : "下一个"}
            </button>
          ) : (
            <span className="type-chip" title={account.algorithm}>
              {group ? `${typeLabel(type)} · ${account.algorithm.replace("SHA", "SHA-")}` : typeLabel(type)}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}
