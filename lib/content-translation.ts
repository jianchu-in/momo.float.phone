import { jsonrepair } from 'jsonrepair';
import { loadApiConfigs, loadBindingConfig, resolveBinding } from './settings-storage';
import { loadCharacters } from './character-storage';
import { sendLLMRequest } from './chat-engine';

export function resolveContentTranslationApiConfig(appId: string, characterId?: string) {
  const id = characterId || loadCharacters()[0]?.id || '';
  const slot = resolveBinding(loadBindingConfig(), id, appId);
  return loadApiConfigs().find((x) => x.id === (slot.translationApiConfigId || slot.apiConfigId)) || null;
}

export async function translateContentTexts(texts: string[], appId: string, characterId?: string): Promise<string[]> {
  const api = resolveContentTranslationApiConfig(appId, characterId);
  if (!api) return texts;
  try {
    const raw = await sendLLMRequest(
      api,
      null,
      [
        { role: 'system', content: '将输入文本数组逐项翻译为简体中文，保留原意和语气。只返回 JSON {texts: string[]}。' },
        { role: 'user', content: JSON.stringify({ texts }) }
      ],
      [],
      undefined,
      { appId: 'content_translation', skipOutputRegex: true }
    );
    const parsed = JSON.parse(jsonrepair(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)));
    if (Array.isArray(parsed.texts)) return parsed.texts;
  } catch (e) {
    console.warn('[content-translation] translation failed', e);
  }
  return texts;
}
