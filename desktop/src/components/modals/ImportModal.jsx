import React, { useEffect, useRef, useState } from "react";
import { Icon } from "../../icons.jsx";
import {
  AccountAvatar,
  Badge,
  Button,
  Field,
  InlineNotice,
  Modal,
  PasswordInput,
  Select,
  Switch,
} from "../UI.jsx";
import {
  accountSubtitle,
  accountTitle,
  formatDate,
  typeLabel,
} from "../../utils.js";

const MAX_FILE_SIZE = 20 * 1024 * 1024;

export default function ImportModal({ open, vault, onClose, onImported, toast }) {
  const [stage, setStage] = useState("choose");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [password, setPassword] = useState("");
  const [result, setResult] = useState(null);
  const [source, setSource] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [targetGroup, setTargetGroup] = useState("");
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const dropRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setStage("choose");
    setText("");
    setFileName("");
    setPassword("");
    setResult(null);
    setSource("");
    setError("");
    setBusy(false);
    setDragging(false);
    setTargetGroup("");
    setSkipDuplicates(true);
  }, [open]);

  async function inspect(content, passwordValue = null) {
    if (!content?.trim()) {
      setError("请选择备份文件或粘贴备份内容。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await window.authenticator.inspectImport(content, passwordValue);
      if (response.status === "password_required") {
        setSource(response.source || "加密备份");
        setStage("password");
        setPassword("");
        return;
      }
      setResult(response);
      setSource(response.source || "备份文件");
      setStage("preview");
      if (response.warnings?.length) {
        setError("");
      }
    } catch (inspectError) {
      setError(inspectError.message || "无法读取此备份。");
    } finally {
      setBusy(false);
    }
  }

  async function pickFile() {
    setBusy(true);
    setError("");
    try {
      const response = await window.authenticator.pickImportFile();
      if (response.cancelled) return;
      if (response.text.length > MAX_FILE_SIZE) {
        throw new Error("备份文件超过 20 MB，无法导入。");
      }
      setText(response.text);
      setFileName(response.name);
      await inspect(response.text);
    } catch (pickError) {
      setError(pickError.message || "无法读取文件。");
    } finally {
      setBusy(false);
    }
  }

  async function readDroppedFile(file) {
    if (!file) return;
    if (file.size > MAX_FILE_SIZE) {
      setError("备份文件超过 20 MB，无法导入。");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const content = await file.text();
      setText(content);
      setFileName(file.name);
      await inspect(content);
    } catch (readError) {
      setError(readError.message || "无法读取文件。");
    } finally {
      setBusy(false);
    }
  }

  async function submitPassword(event) {
    event.preventDefault();
    if (!password) {
      setError("请输入备份密码。");
      return;
    }
    await inspect(text, password);
  }

  async function commit() {
    if (!result?.accounts?.length) return;
    setBusy(true);
    setError("");
    try {
      const response = await window.authenticator.commitImport(
        result.accounts,
        targetGroup || null,
        skipDuplicates,
        result.groups || []
      );
      const added = response.added.length;
      const skipped = response.skipped.length;
      const groupNote = response.groupsAdded?.length
        ? `，并恢复 ${response.groupsAdded.length} 个分组`
        : "";
      if (added === 0) {
        toast(
          skipped
            ? `没有导入新账户：${skipped} 个条目与现有账户重复或无效`
            : "没有导入任何账户",
          "info"
        );
      } else if (skipped) {
        toast(
          `已导入 ${added} 个验证码${groupNote}，跳过 ${skipped} 个重复或无效条目`,
          "success"
        );
      } else {
        toast(`已导入 ${added} 个验证码${groupNote}`, "success");
      }
      onImported?.(response.vault);
    } catch (commitError) {
      setError(commitError.message || "导入失败。");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setStage("choose");
    setResult(null);
    setError("");
    setPassword("");
    setSource("");
  }

  const footer =
    stage === "preview" ? (
      <div className="modal-footer-actions">
        <Button variant="ghost" onClick={reset} disabled={busy}>
          重新选择
        </Button>
        <Button
          variant="primary"
          onClick={commit}
          loading={busy}
          icon={<Icon name="download" size={16} />}
        >
          导入 {result?.accounts?.length || 0} 个验证码
        </Button>
      </div>
    ) : stage === "password" ? (
      <div className="modal-footer-actions">
        <Button variant="ghost" onClick={reset} disabled={busy}>
          返回
        </Button>
        <Button
          variant="primary"
          onClick={submitPassword}
          loading={busy}
          disabled={!password}
          icon={<Icon name="unlock" size={16} />}
        >
          解锁备份
        </Button>
      </div>
    ) : (
      <div className="modal-footer-actions">
        <span className="scanner-footer-hint">
          <Icon name="shieldCheck" size={14} />
          解析完全在本机进行
        </span>
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          取消
        </Button>
      </div>
    );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        stage === "preview"
          ? "确认导入"
          : stage === "password"
            ? "备份已加密"
            : "导入备份"
      }
      subtitle={
        stage === "preview"
          ? "确认账户和导入选项，重复的账户可以自动跳过。"
          : stage === "password"
            ? "输入创建此备份时使用的密码。它可能与当前主密码不同。"
            : "从 Authenticator 浏览器插件、本应用或其他标准 otpauth 数据迁移。"
      }
      eyebrow="IMPORT"
      icon={<Icon name={stage === "password" ? "lock" : "download"} size={20} />}
      size="lg"
      closeDisabled={busy}
      footer={footer}
    >
      {stage === "choose" ? (
        <div className="import-choose">
          <div
            ref={dropRef}
            className={`drop-zone ${dragging ? "is-dragging" : ""}`}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              readDroppedFile(event.dataTransfer.files?.[0]);
            }}
          >
            <span className="drop-zone-icon">
              <Icon name="upload" size={26} />
            </span>
            <strong>拖放备份文件到这里</strong>
            <span>JSON、TXT 或 .authbackup，最大 20 MB</span>
            <Button
              variant="secondary"
              size="sm"
              onClick={pickFile}
              loading={busy}
              icon={<Icon name="folder" size={15} />}
            >
              选择文件
            </Button>
          </div>

          <div className="import-divider">
            <span>或粘贴备份内容</span>
          </div>

          <Field label="otpauth 链接 / JSON 备份" optional>
            <textarea
              className="textarea-input import-textarea"
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setError("");
              }}
              placeholder={"otpauth://totp/GitHub:alice?secret=...\notpauth://hotp/Example:bob?secret=...&counter=0"}
              spellCheck={false}
            />
          </Field>

          <div className="import-actions-row">
            <span className="import-file-name">
              {fileName ? (
                <>
                  <Icon name="clipboard" size={13} />
                  {fileName}
                </>
              ) : (
                "支持明文 JSON、插件加密备份、otpauth 文本"
              )}
            </span>
            <Button
              variant="primary"
              size="sm"
              onClick={() => inspect(text)}
              loading={busy}
              disabled={!text.trim()}
              icon={<Icon name="download" size={15} />}
            >
              解析内容
            </Button>
          </div>

          {error ? (
            <div className="form-error form-error-block" role="alert">
              <Icon name="warning" size={15} />
              {error}
            </div>
          ) : null}

          <div className="supported-formats">
            <div className="supported-format">
              <Badge tone="success">推荐</Badge>
              <span>Authenticator Desktop 加密备份</span>
            </div>
            <div className="supported-format">
              <Badge tone="info">插件</Badge>
              <span>Authenticator v1 / v2 / v3 备份</span>
            </div>
            <div className="supported-format">
              <Badge tone="neutral">通用</Badge>
              <span>otpauth 链接与 Google 迁移数据</span>
            </div>
          </div>
        </div>
      ) : null}

      {stage === "password" ? (
        <form className="import-password-stage" onSubmit={submitPassword}>
          <div className="encrypted-file-card">
            <span className="encrypted-file-icon">
              <Icon name="lock" size={22} />
            </span>
            <div>
              <strong>{fileName || "加密备份"}</strong>
              <span>{source}</span>
            </div>
            <Badge tone="warning" icon="lock">
              已加密
            </Badge>
          </div>
          <Field label="备份密码" htmlFor="import-password">
            <PasswordInput
              id="import-password"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setError("");
              }}
              placeholder="输入创建备份时的密码"
              autoComplete="off"
              data-autofocus
            />
          </Field>
          <InlineNotice tone="neutral" icon="info">
            密码只用于在当前内存中解密备份，不会被保存。解密后的账户会使用当前保险库重新加密。
          </InlineNotice>
          {error ? (
            <div className="form-error form-error-block" role="alert">
              <Icon name="warning" size={15} />
              {error}
            </div>
          ) : null}
        </form>
      ) : null}

      {stage === "preview" && result ? (
        <div className="import-preview">
          <div className="import-summary">
            <div className="import-summary-copy">
              <Badge tone="success" icon="check">
                可以导入
              </Badge>
              <strong>{result.accounts.length} 个验证码</strong>
              <span>
                {source}
                {result.exportedAt ? ` · 导出于 ${formatDate(result.exportedAt)}` : ""}
              </span>
            </div>
            <div className="import-summary-stats">
              <span>
                <strong>{result.accounts.filter((account) => account.type === "totp").length}</strong>
                TOTP
              </span>
              <span>
                <strong>{result.accounts.filter((account) => account.type === "hotp").length}</strong>
                HOTP
              </span>
              <span>
                <strong>{result.accounts.filter((account) => account.type === "steam").length}</strong>
                Steam
              </span>
            </div>
          </div>

          {result.warnings?.length ? (
            <InlineNotice tone="warning" icon="warning" title="部分内容被跳过">
              <ul className="warning-list">
                {result.warnings.slice(0, 6).map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
                {result.warnings.length > 6 ? (
                  <li>还有 {result.warnings.length - 6} 条提示未显示</li>
                ) : null}
              </ul>
            </InlineNotice>
          ) : null}

          <div className="import-account-list">
            {result.accounts.map((account, index) => (
              <div className="import-account-row" key={`${account.secret}-${index}`}>
                <span className="import-row-index">{String(index + 1).padStart(2, "0")}</span>
                <AccountAvatar account={account} size={34} />
                <div className="import-row-copy">
                  <strong>{accountTitle(account)}</strong>
                  <span>{accountSubtitle(account)}</span>
                </div>
                {account.pinned ? <Icon name="pin" size={13} className="import-pin" /> : null}
                <Badge tone="neutral">{typeLabel(account.type)}</Badge>
              </div>
            ))}
          </div>

          <div className="import-options">
            <Field label="导入到分组" optional>
              <Select value={targetGroup} onChange={(event) => setTargetGroup(event.target.value)}>
                <option value="">未分组</option>
                {vault.groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Switch
              checked={skipDuplicates}
              onChange={setSkipDuplicates}
              label="跳过重复账户"
              description="密钥、发行方和账户名称完全相同的验证码会被跳过。"
            />
          </div>

          {error ? (
            <div className="form-error form-error-block" role="alert">
              <Icon name="warning" size={15} />
              {error}
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
