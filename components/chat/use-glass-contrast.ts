"use client";
import { useEffect, type RefObject } from "react";

const controls = '.imessage-header-button,.imessage-contact-name,.chat-plus-toggle,.chat-monologue-heart,.imessage-quote-compose-close,.chat-voice-message-btn';
const bubbles = '.chat-bubble-role-assistant[data-media-type="text"],.chat-stream-bubble,.chat-bubble-role-assistant[data-media-type="audio"],.chat-quote-message-assistant .chat-quote-reply';
const menus = '.imessage-context-index,.imessage-context-tapbar,.chat-floating-ctx-menu';
const properties = ['--im26-local-control-ink','--im26-local-control-text-shadow','--im26-local-bubble-ink','--im26-local-bubble-fill','--im26-local-bubble-outline','--im26-local-composer-ink','--im26-local-menu-ink','--im26-local-menu-fill'];

/** Match the actual center/cover wallpaper crop, rather than its whole-image average. */
export function sampleCoveredWallpaper(pixels: Uint8ClampedArray, imageWidth: number, imageHeight: number, roomWidth: number, roomHeight: number, box: {x:number;y:number;width:number;height:number}) {
    const scale=Math.max(roomWidth/imageWidth,roomHeight/imageHeight),drawWidth=imageWidth*scale,drawHeight=imageHeight*scale;
    let sum=0;
    for(let y=0;y<5;y++)for(let x=0;x<5;x++){
        const u=(box.x+box.width*(x+.5)/5+(drawWidth-roomWidth)/2)/drawWidth;
        const v=(box.y+box.height*(y+.5)/5+(drawHeight-roomHeight)/2)/drawHeight;
        const offset=(Math.min(63,Math.max(0,Math.floor(v*64)))*64+Math.min(63,Math.max(0,Math.floor(u*64))))*4;
        sum=.2126*pixels[offset]+.7152*pixels[offset+1]+.0722*pixels[offset+2]+sum;
    }
    return sum/25;
}

/** Only glass mode gets local material contrast. No uploads and no per-frame image reads. */
export function useGlassContrast(root: RefObject<HTMLDivElement|null>, background: string|null, enabled: boolean, dark: boolean) {
    useEffect(()=>{
        const host=root.current;if(!host||!enabled)return;
        let stopped=false,timer:ReturnType<typeof setTimeout>|undefined,image:HTMLImageElement|undefined;
        let sample:{pixels:Uint8ClampedArray;width:number;height:number}|undefined;
        const touched=new Set<HTMLElement>(),lastLight=new WeakMap<HTMLElement,boolean>();
        const set=(node:HTMLElement,key:string,value:string)=>{touched.add(node);if(node.style.getPropertyValue(key)!==value)node.style.setProperty(key,value)};
        const update=()=>{
            timer=undefined;if(stopped)return;
            const rect=host.getBoundingClientRect();if(!rect.width||!rect.height)return;
            for(const node of touched)if(!host.contains(node)){for(const key of properties)node.style.removeProperty(key);touched.delete(node)}
            for(const node of host.querySelectorAll<HTMLElement>(`${controls},${bubbles},${menus},.chat-input-bar[data-imessage-private]`)){
                const b=node.getBoundingClientRect();if(!b.width||!b.height||b.bottom<rect.top||b.top>rect.bottom)continue;
                // A blocked remote image retains a readable light-ink fallback on wallpaper.
                let level=dark?25:245;
                if(sample)level=sampleCoveredWallpaper(sample.pixels,sample.width,sample.height,rect.width,rect.height,{x:b.left-rect.left,y:b.top-rect.top,width:b.width,height:b.height});
                const threshold=node.matches(bubbles)?160:185;
                const previous=lastLight.get(node),light=level>(threshold+(previous===true?-6:previous===false?6:0));lastLight.set(node,light);
                const ink=light?'#16191e':'#f8fafc';
                if(node.matches(menus)) {
                    set(node,'--im26-local-menu-ink',ink);
                    set(node,'--im26-local-menu-fill',light?'rgba(239,244,250,.8)':'rgba(31,45,62,.8)');
                }else if(node.matches(controls)){
                    set(node,'--im26-local-control-ink',ink);
                    // A tiny text-only shadow keeps a name readable when its lens
                    // crosses a strong light/dark boundary. Never a glowing rim.
                    set(node,'--im26-local-control-text-shadow',light?'none':'0 .5px 1.5px rgba(0,0,0,.45)');
                }
                else if(node.matches(bubbles)){
                    set(node,'--im26-local-bubble-ink',ink);
                    set(node,'--im26-local-bubble-fill',light?'rgba(220,225,231,.28)':'rgba(66,72,81,.38)');
                    set(node,'--im26-local-bubble-outline',light?'rgba(28,38,50,.17)':'rgba(227,234,242,.28)');
                }else set(node,'--im26-local-composer-ink',ink);
            }
        };
        const schedule=()=>{if(!stopped&&!timer)timer=setTimeout(update,100)};
        if(background){
            image=new Image();image.crossOrigin='anonymous';image.onload=()=>{
                if(stopped)return;
                try{const canvas=document.createElement('canvas');canvas.width=canvas.height=64;const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)return;ctx.fillStyle=dark?'#19191b':'#fff';ctx.fillRect(0,0,64,64);ctx.drawImage(image!,0,0,64,64);sample={pixels:ctx.getImageData(0,0,64,64).data,width:image!.naturalWidth,height:image!.naturalHeight};schedule()}catch{/* CORS failure: keep fallback. */}
            };image.src=background;
        }
        const resize=new ResizeObserver(schedule);resize.observe(host);
        const mutation=new MutationObserver(schedule);mutation.observe(host,{childList:true,subtree:true});
        host.addEventListener('scroll',schedule,true);window.addEventListener('resize',schedule);schedule();
        return ()=>{stopped=true;if(timer)clearTimeout(timer);resize.disconnect();mutation.disconnect();host.removeEventListener('scroll',schedule,true);window.removeEventListener('resize',schedule);if(image)image.onload=image.onerror=null;for(const node of touched)for(const key of properties)node.style.removeProperty(key)};
    },[root,background,enabled,dark]);
}
