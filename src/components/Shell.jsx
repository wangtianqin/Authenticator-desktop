import React, { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "../icons.jsx";
import AccountCard from "./AccountCard.jsx";
import WindowControls from "./WindowControls.jsx";
import {
  BrandBlock,
  Button,
  EmptyState,
  IconButton,
} from "./UI.jsx";
import {
  accountTitle,
  applyReorder,
  cn,
  searchableText,
  sortAccounts,
} from "../utils.js";

function NavItem({ icon, label, count, active, onClick, children }) {
  return (
    <button type="button" className={cn("side-nav-item", active && "is-active")} onClick={onClick}>
      <span className="side-nav-icon">{icon}</span>
      <span className="side-nav-label">{label}</span>
      {children}
      {count !== undefined ? <span className="side-nav-count">{count}</span> : null}
    </button>
  );
}

function Sidebar({
  vault,
  view,
  onViewChange,
  onAddAccount,
  onAddGroup,
  onEditGroup,
  onOpenSettings,
  onOpenImport,
  onLock,
}) {
  const groups = useMemo(
    () => [...vault.groups].sort((a, b) => a.order - b.order),
    [vault.groups]
  );
  const pinnedCount = vault.accounts.filter((account) => account.pinned).length;
  const securityMode = vault.meta.securityMode;

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <BrandBlock />
      </div>

      <div className="sidebar-action">
        <Button
          variant="primary"
          size="md"
          block
          icon={<Icon name="plus" size={16} />}
          onClick={onAddAccount}
          className="sidebar-add"
        >
          添加验证码
          <kbd className="btn-kbd">Ctrl N</kbd>
        </Button>
      </div>

      <nav className="sidebar-nav" aria-label="验证码导航">
        <div className="side-nav-section">
          <div className="side-nav-heading">验证码</div>
          <NavItem
            icon={<Icon name="grid" size={16} />}
            label="全部验证码"
            count={vault.accounts.length}
            active={view === "all"}
            onClick={() => onViewChange("all")}
          />
          <NavItem
            icon={<Icon name="pin" size={16} />}
            label="已固定"
            count={pinnedCount}
            active={view === "pinned"}
            onClick={() => onViewChange("pinned")}
          />
        </div>

        <div className="side-nav-section groups-section">
          <div className="side-nav-heading-row">
            <div className="side-nav-heading">分组</div>
            <button
              type="button"
              className="side-nav-add"
              onClick={onAddGroup}
              aria-label="新建分组"
              title="新建分组"
            >
              <Icon name="plus" size={14} />
            </button>
          </div>
          {groups.length === 0 ? (
            <button type="button" className="group-empty-hint" onClick={onAddGroup}>
              <Icon name="plus" size={13} />
              新建一个分组
            </button>
          ) : (
            groups.map((group) => {
              const count = vault.accounts.filter((account) => account.groupId === group.id).length;
              const active = view === `group:${group.id}`;
              return (
                <div className={cn("group-nav-row", active && "is-active")} key={group.id}>
                  <button
                    type="button"
                    className="side-nav-item group-nav-item"
                    onClick={() => onViewChange(`group:${group.id}`)}
                  >
                    <span
                      className="group-color-dot"
                      style={{ background: group.color }}
                      aria-hidden="true"
                    />
                    <span className="side-nav-label">{group.name}</span>
                    <span className="side-nav-count">{count}</span>
                  </button>
                  <button
                    type="button"
                    className="group-edit-btn"
                    aria-label={`编辑分组 ${group.name}`}
                    title="编辑分组"
                    onClick={() => onEditGroup(group)}
                  >
                    <Icon name="edit" size={13} />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </nav>

      <div className="sidebar-bottom">
        <button type="button" className="import-shortcut" onClick={onOpenImport}>
          <span className="import-shortcut-icon">
            <Icon name="download" size={15} />
          </span>
          <span>
            <strong>导入备份</strong>
            <small>支持插件格式</small>
          </span>
          <Icon name="chevronRight" size={14} />
        </button>

        <div className="sidebar-security">
          <span className="security-dot" />
          <div>
            <strong>{securityMode === "password" ? "主密码保护" : "无密码进入"}</strong>
            <span>
              {securityMode === "password"
                ? "AES-256-GCM · 本地存储"
                : "Windows 数据保护 · 本地存储"}
            </span>
          </div>
        </div>

        <div className="sidebar-footer-actions">
          {securityMode === "password" ? (
            <button type="button" className="sidebar-footer-btn" onClick={onLock}>
              <Icon name="lock" size={15} />
              锁定
            </button>
          ) : null}
          <button type="button" className="sidebar-footer-btn" onClick={onOpenSettings}>
            <Icon name="settings" size={15} />
            设置
            <kbd>Ctrl ,</kbd>
          </button>
        </div>
      </div>
    </aside>
  );
}

function viewTitle(view, group, query) {
  if (query) return "搜索结果";
  if (view === "pinned") return "已固定";
  if (view.startsWith("group:") && group) return group.name;
  return "全部验证码";
}

export default function Shell({
  vault,
  codes,
  hideCodes,
  onToggleHideCodes,
  state,
  searchRef,
  onAddAccount,
  onOpenScanner,
  onEditAccount,
  onPinAccount,
  onIncrementCounter,
  onOpenSettings,
  onOpenImport,
  onOpenExport,
  onAddGroup,
  onEditGroup,
  onLock,
  onVaultUpdated,
  toast,
}) {
  const [view, setView] = useState("all");
  const [query, setQuery] = useState("");
  const [sorting, setSorting] = useState(false);
  const [draggingId, setDraggingId] = useState(null);
  const [dragTarget, setDragTarget] = useState(null);
  const searchFieldRef = useRef(null);
  const inputRef = searchRef || searchFieldRef;

  const groups = useMemo(
    () => [...vault.groups].sort((a, b) => a.order - b.order),
    [vault.groups]
  );
  const activeGroup = view.startsWith("group:")
    ? groups.find((group) => `group:${group.id}` === view)
    : null;
  const orderedAccounts = useMemo(
    () => [...vault.accounts].sort((a, b) => a.order - b.order),
    [vault.accounts]
  );

  useEffect(() => {
    if (view.startsWith("group:") && !activeGroup) setView("all");
  }, [view, activeGroup]);

  useEffect(() => {
    setSorting(false);
    setDraggingId(null);
    setDragTarget(null);
  }, [view]);

  const normalizedQuery = query.trim().toLocaleLowerCase("zh-CN");
  const baseAccounts = useMemo(() => {
    let list = orderedAccounts;
    if (view === "pinned") list = list.filter((account) => account.pinned);
    else if (view.startsWith("group:")) {
      list = list.filter((account) => account.groupId === activeGroup?.id);
    }
    if (normalizedQuery) {
      list = list.filter((account) => searchableText(account, groups).includes(normalizedQuery));
    }
    return list;
  }, [orderedAccounts, view, activeGroup, normalizedQuery, groups]);

  const displayAccounts = useMemo(() => {
    if (sorting) return orderedAccounts;
    return sortAccounts(baseAccounts);
  }, [sorting, orderedAccounts, baseAccounts]);

  const pinnedAccounts = displayAccounts.filter((account) => account.pinned);
  const regularAccounts = displayAccounts.filter((account) => !account.pinned);
  const showSections =
    view === "all" && !sorting && !normalizedQuery && pinnedAccounts.length > 0;
  const title = viewTitle(view, activeGroup, normalizedQuery);
  const totalInView =
    view === "all"
      ? vault.accounts.length
      : view === "pinned"
        ? vault.accounts.filter((account) => account.pinned).length
        : vault.accounts.filter((account) => account.groupId === activeGroup?.id).length;

  function changeView(nextView) {
    setView(nextView);
    setQuery("");
  }

  async function copyCode(account, codeInfo) {
    if (sorting) return;
    if (hideCodes) {
      toast("验证码已隐藏，请先点击右上角眼睛图标。", "info");
      return;
    }
    if (!codeInfo?.ok || !codeInfo.code) {
      toast(codeInfo?.error || "验证码尚未生成，请稍后重试。", "error");
      return;
    }
    try {
      const result = await window.authenticator.copyText(codeInfo.code);
      if (result.clearSeconds > 0) {
        toast(`已复制 ${accountTitle(account)} 的验证码，${result.clearSeconds} 秒后清除`, "success");
      } else {
        toast(`已复制 ${accountTitle(account)} 的验证码`, "success");
      }
    } catch (copyError) {
      toast(copyError.message || "复制失败。", "error");
    }
  }

  function beginSort() {
    if (sorting) {
      setSorting(false);
      setDraggingId(null);
      setDragTarget(null);
      return;
    }
    setQuery("");
    setSorting(true);
  }

  function handleDragOver(_event, account, position) {
    if (!draggingId) return;
    if (dragTarget?.id === account.id && dragTarget?.position === position) return;
    setDragTarget({ id: account.id, position });
  }

  async function handleDrop(_event, account) {
    if (!draggingId || draggingId === account.id) {
      setDraggingId(null);
      setDragTarget(null);
      return;
    }
    const position = dragTarget?.id === account.id ? dragTarget.position : "before";
    const next = applyReorder(orderedAccounts, draggingId, account.id, position);
    setDraggingId(null);
    setDragTarget(null);
    try {
      const result = await window.authenticator.reorderAccounts(next.map((item) => item.id));
      onVaultUpdated?.(result.vault);
    } catch (error) {
      toast(error.message || "无法保存排序。", "error");
    }
  }

  function renderCards(accounts) {
    return accounts.map((account) => (
      <AccountCard
        key={account.id}
        account={account}
        codeInfo={codes[account.id]}
        group={groups.find((group) => group.id === account.groupId)}
        hidden={hideCodes}
        sorting={sorting}
        dragging={draggingId === account.id}
        dragPosition={dragTarget?.id === account.id ? dragTarget.position : null}
        onCopy={copyCode}
        onEdit={onEditAccount}
        onPin={onPinAccount}
        onIncrement={onIncrementCounter}
        onDragStart={(_event, item) => {
          setDraggingId(item.id);
          setDragTarget(null);
        }}
        onDragOver={handleDragOver}
        onDragLeave={(_event, item) => {
          if (dragTarget?.id === item.id) setDragTarget(null);
        }}
        onDrop={handleDrop}
        onDragEnd={() => {
          setDraggingId(null);
          setDragTarget(null);
        }}
      />
    ));
  }

  const noAccounts = vault.accounts.length === 0;
  const noResults = !noAccounts && displayAccounts.length === 0;

  return (
    <div className={cn("app-shell", vault.settings.compact && "is-compact")}>
      <Sidebar
        vault={vault}
        view={view}
        onViewChange={changeView}
        onAddAccount={onAddAccount}
        onAddGroup={onAddGroup}
        onEditGroup={onEditGroup}
        onOpenSettings={() => onOpenSettings("security")}
        onOpenImport={onOpenImport}
        onLock={onLock}
      />

      <div className="workspace">
        <header className="titlebar">
          <div className="titlebar-left">
            <span className="titlebar-status-dot" />
            <span>本地保险库</span>
            <span className="titlebar-separator" />
            <span className="titlebar-muted">
              {vault.meta.securityMode === "password" ? "主密码保护" : "无密码进入"}
            </span>
          </div>
          <WindowControls />
        </header>

        <main className="main-area">
          <header className="content-header">
            <div className="content-heading">
              <div className="content-eyebrow">
                <span>VAULT</span>
                {activeGroup ? (
                  <>
                    <span className="eyebrow-dot" />
                    <span className="group-eyebrow">
                      <span
                        className="group-color-dot"
                        style={{ background: activeGroup.color }}
                      />
                      {activeGroup.name}
                    </span>
                  </>
                ) : null}
              </div>
              <h1>{title}</h1>
              <p>
                {normalizedQuery
                  ? `${displayAccounts.length} 个匹配结果`
                  : noAccounts
                    ? "你的验证码将加密保存在此电脑"
                    : `${totalInView} 个验证码${pinnedAccounts.length && view === "all" ? ` · ${pinnedAccounts.length} 个已固定` : ""}`}
              </p>
            </div>

            <div className="header-actions">
              <div className="search-box">
                <Icon name="search" size={16} className="search-icon" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    if (sorting) setSorting(false);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setQuery("");
                      event.currentTarget.blur();
                    }
                  }}
                  placeholder="搜索账户、发行方或分组"
                  aria-label="搜索验证码"
                  spellCheck={false}
                  data-testid="search-input"
                />
                {query ? (
                  <button
                    type="button"
                    className="search-clear"
                    onClick={() => {
                      setQuery("");
                      inputRef.current?.focus();
                    }}
                    aria-label="清除搜索"
                  >
                    <Icon name="x" size={13} />
                  </button>
                ) : (
                  <kbd className="search-kbd">/</kbd>
                )}
              </div>

              <div className="header-icon-group">
                <IconButton
                  icon={hideCodes ? "eyeOff" : "eye"}
                  label={hideCodes ? "显示验证码" : "隐藏验证码"}
                  active={hideCodes}
                  onClick={onToggleHideCodes}
                />
                <IconButton
                  icon="scan"
                  label="扫描二维码"
                  onClick={onOpenScanner}
                />
                {view === "all" && !normalizedQuery && vault.accounts.length > 1 ? (
                  <IconButton
                    icon="sort"
                    label={sorting ? "完成排序" : "调整顺序"}
                    active={sorting}
                    onClick={beginSort}
                  />
                ) : null}
                <IconButton
                  icon="settings"
                  label="设置"
                  onClick={() => onOpenSettings("security")}
                />
              </div>

              <Button
                variant="primary"
                icon={<Icon name="plus" size={16} />}
                onClick={onAddAccount}
                className="header-add"
                aria-label="添加验证码"
                title="添加验证码"
              >
                添加验证码
              </Button>
            </div>
          </header>

          <div className={cn("content-scroll", sorting && "is-sorting")}>
            {sorting ? (
              <div className="sorting-banner">
                <span className="sorting-icon">
                  <Icon name="grip" size={17} />
                </span>
                <div>
                  <strong>调整验证码顺序</strong>
                  <span>拖动卡片到你喜欢的位置，顺序会自动保存。</span>
                </div>
                <Button size="sm" variant="secondary" icon={<Icon name="check" size={14} />} onClick={beginSort}>
                  完成
                </Button>
              </div>
            ) : null}

            {noAccounts ? (
              <EmptyState
                icon="key"
                variant="welcome"
                title="添加你的第一个验证码"
                description="扫描网站提供的二维码，或手动输入密钥。所有数据只会加密保存在这台电脑上。"
                actions={
                  <>
                    <Button
                      variant="primary"
                      size="lg"
                      icon={<Icon name="plus" size={17} />}
                      onClick={onAddAccount}
                    >
                      手动添加
                    </Button>
                    <Button
                      variant="secondary"
                      size="lg"
                      icon={<Icon name="scan" size={17} />}
                      onClick={onOpenScanner}
                    >
                      扫描二维码
                    </Button>
                    <Button
                      variant="ghost"
                      size="lg"
                      icon={<Icon name="download" size={17} />}
                      onClick={onOpenImport}
                    >
                      导入备份
                    </Button>
                  </>
                }
              />
            ) : noResults ? (
              normalizedQuery ? (
                <EmptyState
                  icon="search"
                  title="没有找到匹配的验证码"
                  description={`没有与“${query.trim()}”匹配的账户，试试搜索发行方、账户名或备注。`}
                  actions={
                    <Button variant="secondary" onClick={() => setQuery("")}>
                      清除搜索
                    </Button>
                  }
                />
              ) : view === "pinned" ? (
                <EmptyState
                  icon="pin"
                  title="还没有固定验证码"
                  description="把常用的账户固定在顶部，它们会始终排在最前面。"
                  actions={
                    <Button variant="secondary" onClick={() => changeView("all")}>
                      查看全部验证码
                    </Button>
                  }
                />
              ) : (
                <EmptyState
                  icon="layers"
                  title="这个分组还是空的"
                  description="添加验证码时可以选择分组，或在编辑账户时将现有账户移入这里。"
                  actions={
                    <>
                      <Button
                        variant="primary"
                        icon={<Icon name="plus" size={16} />}
                        onClick={onAddAccount}
                      >
                        添加验证码
                      </Button>
                      <Button variant="ghost" onClick={() => changeView("all")}>
                        查看全部
                      </Button>
                    </>
                  }
                />
              )
            ) : sorting ? (
              <div className="account-grid sorting-grid">{renderCards(displayAccounts)}</div>
            ) : showSections ? (
              <>
                <section className="account-section">
                  <div className="section-heading">
                    <span className="section-title">
                      <Icon name="pin" size={14} />
                      已固定
                    </span>
                    <span className="section-count">{pinnedAccounts.length}</span>
                    <span className="section-line" />
                  </div>
                  <div className="account-grid">{renderCards(pinnedAccounts)}</div>
                </section>
                {regularAccounts.length > 0 ? (
                  <section className="account-section">
                    <div className="section-heading">
                      <span className="section-title">其他验证码</span>
                      <span className="section-count">{regularAccounts.length}</span>
                      <span className="section-line" />
                    </div>
                    <div className="account-grid">{renderCards(regularAccounts)}</div>
                  </section>
                ) : null}
              </>
            ) : (
              <div className="account-grid">{renderCards(displayAccounts)}</div>
            )}

            {!noAccounts && !sorting && !noResults ? (
              <div className="content-endnote">
                <Icon name="shieldCheck" size={13} />
                <span>验证码在本机生成，不会通过网络发送</span>
                {vault.settings.autoLockMinutes > 0 && vault.meta.securityMode === "password" ? (
                  <>
                    <span className="note-separator" />
                    <span>{vault.settings.autoLockMinutes} 分钟无操作后自动锁定</span>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}
