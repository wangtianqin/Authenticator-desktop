import React, { useEffect, useState } from "react";
import { Icon } from "../../icons.jsx";
import {
  Badge,
  Button,
  Field,
  InlineNotice,
  Modal,
  PasswordInput,
  PasswordStrength,
} from "../UI.jsx";
import { cn, formatBytes, formatDateTime, validatePassword } from "../../utils.js";

const FORMATS = [
  {
    id: "encrypted",
    icon: "lock",
    title: "加密备份",
    extension: ".authbackup",
    description: "使用独立密码和 AES-256-GCM 加密。适合存放在网盘或移动硬盘。",
    recommended: true,
    tone: "success",
  },
  {
    id: "plain",
    icon: "database",
    title: "明文 JSON",
    extension: ".json",
    description: "包含完整密钥，可直接阅读。仅建议在受控环境中临时迁移。",
    tone: "warning",
  },
  {
    id: "extension",
    icon: "layers",
    title: "插件兼容 JSON",
    extension: ".json",
    description: "兼容 Authenticator 浏览器插件的未加密备份格式。",
    tone: "warning",
  },
  {
    id: "otpauth",
    icon: "qr",
    title: "otpauth 文本",
    extension: ".txt",
    description: "每行一个标准 otpauth 链接，可用于导入其他验证器。Steam 账户不会包含在内。",
    tone: "neutral",
  },
];

export default function ExportModal({ open, vault, onClose, onVaultUpdated, toast }) {
  const [kind, setKind] = useState("encrypted");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
    if (!open) return;
    setKind("encrypted");
    setPassword("");
    setConfirmation("");
    setError("");
    setBusy(false);
    setResult(null);
  }, [open]);

  const selected = FORMATS.find((format) => format.id === kind);
  const plaintext = kind !== "encrypted";
  const passwordOk =
    !validatePassword(password) && password === confirmation && password.length > 0;

  async function exportBackup() {
    setError("");
    if (kind === "encrypted") {
      const validation = validatePassword(password);
      if (validation) {
        setError(validation);
        return;
      }
      if (password !== confirmation) {
        setError("两次输入的备份密码不一致。");
        return;
      }
    }
    setBusy(true);
    try {
      const response = await window.authenticator.exportBackup(
        kind,
        kind === "encrypted" ? password : null
      );
      if (response.cancelled) return;
      setResult(response);
      if (response.vault) onVaultUpdated?.(response.vault);
      toast("备份已保存", "success");
    } catch (exportError) {
      setError(exportError.message || "导出失败。");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    return (
      <Modal
        open={open}
        onClose={onClose}
        title="备份已保存"
        subtitle="请把备份文件放在安全且可找回的位置。"
        eyebrow="EXPORT COMPLETE"
        icon={<Icon name="check" size={20} />}
        size="md"
        footer={
          <Button variant="primary" onClick={onClose} block>
            完成
          </Button>
        }
      >
        <div className="export-success">
          <span className="export-success-icon">
            <Icon name="shieldCheck" size={30} />
          </span>
          <h3>{selected?.title}</h3>
          <p className="export-success-note">
            {kind === "encrypted"
              ? "备份使用你刚刚设置的密码加密。请将密码与文件分开保存。"
              : "此文件包含明文密钥。导入完成后，请考虑删除它。"}
          </p>
          <div className="export-path">
            <Icon name="folder" size={15} />
            <code title={result.path}>{result.path}</code>
          </div>
          <div className="export-stats">
            <span>
              <Icon name="database" size={14} />
              {formatBytes(result.bytes)}
            </span>
            <span>
              <Icon name="clock" size={14} />
              {formatDateTime(new Date().toISOString())}
            </span>
            <span>
              <Icon name="key" size={14} />
              {vault.accounts.length} 个账户
            </span>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="导出备份"
      subtitle="选择一种格式。定期备份是找回验证码的唯一方式。"
      eyebrow="EXPORT"
      icon={<Icon name="upload" size={20} />}
      size="lg"
      closeDisabled={busy}
      footer={
        <div className="modal-footer-actions">
          <span className="scanner-footer-hint">
            <Icon name="shieldCheck" size={14} />
            文件写入由你选择的位置
          </span>
          <div className="modal-footer-right">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              取消
            </Button>
            <Button
              variant="primary"
              onClick={exportBackup}
              loading={busy}
              disabled={kind === "encrypted" && !passwordOk}
              icon={<Icon name="download" size={16} />}
            >
              选择保存位置
            </Button>
          </div>
        </div>
      }
    >
      <div className="export-formats">
        {FORMATS.map((format) => (
          <button
            key={format.id}
            type="button"
            className={cn(
              "export-format",
              kind === format.id && "is-selected",
              `format-${format.tone}`
            )}
            onClick={() => {
              setKind(format.id);
              setError("");
              setPassword("");
              setConfirmation("");
            }}
          >
            <span className="export-format-icon">
              <Icon name={format.icon} size={20} />
            </span>
            <span className="export-format-copy">
              <span className="export-format-title">
                {format.title}
                {format.recommended ? <Badge tone="success">推荐</Badge> : null}
              </span>
              <span>{format.description}</span>
              <span className="export-format-ext">{format.extension}</span>
            </span>
            <span className="mode-radio" />
          </button>
        ))}
      </div>

      {kind === "encrypted" ? (
        <div className="export-password">
          <div className="export-password-heading">
            <Icon name="lock" size={16} />
            <div>
              <strong>设置备份密码</strong>
              <span>此密码只用于加密导出文件，可以不同于主密码。</span>
            </div>
          </div>
          <div className="form-grid">
            <Field label="备份密码">
              <PasswordInput
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setError("");
                }}
                placeholder="至少 8 个字符"
                autoComplete="new-password"
                data-autofocus
              />
              <PasswordStrength password={password} />
            </Field>
            <Field label="确认备份密码">
              <PasswordInput
                value={confirmation}
                onChange={(event) => {
                  setConfirmation(event.target.value);
                  setError("");
                }}
                placeholder="再次输入"
                autoComplete="new-password"
              />
            </Field>
          </div>
          <InlineNotice tone="warning" icon="warning">
            备份密码无法找回。如果忘记了，这个备份文件将无法恢复。
          </InlineNotice>
        </div>
      ) : (
        <InlineNotice
          tone="danger"
          icon="warning"
          title="此格式包含明文密钥"
        >
          {selected?.description}
          {""}
          请勿通过聊天工具或邮件发送此文件。导入完成后建议删除。
        </InlineNotice>
      )}

      {plaintext ? (
        <div className="export-plain-note">
          <Icon name="info" size={14} />
          当前保险库有 {vault.accounts.length} 个账户；导出会把密钥以可读形式写入文件。
        </div>
      ) : null}

      {error ? (
        <div className="form-error form-error-block" role="alert">
          <Icon name="warning" size={15} />
          {error}
        </div>
      ) : null}
    </Modal>
  );
}
