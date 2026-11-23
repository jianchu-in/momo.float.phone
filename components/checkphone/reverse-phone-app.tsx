"use client";

import { bgSetTimeout } from "@/lib/bg-timer";
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { BookOpen, Globe, LockKeyhole, MessageCircle, ShoppingBag, Settings, History, ChevronLeft } from "lucide-react";
import { loadCharacters } from "@/lib/character-storage";
import { loadShoppingState } from "@/lib/shopping-storage";
import { loadBooks } from "@/lib/reading-storage";
import { getThemeAssetMap, readThemeProfile } from "@/lib/theme-storage";
import { appendReverseReplay, loadReverseSession, loadReverseSessions, loadReverseSettings, loadUserBrowser, resolveReversePermissions, reverseScope } from "@/lib/reverse-phone-storage";
import { REVERSE_APPS, type ReverseSession, type ReverseApp, type ReverseScope } from "@/lib/reverse-phone-types";
import { ReversePhoneReplay, freezeReverseFrame } from "./reverse-phone-replay";
import { ReversePhoneHistory } from "./reverse-phone-history";
import { ReversePhoneSettings } from "./reverse-phone-settings";
import { UserBrowser } from "./user-browser";
import { useReversePhone, type ReverseScreen } from "./use-reverse-phone";
import "@/styles/reverse-phone.css";

const PhoneChatApp = dynamic(() => import("@/components/chat/phone-chat-app").then(module => module.PhoneChatApp), { ssr: false });
const ICONS = { chat: MessageCircle, shopping: ShoppingBag, browser: Globe, reading: BookOpen };

function Avatar({ src, name }: { src?: string | null; name: string }) {
  return <span className="rp-avatar">{src ? <img src={src} alt={name} onError={event => { event.currentTarget.style.display = "none"; }} /> : name.slice(0, 1)}</span>;
}

/** The controlled phone reuses the real chat renderer; the other apps expose only their permitted modules. */
function InspectionPage({ screen, scope, characterId, onBack, onScreen }: { screen: ReverseScreen; scope: ReverseScope; characterId: string; onBack: () => void; onScreen: (value: ReverseScreen) => void }) {
  const p = resolveReversePermissions(characterId, scope);
  if (screen.app === "desktop") return null;
  if (screen.locked || p.modes[screen.app] === "locked") return <section className="rp-panel rp-locked"><LockKeyhole size={46} /><h2>该APP已被用户隐私锁定</h2><p>{REVERSE_APPS[screen.app]}的内容不可查看。</p></section>;
  if (p.modes[screen.app] === "hidden") return <section className="rp-panel rp-locked"><p>当前应用不可用</p></section>;
  if (screen.app === "chat") return <div className="rp-chat-host"><PhoneChatApp onClose={onBack} inspectionControl={screen.chat ?? { page: "messages" }} /></div>;
  const section = screen.section ?? (screen.app === "shopping" ? "cart" : screen.app === "browser" ? "history" : "shelf");
  const shopping = screen.app === "shopping" ? loadShoppingState() : null;
  const entries = screen.app === "browser" ? loadUserBrowser(scope).filter(item => p.browser[item.kind]) : [];
  const books = screen.app === "reading" ? loadBooks() : [];
  const cartItem = p.shopping.cart && shopping?.cartItems.find(item => "cart:" + item.id === screen.itemId);
  const order = p.shopping.orders && shopping?.orders.find(item => "order:" + item.id === screen.itemId);
  const entry = entries.find(item => "entry:" + item.id === screen.itemId);
  const changeTab = (value: string) => onScreen({ app: screen.app, section: value });
  return <section className="rp-panel">
    <header className="rp-header"><button data-reverse-target="back" onClick={onBack}><ChevronLeft size={18} />桌面</button><h2>{REVERSE_APPS[screen.app]}</h2><span /></header>
    {screen.app === "shopping" && <nav className="rp-tabs">{p.shopping.cart && <button data-rp-target="cart" aria-pressed={section === "cart"} onClick={() => changeTab("cart")}>购物车</button>}{p.shopping.orders && <button data-rp-target="orders" aria-pressed={section === "orders"} onClick={() => changeTab("orders")}>订单</button>}</nav>}
    {screen.app === "browser" && <nav className="rp-tabs">{p.browser.history && <button data-rp-target="history" aria-pressed={section === "history"} onClick={() => changeTab("history")}>历史记录</button>}{p.browser.bookmarks && <button data-rp-target="bookmarks" aria-pressed={section === "bookmarks"} onClick={() => changeTab("bookmarks")}>收藏夹</button>}</nav>}
    <main className="rp-scroll" key={`${screen.app}:${section}:${screen.itemId ?? ""}`}>
      {cartItem ? <article className="rp-detail"><small>商品详情</small><h2>{cartItem.title}</h2><p>{cartItem.subtitle}</p><p>{cartItem.detail}</p><strong>{cartItem.priceLabel}</strong><p>{cartItem.quantityLabel} · {cartItem.merchantLabel}</p></article>
        : order ? <article className="rp-detail"><small>订单详情 · {order.statusLabel}</small><h2>{order.summary}</h2><strong>{order.totalLabel}</strong><p>{order.timeLabel}</p>{order.items.map(item => <div className="rp-card" key={item.id}><b>{item.title}</b><p>{item.detail}</p><small>{item.priceLabel} {item.quantityLabel}</small></div>)}</article>
          : entry ? <article className="rp-detail"><small>{entry.kind === "history" ? "历史记录" : "收藏夹"}</small><h2>{entry.title}</h2><small>{entry.url}</small><p>{entry.description}</p></article>
            : <>
              {screen.app === "shopping" && (section === "cart" && p.shopping.cart ? <>
                {shopping!.cartItems.map(item => <button className="rp-card rp-product" data-rp-target={`cart:${item.id}`} key={item.id} onClick={() => onScreen({ ...screen, itemId: "cart:" + item.id })}><span className="rp-product-icon">{item.previewIcon || "▧"}</span><span><b>{item.title}</b><small>{item.subtitle}</small><strong>{item.priceLabel}</strong><small>{item.quantityLabel} · {item.merchantLabel}</small></span></button>)}
                {!shopping!.cartItems.length && <p className="rp-empty">购物车还是空的</p>}
                {!!shopping!.cartItems.length && <button data-rp-target="buy" className="rp-primary">替你买单</button>}
              </> : section === "orders" && p.shopping.orders ? <>{shopping!.orders.map(item => <button className="rp-card" data-rp-target={`order:${item.id}`} key={item.id} onClick={() => onScreen({ ...screen, itemId: "order:" + item.id })}><small>{item.statusLabel} · {item.timeLabel}</small><b>{item.summary}</b><strong>{item.totalLabel}</strong></button>)}{!shopping!.orders.length && <p className="rp-empty">还没有订单</p>}</> : <p className="rp-empty">购物车和订单均未开放查看</p>)}
              {screen.app === "browser" && (p.browser[section as "history" | "bookmarks"] ? <>{entries.filter(item => item.kind === section).map(item => <button className="rp-card" data-rp-target={`entry:${item.id}`} key={item.id} onClick={() => onScreen({ ...screen, itemId: "entry:" + item.id })}><b>{item.title}</b><small>{item.url}</small><p>{item.description}</p></button>)}{!entries.some(item => item.kind === section) && <p className="rp-empty">这里暂时没有记录</p>}</> : <p className="rp-empty">历史记录和收藏夹均未开放查看</p>)}
              {screen.app === "reading" && <><h3>我的书架</h3><div className="rp-books">{books.map((book, index) => <div className={`rp-book rp-book-${index % 4}`} data-rp-target={`book:${book.id}`} key={book.id}><BookOpen size={24} /><span>{book.title}</span></div>)}</div>{!books.length && <p className="rp-empty">书架上还没有书</p>}</>}
            </>}
    </main>
  </section>;
}

export function ReversePhoneApp({ initialCharacterId, resumeSessionId, autoContinue = false, initialReplayId, initialPanel, background = false, onFinished, onClose }: { initialCharacterId?: string; resumeSessionId?: string; autoContinue?: boolean; initialReplayId?:string; initialPanel?:"history"; background?:boolean; onFinished?:(record:ReverseSession)=>void; onClose: () => void }) {
  const [scope] = useState(reverseScope), host = useRef<HTMLDivElement>(null);
  const run = useReversePhone(scope, host, initialCharacterId, undefined, resumeSessionId, { autoContinue, background });
  const [replayId,setReplayId]=useState<string|undefined>(initialReplayId); const started=useRef(false),finished=useRef(false);
  const [panel, setPanel] = useState<"settings" | "browser" | "history" | null>(initialPanel??null);
  const [theme] = useState(readThemeProfile), [assets, setAssets] = useState<Record<string, string>>({});
  const characters = loadCharacters(), character = characters.find(item => item.id === (run.running ? run.session?.characterId : run.characterId));
  const settings = loadReverseSettings(scope);
  const records = useMemo(() => loadReverseSessions(scope), [scope, panel, run.session]);
  useEffect(() => { let live = true; void getThemeAssetMap([theme.wallpaperAssetId, ...Object.values(theme.iconSkins)].filter((id): id is string => !!id)).then(value => { if (live) setAssets(value); }); return () => { live = false; }; }, [theme]);
  useEffect(() => { if (!run.toast) return; const timer = setTimeout(() => run.setToast(""), 2600); return () => clearTimeout(timer); }, [run.toast]);
  useEffect(()=>{
    if(run.running)started.current=true;
    if(started.current&&!run.running&&run.session&&!finished.current){finished.current=true;onFinished?.(loadReverseSession(run.session.id)??run.session);}
  },[run.running,run.session,onFinished]);
  useEffect(()=>{
    if(!run.session||!run.running||!host.current)return;
    const id=run.session.id,at=Date.now()-Date.parse(run.session.createdAt);
    const cancel=bgSetTimeout(()=>{
      const content=host.current?.querySelector('.rp-phone-content');if(!content)return;
      const copy=content.cloneNode(true) as HTMLElement;
      const source=[...content.querySelectorAll<HTMLElement>('*')],targets=[...copy.querySelectorAll<HTMLElement>('*')];
      source.forEach((el,i)=>{if(el.scrollTop)targets[i]?.setAttribute('data-rp-scroll-top',String(el.scrollTop));});
      void freezeReverseFrame(copy.innerHTML).then(html=>appendReverseReplay(id,{at,html,speech:run.speech,loading:run.loading,app:run.screen.app,touch:run.touch})).catch(error=>console.warn("查岗回放画面保存失败，文字记录仍保留",error));
    },100);
    return cancel;
  },[run.screen,run.speech,run.loading,run.touch,run.running,run.session?.id]);
  if(replayId){const record=loadReverseSession(replayId);if(record?.scope.key===scope.key)return <ReversePhoneReplay record={record} onClose={()=>setReplayId(undefined)}/>;}
  async function close() { await run.stop(); onClose(); }
  async function openPanel(value: "settings" | "history") { if (run.running) await run.stop(); setPanel(value); }
  const back = () => run.setScreen({ app: "desktop" });
  const resumable = run.session && ["paused", "running"].includes(run.session.status) && !run.running;
  return <div className="rp-app" aria-label="我的手机 · 反查岗">
    {panel === "settings" ? <ReversePhoneSettings scope={scope} initialCharacterId={run.characterId} onHistory={()=>setPanel("history")} onClose={() => setPanel(null)} />
      : panel === "browser" ? <UserBrowser scope={scope} initialCharacterId={run.characterId} onClose={() => setPanel(null)} onSettings={() => setPanel("settings")} />
        : panel === "history" ? <ReversePhoneHistory scope={scope} initialCharacterId={initialPanel==="history"?initialCharacterId:undefined} onClose={()=>setPanel(null)} onReplay={setReplayId} onResume={id=>{void run.restore(id);setPanel(null);}}/>
          : <>
            <header className="rp-top"><button onClick={() => void close()} aria-label="关闭我的手机"><ChevronLeft size={20} /></button><span>{run.running ? `${character?.name ?? "Ta"}正在查岗` : "我的手机"}</span><div><button onClick={() => void openPanel("history")} aria-label="查手机记录"><History size={18} /></button><button onClick={() => void openPanel("settings")} aria-label="反查岗设置" title={run.running ? "结束查岗并打开设置" : "反查岗设置"}><Settings size={18} /></button></div></header>
            <div ref={host} className={`rp-stage ${run.screen.app === "desktop" ? "is-desktop" : ""}`}>
              <div className="rp-phone-content" inert={run.running || !!resumable}>
                {run.screen.app === "desktop" ? <div className="rp-desktop">
                  {theme.wallpaperAssetId && assets[theme.wallpaperAssetId] && <div className="rp-wallpaper" style={{ backgroundImage: `url(${assets[theme.wallpaperAssetId]})`, backgroundPosition: `${theme.wallpaperX}% ${theme.wallpaperY}%`, backgroundSize: "cover", transform: `scale(${theme.wallpaperScale / 100})`, filter: `blur(${theme.wallpaperBlur}px)`, opacity: theme.wallpaperOpacity }} />}
                  <div className="rp-owner"><Avatar src={scope.userAvatar} name={scope.userName} /><h2>{scope.userName}的手机</h2><p>{run.running ? "正在共享屏幕" : "邀请角色来看看你的手机"}</p></div>
                  <div className="rp-app-grid">{(Object.keys(REVERSE_APPS) as ReverseApp[]).map(app => { const Icon = ICONS[app], skin = app === "browser" ? undefined : theme.iconSkins[app]; return <button className={`rp-app-icon rp-icon-${app}`} data-rp-target={`app:${app}`} key={app} onClick={() => app === "browser" ? setPanel("browser") : run.setToast("选择角色后，点击下方开始查岗。浏览器可以直接进入编辑。") }><span>{skin && assets[skin] ? <img src={assets[skin]} alt="" /> : <Icon size={29} strokeWidth={1.7} />}</span><b>{REVERSE_APPS[app]}</b></button>; })}</div>
                  {!run.running && <p className="rp-desktop-tip">应用权限在右上角设置中配置</p>}
                </div> : <InspectionPage scope={scope} characterId={run.session?.characterId ?? run.characterId} screen={run.screen} onScreen={run.setScreen} onBack={back} />}
              </div>
              {run.running && <div className="rp-control-shield" onPointerDown={event => { event.preventDefault(); run.setToast("手机正在被他控制～"); }} />}
              {run.running && settings.showTouch && run.touch.visible && <span aria-hidden className={`rp-touch ${run.touch.pressed ? "is-pressed" : ""}`} style={{ transform: `translate(${run.touch.x - 14}px, ${run.touch.y - 14}px)` }} />}
              {(run.loading || run.speech) && <div className="rp-reaction" role="status"><Avatar src={character?.avatar} name={character?.name ?? "Ta"} /><div className="rp-bubble">{run.speech || <><span className="rp-dots"><i /><i /><i /></span><small>{run.loading}</small></>}</div></div>}
              {run.toast && <div className="rp-toast" role="status">{run.toast}</div>}
            </div>
            <footer className="rp-bottom">
              {run.running ? <div className="rp-actions"><button onClick={() => void run.skip(true)}>不要看这个</button><button className="rp-primary" onClick={() => void run.stop()}>抢回手机</button></div>
                : resumable ? <><p className="rp-muted">{run.error || "上次查岗已暂停，已完成的操作会保留。"}</p><div className="rp-actions"><button className="rp-primary" onClick={() => void run.execute()}>{run.error ? "重试这部分" : "继续查岗"}</button><button onClick={() => void run.skip()}>跳过这部分</button><button onClick={() => void run.stop()}>结束查岗</button></div></>
                  : <><label className="rp-role-picker"><Avatar src={character?.avatar} name={character?.name ?? "Ta"} /><select aria-label="查岗角色" value={run.characterId} onChange={event => run.setCharacterId(event.target.value)}>{characters.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><button className="rp-primary" disabled={!character} onClick={() => void run.start()}>请他查岗</button></label>{run.error && <p role="alert">{run.error}</p>}{!run.session && records.some(item => ["paused", "running"].includes(item.status)) && <button className="rp-muted" onClick={() => setPanel("history")}>查看未完成的查岗</button>}</>}
            </footer>
          </>}
  </div>;
}
