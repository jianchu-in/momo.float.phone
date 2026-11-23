"use client";
import {useEffect,useRef,useState} from "react";
import {loadMediaObjectUrl} from "@/lib/media-cache-storage";
import {loadMapPreferences,saveMapPreferences,type MapAmbience} from "@/lib/facing-map-storage";
export const FACING_SPEECH_EVENT="facing-voice-playback";
export function FacingAmbience({track,location}:{track?:MapAmbience;location?:string}){
 const player=useRef<HTMLAudioElement|null>(null),muted=useRef(loadMapPreferences().ambienceMuted===true),ducked=useRef(false),microphone=useRef(false),volume=useRef(track?.volume??.25);
 const audibleVolume=()=>microphone.current?0:volume.current*(ducked.current ? 0.2 : 1);
 const [playing,setPlaying]=useState(false),[ready,setReady]=useState(false),[error,setError]=useState("");volume.current=Math.max(0,Math.min(1,track?.volume??.25));
 useEffect(()=>{
  let live=true,url:string|undefined;setError("");setPlaying(false);setReady(false);
  if(track?.mediaRef)void loadMediaObjectUrl(track.mediaRef).then(async source=>{
   if(!source)throw new Error("氛围音文件不存在，请重新上传。");url=source;if(!live){URL.revokeObjectURL(source);return;}
   const audio=new Audio(source);player.current=audio;audio.loop=true;audio.volume=audibleVolume();setReady(true);
   audio.onplay=()=>{if(live){setPlaying(true);setError("");}};audio.onpause=()=>{if(live)setPlaying(false);};audio.onerror=()=>{if(live){setPlaying(false);setError("该音频无法播放，可在地点设置中更换。");}};
   if(!muted.current)try{await audio.play();}catch{if(live)setPlaying(false);}
  }).catch(e=>{if(live)setError(e instanceof Error?e.message:"氛围音读取失败");});
  return()=>{live=false;player.current?.pause();player.current=null;if(url)URL.revokeObjectURL(url);};
 },[track?.mediaRef]);
 useEffect(()=>{if(player.current)player.current.volume=audibleVolume();},[track?.volume]);
 useEffect(()=>{const change=(event:Event)=>{ducked.current=(event as CustomEvent).detail===true;if(player.current)player.current.volume=audibleVolume();};const mic=(event:Event)=>{microphone.current=(event as CustomEvent).detail===true;if(player.current)player.current.volume=audibleVolume();};window.addEventListener(FACING_SPEECH_EVENT,change);window.addEventListener("facing-live-microphone",mic);return()=>{window.removeEventListener(FACING_SPEECH_EVENT,change);window.removeEventListener("facing-live-microphone",mic);};},[]);
 if(!track)return null;
 return <div className="facing-ambience"><button type="button" disabled={!ready} aria-label={playing?"暂停氛围音":"播放氛围音"} onClick={()=>{const audio=player.current;if(!audio)return;if(playing){muted.current=true;audio.pause();void saveMapPreferences({ambienceMuted:true}).catch(()=>setError("静音设置保存失败"));}else{muted.current=false;void saveMapPreferences({ambienceMuted:false}).catch(()=>{});void audio.play().catch(()=>setError("暂时无法播放，请重试或更换音频。"));}}}>{!ready&&!error?"正在读取氛围音…":playing?"♫ 暂停氛围音":"♫ 播放氛围音"}</button><small>{location}</small>{error&&<small role="alert">{error}</small>}</div>;
}
