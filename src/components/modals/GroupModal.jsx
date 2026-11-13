import React, { useEffect, useState } from "react";
import { Icon } from "../../icons.jsx";
import { Button, Field, InlineNotice, Modal, TextInput } from "../UI.jsx";
import { cn } from "../../utils.js";

const COLORS = [
  "#14b8a6",
  "#6366f1",
  "#f59e0b",
  "#ec4899",
  "#0ea5e9",
  "#84cc16",
  "#f97316",
  "#8b5cf6",
  "#ef4444",
  "#64748b",
];

export default function GroupModal({
  open,
  group,
  vault,
  onClose,
  onVaultUpdated,
  onRequestDelete,
  toast,
}) {
  const editing = Boolean(group?.id);
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLORS[0]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(group?.name || "");
    setColor(group?.color || COLORS[0]);
    setError("");
    setBusy(false);
  }, [open, group?.id]);

  const accountCount = editing
    ? vault.accounts.filter((account) => account.groupId === group.id).length
    : 0;

  async function save(event) {
    event.preventDefault();
    setError("");
    if (!name.trim()) {
      setError("请输入分组名称。");
      return;
    }
    setBusy(true);
    try {
      const result = editing
        ? await window.authenticator.updateGroup(group.id, name.trim(), color)
        : await window.authenticator.createGroup(name.trim(), color);
      onVaultUpdated?.(result.vault);
      toast(editing ? "分组已更新" : "分组已创建", "success");
    } catch (saveError) {
      setError(saveError.message || "无法保存分组。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? "编辑分组" : "新建分组"}
      subtitle={
        editing
          ? "重命名分组或更换颜色。删除分组不会删除其中的验证码。"
          : "用分组整理工作、个人或其他账户。"
      }
      eyebrow="GROUP"
      icon={<Icon name="layers" size={20} />}
      size="sm"
      closeDisabled={busy}
      footer={
        <div className="modal-footer-actions">
          {editing ? (
            <Button
              variant="ghost"
              className="danger-text-button"
              icon={<Icon name="trash" size={15} />}
              onClick={() => onRequestDelete?.(group)}
              disabled={busy}
            >
              删除分组
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
              disabled={!name.trim()}
              icon={<Icon name="check" size={15} />}
            >
              {editing ? "保存修改" : "创建分组"}
            </Button>
          </div>
        </div>
      }
    >
      <form className="group-form" onSubmit={save}>
        <div className="group-preview">
          <span className="group-preview-dot" style={{ background: color }}>
            <Icon name="layers" size={16} />
          </span>
          <div>
            <strong>{name.trim() || "分组名称"}</strong>
            <span>{editing ? `${accountCount} 个验证码` : "新分组"}</span>
          </div>
        </div>
        <Field label="分组名称" htmlFor="group-name">
          <TextInput
            id="group-name"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setError("");
            }}
            placeholder="例如：工作、个人、客户项目"
            maxLength={60}
            data-autofocus
          />
        </Field>
        <Field label="颜色">
          <div className="color-picker">
            {COLORS.map((item) => (
              <button
                key={item}
                type="button"
                className={cn("color-swatch", color === item && "is-selected")}
                style={{ background: item }}
                onClick={() => setColor(item)}
                aria-label={`选择颜色 ${item}`}
                title={item}
              >
                {color === item ? <Icon name="check" size={13} /> : null}
              </button>
            ))}
          </div>
        </Field>

        {editing && accountCount > 0 ? (
          <InlineNotice tone="neutral" icon="info">
            删除分组后，其中的 {accountCount} 个验证码会移动到“未分组”，不会被删除。
          </InlineNotice>
        ) : null}

        {error ? (
          <div className="form-error form-error-block" role="alert">
            <Icon name="warning" size={15} />
            {error}
          </div>
        ) : null}
      </form>
    </Modal>
  );
}
