import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./styles.css";

const savedTheme = window.localStorage.getItem("authdesk-theme") || "system";
const initialTheme =
  savedTheme === "system"
    ? window.matchMedia?.("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light"
    : savedTheme;
document.documentElement.dataset.theme = initialTheme;
document.documentElement.style.colorScheme = initialTheme;

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("Renderer error", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="fatal-screen">
          <div className="fatal-card">
            <div className="fatal-mark">!</div>
            <h1>界面遇到了问题</h1>
            <p>你的保险库数据仍然安全地保存在本机。请重新加载应用。</p>
            <pre>{String(this.state.error?.message || this.state.error)}</pre>
            <button className="btn btn-primary" onClick={() => window.location.reload()}>
              重新加载
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
