import { memo } from "react";

export type UpdatePhase = "checking" | "downloading" | "installing" | "relaunching";

interface UpdateProgressModalProps {
  phase: UpdatePhase;
  downloadedBytes: number;
  totalBytes: number | null;
  onCancel: () => void;
}

const PHASE_LABELS: Record<UpdatePhase, string> = {
  checking: "检查更新",
  downloading: "下载更新",
  installing: "安装更新",
  relaunching: "重启应用"
};

export const UpdateProgressModal = memo(function UpdateProgressModal({
  phase,
  downloadedBytes,
  totalBytes,
  onCancel
}: UpdateProgressModalProps) {
  const hasTotal = totalBytes != null && totalBytes > 0;
  const percent = hasTotal
    ? Math.max(0, Math.min(100, Math.floor((downloadedBytes / totalBytes) * 100)))
    : null;
  const phaseLabel = PHASE_LABELS[phase];
  const progressLabel = percent != null ? `${phaseLabel} ${percent}%` : `${phaseLabel}中`;

  return (
    <div className="update-progress-overlay" role="status" aria-live="polite">
      <button
        type="button"
        className="update-progress-pill"
        onClick={onCancel}
        aria-label={`${progressLabel}，点击隐藏更新进度`}
        title={`${progressLabel}，点击隐藏更新进度`}
      >
        <span
          className="update-progress-track"
          role="progressbar"
          aria-label={phaseLabel}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={percent ?? undefined}
        >
          <span
            className={`update-progress-fill ${percent == null ? "is-indeterminate" : ""}`}
            style={percent != null ? { width: `${percent}%` } : undefined}
            aria-hidden="true"
          />
        </span>
      </button>
    </div>
  );
});
