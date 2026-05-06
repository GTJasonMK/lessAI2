import { memo } from "react";
import { Orbit } from "lucide-react";
import type { AppSettings, ProviderCheckResult } from "../../lib/types";
import type { NoticeTone } from "../../lib/constants";
import { AI_DETECTION_UI_ENABLED } from "../../lib/featureFlags";
import { ActionButton } from "../ActionButton";
import { StatusBadge } from "../StatusBadge";

interface ProviderSettingsPageProps {
  settings: AppSettings;
  demoRuntime: boolean;
  providerStatus: ProviderCheckResult | null;
  providerTone: NoticeTone;
  testProviderBusy: boolean;
  testProviderDisabled: boolean;
  onTestProvider: () => void;
  onUpdateStringSetting: <
    K extends
      | "baseUrl"
      | "apiKey"
      | "model"
      | "detectionBaseUrl"
      | "detectionApiKey"
      | "detectionModel"
      | "updateProxy"
  >(
    key: K,
    value: string
  ) => void;
  onUpdateBooleanSetting: <K extends "detectionEnabled">(key: K, value: boolean) => void;
  onUpdateNumberSetting: (
    key: "timeoutMs" | "temperature" | "maxConcurrency" | "unitsPerBatch",
    value: string
  ) => void;
}

export const ProviderSettingsPage = memo(function ProviderSettingsPage({
  settings,
  demoRuntime,
  providerStatus,
  providerTone,
  testProviderBusy,
  testProviderDisabled,
  onTestProvider,
  onUpdateStringSetting,
  onUpdateBooleanSetting,
  onUpdateNumberSetting
}: ProviderSettingsPageProps) {
  return (
    <div className="settings-page">
      <div className="settings-page-head">
        <h3>模型与接口</h3>
        <StatusBadge tone={providerTone}>
          {providerStatus ? (providerStatus.ok ? "连接正常" : "待修正") : "未测试"}
        </StatusBadge>
      </div>

      <div className="field-grid">
        <label className="field">
          <span>Base URL</span>
          <input
            value={settings.baseUrl}
            onChange={(event) => onUpdateStringSetting("baseUrl", event.target.value)}
            placeholder="https://api.deepseek.com/v1"
          />
        </label>
        <label className="field">
          <span>API Key</span>
          <input
            type="password"
            value={settings.apiKey}
            onChange={(event) => onUpdateStringSetting("apiKey", event.target.value)}
            placeholder="sk-..."
          />
        </label>
        <label className="field">
          <span>Model</span>
          <input
            value={settings.model}
            onChange={(event) => onUpdateStringSetting("model", event.target.value)}
            placeholder="deepseek-v4-flash"
          />
        </label>
        <label className="field field-inline">
          <span>超时（毫秒）</span>
          <input
            type="number"
            min={1000}
            step={1000}
            value={settings.timeoutMs}
            onChange={(event) => onUpdateNumberSetting("timeoutMs", event.target.value)}
          />
        </label>
      </div>

      <div className="settings-page-actions">
        <ActionButton
          icon={Orbit}
          label="测试连接"
          busy={testProviderBusy}
          disabled={testProviderDisabled}
          onClick={onTestProvider}
          variant="secondary"
        />
      </div>

      {AI_DETECTION_UI_ENABLED ? (
        <div className="field-block">
          <div className="field-line">
            <span>AI 检测接口</span>
            <strong>{settings.detectionEnabled ? "已启用" : "未启用"}</strong>
          </div>
          <label className="field-check">
            <input
              type="checkbox"
              checked={settings.detectionEnabled}
              onChange={(event) =>
                onUpdateBooleanSetting("detectionEnabled", event.target.checked)
              }
            />
            <span>启用独立 AI 检测 API</span>
          </label>
          <div className="field-grid">
            <label className="field">
              <span>检测 Base URL</span>
              <input
                value={settings.detectionBaseUrl}
                onChange={(event) =>
                  onUpdateStringSetting("detectionBaseUrl", event.target.value)
                }
                placeholder="https://api.deepseek.com/v1"
              />
            </label>
            <label className="field">
              <span>检测 API Key</span>
              <input
                type="password"
                value={settings.detectionApiKey}
                onChange={(event) =>
                  onUpdateStringSetting("detectionApiKey", event.target.value)
                }
                placeholder="sk-..."
              />
            </label>
            <label className="field">
              <span>检测 Model</span>
              <input
                value={settings.detectionModel}
                onChange={(event) =>
                  onUpdateStringSetting("detectionModel", event.target.value)
                }
                placeholder="deepseek-v4-flash"
              />
            </label>
          </div>
          <span className="workspace-hint">
            检测配置独立于改写模型；检测结果以 0-100 的 AI 概率展示。
          </span>
        </div>
      ) : null}

      <div className="field-block">
        <div className="field-line">
          <span>Temperature</span>
          <strong>{settings.temperature.toFixed(1)}</strong>
        </div>
        <input
          type="range"
          min={0}
          max={2}
          step={0.1}
          value={settings.temperature}
          onChange={(event) => onUpdateNumberSetting("temperature", event.target.value)}
        />
      </div>

      <div className="field-block">
        <div className="field-line">
          <span>网络代理</span>
          <strong>{demoRuntime ? "网页托管" : "网络"}</strong>
        </div>
        <label className="field">
          <span>代理地址（可选）</span>
          <input
            value={settings.updateProxy}
            onChange={(event) => onUpdateStringSetting("updateProxy", event.target.value)}
            placeholder="http://127.0.0.1:7890"
            disabled={demoRuntime}
            title={demoRuntime ? "网页版请求由浏览器/系统代理决定，此项仅桌面版生效。" : ""}
          />
        </label>
        <span className="workspace-hint">
          {demoRuntime
            ? "网页版请求由浏览器/系统代理配置决定，此项仅桌面版生效。"
            : "留空则直连；用于 AI 模型请求与应用更新相关网络请求。"}
        </span>
      </div>

      {providerStatus ? (
        <div className="empty-inline">
          <span>{providerStatus.message}</span>
        </div>
      ) : null}
    </div>
  );
});
