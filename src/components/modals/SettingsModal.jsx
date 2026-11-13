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
  Select,
  Switch,
} from "../UI.jsx";
import {
  cn,
  formatDateTime,
  relativeLockTime,
  validatePassword,
} from "../../utils.js";

const TABS = [
  { id: "security", label: "安全", icon: "shieldCheck" },
  { id: "appearance", label: "外观", icon: "sun" },
  { id: "data", label: "数据", icon: "database" },
  { id: "about", label: "关于", icon: "info" },
];

const THEMES = [
  { value: "system", label: "跟随系统", icon: "monitor", description: "随 Windows 外观自动切换" },
  { value: "light", label: "浅色", icon: "sun", description: "明亮、清爽" },
  { value: "dark", label: "深色", icon: "moon", description: "适合暗光环境" },
];

export default function SettingsModal({
  open,
  initialTab = "security",
  vault,
  state,
  onClose,
  onVaultUpdated,
  onSecurityChanged,
  onOpenExport,
  onOpenImport,
  onRequestReset,
  onLock,
  toast,
}) {
  const [tab, setTab] = useState(initialTab);
  const [saving, setSaving] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [modeBusy, setModeBusy] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertPassword, setConvertPassword] = useState("");
  const [enableOpen, setEnableOpen] = useState(false);
  const [enablePassword, setEnablePassword] = useState("");
  const [enableConfirm, setEnableConfirm] = useState("");
  const [modeError, setModeError] = useState("");
  const [info, setInfo] = useState(null);

  const mode = vault.meta.securityMode;
  const settings = vault.settings;

  useEffect(() => {
    if (!open) return;
    setTab(initialTab);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setPasswordError("");
    setConvertOpen(false);
    setConvertPassword("");
    setEnableOpen(false);
    setEnablePassword("");
    setEnableConfirm("");
    setModeError("");
    window.authenticator
      .getInfo()
      .then(setInfo)
      .catch(() => setInfo(null));
  }, [open, initialTab]);

  async function updateSetting(patch, key = "setting") {
    setSaving(key);
    try {
      const result = await window.authenticator.updateSettings(patch);
      onVaultUpdated?.(result.vault);
    } catch (error) {
      toast(error.message || "无法保存设置。", "error");
    } finally {
      setSaving("");
    }
  }

  async function changePassword(event) {
    event.preventDefault();
    setPasswordError("");
    if (!currentPassword) {
      setPasswordError("请输入当前主密码。");
      return;
    }
    const validation = validatePassword(newPassword);
    if (validation) {
      setPasswordError(validation);
      return;
    }
    if (newPassword !== confirmPassword) {
      setPasswordError("两次输入的新密码不一致。");
      return;
    }
    if (newPassword === currentPassword) {
      setPasswordError("新密码不能与当前密码相同。");
      return;
    }
    setPasswordBusy(true);
    try {
      await window.authenticator.changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      toast("主密码已更新", "success");
    } catch (error) {
      setPasswordError(error.message || "无法修改主密码。");
    } finally {
      setPasswordBusy(false);
    }
  }

  async function removePassword(event) {
    event.preventDefault();
    setModeError("");
    if (!convertPassword) {
      setModeError("请输入当前主密码。");
      return;
    }
    setModeBusy(true);
    try {
      const result = await window.authenticator.disablePassword(convertPassword);
      onSecurityChanged?.(result);
      setConvertOpen(false);
      setConvertPassword("");
      toast("无密码进入已开启", "success");
    } catch (error) {
      setModeError(error.message || "无法切换保护方式。");
    } finally {
      setModeBusy(false);
    }
  }

  async function submitEnablePassword(event) {
    event.preventDefault();
    setModeError("");
    const validation = validatePassword(enablePassword);
    if (validation) {
      setModeError(validation);
      return;
    }
    if (enablePassword !== enableConfirm) {
      setModeError("两次输入的主密码不一致。");
      return;
    }
    setModeBusy(true);
    try {
      const result = await window.authenticator.enablePassword(enablePassword);
      onSecurityChanged?.(result);
      setEnableOpen(false);
      setEnablePassword("");
      setEnableConfirm("");
      toast("无密码进入已关闭，下次启动需要输入主密码", "success");
    } catch (error) {
      setModeError(error.message || "无法启用主密码。");
    } finally {
      setModeBusy(false);
    }
  }

  const newPasswordValid = !validatePassword(newPassword) && newPassword === confirmPassword;
  const heading = {
    security: { title: "安全与锁定", description: "控制无密码进入、主密码和自动锁定行为。" },
    appearance: { title: "外观", description: "让验证器融入你的桌面。" },
    data: { title: "数据与备份", description: "导入、导出并管理本机上的保险库数据。" },
    about: { title: "关于 Authenticator Desktop", description: "独立的 Windows 桌面验证器。" },
  }[tab];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="设置"
      subtitle="所有更改会立即保存在本机"
      eyebrow="SETTINGS"
      icon={<Icon name="settings" size={20} />}
      size="xl"
      className="settings-modal"
      bodyClassName="settings-modal-body"
    >
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="设置分类">
          {TABS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={cn("settings-nav-item", tab === item.id && "is-active")}
              onClick={() => setTab(item.id)}
            >
              <Icon name={item.icon} size={16} />
              {item.label}
            </button>
          ))}
          <div className="settings-nav-footer">
            <span className="settings-nav-version">v{state?.version || info?.version || "1.0.0"}</span>
            <span>本地保险库</span>
          </div>
        </nav>

        <div className="settings-content">
          <header className="settings-heading">
            <h3>{heading.title}</h3>
            <p>{heading.description}</p>
          </header>

          {tab === "security" ? (
            <div className="settings-sections">
              <section className="settings-section">
                <div className="security-overview">
                  <div className="security-overview-icon">
                    <Icon name={mode === "password" ? "lock" : "shieldCheck"} size={24} />
                  </div>
                  <div className="security-overview-copy">
                    <div className="security-overview-title">
                      {mode === "password" ? "主密码保护" : "Windows 数据保护"}
                      <Badge tone={mode === "password" ? "success" : "info"} icon="check">
                        {mode === "password" ? "已启用" : "无密码进入"}
                      </Badge>
                    </div>
                    <p>
                      {mode === "password"
                        ? "保险库使用 AES-256-GCM 加密。启动、解锁和自动锁定时都需要主密码。"
                        : "已开启无密码进入。启动时自动使用当前 Windows 用户解密保险库，不再要求输入主密码。"}
                    </p>
                  </div>
                  {mode === "password" ? (
                    <Button variant="secondary" size="sm" icon={<Icon name="lock" size={14} />} onClick={onLock}>
                      立即锁定
                    </Button>
                  ) : null}
                </div>
              </section>

              <section className="settings-section">
                <div className="settings-section-heading">
                  <h4>无密码进入</h4>
                  <p>使用 Windows 数据保护代替主密码，启动验证器时直接进入。</p>
                </div>
                <div className={`passwordless-option ${mode === "device" ? "is-enabled" : ""}`}>
                  <Switch
                    checked={mode === "device"}
                    onChange={(enabled) => {
                      setModeError("");
                      if (enabled) {
                        setEnableOpen(false);
                        setConvertOpen(true);
                      } else {
                        setConvertOpen(false);
                        setEnableOpen(true);
                      }
                    }}
                    label="启动时无需输入主密码"
                    description={
                      mode === "device"
                        ? "已开启。验证器会使用当前 Windows 用户的数据保护自动解密。"
                        : "未开启。启动或锁定时仍需要主密码。"
                    }
                    disabled={modeBusy}
                  />
                </div>
                {mode === "device" ? (
                  <p className="settings-hint">
                    无密码进入不会降低保险库的静态加密强度，但任何能登录此 Windows 账户的人都可以直接打开验证器。
                  </p>
                ) : null}

                {mode === "password" && convertOpen ? (
                  <form className="inline-conversion" onSubmit={removePassword}>
                    <InlineNotice tone="warning" icon="warning" title="开启前请确认">
                      开启无密码进入后，任何能登录此 Windows 账户的人都可以直接打开验证器。请确保你的
                      Windows 账户本身有登录密码或 Windows Hello 保护。
                    </InlineNotice>
                    <Field label="输入当前主密码以确认" htmlFor="convert-password">
                      <PasswordInput
                        id="convert-password"
                        value={convertPassword}
                        onChange={(event) => {
                          setConvertPassword(event.target.value);
                          setModeError("");
                        }}
                        placeholder="当前主密码"
                        autoComplete="current-password"
                        data-autofocus
                      />
                    </Field>
                    {modeError ? <p className="form-error">{modeError}</p> : null}
                    <div className="inline-form-actions">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setConvertOpen(false);
                          setConvertPassword("");
                          setModeError("");
                        }}
                        disabled={modeBusy}
                      >
                        取消
                      </Button>
                      <Button
                        type="submit"
                        variant="primary"
                        size="sm"
                        icon={<Icon name="unlock" size={15} />}
                        loading={modeBusy}
                        disabled={!convertPassword}
                      >
                        开启无密码进入
                      </Button>
                    </div>
                  </form>
                ) : null}

                {mode === "device" && enableOpen ? (
                  <form className="inline-conversion" onSubmit={submitEnablePassword}>
                    <InlineNotice tone="info" icon="lock" title="设置主密码以关闭无密码进入">
                      关闭后，每次启动和自动锁定后都需要输入新的主密码。保险库会立即改用主密码重新加密。
                    </InlineNotice>
                    <Field label="新主密码" htmlFor="enable-password">
                      <PasswordInput
                        id="enable-password"
                        value={enablePassword}
                        onChange={(event) => {
                          setEnablePassword(event.target.value);
                          setModeError("");
                        }}
                        placeholder="至少 8 个字符"
                        autoComplete="new-password"
                        data-autofocus
                      />
                      <PasswordStrength password={enablePassword} />
                    </Field>
                    <Field label="确认主密码" htmlFor="enable-confirm">
                      <PasswordInput
                        id="enable-confirm"
                        value={enableConfirm}
                        onChange={(event) => {
                          setEnableConfirm(event.target.value);
                          setModeError("");
                        }}
                        placeholder="再次输入"
                        autoComplete="new-password"
                      />
                    </Field>
                    {modeError ? <p className="form-error">{modeError}</p> : null}
                    <div className="inline-form-actions">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEnableOpen(false);
                          setEnablePassword("");
                          setEnableConfirm("");
                          setModeError("");
                        }}
                        disabled={modeBusy}
                      >
                        取消
                      </Button>
                      <Button
                        type="submit"
                        variant="primary"
                        size="sm"
                        icon={<Icon name="lock" size={15} />}
                        loading={modeBusy}
                        disabled={
                          Boolean(validatePassword(enablePassword)) ||
                          enablePassword !== enableConfirm
                        }
                      >
                        设置主密码并关闭
                      </Button>
                    </div>
                  </form>
                ) : null}
              </section>

              <section className="settings-section">
                <div className="settings-section-heading">
                  <h4>自动锁定</h4>
                  <p>在一段时间无操作后隐藏验证码并要求重新解锁。</p>
                </div>
                {mode === "password" ? (
                  <>
                    <div className="setting-row">
                      <div className="setting-row-copy">
                        <strong>锁定等待时间</strong>
                        <span>{relativeLockTime(settings.autoLockMinutes)}</span>
                      </div>
                      <Select
                        value={settings.autoLockMinutes}
                        onChange={(event) =>
                          updateSetting({ autoLockMinutes: Number(event.target.value) }, "autoLock")
                        }
                        disabled={saving === "autoLock"}
                        className="setting-select"
                      >
                        <option value={0}>不自动锁定</option>
                        <option value={1}>1 分钟</option>
                        <option value={5}>5 分钟</option>
                        <option value={15}>15 分钟</option>
                        <option value={30}>30 分钟</option>
                        <option value={60}>1 小时</option>
                        <option value={120}>2 小时</option>
                      </Select>
                    </div>
                    <Switch
                      checked={settings.lockOnMinimize}
                      onChange={(value) => updateSetting({ lockOnMinimize: value }, "minimize")}
                      label="最小化窗口时锁定"
                      description="窗口最小化或隐藏后立即清除解锁状态。"
                    />
                  </>
                ) : (
                  <InlineNotice tone="neutral" icon="unlock">
                    无密码进入模式下自动锁定已停用。关闭无密码进入并设置主密码后即可重新配置。
                  </InlineNotice>
                )}
              </section>

              <section className="settings-section">
                <div className="settings-section-heading">
                  <h4>剪贴板</h4>
                  <p>验证码复制后自动从系统剪贴板移除，避免被其他程序读取。</p>
                </div>
                <div className="setting-row">
                  <div className="setting-row-copy">
                    <strong>自动清除验证码</strong>
                    <span>
                      {settings.clipboardClearSeconds
                        ? `复制 ${settings.clipboardClearSeconds} 秒后清除`
                        : "不会自动清除"}
                    </span>
                  </div>
                  <Select
                    value={settings.clipboardClearSeconds}
                    onChange={(event) =>
                      updateSetting(
                        { clipboardClearSeconds: Number(event.target.value) },
                        "clipboard"
                      )
                    }
                    disabled={saving === "clipboard"}
                    className="setting-select"
                  >
                    <option value={15}>15 秒</option>
                    <option value={30}>30 秒</option>
                    <option value={60}>1 分钟</option>
                    <option value={120}>2 分钟</option>
                    <option value={0}>不清除</option>
                  </Select>
                </div>
              </section>

              {mode === "password" ? (
                <section className="settings-section">
                  <div className="settings-section-heading">
                    <h4>修改主密码</h4>
                    <p>修改后会使用新密码重新加密保险库；当前会话保持解锁。</p>
                  </div>
                  <form className="settings-form" onSubmit={changePassword}>
                    <Field label="当前主密码" htmlFor="settings-current-password">
                      <PasswordInput
                        id="settings-current-password"
                        value={currentPassword}
                        onChange={(event) => {
                          setCurrentPassword(event.target.value);
                          setPasswordError("");
                        }}
                        placeholder="输入当前主密码"
                        autoComplete="current-password"
                      />
                    </Field>
                    <div className="form-grid">
                      <Field label="新主密码" htmlFor="settings-new-password">
                        <PasswordInput
                          id="settings-new-password"
                          value={newPassword}
                          onChange={(event) => {
                            setNewPassword(event.target.value);
                            setPasswordError("");
                          }}
                          placeholder="至少 8 个字符"
                          autoComplete="new-password"
                        />
                        <PasswordStrength password={newPassword} />
                      </Field>
                      <Field label="确认新密码" htmlFor="settings-confirm-password">
                        <PasswordInput
                          id="settings-confirm-password"
                          value={confirmPassword}
                          onChange={(event) => {
                            setConfirmPassword(event.target.value);
                            setPasswordError("");
                          }}
                          placeholder="再次输入新密码"
                          autoComplete="new-password"
                        />
                      </Field>
                    </div>
                    {passwordError ? (
                      <div className="form-error form-error-block">
                        <Icon name="warning" size={14} />
                        {passwordError}
                      </div>
                    ) : null}
                    <div className="settings-form-actions">
                      <Button
                        type="submit"
                        variant="primary"
                        size="sm"
                        loading={passwordBusy}
                        disabled={!newPasswordValid || !currentPassword}
                      >
                        更新主密码
                      </Button>
                    </div>
                  </form>
                </section>
              ) : null}


            </div>
          ) : null}

          {tab === "appearance" ? (
            <div className="settings-sections">
              <section className="settings-section">
                <div className="settings-section-heading">
                  <h4>主题</h4>
                  <p>选择应用的外观。跟随系统会随 Windows 的浅色/深色模式自动切换。</p>
                </div>
                <div className="theme-options">
                  {THEMES.map((theme) => (
                    <button
                      key={theme.value}
                      type="button"
                      className={cn(
                        "theme-option",
                        settings.theme === theme.value && "is-selected"
                      )}
                      onClick={() => updateSetting({ theme: theme.value }, "theme")}
                      disabled={saving === "theme"}
                    >
                      <span className={`theme-preview theme-preview-${theme.value}`}>
                        <span className="theme-preview-side" />
                        <span className="theme-preview-card theme-preview-card-one" />
                        <span className="theme-preview-card theme-preview-card-two" />
                      </span>
                      <span className="theme-option-label">
                        <span>
                          <Icon name={theme.icon} size={14} />
                          {theme.label}
                        </span>
                        {settings.theme === theme.value ? (
                          <span className="theme-check">
                            <Icon name="check" size={12} />
                          </span>
                        ) : null}
                      </span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="settings-section">
                <div className="settings-section-heading">
                  <h4>密度</h4>
                </div>
                <Switch
                  checked={settings.compact}
                  onChange={(value) => updateSetting({ compact: value }, "compact")}
                  label="紧凑布局"
                  description="缩小卡片和验证码字号，在一屏内显示更多账户。"
                />
              </section>

              <section className="settings-section">
                <div className="settings-section-heading">
                  <h4>颜色与字体</h4>
                </div>
                <InlineNotice tone="neutral" icon="info">
                  界面使用系统字体和 Cascadia Code 等宽字体显示验证码，跟随 Windows 的字体设置。
                </InlineNotice>
              </section>
            </div>
          ) : null}

          {tab === "data" ? (
            <div className="settings-sections">
              <section className="settings-section">
                <div className="backup-card">
                  <div className="backup-card-icon">
                    <Icon name="download" size={22} />
                  </div>
                  <div className="backup-card-copy">
                    <strong>备份你的保险库</strong>
                    <p>
                      导出包含密钥的加密备份。忘记主密码或更换电脑时，只有备份能帮你找回验证码。
                    </p>
                    <span className="backup-last">
                      <Icon name="clock" size={13} />
                      上次备份：{formatDateTime(settings.lastBackupAt)}
                    </span>
                  </div>
                  <div className="backup-actions">
                    <Button variant="primary" size="sm" onClick={onOpenExport} icon={<Icon name="upload" size={15} />}>
                      导出备份
                    </Button>
                    <Button variant="secondary" size="sm" onClick={onOpenImport} icon={<Icon name="download" size={15} />}>
                      导入备份
                    </Button>
                  </div>
                </div>
              </section>

              <section className="settings-section">
                <div className="settings-section-heading">
                  <h4>数据目录</h4>
                  <p>保险库以加密文件保存在以下位置。备份时也可以直接复制该目录。</p>
                </div>
                <div className="data-path">
                  <Icon name="folder" size={16} />
                  <code title={vault.meta.dataDir}>{vault.meta.dataDir}</code>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={<Icon name="folder" size={15} />}
                  onClick={async () => {
                    try {
                      await window.authenticator.openDataFolder();
                    } catch (error) {
                      toast(error.message || "无法打开数据目录。", "error");
                    }
                  }}
                >
                  在资源管理器中打开
                </Button>
              </section>

              <section className="settings-section">
                <div className="settings-section-heading">
                  <h4>兼容性</h4>
                  <p>可以从 Authenticator 浏览器插件迁移账户。</p>
                </div>
                <InlineNotice tone="info" icon="check">
                  支持导入插件的明文 JSON、加密 JSON（v1/v2/v3）、otpauth 链接以及 Google Authenticator
                  迁移二维码。加密备份会提示输入原插件密码。
                </InlineNotice>
              </section>

              <section className="settings-section danger-section">
                <div className="settings-section-heading">
                  <h4>危险操作</h4>
                  <p>删除此电脑上的全部验证码、分组和设置。该操作无法撤销。</p>
                </div>
                <Button
                  variant="danger"
                  size="sm"
                  icon={<Icon name="trash" size={15} />}
                  onClick={onRequestReset}
                >
                  重置应用
                </Button>
              </section>
            </div>
          ) : null}

          {tab === "about" ? (
            <div className="settings-sections">
              <section className="settings-section about-hero">
                <div className="about-logo">
                  <span className="about-logo-mark">
                    <Icon name="shieldCheck" size={30} />
                  </span>
                </div>
                <div>
                  <h4>Authenticator Desktop</h4>
                  <p>一个独立、离线、可审计的 Windows 二次验证应用。</p>
                  <div className="about-badges">
                    <Badge tone="success" icon="shieldCheck">
                      本地加密
                    </Badge>
                    <Badge tone="neutral" icon="globe">
                      无需联网
                    </Badge>
                    <Badge tone="neutral">v{state?.version || info?.version || "1.0.0"}</Badge>
                  </div>
                </div>
              </section>

              <section className="settings-section">
                <div className="settings-section-heading">
                  <h4>版本信息</h4>
                </div>
                <dl className="about-list">
                  <div>
                    <dt>应用版本</dt>
                    <dd>{state?.version || info?.version || "—"}</dd>
                  </div>
                  <div>
                    <dt>Electron</dt>
                    <dd>{info?.electron || state?.versions?.electron || "—"}</dd>
                  </div>
                  <div>
                    <dt>Chromium</dt>
                    <dd>{info?.chrome || state?.versions?.chrome || "—"}</dd>
                  </div>
                  <div>
                    <dt>Node.js</dt>
                    <dd>{info?.node || state?.versions?.node || "—"}</dd>
                  </div>
                  <div>
                    <dt>数据目录</dt>
                    <dd className="mono">{info?.dataDir || vault.meta.dataDir}</dd>
                  </div>
                </dl>
              </section>

              <section className="settings-section">
                <div className="settings-section-heading">
                  <h4>关于此应用</h4>
                </div>
                <p className="about-paragraph">
                  Authenticator Desktop 是一个独立实现的 Windows 桌面验证器，兼容 {""}
                  Authenticator 浏览器插件（MIT 协议）的 TOTP/HOTP 账户与备份格式。界面、加密存储和桌面集成均为独立实现。
                </p>
                <p className="about-paragraph">
                  核心协议遵循 RFC 4226（HOTP）和 RFC 6238（TOTP），支持 Steam Guard。验证码只在本机生成。
                </p>
                <div className="about-links">
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Icon name="external" size={14} />}
                    onClick={() => window.authenticator.openExternal("https://github.com/Authenticator-Extension/Authenticator")}
                  >
                    Authenticator 插件项目
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Icon name="external" size={14} />}
                    onClick={() => window.authenticator.openExternal("https://github.com/Authenticator-Extension/Authenticator#license")}
                  >
                    MIT 许可证
                  </Button>
                </div>
              </section>

              <section className="settings-section">
                <div className="settings-section-heading">
                  <h4>安全设计</h4>
                </div>
                <ul className="security-list">
                  <li>
                    <Icon name="check" size={14} />
                    主密码使用 scrypt 派生密钥，保险库使用 AES-256-GCM 认证加密。
                  </li>
                  <li>
                    <Icon name="check" size={14} />
                    密钥只存在于主进程内存中，渲染界面无法直接读取保险库文件。
                  </li>
                  <li>
                    <Icon name="check" size={14} />
                    所有网络访问默认关闭，应用不会上传验证码或遥测数据。
                  </li>
                </ul>
              </section>
            </div>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}
