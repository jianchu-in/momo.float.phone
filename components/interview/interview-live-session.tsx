"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, Pause, Send, Settings2 } from "lucide-react";
import { generateHostOpening, generateHostQuestion, generateCharacterInterviewAnswer, generateInterviewGroupAnswers, generateInterviewAudience } from "@/lib/interview-magazine-engine";
import { InterviewLiveController, initialInterviewLiveState, isInterviewLiveBusy } from "@/lib/interview-magazine-live";
import { interviewGuestGroups, normalizeInterviewOptions } from "@/lib/interview-magazine-options";
import { saveInterviewDraft,loadInterviewHostPrompt,loadInterviewMemoryPrompt,saveInterviewHostPrompt,saveInterviewMemoryPrompt } from "@/lib/interview-magazine-storage";
import { INTERVIEW_DEFAULT_AUDIENCE_PROMPT, INTERVIEW_MAGAZINE_HOST_NAME, type InterviewAudienceRound, type InterviewDraft, type InterviewLiveSnapshot, type InterviewOptions } from "@/lib/interview-magazine-types";
import { loadApiConfigs } from "@/lib/settings-storage";

export const INTERVIEW_PARTICIPATIONS = [
  ["guest", "用户出场"], ["spectator", "旁观"], ["backstage", "幕后主持（AI代问）"], ["host", "本人主持"], ["flexible", "灵活转换"],
] as const;

export function InterviewOptionsEditor({ options, onChange }: { options: InterviewOptions; onChange: (options: InterviewOptions) => void }) {
  return <section className="interview-glass-panel p-4 flex flex-col gap-4">
    <strong className="text-white text-sm">参与及采访方式</strong>
    <label className="flex flex-col gap-2 text-white/70 text-sm">参与身份
      <select aria-label="参与身份" className="interview-glass-input p-3 bg-[#181818]" value={options.participation} onChange={event => onChange({ ...options, participation: event.target.value as InterviewOptions["participation"] })}>
        {INTERVIEW_PARTICIPATIONS.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
      </select></label>
    <label className="flex flex-col gap-2 text-white/70 text-sm">采访方式
      <select aria-label="采访方式" className="interview-glass-input p-3 bg-[#181818]" value={options.flow} onChange={event => onChange({ ...options, flow: event.target.value as InterviewOptions["flow"] })}>
        <option value="turns">原版轮流采访（一位角色／用户交替）</option>
        <option value="all">全员回答（一轮后停下）</option>
        <option value="all_user">全员回答后，用户回答并触发反应</option>
      </select></label>
    <p className="text-white/45 text-xs leading-relaxed">全员模式每组请求一次，单人发言逐字显示。开启互相讨论会再按组生成讨论。</p>
    <label className="text-white/70 text-xs flex gap-2 items-center"><input type="checkbox" checked={options.readRecentMemory} onChange={event => onChange({ ...options, readRecentMemory: event.target.checked })} />接入角色最近记忆（默认开启）</label>
    <p className="text-white/45 text-xs">仅作为采访背景，遵循最近记忆的来源与长度设置。成刊后可另行选择是否写入、写给哪些受访角色。</p>
    <label className="text-white/70 text-sm flex flex-col gap-2">场景要求<textarea aria-label="场景要求" className="interview-glass-input p-3" rows={2} value={options.sceneInstructions} placeholder="例如：回答后互相讨论，展现分歧和现场反应。" onChange={event => onChange({ ...options, sceneInstructions: event.target.value })} /></label>
    <label className="text-white/70 text-xs flex gap-2 items-center"><input type="checkbox" checked={options.discussion} onChange={event => onChange({ ...options, discussion: event.target.checked })} />回答后互相讨论</label>
    <InterviewAudienceOptions options={options} onChange={onChange} />
  </section>;
}

function InterviewAudienceOptions({ options, onChange, disabled }: { options: InterviewOptions; onChange: (next: InterviewOptions) => void; disabled?: boolean }) {
  const audience = options.audience ?? {};
  const apis = loadApiConfigs();
  return <fieldset disabled={disabled} className="border-t border-white/10 pt-3 flex flex-col gap-2 text-white/70 text-xs">
    <label className="flex gap-2 items-center"><input type="checkbox" checked={audience.enabled === true}
      onChange={event => onChange({ ...options, audience: { ...audience, enabled: event.target.checked } })} />开启观众区（每轮额外请求一次）</label>
    {audience.enabled && <>
      <label className="flex flex-col gap-1">观众区 API<select className="interview-glass-input p-2 bg-[#181818]" value={audience.apiConfigId ?? ""}
        onChange={event => onChange({ ...options, audience: { ...audience, apiConfigId: event.target.value || undefined } })}>
        <option value="">使用在场绑定</option>
        {apis.map(api => <option key={api.id} value={api.id}>{api.name || api.defaultModel}</option>)}
      </select></label>
      <label className="flex flex-col gap-1">观众区补充提示词<textarea className="interview-glass-input p-2" rows={3}
        placeholder={INTERVIEW_DEFAULT_AUDIENCE_PROMPT} value={audience.prompt ?? ""}
        onChange={event => onChange({ ...options, audience: { ...audience, prompt: event.target.value } })} /></label>
    </>}
  </fieldset>;
}

export function InterviewAudience({ rounds, busy, error }: { rounds?: InterviewAudienceRound[]; busy?: boolean; error?: string }) {
  if (!rounds?.length && !busy && !error) return null;
  return <section aria-label="观众区" className="interview-glass-panel p-4 flex flex-col gap-3">
    <strong className="text-sm text-white">观众区</strong>
    {rounds?.map((entry, index) => <details key={entry.questionId ?? entry.round} open={index === rounds.length - 1} className="text-white/75 text-xs">
      <summary className="cursor-pointer">第 {entry.round} 轮 · {entry.comments.length} 条</summary>
      <ul className="mt-2 space-y-1.5">{entry.comments.map((comment, item) => <li key={item} className="break-words">
        <span className="text-white/50 mr-2">{comment.name}</span>{comment.content}</li>)}</ul>
    </details>)}
    {busy && <p className="text-white/60 text-xs">观众正在讨论…</p>}
    {error && <p className="text-red-200 text-xs">观众区生成失败。{error}</p>}
  </section>;
}

export function InterviewSessionSettings({characters,guestIds,options,onApply,onClose}:{characters:{id:string;name:string}[];guestIds:string[];options:InterviewOptions;onApply:(ids:string[],options:InterviewOptions)=>void;onClose:()=>void}){
 const [ids,setIds]=useState(guestIds),[draft,setDraft]=useState(()=>normalizeInterviewOptions(options)),[query,setQuery]=useState(""),[error,setError]=useState("");
 const [hostPrompt,setHostPrompt]=useState(loadInterviewHostPrompt),[memoryPrompt,setMemoryPrompt]=useState(loadInterviewMemoryPrompt);
 const picked=ids.flatMap(id=>characters.find(char=>char.id===id)??[]),groups=interviewGuestGroups(picked,draft.guestGroups);
 return <div role="dialog" aria-modal="true" aria-label="在场访谈设置" className="absolute inset-0 z-[80] flex flex-col bg-[#151419] text-white" style={{paddingTop:"max(16px, env(safe-area-inset-top))",paddingBottom:"max(16px, env(safe-area-inset-bottom))"}}>
  <header className="interview-header"><button type="button" onClick={onClose}>取消</button><strong>在场 · 本期访谈设置</strong><button type="button" disabled={!ids.length} onClick={()=>{try{const normalized=normalizeInterviewOptions({...draft,guestGroups:Object.fromEntries(Object.entries(draft.guestGroups??{}).filter(([id])=>ids.includes(id)))});if(hostPrompt!==loadInterviewHostPrompt())saveInterviewHostPrompt(hostPrompt);if(memoryPrompt!==loadInterviewMemoryPrompt())saveInterviewMemoryPrompt(memoryPrompt);onApply(ids,normalized);}catch(e){setError(e instanceof Error?e.message:"设置保存失败");}}}>保存并返回问答</button></header>
  <main className="interview-scroll px-5 py-4 flex flex-col gap-4"><p className="text-xs text-white/60">本轮已暂停。已有实录和未发送文字保留，修改用于后续问答，不会重新开场或自动调用接口。</p>
   <section aria-label="受访嘉宾" className="interview-glass-panel p-3"><strong>受访嘉宾 · 可多选</strong><input aria-label="搜索嘉宾" className="interview-glass-input w-full p-2 my-2" value={query} onChange={e=>setQuery(e.target.value)} placeholder="搜索角色"/><div className="max-h-48 overflow-y-auto">{characters.filter(char=>char.name.toLowerCase().includes(query.toLowerCase())).map(char=><label key={char.id} className="flex gap-2 items-center py-2"><input type="checkbox" aria-label={`选择嘉宾${char.name}`} checked={ids.includes(char.id)} onChange={e=>setIds(old=>e.target.checked?[...old,char.id]:old.filter(id=>id!==char.id))}/>{char.name}</label>)}</div></section>
   {picked.length>1&&<section aria-label="嘉宾分组" className="interview-glass-panel p-3"><strong>嘉宾分组</strong><p className="text-xs text-white/60">全员回答时，每轮嘉宾回答按当前 {groups.length} 个非空组请求；同组使用排在最前面的嘉宾绑定。轮流采访仍按原方式调用。</p>{picked.map(char=><label key={char.id} className="flex justify-between py-2">{char.name}<select aria-label={`${char.name}的分组`} className="interview-glass-input bg-[#181818] p-2" value={draft.guestGroups?.[char.id]??1} onChange={e=>setDraft(old=>({...old,guestGroups:{...old.guestGroups,[char.id]:Number(e.target.value)}}))}>{[...new Set([...picked.map((_,i)=>i+1),draft.guestGroups?.[char.id]??1])].map(group=><option key={group} value={group}>第{group}组</option>)}</select></label>)}</section>}
   <InterviewOptionsEditor options={draft} onChange={setDraft}/>
   <details className="interview-glass-panel p-3"><summary>主持与记忆提示词（所有访谈共用）</summary><label className="block mt-3">主持提示词<textarea aria-label="主持提示词" className="interview-glass-input w-full p-2" rows={5} value={hostPrompt} onChange={e=>setHostPrompt(e.target.value)}/></label><label className="block mt-3">记忆提示词<textarea aria-label="记忆提示词" className="interview-glass-input w-full p-2" rows={5} value={memoryPrompt} onChange={e=>setMemoryPrompt(e.target.value)}/></label></details>
   {error&&<p role="alert">{error}</p>}
  </main>
 </div>;
}

export function InterviewLiveSession({ theme, guests:initialGuests,characters, userIdentityId, userName, initialOptions, initialState, draftId, externalError, onChange, onDraftSaved, onBack, onCompose,onConfigure }: {
  theme: string; guests: { id: string; name: string }[]; userIdentityId: string; userName: string;
  initialOptions: InterviewOptions; initialState?: InterviewLiveSnapshot; draftId?: string | null;
  characters?:{id:string;name:string}[];
  onConfigure?:(ids:string[],options:InterviewOptions)=>void;
  externalError?: string;
  onChange: (state: InterviewLiveSnapshot, options: InterviewOptions) => void;
  onDraftSaved: (draft: InterviewDraft) => void;
  onBack: () => void; onCompose: (state: InterviewLiveSnapshot, options: InterviewOptions) => void;
}) {
  const [guests,setGuests]=useState(initialGuests),[settingsOpen,setSettingsOpen]=useState(false);
  const guestsRef=useRef(guests);guestsRef.current=guests;
  const [options, setOptions] = useState(() => normalizeInterviewOptions(initialOptions));
  const [state, setState] = useState(() => initialInterviewLiveState(normalizeInterviewOptions(initialOptions), initialState));
  const [question, setQuestion] = useState(initialState?.questionInput || "");
  const [reply, setReply] = useState(initialState?.userInput || "");
  const [editing, setEditing] = useState<{ id: string; text: string }>();
  const [deleteId, setDeleteId] = useState<string>();
  const runner = useRef<InterviewLiveController | null>(null);
  const stateRef = useRef(state); stateRef.current = state;
  const optionsRef = useRef(options); optionsRef.current = options;
  const callbacks = useRef({ onChange, onDraftSaved, onBack, onCompose }); callbacks.current = { onChange, onDraftSaved, onBack, onCompose };
  const savedId = useRef(draftId || `interview_draft_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`);
  const createdAt = useRef(new Date().toISOString());
  const lastSaved = useRef("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const followBottom = useRef(true);
  const busy = isInterviewLiveBusy(state);
  const manual = ["host", "backstage", "flexible"].includes(options.participation);
  const save = (notify = true) => {
    const snapshot = runner.current?.state || stateRef.current;
    if (!snapshot.messages.length && !snapshot.round) return;
    const fingerprint = JSON.stringify([snapshot, optionsRef.current, guestsRef.current]);
    if (fingerprint === lastSaved.current) return;
    lastSaved.current = fingerprint;
    const status = snapshot.phase === "awaiting_user" ? "awaiting_user" : snapshot.phase === "done" ? "done" : snapshot.phase === "error" ? "error" : "paused";
    const draft: InterviewDraft = { id: savedId.current, theme, characterIds: guestsRef.current.map(guest => guest.id), characterNames: guestsRef.current.map(guest => guest.name),
      userIdentityId, userName, transcript: snapshot.messages, characterRounds: snapshot.round, status,
      options: optionsRef.current, liveState: snapshot, userInput: snapshot.userInput, createdAt: createdAt.current, updatedAt: new Date().toISOString() };
    saveInterviewDraft(draft);
    if (notify) callbacks.current.onDraftSaved(draft);
  };
  useEffect(() => {
    let alive = true;
    const ids = ()=>guestsRef.current.map(guest => guest.id);
    const live = new InterviewLiveController(guests, optionsRef.current, {
      opening: (signal, nextOptions, userAsGuest) => generateHostOpening(theme, ids(), userIdentityId, { signal, options: nextOptions, userAsGuest }),
      question: (target, transcript, signal, nextOptions, userAsGuest) => generateHostQuestion({ theme, characterIds: ids(), userIdentityId, transcript,
        target, phase: target === "user" ? "用户明确出场，请向其提问并等待真实输入" : "根据已有实录提出新一轮采访问题", signal, options: nextOptions, userAsGuest }),
      answer: input => generateCharacterInterviewAnswer({ ...input, theme, characterIds: [...new Set([...ids(), input.characterId])], userIdentityId }),
      groupAnswers: input => generateInterviewGroupAnswers({ ...input, theme, characterIds: ids(), userIdentityId }),
      audience: input => generateInterviewAudience({ ...input, theme, characterIds: ids(), userName }),
    }, next => {
      if (!alive) return;
      stateRef.current = next; setState(next); callbacks.current.onChange(next, optionsRef.current);
    }, initialState);
    runner.current = live;
    // Defer one microtask so Strict Mode's probe cannot submit a duplicate opening.
    Promise.resolve().then(() => { if (alive && !initialState) void live.start(); });
    const timer = setInterval(() => save(), 1000);
    return () => { alive = false; clearInterval(timer); live.stop(); save(false); live.dispose(); runner.current = null; };
    // One controller owns one recorded session; parent updates must not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!isInterviewLiveBusy(state)) save();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.phase, state.messages, state.audienceRounds, options]);
  useEffect(() => {
    if (followBottom.current) scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight, behavior: "auto" });
  }, [state.messages]);
  const updateOptions = (next: InterviewOptions) => {
    if (busy) return;
    const normalized = normalizeInterviewOptions(next);
    optionsRef.current = normalized; setOptions(normalized); runner.current?.updateOptions(normalized);
    callbacks.current.onChange(stateRef.current, normalized);
  };
  const stop = () => { runner.current?.stop(); save(); };
  const canCompose = state.messages.some(message => message.role === "character" && message.content.trim());
  return <>
    <header className="interview-header">
      <button type="button" className="interview-icon-btn" aria-label="保存并返回" onClick={() => { stop(); callbacks.current.onBack(); }}><ChevronLeft size={20} /></button>
      <div className="text-center min-w-0"><strong className="text-white text-sm">{theme}</strong><div className="text-xs text-white/45">第 {state.round} 轮 · {state.userAsGuest ? "用户已出场" : INTERVIEW_PARTICIPATIONS.find(([id]) => id === options.participation)?.[1]}</div></div>
      <button type="button" className="interview-icon-btn" aria-label="在场访谈设置" onClick={()=>{stop();setSettingsOpen(true);}}><Settings2 size={18}/></button>
    </header>
    <div ref={scrollRef} className="interview-scroll px-5 py-5 flex flex-col gap-5" aria-live="polite" onScroll={event => {
      const node = event.currentTarget; followBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
    }}>
      {state.messages.map(message => <article key={message.id} className="interview-glass-panel p-4" data-interview-status={message.status}>
        <div className="flex justify-between gap-3 mb-2 text-xs text-white/50"><strong>{message.role === "host" ? INTERVIEW_MAGAZINE_HOST_NAME : message.role === "user" ? `${userName}${message.kind === "question" ? " · 主持" : ""}` : message.speakerName}</strong>
          <span>{message.status === "streaming" ? "正在回复…" : message.status === "stopped" ? "已停止 · 保留部分内容" : message.status === "error" ? "回复失败" : message.kind === "reaction" ? "回应" : message.kind === "discussion" ? "讨论" : ""}</span></div>
        {editing?.id === message.id ? <textarea aria-label="编辑历史问题" className="interview-glass-input w-full p-2 text-sm" rows={3}
          value={editing.text} onChange={event => setEditing({ id: message.id, text: event.target.value })} />
          : <p className="whitespace-pre-wrap break-words text-white/90 text-sm leading-relaxed">{message.content || (message.status === "streaming" ? "正在回复…" : "本条未生成内容")}</p>}
        {(message.kind === "question" || message.role === "character") && <div className="flex justify-end items-center gap-3 mt-2 text-xs text-white/65">
          {deleteId === message.id ? <>
            <button type="button" onClick={() => setDeleteId(undefined)}>取消</button>
            <button type="button" className="text-red-200 py-1" disabled={busy} onClick={() => { runner.current?.deleteMessage(message.id); setDeleteId(undefined); }}>确定删除</button>
          </> : editing?.id === message.id ? <>
            <button type="button" onClick={() => setEditing(undefined)}>取消</button>
            <button type="button" className="py-1" disabled={busy || !editing.text.trim()} onClick={() => { runner.current?.editQuestion(message.id, editing.text); setEditing(undefined); }}>保存问题</button>
          </> : <>
            {message.kind === "question" && <button type="button" className="py-1" disabled={busy} onClick={() => { setDeleteId(undefined); setEditing({ id: message.id, text: message.content }); }}>编辑问题</button>}
            {message.role === "character" && <button type="button" className="py-1" disabled={busy} onClick={() => { setDeleteId(undefined); void runner.current?.retryAnswer(message.id); }}>重试回复</button>}
            <button type="button" className="py-1" disabled={busy} onClick={() => { setEditing(undefined); setDeleteId(message.id); }}>删除</button>
          </>}
        </div>}
      </article>)}
      <InterviewAudience rounds={state.audienceRounds} busy={state.phase === "audience"} error={state.audienceError} />
      {state.phase === "opening" && <p className="text-white/60 text-sm">主持人正在准备问题…</p>}
      {(state.error || externalError) && <p role="alert" className="text-red-200 text-sm whitespace-pre-wrap">{state.error || externalError}</p>}
      {state.phase === "awaiting_user" && <p className="text-white/70 text-sm">等待你的真实回答，不会自动代答。</p>}
      {!busy && state.phase !== "awaiting_user" && state.phase !== "done" && <p className="text-white/50 text-sm">{!state.round && manual ? "输入你的第一个问题，开始本期访谈。" : "本轮已暂停推进，可继续下一轮、提出问题或选择出场。"}</p>}
    </div>
    <footer className="interview-bottom-bar flex flex-col gap-3" style={{ maxHeight: "55%", overflowY: "auto", flexShrink: 0 }}>
      <details className="text-white/70 text-xs"><summary>场景要求与讨论</summary>
        <label className="flex gap-2 items-center mt-2"><input type="checkbox" disabled={busy} checked={options.readRecentMemory} onChange={event => updateOptions({ ...options, readRecentMemory: event.target.checked })} />接入角色最近记忆</label>
        <textarea aria-label="场景要求" disabled={busy} className="interview-glass-input w-full p-3 mt-2" rows={2} placeholder="例如：回答之后互相讨论，展现分歧和现场反应。要求不会作为公开台词。" value={options.sceneInstructions} onChange={event => updateOptions({ ...options, sceneInstructions: event.target.value })} />
        <label className="flex gap-2 items-center mt-2"><input type="checkbox" disabled={busy} checked={options.discussion} onChange={event => updateOptions({ ...options, discussion: event.target.checked })} />回答后互相讨论（用户出场时在用户回答之后）</label>
        <div className="mt-3"><InterviewAudienceOptions options={options} onChange={updateOptions} disabled={busy} /></div>
      </details>
      {state.phase === "awaiting_user" ? <div className="flex gap-2"><textarea aria-label="用户回答" className="interview-glass-input flex-1 p-3" rows={2} value={reply} onChange={event => { setReply(event.target.value); runner.current?.updateDraftInput({ userInput: event.target.value }); }} placeholder="输入你的回答" />
        <button type="button" className="interview-icon-btn" aria-label="提交回答" disabled={!reply.trim()} onClick={() => { if (!runner.current) return; runner.current.updateDraftInput({ userInput: "" }); void runner.current.submitUser(reply); setReply(""); }}><Send size={18} /></button></div>
        : manual && !busy && state.phase !== "done" ? <div className="flex flex-col gap-2">
          {options.participation === "flexible" && <label className="flex gap-2 text-xs text-white/60">本次提问<select aria-label="本次提问身份" className="bg-[#181818]" value={options.questionAsHost ? "self" : "backstage"} onChange={event => updateOptions({ ...options, questionAsHost: event.target.value === "self" })}><option value="self">本人主持</option><option value="backstage">幕后代问</option></select></label>}
          <div className="flex gap-2"><textarea aria-label="主持提问" className="interview-glass-input flex-1 p-3" rows={2} value={question} onChange={event => { setQuestion(event.target.value); runner.current?.updateDraftInput({ questionInput: event.target.value }); }} placeholder={options.participation === "backstage" ? "写下问题，由AI主持人代问" : "输入你想问角色的问题"} />
            <button type="button" className="interview-icon-btn" aria-label="发起提问" disabled={!question.trim()} onClick={() => { if (!runner.current) return; runner.current.updateDraftInput({ questionInput: "" }); void runner.current.manualQuestion(question, userName); setQuestion(""); }}><Send size={18} /></button></div>
        </div> : null}
      <div className="flex flex-wrap gap-2 text-xs text-white/80">
        {busy ? <><button type="button" className="interview-icon-btn !w-auto px-3" onClick={stop}><Pause size={14} />停止本轮</button>
          <button type="button" disabled={state.askUserAfterRound} className="border border-white/20 rounded-full px-3 py-2" onClick={() => void runner.current?.askUser()}>{state.askUserAfterRound ? "本轮结束后询问你" : "出场 · 本轮后问我"}</button></> : <>
          {state.phase !== "awaiting_user" && state.phase !== "done" && <button type="button" className="border border-white/20 rounded-full px-3 py-2" onClick={() => void runner.current?.nextQuestion()}>{manual ? "请AI继续提问" : "下一轮采访"}</button>}
          {state.phase !== "done" && state.phase !== "awaiting_user" && <button type="button" className="border border-white/20 rounded-full px-3 py-2" onClick={() => void runner.current?.askUser()}>出场 · 让主持人问我</button>}
          {state.userAsGuest && <button type="button" className="border border-white/20 rounded-full px-3 py-2" onClick={() => runner.current?.setPresence(false)}>转为旁观</button>}
          {canCompose && <button type="button" className="border border-white/20 rounded-full px-3 py-2" onClick={() => { save(); callbacks.current.onCompose(runner.current?.state || stateRef.current, optionsRef.current); }}>保留实录并成刊</button>}
        </>}
      </div>
    </footer>
    {settingsOpen&&<InterviewSessionSettings characters={characters??initialGuests} guestIds={guests.map(guest=>guest.id)} options={options} onClose={()=>setSettingsOpen(false)} onApply={(ids,next)=>{
      const available=characters??initialGuests,nextGuests=ids.flatMap(id=>available.find(char=>char.id===id)??[]);
      runner.current?.updateGuests(nextGuests);runner.current?.updateOptions(next);
      if(next.participation!==optionsRef.current.participation)runner.current?.setPresence(next.participation==="guest");
      guestsRef.current=nextGuests;setGuests(nextGuests);optionsRef.current=next;setOptions(next);
      onConfigure?.(ids,next);callbacks.current.onChange(runner.current?.state??stateRef.current,next);save();setSettingsOpen(false);
    }}/>}
  </>;
}
