/* Character card parser. No network calls. Browser + Node-compatible test export. */
(function (scope) {
  'use strict';
  const text = v => typeof v === 'string' ? v : v == null ? '' : String(v);
  const obj = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  const arr = v => Array.isArray(v) ? v : [];
  const clone = v => JSON.parse(JSON.stringify(v));
  function normalizeCard(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('文件不是有效的角色卡 JSON 对象');
    const root = clone(input);
    const data = root.data && typeof root.data === 'object' && !Array.isArray(root.data) ? root.data : root;
    if (!text(data.name || root.name).trim()) throw new Error('没有识别到角色名称，请确认是角色卡而非聊天存档');
    const ext = obj(data.extensions);
    const greetings = [text(data.first_mes ?? root.first_mes), ...arr(data.alternate_greetings ?? root.alternate_greetings).map(text)]
      .map((content, i) => ({id: 'opening_' + i, name: i ? `备用开场 ${i}` : '默认开场', content, sourceIndex: i, format: /<\/?[a-z][^>]*>/i.test(content) ? 'html' : 'text'}))
      .filter(g => g.content.length);
    const book = obj(data.character_book || data.characterBook || ext.character_book || root.character_book);
    const rawScripts = ext.regex_scripts ?? ext.regexScripts ?? root.regex_scripts ?? [];
    return {
      spec: text(root.spec || (root.data ? 'chara_card_v2' : 'legacy')), raw: root,
      name: text(data.name ?? root.name), description: text(data.description ?? root.description),
      personality: text(data.personality ?? root.personality), scenario: text(data.scenario ?? root.scenario),
      mesExample: text(data.mes_example ?? root.mes_example),
      systemPrompt: text(data.system_prompt), postHistory: text(data.post_history_instructions),
      creatorNotes: text(data.creator_notes), creator: text(data.creator), version: text(data.character_version),
      tags: arr(data.tags).map(text), greetings, worldBook: book, scripts: arr(rawScripts),
      extensions: ext, sourceFields: Object.keys(data),
    };
  }
  function updateRaw(card, patch) {
    const raw = clone(card.raw);
    const d = obj(raw.data);
    const target = raw.data && typeof raw.data === 'object' ? d : raw;
    const fields = {name:'name',description:'description',personality:'personality',scenario:'scenario',mesExample:'mes_example',systemPrompt:'system_prompt',postHistory:'post_history_instructions',creatorNotes:'creator_notes'};
    for (const [k, field] of Object.entries(fields)) if (Object.hasOwn(patch,k)) target[field] = text(patch[k]);
    if (Object.hasOwn(patch, 'greetings')) {
      const greetings = arr(patch.greetings);
      target.first_mes = greetings[0]?.content || '';
      target.alternate_greetings = greetings.slice(1).map(g => text(g.content));
    }
    if (raw.data) raw.data = target;
    return normalizeCard(raw);
  }
  function bytesToString(uint) { return new TextDecoder('utf-8').decode(uint); }
  function base64Json(raw) {
    const compact = text(raw).replace(/\s/g,'');
    if (/^[\[{]/.test(compact)) return JSON.parse(raw);
    const bin = atob(compact);
    return JSON.parse(bytesToString(Uint8Array.from(bin, c => c.charCodeAt(0))));
  }
  async function inflate(bytes) {
    if (typeof DecompressionStream !== 'function') throw new Error('此浏览器不支持 PNG 压缩元数据；建议改用 JSON 角色卡导入');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  async function parsePngCard(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer); const dv = new DataView(arrayBuffer);
    if (bytes.length < 12 || ![137,80,78,71,13,10,26,10].every((v,i)=>v===bytes[i])) throw new Error('这不是有效的 PNG 文件');
    let p = 8, metadata = [];
    while (p + 12 <= bytes.length) {
      const size = dv.getUint32(p); const type = String.fromCharCode(...bytes.slice(p+4,p+8));
      if (size > bytes.length - p - 12) throw new Error('PNG 文件结构损坏');
      const chunk = bytes.slice(p+8,p+8+size); const sep = chunk.indexOf(0);
      if (sep >= 0 && (type === 'tEXt' || type === 'zTXt' || type === 'iTXt')) {
        const keyword = String.fromCharCode(...chunk.slice(0,sep));
        if (['chara','ccv3','character','chara_card_v3'].includes(keyword.toLowerCase())) {
          let content;
          if (type === 'tEXt') content = bytesToString(chunk.slice(sep+1));
          if (type === 'zTXt') content = bytesToString(await inflate(chunk.slice(sep+2)));
          if (type === 'iTXt') {
            const compressed = chunk[sep+1] === 1; let start = sep+3;
            for (let j=0;j<2;j++) { const end = chunk.indexOf(0,start); if (end<0) throw new Error('PNG iTXt 结构损坏'); start=end+1; }
            const payload=chunk.slice(start); content = bytesToString(compressed?await inflate(payload):payload);
          }
          if (content) metadata.push({keyword, content});
        }
      }
      p += 12 + size;
      if(type==='IEND') break;
    }
    for (const item of metadata.sort((a,b) => Number(b.keyword.toLowerCase()==='ccv3')-Number(a.keyword.toLowerCase()==='ccv3'))) {
      try { const card=normalizeCard(base64Json(item.content)); return {card, metadataKey:item.keyword}; } catch (err) { /* attempt alternate metadata */ }
    }
    throw new Error('PNG 中没有可识别的酒馆角色卡元数据（chara / ccv3）');
  }
  const api={ normalizeCard, updateRaw, parsePngCard };
  if (typeof module !== 'undefined' && module.exports) module.exports=api;
  if (scope) scope.CardImport=api;
})(typeof window !== 'undefined' ? window : globalThis);
