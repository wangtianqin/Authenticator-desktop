import React, { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { Icon } from "../../icons.jsx";
import {
  AccountAvatar,
  Badge,
  Button,
  Field,
  InlineNotice,
  Modal,
  Select,
} from "../UI.jsx";
import { accountTitle, accountSubtitle, typeLabel } from "../../utils.js";

function ScanFrame() {
  return (
    <div className="scan-frame" aria-hidden="true">
      <span className="scan-corner scan-corner-tl" />
      <span className="scan-corner scan-corner-tr" />
      <span className="scan-corner scan-corner-bl" />
      <span className="scan-corner scan-corner-br" />
      <span className="scan-line" />
      <div className="scan-placeholder">
        <Icon name="qr" size={46} />
        <span>将二维码放入框内</span>
      </div>
    </div>
  );
}

export default function ScannerModal({
  open,
  groups,
  onClose,
  onDetected,
  onImported,
  toast,
}) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const streamRef = useRef(null);
  const scanTimerRef = useRef(null);
  const processingRef = useRef(false);
  const lastDecodedRef = useRef({ text: "", at: 0 });
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [batch, setBatch] = useState(null);
  const [groupId, setGroupId] = useState("");
  const [importing, setImporting] = useState(false);
  const [imageBusy, setImageBusy] = useState("");

  useEffect(() => {
    if (!open) return undefined;
    setStatus(null);
    setBatch(null);
    setGroupId("");
    setImageBusy("");
    return () => {
      stopCamera();
    };
  }, [open]);

  function stopCamera() {
    if (scanTimerRef.current) {
      window.clearTimeout(scanTimerRef.current);
      scanTimerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
    processingRef.current = false;
  }

  function scheduleScan() {
    if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current);
    scanTimerRef.current = window.setTimeout(scanFrame, 220);
  }

  function scanFrame() {
    const video = videoRef.current;
    if (!video || !streamRef.current) return;
    if (video.readyState >= 2 && video.videoWidth && video.videoHeight) {
      try {
        const canvas = canvasRef.current;
        const maxSide = 900;
        const scale = Math.min(1, maxSide / Math.max(video.videoWidth, video.videoHeight));
        const width = Math.max(1, Math.round(video.videoWidth * scale));
        const height = Math.max(1, Math.round(video.videoHeight * scale));
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context.drawImage(video, 0, 0, width, height);
        const image = context.getImageData(0, 0, width, height);
        const result = jsQR(image.data, width, height, {
          inversionAttempts: "attemptBoth",
        });
        if (result?.data) {
          handleDecoded(result.data);
          return;
        }
      } catch (scanError) {
        console.warn("Camera scan failed", scanError);
      }
    }
    scheduleScan();
  }

  async function startCamera() {
    if (cameraBusy) return;
    if (cameraActive) {
      stopCamera();
      setStatus(null);
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus({ tone: "error", text: "当前环境无法访问摄像头，请改用图片或屏幕截图。" });
      return;
    }
    setCameraBusy(true);
    setStatus({ tone: "neutral", text: "正在请求摄像头权限…" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: "environment",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
      streamRef.current = stream;
      const video = videoRef.current;
      video.srcObject = stream;
      await video.play();
      setCameraActive(true);
      setStatus({ tone: "neutral", text: "正在扫描，请将二维码对准摄像头。" });
      processingRef.current = false;
      scheduleScan();
    } catch (cameraError) {
      stopCamera();
      const message = /Permission|NotAllowed|NotFound|Devices/i.test(cameraError.name || "")
        ? "无法访问摄像头。请检查 Windows 隐私设置，或改用图片/屏幕截图。"
        : cameraError.message || "无法启动摄像头。";
      setStatus({ tone: "error", text: message });
    } finally {
      setCameraBusy(false);
    }
  }

  function drawImageToCanvas(image, width, height) {
    const canvas = canvasRef.current;
    const maxSide = 2000;
    const scale = Math.min(1, maxSide / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0, targetWidth, targetHeight);
    return {
      imageData: context.getImageData(0, 0, targetWidth, targetHeight),
      width: targetWidth,
      height: targetHeight,
    };
  }

  function decodeCanvas() {
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!canvas.width || !canvas.height) return null;
    const image = context.getImageData(0, 0, canvas.width, canvas.height);
    return jsQR(image.data, canvas.width, canvas.height, {
      inversionAttempts: "attemptBoth",
    });
  }

  async function loadDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("无法读取图片。"));
      image.src = dataUrl;
    });
  }

  async function decodeFile(file) {
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) {
      setStatus({ tone: "error", text: "图片超过 12 MB，请选择更小的截图。" });
      return;
    }
    stopCamera();
    setImageBusy("file");
    setStatus({ tone: "neutral", text: "正在识别图片中的二维码…" });
    try {
      const bitmap = await createImageBitmap(file);
      const { width, height } = drawImageToCanvas(bitmap, bitmap.width, bitmap.height);
      bitmap.close?.();
      const result = decodeCanvas();
      if (!result?.data) {
        setStatus({ tone: "error", text: "图片中没有识别到二维码。请确保二维码清晰、完整且未被裁剪。" });
        return;
      }
      await handleDecoded(result.data);
    } catch (error) {
      setStatus({ tone: "error", text: error.message || "无法识别这张图片。" });
    } finally {
      setImageBusy("");
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function captureScreen() {
    stopCamera();
    setImageBusy("screen");
    setStatus({ tone: "neutral", text: "正在截取屏幕并识别二维码…" });
    try {
      const { images } = await window.authenticator.captureScreen();
      if (!images?.length) throw new Error("没有可用的屏幕截图。");
      for (const item of images) {
        const image = await loadDataUrl(item.dataUrl);
        drawImageToCanvas(image, image.naturalWidth, image.naturalHeight);
        const result = decodeCanvas();
        if (result?.data) {
          await handleDecoded(result.data);
          return;
        }
      }
      setStatus({
        tone: "error",
        text: "当前屏幕中没有识别到二维码。请让二维码完整显示在屏幕上后重试。",
      });
    } catch (error) {
      setStatus({ tone: "error", text: error.message || "屏幕扫描失败。" });
    } finally {
      setImageBusy("");
    }
  }

  async function pasteClipboard() {
    stopCamera();
    setImageBusy("clipboard");
    setStatus({ tone: "neutral", text: "正在读取剪贴板中的图片…" });
    try {
      const { image } = await window.authenticator.pasteImage();
      if (!image) {
        setStatus({ tone: "error", text: "剪贴板中没有图片。请先截图或复制二维码图片。" });
        return;
      }
      const loaded = await loadDataUrl(image);
      drawImageToCanvas(loaded, loaded.naturalWidth, loaded.naturalHeight);
      const result = decodeCanvas();
      if (!result?.data) {
        setStatus({ tone: "error", text: "剪贴板图片中没有识别到二维码。" });
        return;
      }
      await handleDecoded(result.data);
    } catch (error) {
      setStatus({ tone: "error", text: error.message || "无法读取剪贴板图片。" });
    } finally {
      setImageBusy("");
    }
  }

  async function handleDecoded(text) {
    const now = Date.now();
    if (processingRef.current) return;
    if (lastDecodedRef.current.text === text && now - lastDecodedRef.current.at < 2500) return;
    lastDecodedRef.current = { text, at: now };
    stopCamera();
    processingRef.current = true;
    setStatus({ tone: "neutral", text: "二维码已识别，正在解析账户信息…" });
    try {
      const result = await window.authenticator.inspectImport(text);
      if (result.status === "password_required") {
        throw new Error("这是一个加密备份二维码，请在“导入备份”中输入密码。");
      }
      if (!result.accounts?.length) throw new Error("二维码中没有可导入的验证码。");
      if (result.accounts.length === 1) {
        setStatus({ tone: "success", text: "识别成功，正在打开账户详情…" });
        onDetected?.(result.accounts[0], result.warnings || []);
      } else {
        setBatch(result.accounts);
        setStatus({
          tone: "success",
          text: `识别到 ${result.accounts.length} 个验证码，请确认后批量导入。`,
        });
      }
    } catch (error) {
      setStatus({ tone: "error", text: error.message || "二维码格式不受支持。" });
      window.setTimeout(() => {
        processingRef.current = false;
        setStatus((current) =>
          current?.tone === "error"
            ? { tone: "neutral", text: "可以继续尝试扫描其他二维码。" }
            : current
        );
      }, 2200);
    }
  }

  async function importBatch() {
    if (!batch?.length) return;
    setImporting(true);
    try {
      const result = await window.authenticator.commitImport(batch, groupId || null, true);
      const skipped = result.skipped?.length || 0;
      toast(
        skipped
          ? `已导入 ${result.added.length} 个验证码，跳过 ${skipped} 个重复或无效条目`
          : `已导入 ${result.added.length} 个验证码`,
        "success"
      );
      onImported?.(result.vault);
    } catch (error) {
      toast(error.message || "导入失败。", "error");
    } finally {
      setImporting(false);
    }
  }

  function resetScanner() {
    setBatch(null);
    setStatus(null);
    processingRef.current = false;
    lastDecodedRef.current = { text: "", at: 0 };
  }

  return (
    <Modal
      open={open}
      onClose={() => {
        stopCamera();
        onClose?.();
      }}
      title={batch ? "批量导入验证码" : "扫描二维码"}
      subtitle={
        batch
          ? "这些账户来自同一个 Google Authenticator 迁移二维码。"
          : "使用摄像头、屏幕截图或图片文件读取 otpauth 二维码。"
      }
      eyebrow="QR SCANNER"
      icon={<Icon name="scan" size={20} />}
      size="lg"
      closeDisabled={importing}
      footer={
        batch ? (
          <div className="modal-footer-actions">
            <Button variant="ghost" onClick={resetScanner} disabled={importing}>
              重新扫描
            </Button>
            <Button
              variant="primary"
              loading={importing}
              icon={<Icon name="download" size={16} />}
              onClick={importBatch}
            >
              导入全部 {batch.length} 个
            </Button>
          </div>
        ) : (
          <div className="modal-footer-actions">
            <span className="scanner-footer-hint">
              <Icon name="shieldCheck" size={14} />
              二维码只在本地解析
            </span>
            <Button variant="ghost" onClick={onClose}>
              取消
            </Button>
          </div>
        )
      }
    >
      {batch ? (
        <div className="batch-import">
          <div className="batch-list">
            {batch.map((account, index) => (
              <div className="batch-row" key={`${account.issuer}-${account.account}-${index}`}>
                <span className="batch-index">{String(index + 1).padStart(2, "0")}</span>
                <AccountAvatar account={account} size={36} />
                <div className="batch-identity">
                  <strong>{accountTitle(account)}</strong>
                  <span>{accountSubtitle(account)}</span>
                </div>
                <Badge tone="neutral">{typeLabel(account.type)}</Badge>
              </div>
            ))}
          </div>
          <Field label="导入到分组" optional>
            <Select value={groupId} onChange={(event) => setGroupId(event.target.value)}>
              <option value="">未分组</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </Select>
          </Field>
          <InlineNotice tone="info" icon="info">
            导入时会自动跳过密钥、发行方和账户名称完全相同的已有验证码。
          </InlineNotice>
        </div>
      ) : (
        <div className="scanner-layout">
          <div className="scanner-visual">
            <div className={`camera-stage ${cameraActive ? "is-active" : ""}`}>
              <video ref={videoRef} playsInline muted autoPlay className="camera-video" />
              {!cameraActive ? <ScanFrame /> : <div className="camera-overlay"><ScanFrame /></div>}
              {cameraActive ? (
                <button type="button" className="camera-stop" onClick={startCamera}>
                  停止摄像头
                </button>
              ) : null}
            </div>
            <canvas ref={canvasRef} className="scan-canvas" />
            <div className={`scanner-status ${status ? `status-${status.tone}` : ""}`}>
              {status ? (
                <>
                  <span className="status-indicator" />
                  {status.text}
                </>
              ) : (
                <>
                  <span className="status-indicator" />
                  等待选择扫描方式
                </>
              )}
            </div>
          </div>

          <div className="scanner-controls">
            <h3>选择扫描方式</h3>
            <p className="scanner-controls-copy">
              从网站的安全设置页面截取二维码，或直接对准屏幕拍摄。
            </p>
            <div className="scan-actions">
              <button
                type="button"
                className={`scan-action ${cameraActive ? "is-active" : ""}`}
                onClick={startCamera}
                disabled={cameraBusy || Boolean(imageBusy)}
              >
                <span className="scan-action-icon">
                  <Icon name="camera" size={20} />
                </span>
                <span>
                  <strong>{cameraActive ? "停止摄像头" : "使用摄像头"}</strong>
                  <small>{cameraBusy ? "正在启动…" : "实时扫描屏幕上的二维码"}</small>
                </span>
                <Icon name="chevronRight" size={15} />
              </button>
              <button
                type="button"
                className="scan-action"
                onClick={() => fileInputRef.current?.click()}
                disabled={Boolean(imageBusy)}
              >
                <span className="scan-action-icon">
                  <Icon name="image" size={20} />
                </span>
                <span>
                  <strong>选择图片</strong>
                  <small>{imageBusy === "file" ? "正在识别…" : "PNG、JPG 或网页截图"}</small>
                </span>
                <Icon name="chevronRight" size={15} />
              </button>
              <button
                type="button"
                className="scan-action"
                onClick={captureScreen}
                disabled={Boolean(imageBusy)}
              >
                <span className="scan-action-icon">
                  <Icon name="monitor" size={20} />
                </span>
                <span>
                  <strong>截取屏幕</strong>
                  <small>{imageBusy === "screen" ? "正在识别…" : "扫描当前所有显示器"}</small>
                </span>
                <Icon name="chevronRight" size={15} />
              </button>
              <button
                type="button"
                className="scan-action"
                onClick={pasteClipboard}
                disabled={Boolean(imageBusy)}
              >
                <span className="scan-action-icon">
                  <Icon name="clipboard" size={20} />
                </span>
                <span>
                  <strong>从剪贴板粘贴</strong>
                  <small>{imageBusy === "clipboard" ? "正在识别…" : "读取复制到剪贴板的二维码"}</small>
                </span>
                <Icon name="chevronRight" size={15} />
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif,image/bmp"
              className="visually-hidden"
              onChange={(event) => decodeFile(event.target.files?.[0])}
            />
            <div className="scanner-tip">
              <Icon name="info" size={14} />
              <span>也支持 Google Authenticator 的迁移二维码，可一次导入多个账户。</span>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
