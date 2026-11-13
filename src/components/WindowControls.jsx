import React, { useEffect, useState } from "react";
import { Icon } from "../icons.jsx";

export default function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let active = true;
    window.authenticator
      .isMaximized()
      .then((result) => {
        if (active) setMaximized(Boolean(result.maximized));
      })
      .catch(() => {});
    const unsubscribe = window.authenticator.onMaximized((value) => setMaximized(Boolean(value)));
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, []);

  return (
    <div className="window-controls">
      <button
        type="button"
        className="window-control"
        aria-label="最小化"
        title="最小化"
        onClick={() => window.authenticator.minimizeWindow()}
      >
        <Icon name="minimize" size={12} strokeWidth={1.2} />
      </button>
      <button
        type="button"
        className="window-control"
        aria-label={maximized ? "还原" : "最大化"}
        title={maximized ? "还原" : "最大化"}
        onClick={() => window.authenticator.toggleMaximize()}
      >
        <Icon name={maximized ? "restore" : "maximize"} size={12} strokeWidth={1.3} />
      </button>
      <button
        type="button"
        className="window-control window-control-close"
        aria-label="关闭"
        title="关闭"
        onClick={() => window.authenticator.closeWindow()}
      >
        <Icon name="x" size={13} strokeWidth={1.3} />
      </button>
    </div>
  );
}
