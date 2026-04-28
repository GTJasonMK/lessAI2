import { memo, useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpCircle, ChevronDown, GitBranch } from "lucide-react";
import { formatDate } from "../../lib/helpers";
import type { ReleaseVersionSummary } from "../../lib/types";
import { ActionButton } from "../ActionButton";
import { StatusBadge } from "../StatusBadge";

interface VersionSettingsPageProps {
  currentVersion: string;
  releaseVersions: ReleaseVersionSummary[];
  selectedReleaseTag: string;
  selectedRelease: ReleaseVersionSummary | null;
  selectedReleaseIsCurrent: boolean;
  releaseListLoadedAt: string | null;
  switchRequiresUpdaterManifest: boolean;
  checkUpdateBusy: boolean;
  checkUpdateDisabled: boolean;
  switchReleaseBusy: boolean;
  switchReleaseDisabled: boolean;
  onCheckUpdate: () => void;
  onSelectReleaseTag: (tag: string) => void;
  onSwitchSelectedRelease: () => void;
}

function formatOptionLabel(release: ReleaseVersionSummary): string {
  const parts = [release.tag];
  if (release.prerelease) parts.push("（预发布）");
  if (!release.updaterAvailable) parts.push("（仅手动下载）");
  return parts.join(" ");
}

export const VersionSettingsPage = memo(function VersionSettingsPage({
  currentVersion,
  releaseVersions,
  selectedReleaseTag,
  selectedRelease,
  selectedReleaseIsCurrent,
  releaseListLoadedAt,
  switchRequiresUpdaterManifest,
  checkUpdateBusy,
  checkUpdateDisabled,
  switchReleaseBusy,
  switchReleaseDisabled,
  onCheckUpdate,
  onSelectReleaseTag,
  onSwitchSelectedRelease
}: VersionSettingsPageProps) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const handleOptionMouseDown = useCallback(
    (tag: string) => (event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      setDropdownOpen(false);
      onSelectReleaseTag(tag);
    },
    [onSelectReleaseTag]
  );

  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClick = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [dropdownOpen]);

  const selectedLabel =
    selectedRelease != null
      ? formatOptionLabel(selectedRelease)
      : "打开版本页后会自动加载";

  return (
    <div className="settings-page">
      <div className="settings-page-head">
        <h3>版本管理</h3>
        <StatusBadge tone={selectedReleaseIsCurrent ? "success" : "info"}>
          {currentVersion ? `当前 ${currentVersion}` : "当前版本未知"}
        </StatusBadge>
      </div>

      <div className="field-block">
        <div className="field-line">
          <span>已发布版本</span>
          <strong>{releaseVersions.length > 0 ? `${releaseVersions.length} 个` : "未加载"}</strong>
        </div>
        <label className="field">
          <span>目标版本</span>
          <div className="version-dropdown" ref={dropdownRef}>
            <button
              type="button"
              className="button button-secondary version-dropdown-trigger"
              disabled={releaseVersions.length === 0}
              onClick={() => setDropdownOpen((open) => !open)}
            >
              <span>{selectedLabel}</span>
              <ChevronDown className={`version-chevron ${dropdownOpen ? "version-chevron-open" : ""}`} />
            </button>

            {dropdownOpen && (
              <div className="version-dropdown-panel">
                <div className="version-dropdown-list">
                  {releaseVersions.map((release) => (
                    <button
                      key={release.tag}
                      type="button"
                      className={`version-dropdown-option ${
                        release.tag === selectedReleaseTag ? "version-dropdown-option-selected" : ""
                      }`}
                      onMouseDown={handleOptionMouseDown(release.tag)}
                    >
                      <span>{release.tag}</span>
                      <span className="version-dropdown-option-extra">
                        {release.prerelease ? "预发布" : ""}
                        {!release.updaterAvailable ? (
                          <span className="version-dropdown-option-warn">需手动下载</span>
                        ) : null}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </label>
        {selectedRelease ? (
          <span className="workspace-hint">
            {selectedRelease.publishedAt
              ? `发布时间：${formatDate(selectedRelease.publishedAt)}`
              : "发布时间未知"}
            {selectedReleaseIsCurrent ? " · 当前正在运行该版本" : ""}
            {!selectedRelease.updaterAvailable
              ? " · 当前版本无 latest.json，需手动下载"
              : ""}
          </span>
        ) : null}
        {releaseListLoadedAt ? (
          <span className="workspace-hint">
            版本列表更新时间：{formatDate(releaseListLoadedAt)}
          </span>
        ) : null}
        <span className="workspace-hint">
          检查更新会同步刷新版本列表；版本切换会读取"模型与接口"页配置的网络代理。
        </span>
        <div className="settings-page-actions">
          <ActionButton
            icon={ArrowUpCircle}
            label="检查更新"
            busy={checkUpdateBusy}
            disabled={checkUpdateDisabled}
            onClick={onCheckUpdate}
            variant="secondary"
          />
          <ActionButton
            icon={GitBranch}
            label="切换到所选版本"
            busy={switchReleaseBusy}
            disabled={
              switchReleaseDisabled ||
              !selectedRelease ||
              selectedReleaseIsCurrent ||
              (switchRequiresUpdaterManifest && !selectedRelease.updaterAvailable)
            }
            onClick={onSwitchSelectedRelease}
            variant="secondary"
          />
        </div>
      </div>
    </div>
  );
});
