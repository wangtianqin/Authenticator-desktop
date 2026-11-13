import React, {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Icon, LogoMark } from "../icons.jsx";
import {
  accountSubtitle,
  accountTitle,
  avatarGradient,
  cn,
  initials,
  passwordScore,
  passwordScoreColor,
  passwordScoreLabel,
} from "../utils.js";

export function Spinner({ size = 16, className = "" }) {
  return <span className={cn("spinner", className)} style={{ width: size, height: size }} />;
}

export function Button({
  children,
  variant = "secondary",
  size = "md",
  icon,
  trailing,
  loading = false,
  block = false,
  className = "",
  disabled,
  type = "button",
  ...rest
}) {
  return (
    <button
      type={type}
      className={cn(
        "btn",
        `btn-${variant}`,
        `btn-${size}`,
        block && "btn-block",
        loading && "is-loading",
        className
      )}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Spinner size={size === "sm" ? 14 : 16} /> : icon}
      {children ? <span>{children}</span> : null}
      {!loading && trailing}
    </button>
  );
}

export function IconButton({
  icon,
  label,
  size = "md",
  variant = "ghost",
  className = "",
  active = false,
  ...rest
}) {
  return (
    <button
      type="button"
      className={cn(
        "icon-btn",
        `icon-btn-${size}`,
        variant !== "ghost" && `icon-btn-${variant}`,
        active && "is-active",
        className
      )}
      aria-label={label}
      title={label}
      {...rest}
    >
      {typeof icon === "string" ? <Icon name={icon} /> : icon}
    </button>
  );
}

export function Field({ label, hint, error, optional, htmlFor, children, className = "" }) {
  return (
    <div className={cn("field", error && "has-error", className)}>
      {label ? (
        <div className="field-label-row">
          <label className="field-label" htmlFor={htmlFor}>
            {label}
            {optional ? <span className="field-optional">可选</span> : null}
          </label>
          {hint ? <span className="field-hint">{hint}</span> : null}
        </div>
      ) : null}
      {children}
      {error ? <p className="field-error">{error}</p> : null}
    </div>
  );
}

export const TextInput = forwardRef(function TextInput(
  { className = "", prefix, suffix, ...rest },
  ref
) {
  return (
    <div className={cn("input-shell", prefix && "has-prefix", suffix && "has-suffix", className)}>
      {prefix ? <span className="input-affix input-prefix">{prefix}</span> : null}
      <input ref={ref} className="text-input" {...rest} />
      {suffix ? <span className="input-affix input-suffix">{suffix}</span> : null}
    </div>
  );
});

export const PasswordInput = forwardRef(function PasswordInput(
  { className = "", autoComplete = "current-password", ...rest },
  ref
) {
  const [visible, setVisible] = useState(false);
  return (
    <div className={cn("input-shell password-shell", className)}>
      <input
        ref={ref}
        type={visible ? "text" : "password"}
        className="text-input"
        autoComplete={autoComplete}
        {...rest}
      />
      <button
        type="button"
        className="input-eye"
        onClick={() => setVisible((value) => !value)}
        aria-label={visible ? "隐藏密码" : "显示密码"}
        title={visible ? "隐藏密码" : "显示密码"}
        tabIndex={-1}
      >
        <Icon name={visible ? "eyeOff" : "eye"} size={17} />
      </button>
    </div>
  );
});

export function Select({ className = "", children, ...rest }) {
  return (
    <div className={cn("select-shell", className)}>
      <select className="select-input" {...rest}>
        {children}
      </select>
      <Icon name="chevronDown" size={15} className="select-chevron" />
    </div>
  );
}

export function Switch({ checked, onChange, label, description, disabled = false }) {
  return (
    <label className={cn("switch-row", disabled && "is-disabled")}>
      <span className="switch-copy">
        <span className="switch-label">{label}</span>
        {description ? <span className="switch-description">{description}</span> : null}
      </span>
      <span className="switch-control">
        <input
          type="checkbox"
          checked={Boolean(checked)}
          onChange={(event) => onChange?.(event.target.checked)}
          disabled={disabled}
        />
        <span className="switch-track">
          <span className="switch-thumb" />
        </span>
      </span>
    </label>
  );
}

export function Segmented({ options, value, onChange, className = "", size = "md" }) {
  return (
    <div className={cn("segmented", `segmented-${size}`, className)} role="tablist">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          className={cn("segment", value === option.value && "is-selected")}
          onClick={() => onChange?.(option.value)}
          disabled={option.disabled}
          title={option.description || option.label}
        >
          {option.icon ? (
            typeof option.icon === "string" ? (
              <Icon name={option.icon} size={15} />
            ) : (
              option.icon
            )
          ) : null}
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function PasswordStrength({ password }) {
  if (!password) return null;
  const score = passwordScore(password);
  return (
    <div className="password-strength">
      <div className="strength-bars">
        {[0, 1, 2, 3].map((index) => (
          <span
            key={index}
            className="strength-bar"
            style={{ background: index <= score ? passwordScoreColor(score) : undefined }}
          />
        ))}
      </div>
      <span className="strength-label" style={{ color: passwordScoreColor(score) }}>
        {passwordScoreLabel(score)}
      </span>
    </div>
  );
}

export function Badge({ children, tone = "neutral", icon, className = "" }) {
  return (
    <span className={cn("badge", `badge-${tone}`, className)}>
      {icon ? (typeof icon === "string" ? <Icon name={icon} size={13} /> : icon) : null}
      {children}
    </span>
  );
}

export function AccountAvatar({ account, size = 42, className = "" }) {
  return (
    <span
      className={cn("account-avatar", className)}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.31),
        background: avatarGradient(account),
        fontSize: Math.max(11, Math.round(size * 0.3)),
      }}
      aria-hidden="true"
    >
      {initials(account)}
    </span>
  );
}

export function AccountIdentity({ account, compact = false }) {
  return (
    <div className="account-identity">
      <div className="account-title" title={accountTitle(account)}>
        {accountTitle(account)}
      </div>
      {!compact ? (
        <div className="account-subtitle" title={accountSubtitle(account)}>
          {accountSubtitle(account)}
        </div>
      ) : null}
    </div>
  );
}

let scrollLockCount = 0;
let previousBodyOverflow = "";

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  eyebrow,
  icon,
  children,
  footer,
  size = "md",
  closeDisabled = false,
  className = "",
  bodyClassName = "",
}) {
  const panelRef = useRef(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement;
    scrollLockCount += 1;
    if (scrollLockCount === 1) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
    }

    const focusTimer = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const preferred = panel.querySelector("[data-autofocus]");
      const field = panel.querySelector(
        'input:not([disabled]):not([type="hidden"]), textarea:not([disabled]), select:not([disabled])'
      );
      (preferred || field || panel).focus?.();
    }, 60);

    const onKeyDown = (event) => {
      if (event.key === "Escape" && !closeDisabled) {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = Array.from(
        panel.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((element) => element.offsetParent !== null);
      if (!focusable.length) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKeyDown, true);
      scrollLockCount = Math.max(0, scrollLockCount - 1);
      if (scrollLockCount === 0) document.body.style.overflow = previousBodyOverflow;
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        window.setTimeout(() => {
          try {
            previouslyFocused.focus();
          } catch {
            // The trigger may have unmounted.
          }
        }, 20);
      }
    };
  }, [open, closeDisabled]);

  if (!open) return null;

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !closeDisabled) onClose?.();
      }}
    >
      <section
        className={cn("modal-panel", `modal-${size}`, className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={panelRef}
        tabIndex={-1}
      >
        <header className="modal-header">
          <div className="modal-heading">
            {icon ? <div className="modal-icon">{icon}</div> : null}
            <div>
              {eyebrow ? <div className="modal-eyebrow">{eyebrow}</div> : null}
              <h2 id={titleId}>{title}</h2>
              {subtitle ? <p>{subtitle}</p> : null}
            </div>
          </div>
          <IconButton icon="x" label="关闭" onClick={onClose} disabled={closeDisabled} />
        </header>
        <div className={cn("modal-body", bodyClassName)}>{children}</div>
        {footer ? <footer className="modal-footer">{footer}</footer> : null}
      </section>
    </div>,
    document.body
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "确认",
  cancelLabel = "取消",
  tone = "default",
  requireText = "",
  icon = "warning",
  busy = false,
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (open) {
      setValue("");
      setError("");
      setWorking(false);
    }
  }, [open]);

  const textMatches = !requireText || value === requireText;
  const isBusy = busy || working;

  async function confirm() {
    if (!textMatches || isBusy) return;
    setWorking(true);
    setError("");
    try {
      await onConfirm?.();
    } catch (confirmError) {
      setError(confirmError.message || "操作失败。");
    } finally {
      setWorking(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      closeDisabled={isBusy}
      icon={<Icon name={icon} size={20} />}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={isBusy}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "primary"}
            onClick={confirm}
            loading={isBusy}
            disabled={!textMatches}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {message ? <div className="confirm-message">{message}</div> : null}
      {requireText ? (
        <Field
          label={`输入“${requireText}”以确认`}
          error={error}
          className="confirm-field"
        >
          <TextInput
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={requireText}
            data-autofocus
            spellCheck={false}
          />
        </Field>
      ) : error ? (
        <p className="form-error">{error}</p>
      ) : null}
    </Modal>
  );
}

export function EmptyState({ icon = "key", title, description, actions, variant = "default" }) {
  return (
    <div className={cn("empty-state", `empty-${variant}`)}>
      <div className="empty-art">
        <span className="empty-ring empty-ring-1" />
        <span className="empty-ring empty-ring-2" />
        <span className="empty-icon">
          {typeof icon === "string" ? <Icon name={icon} size={28} /> : icon}
        </span>
      </div>
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
      {actions ? <div className="empty-actions">{actions}</div> : null}
    </div>
  );
}

export function ToastStack({ toasts, onDismiss }) {
  return createPortal(
    <div className="toast-stack" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div key={toast.id} className={cn("toast", `toast-${toast.type || "success"}`, toast.leaving && "is-leaving")}>
          <span className="toast-icon">
            <Icon
              name={
                toast.type === "error"
                  ? "warning"
                  : toast.type === "info"
                    ? "info"
                    : "check"
              }
              size={15}
            />
          </span>
          <span className="toast-message">{toast.message}</span>
          <button
            type="button"
            className="toast-close"
            aria-label="关闭提示"
            onClick={() => onDismiss?.(toast.id)}
          >
            <Icon name="x" size={13} />
          </button>
        </div>
      ))}
    </div>,
    document.body
  );
}

export function InlineNotice({ tone = "info", icon = "info", title, children, actions }) {
  return (
    <div className={cn("inline-notice", `notice-${tone}`)}>
      <span className="notice-icon">
        {typeof icon === "string" ? <Icon name={icon} size={18} /> : icon}
      </span>
      <div className="notice-copy">
        {title ? <strong>{title}</strong> : null}
        {children ? <div>{children}</div> : null}
      </div>
      {actions ? <div className="notice-actions">{actions}</div> : null}
    </div>
  );
}

export function BrandBlock({ compact = false }) {
  return (
    <div className={cn("brand-block", compact && "brand-block-compact")}>
      <LogoMark size={compact ? 30 : 38} />
      {!compact ? (
        <div className="brand-copy">
          <span className="brand-name">Authenticator</span>
          <span className="brand-edition">DESKTOP</span>
        </div>
      ) : null}
    </div>
  );
}
