"use client";

import { useId } from "react";

export function GeneratedImagePromptDialog({
    value,
    onChange,
    onCancel,
    onConfirm,
    busy,
    error,
    useReferenceImage,
    onUseReferenceImageChange,
    hasReferenceImage,
    useUserReferenceImage,
    onUseUserReferenceImageChange,
    hasUserReference,
    descriptionLabel,
    textOnly = false,
    userReferenceLabel = "允许使用用户参考图（文字模型判断用户是否出镜）",
}: {
    value: string;
    onChange: (value: string) => void;
    onCancel: () => void;
    onConfirm: () => void;
    busy: boolean;
    error?: string;
    useReferenceImage: boolean;
    onUseReferenceImageChange: (useRef: boolean) => void;
    hasReferenceImage: boolean;
    useUserReferenceImage: boolean;
    onUseUserReferenceImageChange: (useRef: boolean) => void;
    hasUserReference: boolean;
    descriptionLabel?: string;
    textOnly?: boolean;
    userReferenceLabel?: string;
}) {
    const descriptionId = useId();
    return (
        <div
            className="modal-overlay"
            data-ui="modal"
            onPointerDown={e => e.stopPropagation()}
            onPointerUp={e => e.stopPropagation()}
            onPointerCancel={e => e.stopPropagation()}
            onPointerMove={e => e.stopPropagation()}
            onContextMenu={e => e.stopPropagation()}
            onClick={e => {
                e.stopPropagation();
                onCancel();
            }}
        >
            <div className="modal-dialog chat-generated-image-prompt-dialog" data-ui="modal-dialog" role="dialog" aria-modal="true" aria-label="重新生成图片" onClick={e => e.stopPropagation()}>
                <div className="modal-header" data-ui="modal-header">
                    <h3 className="modal-title">重新生成图片</h3>
                </div>
                <div className="modal-body chat-generated-image-prompt-body" data-ui="modal-body">
                    {descriptionLabel && <label htmlFor={descriptionId}>{descriptionLabel}</label>}
                    <textarea
                        id={descriptionLabel ? descriptionId : undefined}
                        className="ui-textarea chat-generated-image-prompt-textarea"
                        value={value}
                        onChange={e => onChange(e.target.value)}
                        placeholder="输入图片提示词"
                        disabled={busy}
                    />
                    {textOnly ? <div className="chat-generated-image-prompt-empty-hint">多人剧情使用纯文字生图，不附参考图。</div> : <>
                    {hasReferenceImage ? (
                        <label className="chat-generated-image-prompt-check">
                            <input
                                type="checkbox"
                                checked={useReferenceImage}
                                disabled={busy}
                                onChange={e => onUseReferenceImageChange(e.target.checked)}
                            />
                            <span>使用角色参考图（角色出镜）</span>
                        </label>
                    ) : (
                        <div className="chat-generated-image-prompt-empty-hint">该角色未配置参考图</div>
                    )}
                    {hasUserReference ? (
                        <label className="chat-generated-image-prompt-check">
                            <input
                                type="checkbox"
                                checked={useUserReferenceImage}
                                disabled={busy}
                                onChange={e => onUseUserReferenceImageChange(e.target.checked)}
                            />
                            <span>{userReferenceLabel}</span>
                        </label>
                    ) : (
                        <div className="chat-generated-image-prompt-empty-hint">当前用户身份未配置参考图</div>
                    )}
                    </>}
                    {error && <div className="chat-generated-image-retry-error">{error}</div>}
                </div>
                <div className="modal-footer" data-ui="modal-footer">
                    <button className="ui-btn ui-btn-ghost" onClick={onCancel}>取消</button>
                    <button
                        className="ui-btn ui-btn-action"
                        disabled={busy || !value.trim()}
                        onClick={onConfirm}
                    >
                        {descriptionLabel && busy ? "生成中…" : "生成"}
                    </button>
                </div>
            </div>
        </div>
    );
}
