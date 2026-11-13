import React, { useEffect, useMemo, useRef, useState } from "react";
import qrcode from "qrcode-generator";
import { Icon } from "../../icons.jsx";
import {
  AccountAvatar,
  Badge,
  Button,
  Field,
  InlineNotice,
  Modal,
  PasswordInput,
  Segmented,
  Select,
  TextInput,
} from "../UI.jsx";
import {
  accountTitle,
  cn,
  formatCode,
  typeDescription,
  typeLabel,
} from "../../utils.js";

function makeQrDataUrl(uri) {
  const qr = qrcode(0, "M");
  qr.addData(uri);
  qr.make();
  return qr.createDataURL(5, 12);
}

export default function AccountModal({
  open,
  account = null,
  draft = null,
  groups,
  onClose,
  onSaved,
  onRequestDelete,
  toast,
}) {
  const editing = Boolean(account?.id);
  const initial = editing ? account : draft || {};
  const [type, setType] = useState(initial.type || "totp");
  const [issuer, setIssuer] = useState(initial.issuer || "");
  const [accountName, setAccountName] = useState(initial.account || "");
  const [secret, setSecret] = useState(draft?.secret || "");
  const [secretType, setSecretType] = useState(draft?.secretType || "base32");
  const [algorithm, setAlgorithm] = useState(initial.algorithm || "SHA1");
  const [digits, setDigits] = useState(initial.digits || 6);
  const [period, setPeriod] = useState(initial.period || 30);
  const [counter, setCounter] = useState(initial.counter || 0);
  const [groupId, setGroupId] = useState(initial.groupId || "");
  const [notes, setNotes] = useState(initial.notes || "");
  const [advanced, setAdvanced] = useState(Boolean(draft?.secretType === "hex"));
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [currentSecret, setCurrentSecret] = useState("");
  const [qrData, setQrData] = useState("");
  const [toolBusy, setToolBusy] = useState("");
  const [copiedUri, setCopiedUri] = useState(false);
  const previewTimer = useRef(null);

  const displayAccount = useMemo(
    () => ({
      issuer: issuer.trim(),
      account: accountName.trim(),
      type,
    }),
    [issuer, accountName, type]
  );

  useEffect(() => {
    if (!open) return;
    const seed = editing ? account : draft || {};
    setType(seed.type || "totp");
    setIssuer(seed.issuer || "");
    setAccountName(seed.account || "");
    setSecret(draft?.secret || "");
    setSecretType(draft?.secretType || seed.secretType || "base32");
    setAlgorithm(seed.algorithm || "SHA1");
    setDigits(seed.digits || (seed.type === "steam" ? 5 : 6));
    setPeriod(seed.period || 30);
    setCounter(seed.counter || 0);
    setGroupId(seed.groupId || "");
    setNotes(seed.notes || "");
    setAdvanced(Boolean(draft?.secretType === "hex"));
    setPreview(null);
    setPreviewError("");
    setError("");
    setBusy(false);
    setDetailsOpen(false);
    setCurrentSecret("");
    setQrData("");
    setCopiedUri(false);
  }, [open, editing, account?.id]);

  useEffect(() => {
    if (!open) return undefined;
    if (previewTimer.current) window.clearTimeout(previewTimer.current);
    const canPreview = Boolean((secret.trim() || (editing && account?.id)) && (issuer.trim() || accountName.trim()));
    if (!canPreview) {
      setPreview(null);
      setPreviewError("");
      return undefined;
    }
    previewTimer.current = window.setTimeout(async () => {
      try {
        const payload = {
          type,
          issuer,
          account: accountName,
          secret,
          secretType,
          algorithm: type === "steam" ? "SHA1" : algorithm,
          digits: type === "steam" ? 5 : Number(digits),
          period: type === "hotp" ? 30 : Number(period),
          counter: Number(counter),
        };
        const result = await window.authenticator.previewAccount(payload, editing ? account.id : null);
        setPreview({ ...result, type, digits: type === "steam" ? 5 : Number(digits) });
        setPreviewError("");
      } catch (previewFailure) {
        setPreview(null);
        setPreviewError(previewFailure.message || "无法生成预览");
      }
    }, 320);
    return () => {
      if (previewTimer.current) window.clearTimeout(previewTimer.current);
    };
  }, [
    open,
    editing,
    account?.id,
    type,
    issuer,
    accountName,
    secret,
    secretType,
    algorithm,
    digits,
    period,
    counter,
  ]);

  if (!open) return null;

  function changeType(nextType) {
    setType(nextType);
    if (nextType === "steam") {
      setDigits(5);
      setPeriod(30);
      setAlgorithm("SHA1");
      setSecretType("base32");
    } else if (nextType === "hotp") {
      setPeriod(30);
    } else if (Number(digits) === 5) {
      setDigits(6);
    }
  }

  async function save(event) {
    event.preventDefault();
    setError("");
    if (!issuer.trim() && !accountName.trim()) {
      setError("请填写发行方或账户名称。");
      return;
    }
    if (!editing && !secret.trim()) {
      setError("请输入密钥，或使用扫描二维码添加。");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        type,
        issuer: issuer.trim(),
        account: accountName.trim(),
        secret: secret.trim(),
        secretType,
        algorithm: type === "steam" ? "SHA1" : algorithm,
        digits: type === "steam" ? 5 : Number(digits),
        period: type === "hotp" ? 30 : Number(period),
        counter: Number(counter),
        groupId: groupId || null,
        notes: notes.trim(),
      };
      const result = editing
        ? await window.authenticator.updateAccount(account.id, payload)
        : await window.authenticator.addAccount(payload);
      onSaved?.(result.vault, editing ? "update" : "add");
    } catch (saveError) {
      setError(saveError.message || "无法保存验证码。");
    } finally {
      setBusy(false);
    }
  }

  async function loadDetails() {
    if (!editing) return;
    if (detailsOpen) {
      setDetailsOpen(false);
      return;
    }
    setToolBusy("details");
    try {
      const [secretResult, uriResult] = await Promise.all([
        window.authenticator.getSecret(account.id),
        window.authenticator.getOtpUri(account.id),
      ]);
      setCurrentSecret(secretResult.secret);
      setQrData(makeQrDataUrl(uriResult.uri));
      setDetailsOpen(true);
    } catch (errorDetails) {
      toast(errorDetails.message || "无法读取账户详情。", "error");
    } finally {
      setToolBusy("");
    }
  }

  async function copyUri() {
    if (!editing) return;
    setToolBusy("uri");
    try {
      const { uri } = await window.authenticator.getOtpUri(account.id);
      await window.authenticator.copyText(uri);
      setCopiedUri(true);
      window.setTimeout(() => setCopiedUri(false), 2200);
      toast("已复制 otpauth 链接（包含密钥）", "info");
    } catch (copyError) {
      toast(copyError.message || "复制失败。", "error");
    } finally {
      setToolBusy("");
    }
  }

  const isSteam = type === "steam";
  const isHotp = type === "hotp";
  const previewCode = preview?.code ? formatCode(preview.code, preview.digits || digits) : "";
  const hasDraft = Boolean(draft?.secret);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "编辑验证码" : "添加验证码"}
      subtitle={
        editing
          ? "修改账户信息、分组或密钥。密钥留空则保持不变。"
          : "输入网站提供的密钥，或返回并使用二维码扫描。"
      }
      eyebrow={editing ? "EDIT ACCOUNT" : "NEW ACCOUNT"}
      icon={<Icon name={editing ? "edit" : "plus"} size={20} />}
      size="xl"
      closeDisabled={busy}
      footer={
        <div className="modal-footer-actions">
          {editing ? (
            <Button
              variant="ghost"
              size="md"
              className="danger-text-button"
              icon={<Icon name="trash" size={15} />}
              onClick={() => onRequestDelete?.(account)}
              disabled={busy}
            >
              删除
            </Button>
          ) : null}
          <div className="modal-footer-right">
            <Button variant="ghost" onClick={onClose} disabled={busy}>
              取消
            </Button>
            <Button
              variant="primary"
              onClick={save}
              loading={busy}
              icon={<Icon name="check" size={16} />}
              data-testid="account-save"
            >
              {editing ? "保存修改" : "添加验证码"}
            </Button>
          </div>
        </div>
      }
    >
      <div className="account-editor">
        <form className="account-form" onSubmit={save}>
          {hasDraft ? (
            <InlineNotice tone="success" icon="scan" title="二维码识别成功">
              已读取账户信息。确认无误后点击“添加验证码”。
            </InlineNotice>
          ) : null}

          <Segmented
            value={type}
            onChange={changeType}
            options={[
              { value: "totp", label: "TOTP", icon: "clock" },
              { value: "hotp", label: "HOTP", icon: "refresh" },
              { value: "steam", label: "Steam", icon: "key" },
            ]}
            className="type-segmented"
          />
          <p className="type-description">{typeDescription(type)}</p>

          <div className="form-grid">
            <Field label="发行方" htmlFor="account-issuer" hint="例如 GitHub">
              <TextInput
                id="account-issuer"
                value={issuer}
                onChange={(event) => setIssuer(event.target.value)}
                placeholder="发行方 / 服务名称"
                maxLength={200}
                spellCheck={false}
                data-autofocus
                data-testid="account-issuer"
              />
            </Field>
            <Field label="账户名称" htmlFor="account-name" hint="邮箱或用户名">
              <TextInput
                id="account-name"
                value={accountName}
                onChange={(event) => setAccountName(event.target.value)}
                placeholder="例如 alice@example.com"
                maxLength={200}
                spellCheck={false}
                data-testid="account-name"
              />
            </Field>
          </div>

          <Field
            label="密钥"
            hint={editing ? "留空保持不变" : "Base32 或十六进制"}
            htmlFor="account-secret"
          >
            <div className={cn("secret-input", editing && "is-editing")}>
              <PasswordInput
                id="account-secret"
                value={secret}
                onChange={(event) => setSecret(event.target.value.toUpperCase().replace(/\s/g, ""))}
                placeholder={editing ? "••••••••••••（不修改）" : "例如 JBSWY3DPEHPK3PXP"}
                autoComplete="off"
                spellCheck={false}
                maxLength={2048}
                data-testid="account-secret"
                style={{ fontFamily: "var(--font-mono)" }}
              />
            </div>
          </Field>

          <div className="form-grid">
            <Field label="分组" optional htmlFor="account-group">
              <Select
                id="account-group"
                value={groupId}
                onChange={(event) => setGroupId(event.target.value)}
              >
                <option value="">未分组</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="备注" optional htmlFor="account-notes">
              <TextInput
                id="account-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="仅自己可见"
                maxLength={1000}
              />
            </Field>
          </div>

          {!isSteam ? (
            <div className="advanced-section">
              <button
                type="button"
                className={cn("advanced-toggle", advanced && "is-open")}
                onClick={() => setAdvanced((value) => !value)}
                aria-expanded={advanced}
              >
                <span className="advanced-title">
                  <Icon name="settings" size={14} />
                  高级选项
                </span>
                <span className="advanced-subtitle">
                  {isHotp
                    ? `SHA-${algorithm.replace("SHA", "")} · ${digits} 位`
                    : `${algorithm.replace("SHA", "SHA-")} · ${digits} 位 · ${period} 秒`}
                </span>
                <Icon name="chevronDown" size={15} className="advanced-chevron" />
              </button>
              {advanced ? (
                <div className="advanced-content">
                  <div className="form-grid form-grid-three">
                    <Field label="算法" htmlFor="account-algorithm">
                      <Select
                        id="account-algorithm"
                        value={algorithm}
                        onChange={(event) => setAlgorithm(event.target.value)}
                      >
                        <option value="SHA1">SHA-1</option>
                        <option value="SHA256">SHA-256</option>
                        <option value="SHA512">SHA-512</option>
                      </Select>
                    </Field>
                    <Field label="位数" htmlFor="account-digits">
                      <Select
                        id="account-digits"
                        value={digits}
                        onChange={(event) => setDigits(Number(event.target.value))}
                      >
                        {[6, 7, 8, 9, 10].map((value) => (
                          <option key={value} value={value}>
                            {value} 位
                          </option>
                        ))}
                      </Select>
                    </Field>
                    {isHotp ? (
                      <Field label="计数器" htmlFor="account-counter">
                        <TextInput
                          id="account-counter"
                          type="number"
                          min="0"
                          step="1"
                          value={counter}
                          onChange={(event) => setCounter(Math.max(0, Number(event.target.value)))}
                        />
                      </Field>
                    ) : (
                      <Field label="刷新周期" htmlFor="account-period" hint="秒">
                        <TextInput
                          id="account-period"
                          type="number"
                          min="5"
                          max="86400"
                          value={period}
                          onChange={(event) => setPeriod(Number(event.target.value))}
                        />
                      </Field>
                    )}
                  </div>
                  <Field label="密钥格式" hint="插件导入的十六进制密钥会自动识别">
                    <Segmented
                      value={secretType}
                      onChange={setSecretType}
                      size="sm"
                      options={[
                        { value: "base32", label: "Base32" },
                        { value: "hex", label: "十六进制" },
                      ]}
                    />
                  </Field>
                </div>
              ) : null}
            </div>
          ) : (
            <InlineNotice tone="neutral" icon="info">
              Steam Guard 固定使用 SHA-1、30 秒周期和 5 位字母数字验证码。
            </InlineNotice>
          )}

          {editing ? (
            <div className="account-details-block">
              <button type="button" className="details-toggle" onClick={loadDetails} disabled={toolBusy === "details"}>
                <Icon name="qr" size={15} />
                {toolBusy === "details" ? "读取中…" : detailsOpen ? "收起账户详情" : "二维码与密钥"}
                <Icon name={detailsOpen ? "chevronDown" : "chevronRight"} size={14} />
              </button>
              {detailsOpen ? (
                <div className="account-details-content">
                  <div className="details-qr">
                    <img src={qrData} alt={`${accountTitle(account)} 的 otpauth 二维码`} />
                  </div>
                  <div className="details-copy">
                    <span className="detail-label">CURRENT SECRET</span>
                    <code className="detail-secret">{currentSecret}</code>
                    <div className="details-actions">
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<Icon name={copiedUri ? "check" : "copy"} size={14} />}
                        onClick={copyUri}
                        loading={toolBusy === "uri"}
                      >
                        {copiedUri ? "已复制链接" : "复制 otpauth 链接"}
                      </Button>
                    </div>
                    <p className="detail-warning">
                      <Icon name="warning" size={13} />
                      二维码和链接都包含账户密钥，请勿分享或截图外传。
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <div className="form-error form-error-block" role="alert">
              <Icon name="warning" size={15} />
              {error}
            </div>
          ) : null}
        </form>

        <aside className="account-preview-panel">
          <div className="preview-heading">
            <span>实时预览</span>
            <Badge tone="neutral">{typeLabel(type)}</Badge>
          </div>
          <div className="preview-card">
            <div className="preview-identity">
              <AccountAvatar account={displayAccount} size={36} />
              <div>
                <strong>{issuer.trim() || "发行方"}</strong>
                <span>{accountName.trim() || "账户名称"}</span>
              </div>
            </div>
            {previewCode ? (
              <>
                <div className="preview-code">{previewCode}</div>
                <div className="preview-meta">
                  {preview?.type === "steam"
                    ? "Steam Guard"
                    : `${typeLabel(type)} · ${algorithm.replace("SHA", "SHA-")} · ${digits} 位`}
                </div>
                <div className="preview-valid">
                  <span className="preview-dot" />
                  {isHotp ? `计数器 ${counter}` : `${preview?.period || period} 秒周期`}
                </div>
              </>
            ) : (
              <div className="preview-placeholder">
                <div className="preview-skeleton">••• •••</div>
                <span>{previewError || "输入密钥后显示预览"}</span>
              </div>
            )}
          </div>
          <div className="preview-note">
            <Icon name="shieldCheck" size={15} />
            <p>预览同样在本机生成。密钥不会发送到任何服务器。</p>
          </div>
          {previewError && previewCode ? (
            <p className="preview-error">{previewError}</p>
          ) : null}
        </aside>
      </div>
    </Modal>
  );
}
