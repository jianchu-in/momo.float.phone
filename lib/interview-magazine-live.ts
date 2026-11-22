import type { InterviewAudienceComment, InterviewLiveSnapshot, InterviewMessage, InterviewOptions } from "./interview-magazine-types";
import { interviewGuestGroups, normalizeInterviewOptions } from "./interview-magazine-options";

type Guest = { id: string; name: string };
type AnswerPhase = "answer" | "reaction" | "discussion";
type AnswerInput = { question: string; transcript: InterviewMessage[]; round: number; phase: AnswerPhase;
  signal: AbortSignal; options: InterviewOptions; userAsGuest: boolean };
export type InterviewLiveDependencies = {
  opening: (signal: AbortSignal, options: InterviewOptions, userAsGuest: boolean) => Promise<{ intro: string; question: string; targetCharacterId?: string }>;
  question: (target: "user" | "character", transcript: InterviewMessage[], signal: AbortSignal, options: InterviewOptions, userAsGuest: boolean) => Promise<{ question: string; targetCharacterId?: string }>;
  answer: (input: AnswerInput & { characterId: string; onDelta?: (delta: string) => void }) => Promise<string>;
  groupAnswers?: (input: AnswerInput & { groupIds: string[] }) => Promise<Record<string, string>>;
  audience?: (input: Pick<AnswerInput, "transcript" | "round" | "options" | "signal">) => Promise<InterviewAudienceComment[]>;
};

export function isInterviewLiveBusy(state: InterviewLiveSnapshot): boolean {
  return ["opening", "answering", "reacting", "discussing", "audience"].includes(state.phase);
}

function findLastInterviewQuestion(messages: InterviewMessage[]) {
  return [...messages].reverse().find(message => message.kind === "question" && message.target !== "user");
}

export function initialInterviewLiveState(options: InterviewOptions, seed?: InterviewLiveSnapshot): InterviewLiveSnapshot {
  const recentQuestion = seed && findLastInterviewQuestion(seed.messages);
  const state: InterviewLiveSnapshot = seed ? { ...seed, questionId: seed.questionId ?? recentQuestion?.id, question: seed.question || recentQuestion?.content || "", messages: seed.messages.map(message => ({ ...message,
    ...(message.status === "streaming" ? { status: "stopped" as const } : {}),
  })) } : { messages: [], phase: "idle", round: 0, userAsGuest: options.participation === "guest", question: "" };
  return isInterviewLiveBusy(state) ? { ...state, phase: "stopped" } : state;
}

/** Owns one abortable run. Late chunks/results cannot mutate a stopped or replaced run. */
export class InterviewLiveController {
  state: InterviewLiveSnapshot;
  options: InterviewOptions;
  private token = 0;
  private aborter: AbortController | null = null;
  private disposed = false;
  constructor(private guests: Guest[], options: InterviewOptions, private dependencies: InterviewLiveDependencies,
    private changed: (state: InterviewLiveSnapshot) => void, seed?: InterviewLiveSnapshot) {
    this.options = normalizeInterviewOptions(options);
    this.state = initialInterviewLiveState(this.options, seed);
  }
  private set(patch: Partial<InterviewLiveSnapshot>) {
    if (this.disposed) return;
    this.state = { ...this.state, ...patch };
    this.changed(this.state);
  }
  private message(role: InterviewMessage["role"], content: string, extra: Partial<InterviewMessage> = {}): InterviewMessage {
    return { id: `interview_live_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`, role, content, createdAt: new Date().toISOString(), ...extra };
  }
  private append(message: InterviewMessage) { this.set({ messages: [...this.state.messages, message] }); }
  private replaceMessage(id: string, patch: Partial<InterviewMessage>) {
    this.set({ messages: this.state.messages.map(entry => entry.id === id ? { ...entry, ...patch } : entry) });
  }
  private latestQuestion(messages = this.state.messages) {
    return findLastInterviewQuestion(messages);
  }
  private current(token: number) { return !this.disposed && token === this.token && !this.aborter?.signal.aborted; }
  private async run(work: (token: number, signal: AbortSignal) => Promise<void>): Promise<void> {
    if (this.disposed || this.aborter) return;
    const token = ++this.token;
    const aborter = new AbortController();
    this.aborter = aborter;
    this.set({ error: undefined });
    try { await work(token, aborter.signal); }
    catch (error) {
      if (this.current(token)) this.set({ phase: "error", error: error instanceof Error ? error.message : String(error) });
    } finally { if (this.current(token)) this.aborter = null; }
  }
  stop(): InterviewLiveSnapshot {
    this.token++;
    const wasRunning = Boolean(this.aborter);
    this.aborter?.abort();
    this.aborter = null;
    if (wasRunning) this.set({ phase: "stopped", messages: this.state.messages.map(message => message.status === "streaming" ? { ...message, status: "stopped" } : message) });
    return this.state;
  }
  dispose() { this.stop(); this.disposed = true; }
  updateOptions(options: InterviewOptions) { if (!this.aborter) this.options = normalizeInterviewOptions(options); }
  updateGuests(guests: Guest[]) {
    if(this.aborter||this.disposed)throw new Error("请先暂停本轮，再修改嘉宾。");
    const unique=guests.filter((guest,index)=>guest.id&&guests.findIndex(item=>item.id===guest.id)===index);
    if(!unique.length)throw new Error("请至少保留一位嘉宾。");
    this.guests=unique;
  }
  updateDraftInput(patch: Pick<InterviewLiveSnapshot, "userInput" | "questionInput">) { if (!this.aborter) this.set(patch); }
  editQuestion(id: string, text: string) {
    const question = this.state.messages.find(message => message.id === id && message.kind === "question");
    const content = text.trim();
    if (this.aborter || !question || !content) return;
    this.replaceMessage(id, { content });
    if (id === this.state.questionId || id === this.latestQuestion()?.id) this.set({ question: content });
  }
  deleteMessage(id: string) {
    const removed = this.state.messages.find(message => message.id === id);
    if (this.aborter || !removed || (removed.role !== "character" && removed.kind !== "question")) return;
    const messages = this.state.messages.filter(message => message.id !== id);
    const patch: Partial<InterviewLiveSnapshot> = { messages };
    if (removed.kind === "question") {
      patch.audienceRounds = this.state.audienceRounds?.filter(entry => entry.questionId !== id);
      if (id === this.state.questionId || id === this.latestQuestion()?.id) {
        const remaining = this.latestQuestion(messages);
        patch.question = remaining?.content ?? "";
        patch.questionId = remaining?.id;
      }
      if (removed.target === "user" && this.state.phase === "awaiting_user" && id === this.state.messages.at(-1)?.id) patch.phase = "idle";
    }
    this.set(patch);
  }
  async retryAnswer(id: string) {
    const index = this.state.messages.findIndex(message => message.id === id);
    const answer = this.state.messages[index];
    const characterId = answer?.speakerCharacterId ?? (this.guests.length === 1 ? this.guests[0].id : undefined);
    if (this.aborter || answer?.role !== "character" || !characterId) return;
    const transcript = this.state.messages.slice(0, index).filter(message => message.content.trim());
    const question = answer.questionId ? transcript.find(message => message.id === answer.questionId) : this.latestQuestion(transcript);
    if (!question) { this.set({ error: "原问题已删除或无法找到。" }); return; }
    const previousPhase = this.state.phase;
    await this.run(async (token, signal) => {
      this.set({ phase: "answering" });
      try {
        const content = await this.dependencies.answer({ characterId, question: question.content, transcript,
          round: answer.round ?? question.round ?? transcript.filter(message => message.kind === "question" && message.target !== "user").length,
          phase: answer.kind === "reaction" || answer.kind === "discussion" ? answer.kind : "answer", signal, options: this.options, userAsGuest: this.state.userAsGuest });
        if (this.current(token)) this.replaceMessage(id, { content, status: "complete" });
      } catch (error) {
        if (this.current(token)) this.set({ error: error instanceof Error ? error.message : "重试失败，原回复已保留。" });
      } finally { if (this.current(token)) this.set({ phase: previousPhase }); }
    });
  }
  setPresence(present: boolean) {
    if (this.aborter) return;
    this.set({ userAsGuest: present, askUserAfterRound: false, ...(this.state.phase === "awaiting_user" && !present ? { phase: "idle" as const } : {}) });
  }
  async start(): Promise<void> {
    if (this.state.messages.length || this.state.round || this.options.participation === "host") return;
    await this.run(async (token, signal) => {
      this.set({ phase: "opening" });
      const opening = await this.dependencies.opening(signal, this.options, this.state.userAsGuest);
      if (!this.current(token)) return;
      this.append(this.message("host", opening.intro, { kind: "intro" }));
      if (this.options.participation === "backstage") { this.set({ phase: "idle" }); return; }
      await this.round(opening.question, token, signal, opening.targetCharacterId);
    });
  }
  async nextQuestion(): Promise<void> {
    await this.run(async (token, signal) => {
      this.set({ phase: "opening" });
      const next = await this.dependencies.question("character", this.state.messages, signal, this.options, this.state.userAsGuest);
      if (!this.current(token)) return;
      await this.round(next.question, token, signal, next.targetCharacterId);
    });
  }
  async manualQuestion(text: string, userName: string): Promise<void> {
    const question = text.trim();
    if (!question || this.aborter || !["backstage", "host", "flexible"].includes(this.options.participation)) return;
    await this.run(async (token, signal) => {
      const backstage = this.options.participation === "backstage" || (this.options.participation === "flexible" && !this.options.questionAsHost);
      await this.round(question, token, signal, undefined, backstage ? undefined : userName);
    });
  }
  private async round(question: string, token: number, signal: AbortSignal, targetCharacterId?: string, speakerName?: string) {
    if (!this.guests.length) throw new Error("请选择至少一位有效角色");
    const round = this.state.round + 1;
    const turn = this.message(speakerName ? "user" : "host", question, { kind: "question", target: "character", speakerName, round });
    this.set({ round, question, questionId: turn.id, phase: "answering", audienceError: undefined, messages: [...this.state.messages, turn] });
    const guests = this.options.flow === "turns" ? [this.guests.find(guest => guest.id === targetCharacterId) || this.guests[(round - 1) % this.guests.length]] : this.guests;
    await this.answers(guests, "answer", token, signal);
    if (!this.current(token)) return;
    if (this.options.participation === "guest" && this.state.userAsGuest && !this.state.askUserAfterRound && this.options.flow === "turns" && round >= Math.min(6, Math.max(3, this.guests.length * 2))) {
      await this.audience(token, signal);
      if (!this.current(token)) return;
      this.append(this.message("host", "感谢各位。本期访谈到这里告一段落。", { kind: "outro" }));
      this.set({ phase: "done" }); return;
    }
    if (this.state.askUserAfterRound || (this.state.userAsGuest && this.options.flow !== "all")) { await this.questionForUser(token, signal); return; }
    await this.discuss(token, signal);
    await this.audience(token, signal);
    if (this.current(token)) {
      if (this.state.askUserAfterRound) await this.questionForUser(token, signal);
      else this.set({ phase: "idle" });
    }
  }
  async askUser(): Promise<void> {
    if (this.aborter) { this.set({ userAsGuest: true, askUserAfterRound: true }); return; }
    await this.run(async (token, signal) => {
      this.set({ userAsGuest: true });
      await this.questionForUser(token, signal);
    });
  }
  private async questionForUser(token: number, signal: AbortSignal) {
    this.set({ phase: "opening", askUserAfterRound: false });
    const next = await this.dependencies.question("user", this.state.messages, signal, this.options, true);
    if (!this.current(token)) return;
    this.append(this.message("host", next.question, { kind: "question", target: "user" }));
    this.set({ phase: "awaiting_user" });
  }
  async submitUser(text: string): Promise<void> {
    if (!text.trim() || this.state.phase !== "awaiting_user" || this.aborter) return;
    this.append(this.message("user", text.trim(), { kind: "answer" }));
    if (this.options.flow === "turns") {
      if (this.options.discussion || this.options.audience?.enabled) {
        await this.run(async (token, signal) => {
          await this.discuss(token, signal);
          await this.audience(token, signal);
          if (this.current(token)) {
            if (this.state.askUserAfterRound) await this.questionForUser(token, signal);
            else this.set({ phase: "idle" });
          }
        });
        // The awaited discussion changes the phase from the earlier input guard.
        if ((this.state as InterviewLiveSnapshot).phase !== "idle") return;
      }
      await this.nextQuestion(); return;
    }
    await this.run(async (token, signal) => {
      this.set({ phase: "reacting" });
      await this.answers(this.guests, "reaction", token, signal);
      if (!this.current(token)) return;
      await this.discuss(token, signal);
      await this.audience(token, signal);
      if (this.current(token)) {
        if (this.state.askUserAfterRound) await this.questionForUser(token, signal);
        else this.set({ phase: "idle" });
      }
    });
  }
  private groups(guests: Guest[]) {
    return this.dependencies.groupAnswers ? interviewGuestGroups(guests, this.options.guestGroups) : guests.map(guest => [guest]);
  }
  private async answers(guests: Guest[], phase: AnswerPhase, token: number, signal: AbortSignal) {
    const transcript = this.state.messages.filter(message => message.content.trim());
    const placeholders = new Map(guests.map(guest => [guest.id, this.message("character", "", {
      kind: phase, speakerCharacterId: guest.id, speakerName: guest.name, status: "streaming", round: this.state.round, questionId: this.state.questionId,
    })]));
    this.set({ messages: [...this.state.messages, ...placeholders.values()] });
    const failures: string[] = [];
    const input = { question: this.state.question, transcript, round: this.state.round, phase, signal, options: this.options, userAsGuest: this.state.userAsGuest };
    await Promise.all(this.groups(guests).map(async group => {
      try {
        let answers: Record<string, string>;
        if (group.length > 1 && this.dependencies.groupAnswers) {
          answers = await this.dependencies.groupAnswers({ ...input, groupIds: group.map(guest => guest.id) });
        } else {
          const { id } = group[0];
          let partial = "";
          const answer = await this.dependencies.answer({ ...input, characterId: id, onDelta: delta => {
            if (this.current(token)) { partial += delta; this.replaceMessage(placeholders.get(id)!.id, { content: partial }); }
          } });
          answers = { [id]: answer };
        }
        if (!this.current(token)) return;
        for (const { id, name } of group) {
          const content = answers[id];
          if (typeof content === "string" && content.trim()) this.replaceMessage(placeholders.get(id)!.id, { content, status: "complete" });
          else {
            this.replaceMessage(placeholders.get(id)!.id, { status: "error" });
            failures.push(`${name}：该组未返回这位嘉宾的发言`);
          }
        }
      } catch (error) {
        if (!this.current(token)) return;
        for (const { id } of group) this.replaceMessage(placeholders.get(id)!.id, { status: "error" });
        failures.push(`${group.map(guest => guest.name).join("、")}：${error instanceof Error ? error.message : String(error)}`);
      }
    }));
    if (this.current(token) && failures.length) throw new Error(`本轮部分回复失败，已保留完成及部分内容。${failures.join("；")}`);
  }
  private async discuss(token: number, signal: AbortSignal) {
    if (!this.options.discussion || !this.current(token)) return;
    this.set({ phase: "discussing" });
    // Each later group can react to the actual dialogue from earlier groups.
    for (const group of this.groups(this.guests)) {
      if (!this.current(token)) return;
      await this.answers(group, "discussion", token, signal);
    }
  }

  private async audience(token: number, signal: AbortSignal) {
    const { round, questionId, audienceRounds = [] } = this.state;
    if (!this.current(token) || !round || !this.options.audience?.enabled || !this.dependencies.audience
      || this.state.audienceAttemptedRound === round || audienceRounds.some(entry => entry.round === round)) return;
    const start = questionId ? this.state.messages.findIndex(message => message.id === questionId) : this.state.messages.indexOf(this.latestQuestion()!);
    const transcript = this.state.messages.slice(Math.max(0, start)).filter(message => message.content.trim()
      && (message.status === undefined || message.status === "complete"));
    if (!transcript.some(message => message.role === "character")) return;
    this.set({ phase: "audience", audienceAttemptedRound: round });
    try {
      const comments = await this.dependencies.audience({ transcript, round, options: this.options, signal });
      if (this.current(token) && comments.length) this.set({ audienceRounds: [...audienceRounds, { round, questionId, comments }], audienceError: undefined });
    } catch (error) {
      if (this.current(token)) this.set({ audienceError: error instanceof Error ? error.message : "观众区生成失败。" });
    }
  }
}
