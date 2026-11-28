"use client";
import { useState } from "react";
import { getCharacterBinding, loadBindingConfig, loadVoiceConfigs, saveBindingConfig, setCharacterBinding } from "@/lib/settings-storage";

export function FacingVoiceBinding({ characterId }: { characterId: string }) {
  const [, refresh] = useState(0);
  const config = loadBindingConfig();
  const binding = getCharacterBinding(config, characterId);
  return <label>该角色的面对面语音方案<select aria-label="角色语音方案" value={binding.appOverrides.facing?.voiceConfigId ?? ""} onChange={event => {
    const next = { ...binding, appOverrides: { ...binding.appOverrides, facing: { ...binding.appOverrides.facing, voiceConfigId: event.target.value || undefined } } };
    saveBindingConfig(setCharacterBinding(loadBindingConfig(), next)); refresh(value => value + 1);
  }}><option value="">继承该角色原有绑定</option>{loadVoiceConfigs().map(item => <option key={item.id} value={item.id}>{item.name || item.provider}</option>)}</select></label>;
}
